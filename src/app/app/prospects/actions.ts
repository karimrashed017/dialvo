"use server";

import Anthropic from "@anthropic-ai/sdk";
import { refresh } from "next/cache";
import {
  ActionProblem,
  inWorkspace,
  mustSucceed,
  type ActionResult,
} from "@/lib/app/action";
import {
  cleanLongText,
  cleanText,
  isUuid,
  normalizeEmail,
} from "@/lib/leads/fields";
import { createLimiter } from "@/lib/leads/rate-limit";
import {
  contactDatabaseStatus,
  prospectRuntimeStatus,
} from "@/lib/prospects/config";
import {
  contactQueryFor,
  startContactRun,
} from "@/lib/prospects/contact-search";
import { siteDomain } from "@/lib/prospects/domains";
import { suggestIdealCustomer } from "@/lib/prospects/model";
import { createProspectStore } from "@/lib/prospects/store";
import type { Brief } from "@/lib/prospects/types";
import type { Supabase } from "@/lib/supabase/server";

// Everything a person does in "Find leads". Each action runs through
// inWorkspace(), which checks the session and the membership. What only the
// server may do (start a run, count against the caps) goes through the
// secret-key store; everything else is the person's own write under
// row-level security, or a database function that checks membership itself.

const NOT_ON =
  "Finding leads isn't switched on yet on Dialvo's side. Nothing was started.";

function searchId(form: FormData): string {
  const id = form.get("search");
  if (!isUuid(id)) throw new ActionProblem("Save who you sell to first.");
  return id;
}

/** Saves "who you sell to": a new search, or changes to one. */
export async function saveSearch(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace, user }) => {
    const description = cleanLongText(form.get("description"), 2000);
    if (!description)
      throw new ActionProblem("Describe who you sell to.", "description");
    const fields = {
      name:
        cleanText(form.get("name"), 120) ||
        cleanText(description, 60) ||
        "Search",
      description,
      location: cleanText(form.get("location"), 200),
      company_size: cleanText(form.get("company_size"), 200),
      exclusions: cleanText(form.get("exclusions"), 1000),
    };
    const id = form.get("search");
    if (isUuid(id)) {
      const { data, error } = await supabase
        .from("prospect_searches")
        .update(fields)
        .eq("workspace_id", workspace.id)
        .eq("id", id)
        .select("id");
      mustSucceed({ error }, "update search");
      if (!data?.length) throw new ActionProblem("That search doesn't exist.");
      await refreshSearchDetails(supabase, workspace.id, id);
      refresh();
      return { ok: true, message: "Saved." };
    }
    const { data, error } = await supabase
      .from("prospect_searches")
      .insert({ workspace_id: workspace.id, created_by: user.id, ...fields })
      .select("id")
      .single();
    mustSucceed({ error }, "add search");
    await refreshSearchDetails(supabase, workspace.id, data!.id as string);
    refresh();
    // The form reads the new id from here and moves to it.
    return { ok: true, message: "Saved.", field: data!.id as string };
  });
}

/**
 * With the contact database on, a saved search gets its "Search details"
 * (the query and job titles a run will use) written or brought up to date
 * now, so the team can check them before running. Never fails the save.
 */
async function refreshSearchDetails(
  supabase: Supabase,
  workspaceId: string,
  searchId: string,
) {
  if (!contactDatabaseStatus().on) return;
  await contactQueryFor(supabase, workspaceId, searchId).catch((error) =>
    console.error("[prospects] search details:", (error as Error).message),
  );
}

/** A few suggestions a minute per person, on top of the workspace's daily cap. */
const suggestLimit = createLimiter({ windowMs: 60_000, max: 3 });

export type SuggestResult = ActionResult & {
  suggestion?: Brief & { name: string };
};

/**
 * Drafts "who you sell to" from the workspace's knowledge, for the person to
 * edit. One model call, counted against the day's cap. Nothing is saved.
 */
