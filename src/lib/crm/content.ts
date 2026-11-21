import { createHash } from "node:crypto";
import { isFreeMail, siteDomain } from "@/lib/prospects/domains";
import { NOTE_MAX_CHARS } from "./config";
import type {
  ChatDetail,
  EmailDetail,
  EnrichmentDetail,
  JobLead,
  MeetingDetail,
  MeetingInput,
} from "./types";

// What Dialvo writes into the CRM, as pure functions. Everything that came
// from a visitor, a lead or the CRM is escaped before it goes into a note's
// HTML.

const escape = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const lines = (s: string) => escape(s).replace(/\r?\n/g, "<br>");

/**
 * A word written into every note, meeting and deal Dialvo creates, unique to
 * the Dialvo event. A retry looks for it first, so a note whose first try
 * reached the CRM but wasn't recorded is not written twice. Letters and
 * digits only, so the CRM's search treats it as one word.
 */
export function marker(workspaceId: string, sourceKey: string): string {
  return (
    "dialvoref" +
    createHash("sha256")
      .update(`${workspaceId}:${sourceKey}`)
      .digest("hex")
      .slice(0, 20)
  );
}

const footer = (ref: string) => `<p>Logged by Dialvo. Ref ${ref}</p>`;

function cap(html: string): string {
  return html.length <= NOTE_MAX_CHARS
    ? html
    : html.slice(0, NOTE_MAX_CHARS - 20) + "…";
}

const OUTCOME_WORDS: Record<string, string> = {
  qualified: "Qualified",
  not_qualified: "Not a fit",
  needs_human: "Asked for a person",
};

export function chatNote(detail: ChatDetail, ref: string): string {
  const outcome = detail.outcome
    ? (OUTCOME_WORDS[detail.outcome] ?? detail.outcome)
    : "Chat ended";
  const parts = [
    `<p><strong>Website chat (Dialvo)</strong>: ${escape(outcome)}</p>`,
  ];
  if (detail.outcome_summary)
    parts.push(`<p>Summary: ${lines(detail.outcome_summary)}</p>`);
  if (detail.transcript)
    parts.push(
      `<p>Transcript (latest messages):<br>${lines(detail.transcript)}</p>`,
    );
  return cap(parts.join("") + footer(ref));
}

export function emailNote(detail: EmailDetail, ref: string): string {
  const head =
    detail.direction === "out"
      ? "Email sent by Dialvo"
      : "Reply received (Dialvo)";
  const parts = [`<p><strong>${head}</strong></p>`];
  if (detail.subject) parts.push(`<p>Subject: ${escape(detail.subject)}</p>`);
  parts.push(`<p>${lines(detail.body)}</p>`);
  return cap(parts.join("") + footer(ref));
}

export function optOutNote(ref: string): string {
  return (
    "<p><strong>Do not contact (Dialvo)</strong></p>" +
    "<p>This person asked not to be contacted. Dialvo has stopped all outreach to them.</p>" +
    footer(ref)
  );
}

const ENRICHMENT_TITLE: Record<EnrichmentDetail["kind"], string> = {
  filled: "Details filled in",
  job_change: "Job change",
  email_invalid: "Email no longer works",
  work_email: "Work email found",
};

/**
 * What Dialvo's enrichment found, as a note. The CRM's own fields are left
 * as they are: the team decides whether to change them.
 */
export function enrichmentNote(detail: EnrichmentDetail, ref: string): string {
  const changes = Object.entries(detail.changes ?? {})
    .filter(([, c]) => c && (c.from || c.to))
    .map(
      ([field, c]) =>
        `<li>${escape(field)}: ${escape(c.from || "(empty)")} &rarr; ${escape(c.to || "(empty)")}</li>`,
    )
    .join("");
  return (
    `<p><strong>${ENRICHMENT_TITLE[detail.kind] ?? "Updated"} (Dialvo)</strong></p>` +
    `<p>${lines(detail.summary)}</p>` +
    (changes ? `<ul>${changes}</ul>` : "") +
    "<p>From Dialvo's contact database lookup.</p>" +
    footer(ref)
  );
}

const MEETING_WORDS: Record<MeetingDetail["status"], string> = {
  scheduled: "Booked",
  completed: "Held",
  cancelled: "Cancelled",
  no_show: "No-show",
};

export function meetingInput(detail: MeetingDetail, ref: string): MeetingInput {
  const title = detail.title.trim() || "Meeting booked through Dialvo";
  return {
    title,
    startsAt: detail.starts_at,
    endsAt: detail.ends_at,
    status: detail.status,
    body: cap(
      `<p><strong>Meeting (Dialvo)</strong>: ${MEETING_WORDS[detail.status]}</p>` +
        `<p>Booked by: ${detail.booked_by === "lead" ? "the lead" : detail.booked_by === "agent" ? "Dialvo's agent" : "a teammate"}</p>` +
        footer(ref),
    ),
  };
}

/** The company's domain: its website, else a work email's domain. */
export function companyDomain(lead: JobLead): string | null {
  const fromSite = siteDomain(lead.website ?? "");
  if (fromSite) return fromSite;
  const at = (lead.email ?? "").split("@")[1];
  const fromEmail = at ? siteDomain(at) : null;
  return fromEmail && !isFreeMail(fromEmail) ? fromEmail : null;
}

export function companyName(lead: JobLead, domain: string): string {
  return (lead.company ?? "").trim().slice(0, 200) || domain;
}

/** "Ada Lovelace" -> ["Ada", "Lovelace"]. */
export function splitName(name: string): [string, string] {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return ["", ""];
  return [parts[0].slice(0, 100), parts.slice(1).join(" ").slice(0, 100)];
}

export function dealTitle(lead: JobLead): string {
  const who = (lead.company || lead.name || lead.email || "New lead").trim();
  return `${who.slice(0, 150)} (from Dialvo)`;
}

const EMAIL = /^[^\s@<>()",;:]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/** A lower-cased email from untrusted CRM data, or null. */
export function cleanEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  return v.length >= 3 && v.length <= 254 && EMAIL.test(v) ? v : null;
}

/** A company domain from untrusted CRM data (a domain or a URL), or null. */
export function cleanDomain(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 300) return null;
  const d = siteDomain(value);
  return d && d.length <= 253 && !isFreeMail(d) ? d : null;
}
