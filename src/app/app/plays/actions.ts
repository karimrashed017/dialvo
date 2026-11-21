"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import {
  ActionProblem,
  inWorkspace,
  mustSucceed,
  type ActionResult,
} from "@/lib/app/action";
import { cleanLongText, cleanText, isUuid } from "@/lib/leads/fields";
import { createLimiter } from "@/lib/leads/rate-limit";
import { makeApiKey } from "@/lib/plays/api-key";
import { DEFAULT_TITLES } from "@/lib/plays/campaign-run";
import {
  EVENT_LIST_MAX_BYTES,
  LOOKALIKE_MAX_SEEDS,
  PLAY_DAYS_MAX,
  PLAY_DAYS_MIN,
  PLAY_DEFAULT_DAYS,
  SIGNAL_MONITOR_MAX_MATCHES,
} from "@/lib/plays/config";
import {
  createPlaysFindymail,
  EMPLOYEE_RANGES,
  type MonitorInput,
} from "@/lib/plays/findymail";
import { readAccounts, readEventList, readSeeds } from "@/lib/plays/lists";
import { createMonitor, keepSignal, removeMonitor } from "@/lib/plays/signals";
import { createPlayStore, type LeadPlay } from "@/lib/plays/store";
import { checkTechnology } from "@/lib/plays/takeout";
import {
  contactDatabaseStatus,
  prospectRuntimeStatus,
} from "@/lib/prospects/config";
import { contactQueryFor } from "@/lib/prospects/contact-search";
import { createServiceClient } from "@/lib/supabase/service";
import { isLanguage } from "@/lib/mail/languages";
import { purposeSequence, setCampaignSequence } from "@/lib/sequences/server";

// Everything a person does on Plays, and on Find leads' Signals, Lookalike
// and Target accounts. Each action runs through inWorkspace(), which checks
// the session and the membership. What only the server may do (start a play,
// spend Findymail credits) goes through the secret-key store, whose database
// functions check membership again; the person's own settings go through
// functions that check they are an owner or admin.

const NOT_ON =
  "This isn't switched on yet on Dialvo's side. Nothing was started.";
const NO_DATABASE =
  "This needs the contact database, which isn't switched on yet on Dialvo's side. Nothing was started.";

/** Per person: Findymail lookups started by hand. */
const lookupLimit = createLimiter({ windowMs: 60_000, max: 20 });

function store() {
  const s = createPlayStore();
  if (!s) throw new ActionProblem(NOT_ON);
  return s;
}

function findymail() {
  const f = contactDatabaseStatus().on ? createPlaysFindymail() : null;
  if (!f) throw new ActionProblem(NO_DATABASE);
  return f;
}

const LEAD_PLAYS: Record<string, LeadPlay> = {
  reactivation: "reactivation",
  closed_lost: "closed_lost",
  plg: "plg",
  expansion: "expansion",
  nurture: "nurture",
  onboarding: "onboarding",
};

const PLAY_NAME: Record<LeadPlay, string> = {
  reactivation: "Lead reactivation",
  closed_lost: "Closed lost",
  plg: "Trial users ready to buy",
  expansion: "Customer expansion",
  nurture: "Lead nurture",
  onboarding: "Customer onboarding",
};

function days(form: FormData, kind: LeadPlay): number {
  const n = Number(form.get("days") ?? PLAY_DEFAULT_DAYS[kind]);
  if (!Number.isInteger(n) || n < PLAY_DAYS_MIN || n > PLAY_DAYS_MAX)
    throw new ActionProblem(
      `Choose a number of days from ${PLAY_DAYS_MIN} to ${PLAY_DAYS_MAX}.`,
      "days",
    );
  return n;
}

/**
 * The sequence and language a play run uses, from its start form. "purpose"
 * is the play's ready-made sequence (onboarding, nurture), made the first
 * time; empty is the workspace's default. The foreign key keeps a chosen
 * sequence inside the workspace.
 */
async function applySequence(
  workspaceId: string,
  campaignId: string,
  form: FormData,
  purpose: "onboarding" | "nurture" | null,
) {
  const choice = String(form.get("sequence") ?? "");
  const language = String(form.get("language") ?? "auto");
  const sequence =
    choice === "purpose" && purpose
      ? await purposeSequence(workspaceId, purpose)
      : isUuid(choice)
        ? choice
        : null;
  await setCampaignSequence(
    workspaceId,
    campaignId,
    sequence,
    isLanguage(language) ? language : "auto",
  );
}

