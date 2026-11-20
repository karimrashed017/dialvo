"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import {
  ActionProblem,
  inWorkspace,
  mustSucceed,
  type ActionContext,
  type ActionResult,
} from "@/lib/app/action";
import {
  CONSENT_CHANNELS,
  CONSENT_LABEL,
  LEAD_STATUSES,
  STATUS_LABEL,
  type ConsentChannel,
  type LeadStatus,
} from "@/lib/app/types";
import { dedupe, MAX_IMPORT_ROWS, type ImportLead } from "@/lib/leads/csv";
import {
  cleanLongText,
  cleanText,
  isUuid,
  normalizeEmail,
  normalizePhone,
} from "@/lib/leads/fields";

// Every change to a lead. Each action runs through inWorkspace(), which
// checks the session and the membership; every query also names the
// workspace, so an id from another workspace matches nothing.

function leadId(form: FormData): string {
  const id = form.get("lead");
  if (!isUuid(id)) throw new ActionProblem("That lead doesn't exist.");
  return id;
}

/** The contact fields of the add and edit forms, cleaned. */
function contactFields(form: FormData) {
  const rawEmail = cleanText(form.get("email"), 254);
  const rawPhone = cleanText(form.get("phone"), 40);
  const email = normalizeEmail(rawEmail);
  const phone = normalizePhone(rawPhone);
  if (rawEmail && !email)
    throw new ActionProblem("That email doesn't look right.", "email");
  if (rawPhone && !phone)
    throw new ActionProblem("That phone number doesn't look right.", "phone");
  if (!email && !phone)
    throw new ActionProblem("Add an email or a phone number.", "email");
  return {
    name: cleanText(form.get("name"), 200),
    email,
    phone,
    company: cleanText(form.get("company"), 200) || null,
    website: cleanText(form.get("website"), 300) || null,
  };
}

async function log(
  { supabase, user, workspace }: ActionContext,
  lead: string | null,
  kind: string,
  summary: string,
  metadata: Record<string, unknown> = {},
) {
  mustSucceed(
    await supabase.from("activity_events").insert({
      workspace_id: workspace.id,
      lead_id: lead,
      actor_id: user.id,
      kind,
      summary,
      metadata,
    }),
    "log event",
  );
}

const DUPLICATE = "23505";

export async function addLead(form: FormData): Promise<ActionResult> {
  return inWorkspace(async (context) => {
    const { supabase, workspace } = context;
    const fields = contactFields(form);
    const { data, error } = await supabase
      .from("leads")
      .insert({ workspace_id: workspace.id, source: "manual", ...fields })
      .select("id")
      .single();
    if (error?.code === DUPLICATE)
      throw new ActionProblem(
        "There's already a lead with that email address.",
        "email",
      );
    mustSucceed({ error }, "add lead");
    await log(context, data!.id, "lead_created", "Lead added by hand");
    redirect(`/app/leads/${data!.id}`);
  });
}

export async function updateLead(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace }) => {
    const id = leadId(form);
    const owner = form.get("owner");
    const { error } = await supabase
      .from("leads")
      .update({
        ...contactFields(form),
        owner_id: isUuid(owner) ? owner : null,
      })
      .eq("workspace_id", workspace.id)
      .eq("id", id);
    if (error?.code === DUPLICATE)
      throw new ActionProblem(
        "Another lead already has that email address.",
        "email",
      );
    // An owner who isn't in this workspace breaks the foreign key.
    if (error?.code === "23503")
      throw new ActionProblem("Choose an owner from this workspace.", "owner");
    mustSucceed({ error }, "update lead");
    refresh();
    return { ok: true, message: "Saved." };
  });
}

export async function setLeadStatus(form: FormData): Promise<ActionResult> {
  return inWorkspace(async (context) => {
    const { supabase, workspace } = context;
    const id = leadId(form);
    const status = form.get("status") as LeadStatus;
    if (!LEAD_STATUSES.includes(status))
      throw new ActionProblem("Choose a status.");
    const current = await supabase
      .from("leads")
      .select("status")
      .eq("workspace_id", workspace.id)
      .eq("id", id)
      .maybeSingle();
    mustSucceed(current, "read lead");
    const from = current.data?.status as LeadStatus | undefined;
    if (!from) throw new ActionProblem("That lead doesn't exist.");
    if (from === status) return { ok: true };
    mustSucceed(
      await supabase
        .from("leads")
        .update({ status })
        .eq("workspace_id", workspace.id)
        .eq("id", id),
      "set status",
    );
    await log(
      context,
      id,
      "lead_status_changed",
      `Status changed from ${STATUS_LABEL[from]} to ${STATUS_LABEL[status]}`,
      { from, to: status },
    );
    refresh();
    return { ok: true };
  });
}

export async function addNote(form: FormData): Promise<ActionResult> {
  return inWorkspace(async (context) => {
    const id = leadId(form);
    const note = cleanLongText(form.get("note"), 5000);
    if (!note) throw new ActionProblem("Write the note first.", "note");
    await log(context, id, "note", note);
    refresh();
    return { ok: true };
  });
}