export async function suggestSearch(): Promise<SuggestResult> {
  let suggestion: SuggestResult["suggestion"];
  const result = await inWorkspace(async ({ supabase, workspace, user }) => {
    const store = prospectRuntimeStatus().on ? createProspectStore() : null;
    if (!store)
      throw new ActionProblem(
        "Suggestions aren't switched on yet on Dialvo's side. Describe who you sell to in your own words.",
      );
    const { data, error } = await supabase
      .from("knowledge_items")
      .select("title, content, source_url, kind")
      .eq("workspace_id", workspace.id)
      .eq("status", "ready")
      .order("created_at", { ascending: false })
      .limit(20);
    mustSucceed({ error }, "read knowledge");
    const knowledge = (
      (data ?? []) as {
        title: string;
        content: string;
        source_url: string | null;
        kind: string;
      }[]
    )
      .filter((k) => k.kind === "text" || k.source_url)
      // "What we sell" (written at sign-up) first.
      .sort(
        (x, y) =>
          Number(y.title === "What we sell") -
          Number(x.title === "What we sell"),
      );
    if (knowledge.length === 0)
      throw new ActionProblem(
        "There's nothing in Knowledge to work from yet. Describe who you sell to in your own words, or add what you sell to Knowledge first.",
      );
    if (suggestLimit.take(user.id) > 0)
      throw new ActionProblem("Give it a moment, then try again.");
    if (!(await store.takeSuggestion(workspace.id, user.id)))
      throw new ActionProblem(
        "That's today's limit for suggestions. You can still write it yourself.",
      );
    const made = await suggestIdealCustomer(new Anthropic(), {
      workspace: { name: workspace.name, website: workspace.website },
      knowledge,
    });
    await store.recordSpend(workspace.id, made.spend.cost_micros);
    if (!made.ok)
      throw new ActionProblem(
        "Couldn't come up with a suggestion just now. Describe who you sell to in your own words.",
      );
    suggestion = made.suggestion;
    return {
      ok: true,
      message: "Here's a first suggestion. Edit it, then save.",
    };
  });
  return { ...result, suggestion };
}

/** "Find leads": starts a run for a saved search. The open page advances it. */
export async function startRun(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace, user }) => {
    const id = searchId(form);
    const store = prospectRuntimeStatus().on ? createProspectStore() : null;
    if (!store) throw new ActionProblem(NOT_ON);
    // The contact database when its key is set, the web search otherwise.
    const started =
      (contactDatabaseStatus().on &&
        (await startContactRun(supabase, workspace.id, id, user.id))) ||
      (await store.startRun(workspace.id, id, user.id));
    if (started.status === "invalid")
      throw new ActionProblem(
        "The search details are empty. Open Search details and write them again.",
      );
    if (started.status === "not_found")
      throw new ActionProblem("That search doesn't exist.");
    if (started.status === "capped")
      throw new ActionProblem(
        "That's today's limit for finding leads in this workspace. Try again tomorrow.",
      );
    refresh();
    return {
      ok: true,
      message:
        started.status === "busy"
          ? "A search is already running."
          : "Started. Results appear below as they are found.",
    };
  });
}

export async function stopRun(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace }) => {
    const id = form.get("run");
    if (!isUuid(id)) throw new ActionProblem("That search isn't running.");
    // Read as the person first: the run must be one they can see.
    const { data, error } = await supabase
      .from("prospect_runs")
      .select("id")
      .eq("workspace_id", workspace.id)
      .eq("id", id)
      .maybeSingle();
    mustSucceed({ error }, "read run");
    const store = createProspectStore();
    if (!data || !store) throw new ActionProblem("That search isn't running.");
    await store.release(id, workspace.id, {
      status: "stopped",
      reason: "stopped_by_user",
    });
    refresh();
    return { ok: true, message: "Stopped. What was found so far is kept." };
  });
}

/** Keep or Remove one prospect (or put it back to undecided). */
export async function decideProspect(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace }) => {
    const id = form.get("prospect");
    const decision = form.get("decision");
    if (
      !isUuid(id) ||
      !["kept", "removed", "undecided"].includes(String(decision))
    )
      throw new ActionProblem("That company isn't in the list any more.");
    mustSucceed(
      await supabase
        .from("prospects")
        .update({ decision })
        .eq("workspace_id", workspace.id)
        .eq("id", id)
        .eq("research_status", "found"),
      "decide prospect",
    );
    refresh();
    return { ok: true };
  });
}

/** Keeps every undecided result of a search that has an email address. */
export async function keepAllWithEmail(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace }) => {
    const { data, error } = await supabase
      .from("prospects")
      .update({ decision: "kept" })
      .eq("workspace_id", workspace.id)
      .eq("search_id", searchId(form))
      .eq("research_status", "found")
      .eq("decision", "undecided")
      .not("email", "is", null)
      .select("id");
    mustSucceed({ error }, "keep prospects");
    refresh();
    const n = data?.length ?? 0;
    return { ok: true, message: n ? `Kept ${n}.` : "Nothing left to keep." };
  });
}