/** Starts a play on the workspace's own leads: their drafts wait for approval. */
export async function startLeadPlay(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ workspace, user }) => {
    const kind = LEAD_PLAYS[String(form.get("kind"))];
    if (!kind) throw new ActionProblem("That play doesn't exist.");
    if (!prospectRuntimeStatus().on) throw new ActionProblem(NOT_ON);
    const n = days(form, kind);
    const date = new Date().toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
    });
    const started = await store().start(
      workspace.id,
      user.id,
      kind,
      `${PLAY_NAME[kind]}, ${date}`,
      n,
    );
    refresh();
    if (started.status === "empty")
      return {
        ok: false,
        message:
          "No lead fits this play right now, so nothing was started. Try a different number of days, or come back later.",
      };
    if (started.status !== "created" || !started.campaign_id)
      throw new ActionProblem("That play couldn't be started.");
    await applySequence(
      workspace.id,
      started.campaign_id,
      form,
      kind === "onboarding" || kind === "nurture" ? kind : null,
    );
    refresh();
    return {
      ok: true,
      message: `Started for ${started.selected} ${started.selected === 1 ? "lead" : "leads"}. Write their emails below; each one waits for your approval.`,
    };
  });
}

export async function stopCampaign(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ workspace, user }) => {
    const id = form.get("campaign");
    if (!isUuid(id)) throw new ActionProblem("That doesn't exist.");
    await store().stop(workspace.id, id, user.id);
    refresh();
    return {
      ok: true,
      message: "Stopped. No more emails will be written for it.",
    };
  });
}

const AUDIENCE = {
  "event-registration": "registered",
  "event-follow-up": "attended",
  "event-no-show": "no_show",
} as const;

/** An uploaded registrant or attendee list becomes an event play. */
export async function importEvent(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ workspace, user }) => {
    const slug = String(form.get("play")) as keyof typeof AUDIENCE;
    const audience = AUDIENCE[slug];
    if (!audience) throw new ActionProblem("That play doesn't exist.");
    if (!prospectRuntimeStatus().on) throw new ActionProblem(NOT_ON);
    const event = cleanText(form.get("event"), 120);
    if (!event) throw new ActionProblem("Name the event.", "event");
    const link = cleanText(form.get("link"), 500);
    if (link && !/^https:\/\/[^\s<>"]+$/.test(link))
      throw new ActionProblem(
        "The link must be a full web address starting with https://",
        "link",
      );
    const date = cleanText(form.get("date"), 40);
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0)
      throw new ActionProblem("Choose the CSV file with your list.", "file");
    if (file.size > EVENT_LIST_MAX_BYTES)
      throw new ActionProblem(
        "That file is too large. Split it into smaller lists.",
        "file",
      );
    const list = readEventList(await file.text());
    if (!list.ok) throw new ActionProblem(list.error, "file");
    if (audience !== "registered" && !list.hasAttended)
      throw new ActionProblem(
        "This play needs an “attended” column (yes or no) to know who came.",
        "file",
      );
    const result = await store().eventImport(workspace.id, user.id, {
      event,
      link,
      date,
      audience,
      rows: list.rows,
    });
    refresh();
    if (result.status === "invalid")
      throw new ActionProblem("That list couldn't be read. Check the file.");
    const extra = [
      result.new_leads
        ? `${result.new_leads} new ${result.new_leads === 1 ? "lead was" : "leads were"} added from the list.`
        : "",
      (result.skipped ?? 0) + list.skipped
        ? `${(result.skipped ?? 0) + list.skipped} left out (no valid email, a repeat, do not contact or on your never-contact list).`
        : "",
    ]
      .filter(Boolean)
      .join(" ");
    if (result.status === "empty")
      return {
        ok: false,
        message:
          `Nobody on that list is in this play's audience, so nothing was started. ${extra}`.trim(),
      };
    if (result.campaign_id)
      await applySequence(workspace.id, result.campaign_id, form, null);
    return {
      ok: true,
      message:
        `Ready for ${result.selected} ${result.selected === 1 ? "person" : "people"}. ${extra} Write their emails below; each waits for your approval.`.trim(),
    };
  });
}