export async function setDoNotContact(form: FormData): Promise<ActionResult> {
  return inWorkspace(async (context) => {
    const { supabase, workspace } = context;
    const id = leadId(form);
    const on = form.get("on") === "true";
    const { data, error } = await supabase
      .from("leads")
      .update({
        do_not_contact: on,
        do_not_contact_at: on ? new Date().toISOString() : null,
      })
      .eq("workspace_id", workspace.id)
      .eq("id", id)
      .select("id");
    mustSucceed({ error }, "set do-not-contact");
    if (!data?.length) throw new ActionProblem("That lead doesn't exist.");
    await log(
      context,
      id,
      "do_not_contact",
      on
        ? "Marked do not contact: agents won't reach out on any channel"
        : "Do not contact removed",
      { on },
    );
    refresh();
    return { ok: true };
  });
}

export async function setConsent(form: FormData): Promise<ActionResult> {
  return inWorkspace(async (context) => {
    const { supabase, workspace, user } = context;
    const id = leadId(form);
    const channel = form.get("channel") as ConsentChannel;
    if (!CONSENT_CHANNELS.includes(channel))
      throw new ActionProblem("Choose a channel.");
    const on = form.get("on") === "true";
    const how = cleanText(form.get("source"), 100);
    if (on && !how)
      throw new ActionProblem(
        "Say how they agreed (for example: asked on a call, 12 Nov).",
        "source",
      );
    const { data, error } = await supabase
      .from("leads")
      .update({
        [`consent_${channel}`]: on,
        [`consent_${channel}_at`]: on ? new Date().toISOString() : null,
        [`consent_${channel}_source`]: on
          ? `${how} (recorded by ${user.email})`.slice(0, 120)
          : null,
      })
      .eq("workspace_id", workspace.id)
      .eq("id", id)
      .select("id");
    mustSucceed({ error }, "set consent");
    if (!data?.length) throw new ActionProblem("That lead doesn't exist.");
    await log(
      context,
      id,
      "consent_changed",
      on
        ? `Consent recorded for ${CONSENT_LABEL[channel]}: ${how}`
        : `Consent withdrawn for ${CONSENT_LABEL[channel]}`,
      { channel, on },
    );
    refresh();
    return { ok: true };
  });
}

export async function deleteLead(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace }) => {
    const id = leadId(form);
    mustSucceed(
      await supabase
        .from("leads")
        .delete()
        .eq("workspace_id", workspace.id)
        .eq("id", id),
      "delete lead",
    );
    redirect("/app/leads");
  });
}

export type ImportResult = ActionResult & {
  added?: number;
  alreadyHere?: number;
  repeated?: number;
  rejected?: number;
};

/**
 * The CSV import's last step. The browser sends the rows it mapped; nothing
 * about them is trusted. Every row is cleaned and checked again here, then
 * matched against the leads the workspace already has, by email and by phone.
 */
export async function importLeads(input: unknown): Promise<ImportResult> {
  let summary: ImportResult = { ok: false };
  const result = await inWorkspace(async (context) => {
    const { supabase, workspace } = context;
    if (!Array.isArray(input) || input.length === 0)
      throw new ActionProblem("There are no rows to import.");
    if (input.length > MAX_IMPORT_ROWS)
      throw new ActionProblem(
        `Import up to ${MAX_IMPORT_ROWS.toLocaleString("en-US")} rows at a time.`,
      );

    const clean: ImportLead[] = [];
    let rejected = 0;
    for (const raw of input as Record<string, unknown>[]) {
      const row = raw && typeof raw === "object" ? raw : {};
      const email = normalizeEmail(row.email);
      const phone = normalizePhone(row.phone);
      if (!email && !phone) {
        rejected++;
        continue;
      }
      clean.push({
        name: cleanText(row.name, 200),
        email,
        phone,
        company: cleanText(row.company, 200) || null,
        website: cleanText(row.website, 300) || null,
        status: LEAD_STATUSES.includes(row.status as LeadStatus)
          ? (row.status as LeadStatus)
          : "new",
      });
    }

    // Which of these does the workspace already have?
    const emails = [
      ...new Set(clean.flatMap((l) => (l.email ? [l.email] : []))),
    ];
    const phones = [
      ...new Set(clean.flatMap((l) => (l.phone ? [l.phone] : []))),
    ];
    const known = { emails: new Set<string>(), phones: new Set<string>() };
    for (const [column, values, into] of [
      ["email", emails, known.emails],
      ["phone", phones, known.phones],
    ] as const)
      for (let i = 0; i < values.length; i += 200) {
        const found = await supabase
          .from("leads")
          .select(column)
          .eq("workspace_id", workspace.id)
          .in(column, values.slice(i, i + 200));
        mustSucceed(found, "check for duplicates");
        for (const row of (found.data ?? []) as unknown as Record<
          string,
          string
        >[])
          into.add(row[column]);
      }

    const { fresh, inFile, inWorkspace: here } = dedupe(clean, known);
    for (let i = 0; i < fresh.length; i += 500)
      mustSucceed(
        await supabase.from("leads").insert(
          fresh.slice(i, i + 500).map((l) => ({
            ...l,
            workspace_id: workspace.id,
            source: "import",
          })),
        ),
        "import leads",
      );
    if (fresh.length > 0)
      await log(
        context,
        null,
        "lead_imported",
        `Imported ${fresh.length} ${fresh.length === 1 ? "lead" : "leads"} from a CSV file`,
        { added: fresh.length },
      );
    summary = {
      ok: true,
      added: fresh.length,
      alreadyHere: here.length,
      repeated: inFile.length,
      rejected,
    };
    refresh();
    return summary;
  });
  return result.ok ? summary : result;
}