/** "Add to leads": kept prospects of this search become leads. */
export async function addToLeads(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace }) => {
    const { data, error } = await supabase.rpc("prospects_add_to_leads", {
      p_workspace_id: workspace.id,
      p_search_id: searchId(form),
    });
    mustSucceed({ error }, "add prospects to leads");
    const r = (data ?? {}) as {
      added?: number;
      linked?: number;
      no_contact?: number;
    };
    refresh();
    const parts = [
      `${r.added ?? 0} added to Leads`,
      r.linked ? `${r.linked} matched a lead you already had` : "",
      r.no_contact
        ? `${r.no_contact} left here because no email or phone number was found`
        : "",
    ].filter(Boolean);
    return { ok: true, message: `${parts.join("; ")}.` };
  });
}

function draftProblem(
  error: { code?: string; message: string } | null,
  what: string,
) {
  if (!error) return;
  if (error.code === "P0002")
    throw new ActionProblem(
      "That draft is no longer there. It may already have been dealt with.",
    );
  if (error.code === "P0001")
    throw new ActionProblem(
      /do not contact/.test(error.message)
        ? "That lead is marked do not contact, so this email can't be approved."
        : "That address is on your suppression list, so this email can't be approved.",
    );
  if (error.code === "22023")
    throw new ActionProblem("The subject or the email is too long.", "body");
  mustSucceed({ error }, what);
}

/** Approve, save edits to, reopen or discard one first email. */
export async function decideDraft(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase }) => {
    const id = form.get("draft");
    const action = String(form.get("action") ?? "");
    if (
      !isUuid(id) ||
      !["approve", "save", "discard", "reopen"].includes(action)
    )
      throw new ActionProblem("That draft doesn't exist.");
    const edits = action === "approve" || action === "save";
    const subject = cleanText(form.get("subject"), 200);
    const body = cleanLongText(form.get("body"), 5000);
    if (edits && form.has("body") && (!subject || !body))
      throw new ActionProblem(
        "An email needs a subject and some text. Discard it if you don't want it.",
        "body",
      );
    const { error } = await supabase.rpc("outbound_draft_decide", {
      p_draft_id: id,
      p_action: action,
      p_subject: edits && form.has("subject") ? subject : null,
      p_body: edits && form.has("body") ? body : null,
    });
    draftProblem(error, "decide draft");
    refresh();
    return {
      ok: true,
      message:
        action === "approve"
          ? "Approved. It's ready to send once a mailbox is connected."
          : action === "save"
            ? "Saved."
            : undefined,
    };
  });
}

/** Approves every waiting draft on the page. */
export async function approveDrafts(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase }) => {
    const ids = form.getAll("draft").filter(isUuid).slice(0, 500);
    if (ids.length === 0)
      throw new ActionProblem("There's nothing to approve.");
    const { data, error } = await supabase.rpc("outbound_drafts_approve", {
      p_draft_ids: ids,
    });
    draftProblem(error, "approve drafts");
    refresh();
    const n = Number(data ?? 0);
    const left = ids.length - n;
    return {
      ok: true,
      message: `${n} approved and ready to send.${left > 0 ? ` ${left} left as they are (on your suppression list, marked do not contact, or already dealt with).` : ""}`,
    };
  });
}

/** Adds an email address or a whole domain to the never-contact list. */
export async function addSuppression(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace, user }) => {
    const raw = cleanText(form.get("value"), 254).toLowerCase();
    const email = raw.includes("@") ? normalizeEmail(raw) : null;
    const domain = raw.includes("@") ? null : siteDomain(raw);
    if (!email && !domain)
      throw new ActionProblem(
        "Enter an email address (name@company.com) or a domain (company.com).",
        "value",
      );
    const { error } = await supabase.from("outbound_suppressions").insert({
      workspace_id: workspace.id,
      kind: email ? "email" : "domain",
      value: email ?? domain,
      note: cleanText(form.get("note"), 200),
      created_by: user.id,
    });
    if (error?.code === "23505")
      throw new ActionProblem("That's already on the list.", "value");
    if (error?.code === "23514")
      throw new ActionProblem(
        "Enter an email address (name@company.com) or a domain (company.com).",
        "value",
      );
    mustSucceed({ error }, "add suppression");
    refresh();
    return {
      ok: true,
      message:
        "Added. Any email waiting or ready to send to it has been discarded.",
    };
  });
}

/** Takes an entry off the list. Admins only: it allows contact again. */
export async function removeSuppression(form: FormData): Promise<ActionResult> {
  return inWorkspace(
    async ({ supabase, workspace }) => {
      const id = form.get("suppression");
      if (!isUuid(id)) throw new ActionProblem("That entry doesn't exist.");
      mustSucceed(
        await supabase
          .from("outbound_suppressions")
          .delete()
          .eq("workspace_id", workspace.id)
          .eq("id", id),
        "remove suppression",
      );
      refresh();
      return { ok: true };
    },
    { admin: true },
  );
}