/** Speed to lead: on or off, and whether its replies wait for approval. */
export async function saveSpeedToLead(form: FormData): Promise<ActionResult> {
  return inWorkspace(
    async ({ supabase, workspace }) => {
      const enabled = form.get("enabled") === "on";
      const auto = form.get("auto_send") === "on";
      const { error } = await supabase.rpc("play_settings_save", {
        p_workspace_id: workspace.id,
        p_play: "speed_to_lead",
        p_enabled: enabled,
        p_auto_send: enabled && auto,
      });
      mustSucceed({ error }, "save speed to lead");
      refresh();
      return {
        ok: true,
        message: !enabled
          ? "Speed to lead is off."
          : auto
            ? "On. Replies to new leads are sent without waiting for approval."
            : "On. Replies to new leads wait for your approval in Find leads, Emails.",
      };
    },
    { admin: true },
  );
}

/** Competitive takeout: a Find leads search for companies using a product. */
export async function startTakeout(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace, user }) => {
    const competitor = cleanText(form.get("competitor"), 80);
    if (!competitor)
      throw new ActionProblem("Name the competitor's product.", "competitor");
    const who = cleanLongText(form.get("who"), 1500);
    const description = `Companies that use ${competitor}${who ? `. ${who}` : ""}`;
    const { data, error } = await supabase
      .from("prospect_searches")
      .insert({
        workspace_id: workspace.id,
        created_by: user.id,
        name: `Uses ${competitor}`.slice(0, 120),
        description,
        location: cleanText(form.get("location"), 200),
        company_size: cleanText(form.get("company_size"), 200),
        exclusions: `companies that sell the same kind of product as us, ${competitor} itself`,
      })
      .select("id")
      .single();
    mustSucceed({ error }, "add takeout search");
    const id = data!.id as string;
    // The play and the product aren't the person's to change later: set
    // with the secret key, naming the workspace.
    const service = createServiceClient();
    if (service) {
      const marked = await service
        .from("prospect_searches")
        .update({ play: "takeout", competitor })
        .eq("workspace_id", workspace.id)
        .eq("id", id);
      mustSucceed(marked, "mark takeout search");
    }
    if (contactDatabaseStatus().on)
      await contactQueryFor(supabase, workspace.id, id).catch((e) =>
        console.error("[plays] takeout details:", (e as Error).message),
      );
    redirect(`/app/prospects?search=${id}`);
  });
}

/** Competitive takeout: check the kept companies for the product. */
export async function checkTakeout(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace, user }) => {
    const id = form.get("search");
    if (!isUuid(id)) throw new ActionProblem("That search doesn't exist.");
    if (lookupLimit.take(user.id) > 0)
      throw new ActionProblem("One moment: too many checks at once.");
    const { data: search } = await supabase
      .from("prospect_searches")
      .select("id, competitor")
      .eq("workspace_id", workspace.id)
      .eq("id", id)
      .maybeSingle();
    if (!search?.competitor)
      throw new ActionProblem("That isn't a competitive-takeout search.");
    const { data: list, error } = await supabase
      .from("prospects")
      .select("id, domain, facts")
      .eq("workspace_id", workspace.id)
      .eq("search_id", id)
      .eq("decision", "kept")
      .limit(100);
    mustSucceed({ error }, "read takeout prospects");
    if (!list?.length)
      throw new ActionProblem(
        "Keep some companies in Review first; only kept ones are checked.",
      );
    const result = await checkTechnology(
      {
        workspaceId: workspace.id,
        competitor: search.competitor as string,
        prospects: list as { id: string; domain: string; facts: [] }[],
      },
      { store: store(), findymail: findymail() },
    );
    refresh();
    return {
      ok: true,
      message: [
        `${result.checked} checked: ${result.confirmed} confirmed using ${search.competitor}, ${result.notFound} not detected.`,
        result.failed
          ? `${result.failed} couldn't be checked; try again later.`
          : "",
        result.capped
          ? "Today's contact-database allowance ran out; the rest can be checked tomorrow."
          : "",
      ]
        .filter(Boolean)
        .join(" "),
    };
  });
}

// --- Target accounts and lookalike -------------------------------------------------

function titlesFrom(form: FormData): string[] {
  const titles = String(form.get("titles") ?? "")
    .split(/[,\n]/)
    .map((t) => cleanText(t, 60))
    .filter(Boolean)
    .slice(0, 10);
  return titles.length ? titles : DEFAULT_TITLES;
}

async function startCampaign(
  workspaceId: string,
  userId: string,
  campaignId: string,
): Promise<string> {
  const started = await store().startCampaignRun(
    workspaceId,
    campaignId,
    userId,
    2,
  );
  if (started.status === "capped")
    throw new ActionProblem(
      "This workspace has used today's allowance for finding leads or contact lookups. It resets at midnight UTC; the list is saved.",
    );
  if (started.status === "nothing_left")
    throw new ActionProblem("Every company on that list has been looked up.");
  if (started.status !== "started" && started.status !== "busy")
    throw new ActionProblem("That couldn't be started.");
  return started.run_id!;
}

export async function createAccounts(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ workspace, user }) => {
    if (!prospectRuntimeStatus().on) throw new ActionProblem(NOT_ON);
    findymail();
    const list = readAccounts(String(form.get("accounts") ?? ""));
    if (!list.ok) throw new ActionProblem(list.error, "accounts");
    const name =
      cleanText(form.get("name"), 120) ||
      `Target accounts, ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;
    const made = await store().createCompanyCampaign(
      workspace.id,
      user.id,
      "accounts",
      name,
      { titles: titlesFrom(form) },
      list.rows,
    );
    if (made.status !== "created" || !made.campaign_id)
      throw new ActionProblem(
        "That list couldn't be saved. Check it and try again.",
      );
    await startCampaign(workspace.id, user.id, made.campaign_id);
    redirect(`/app/prospects/accounts?campaign=${made.campaign_id}`);
  });
}

export async function createLookalike(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ workspace, user }) => {
    if (!prospectRuntimeStatus().on) throw new ActionProblem(NOT_ON);
    findymail();
    const seeds = readSeeds(
      String(form.get("seeds") ?? ""),
      LOOKALIKE_MAX_SEEDS,
    );
    if (seeds.length === 0)
      throw new ActionProblem(
        "Give at least one company's website, such as example.com.",
        "seeds",
      );
    const made = await store().createCompanyCampaign(
      workspace.id,
      user.id,
      "lookalike",
      `Like ${seeds.join(", ")}`.slice(0, 120),
      {
        seeds,
        titles: titlesFrom(form),
        same_country: form.get("same_country") === "on",
        same_size: form.get("same_size") === "on",
      },
      [],
    );
    if (made.status !== "created" || !made.campaign_id)
      throw new ActionProblem("That couldn't be saved. Check the websites.");
    await startCampaign(workspace.id, user.id, made.campaign_id);
    redirect(`/app/prospects/lookalike?campaign=${made.campaign_id}`);
  });
}

/** Looks up the next part of a saved list (a new run). */
export async function continueCampaign(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ workspace, user }) => {
    const id = form.get("campaign");
    if (!isUuid(id)) throw new ActionProblem("That list doesn't exist.");
    findymail();
    await startCampaign(workspace.id, user.id, id);
    refresh();
    return { ok: true, message: "Looking up the next companies." };
  });
}

// --- Signals -----------------------------------------------------------------------

const SIGNAL_TYPES = ["new_hire", "job_change", "keyword_mention"] as const;

export async function addMonitor(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ workspace, user }) => {
    const type = String(form.get("type")) as (typeof SIGNAL_TYPES)[number];
    if (!SIGNAL_TYPES.includes(type))
      throw new ActionProblem("Choose a kind of signal.", "type");
    const list = (name: string, max: number, len: number) =>
      String(form.get(name) ?? "")
        .split(/[,\n]/)
        .map((v) => cleanText(v, len))
        .filter(Boolean)
        .slice(0, max);
    const keywords = list("keywords", 5, 60);
    if (type === "keyword_mention" && keywords.length === 0)
      throw new ActionProblem(
        "Add at least one keyword to watch for.",
        "keywords",
      );
    const countries = list("countries", 10, 2)
      .map((c) => c.toUpperCase())
      .filter((c) => /^[A-Z]{2}$/.test(c));
    const sizes = form
      .getAll("sizes")
      .map(String)
      .filter((s) => (EMPLOYEE_RANGES as readonly string[]).includes(s));
    const monitor: MonitorInput = {
      name:
        cleanText(form.get("name"), 80) ||
        (type === "keyword_mention"
          ? `Mentions: ${keywords[0]}`
          : type === "new_hire"
            ? "New hires"
            : "Job changes"),
      signal_type: type,
      keywords,
      countries,
      employee_count_ranges: sizes,
      target_companies:
        type === "keyword_mention" ? [] : list("companies", 100, 120),
      max_matches: SIGNAL_MONITOR_MAX_MATCHES,
    };
    const made = await createMonitor(
      { workspaceId: workspace.id, userId: user.id, monitor },
      { store: store(), findymail: findymail() },
    );
    refresh();
    if (made === "capped")
      throw new ActionProblem(
        "This workspace has as many signal monitors as it may have. Remove one first.",
      );
    if (made === "refused")
      throw new ActionProblem(
        "The contact database didn't accept that monitor. Check the keywords and filters.",
      );
    if (made !== "created") throw new ActionProblem("That couldn't be saved.");
    return { ok: true, message: "Watching. Signals are pulled once a day." };
  });
}

export async function deleteMonitor(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ workspace, user }) => {
    const id = form.get("monitor");
    if (!isUuid(id)) throw new ActionProblem("That monitor doesn't exist.");
    const done = await removeMonitor(
      { workspaceId: workspace.id, userId: user.id, monitorId: id },
      { store: store(), findymail: findymail() },
    );
    refresh();
    if (!done)
      throw new ActionProblem("That couldn't be removed just now. Try again.");
    return {
      ok: true,
      message: "Removed. It no longer finds or charges for signals.",
    };
  });
}

export async function decideSignal(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace, user }) => {
    const id = form.get("signal");
    if (!isUuid(id)) throw new ActionProblem("That signal doesn't exist.");
    if (form.get("action") === "dismiss") {
      const { error } = await supabase.rpc("signal_dismiss", {
        p_signal_id: id,
      });
      mustSucceed({ error }, "dismiss signal");
      refresh();
      return { ok: true };
    }
    if (lookupLimit.take(user.id) > 0)
      throw new ActionProblem("One moment: too many lookups at once.");
    const kept = await keepSignal(
      { workspaceId: workspace.id, userId: user.id, signalId: id },
      { store: store(), findymail: findymail() },
    );
    refresh();
    const message = {
      kept: "Kept: they are in Buying signals on Find leads, and their first email can be written.",
      no_email: "No email was found for that person, so they weren't added.",
      skipped:
        "Left out: you already have this company or person, or they're on your never-contact list.",
      capped:
        "Today's contact-database allowance is used up. Try again tomorrow.",
      not_found: "That signal can't be kept.",
      failed: "The contact database didn't answer. Try again in a few minutes.",
    }[kept];
    return { ok: kept === "kept", message };
  });
}

// --- API keys ----------------------------------------------------------------------

export async function createApiKey(form: FormData): Promise<ActionResult> {
  return inWorkspace(
    async ({ supabase, workspace }) => {
      const key = makeApiKey();
      const { error } = await supabase.rpc("api_key_create", {
        p_workspace_id: workspace.id,
        p_name: cleanText(form.get("name"), 80) || "Product events",
        p_prefix: key.prefix,
        p_hash: key.hash,
      });
      if (error?.code === "P0001")
        throw new ActionProblem(
          "This workspace has three keys. Revoke one first.",
        );
      mustSucceed({ error }, "create api key");
      refresh();
      // Shown once, here, and never stored.
      return { ok: true, message: key.key, field: "key" };
    },
    { admin: true },
  );
}

export async function revokeApiKey(form: FormData): Promise<ActionResult> {
  return inWorkspace(
    async ({ supabase }) => {
      const id = form.get("key");
      if (!isUuid(id)) throw new ActionProblem("That key doesn't exist.");
      const { error } = await supabase.rpc("api_key_revoke", { p_key_id: id });
      mustSucceed({ error }, "revoke api key");
      refresh();
      return {
        ok: true,
        message: "Revoked. Requests with it are refused from now on.",
      };
    },
    { admin: true },
  );
}
