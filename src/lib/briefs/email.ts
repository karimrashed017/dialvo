import type { AlertEmail } from "@/lib/alerts/email";
import { SITE_URL } from "@/lib/site";
import type { AnyBrief, Cited, Source } from "./types";

// The email a brief is sent as, to one teammate: the meeting's host, else
// the lead's owner, else whoever asked. Pure. Everything in it came from a
// lead's website, the web or a conversation, so all of it is escaped.

const esc = (t: string) =>
  t
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const one = (t: string, n: number) =>
  t
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, n);

const refs = (c: Cited) =>
  c.sources.length ? ` [${c.sources.join(", ")}]` : "";

function sections(brief: AnyBrief): { title: string; items: string[] }[] {
  if (brief.kind === "closed_lost")
    return [
      {
        title: "Why it was likely lost",
        items: brief.reasons.map((r) => r.text + refs(r)),
      },
      { title: "What might change", items: brief.what_might_change },
      { title: "Next step", items: brief.next_step ? [brief.next_step] : [] },
    ];
  return [
    { title: "The company", items: brief.company.map((c) => c.text + refs(c)) },
    {
      title: "People",
      items: brief.people.map(
        (p) =>
          `${p.name}${p.role ? `, ${p.role}` : ""}${p.note ? `: ${p.note}` : ""}${p.sources.length ? ` [${p.sources.join(", ")}]` : ""}`,
      ),
    },
    {
      title: "What was said before",
      items: brief.history.map((c) => c.text + refs(c)),
    },
    { title: "Open questions", items: brief.open_questions },
    {
      title: "Talking points",
      items: brief.talking_points.map((c) => c.text + refs(c)),
    },
  ];
}

export function buildBriefEmail(input: {
  workspace: string;
  leadId: string;
  lead: string;
  company: string;
  meeting: { title: string; starts_at: string } | null;
  brief: AnyBrief;
  summary: string;
  sources: Source[];
}): AlertEmail {
  const who = one(
    input.company ? `${input.lead} (${input.company})` : input.lead,
    160,
  );
  const closed = input.brief.kind === "closed_lost";
  const when = input.meeting
    ? new Date(input.meeting.starts_at).toLocaleString("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
      }) + " UTC"
    : "";
  const headline = closed
    ? `Why ${who} was likely lost`
    : input.meeting
      ? `Brief for your meeting with ${who}, ${when}`
      : `Account brief: ${who}`;
  const link = `${SITE_URL}/app/leads/${encodeURIComponent(input.leadId)}#brief`;
  const parts = sections(input.brief).filter((s) => s.items.length);
  const subject = one(`${headline} (${input.workspace})`, 200);
  const why = `You get this because briefs are emailed to the meeting's owner in ${one(input.workspace, 120)} on Dialvo. An owner or admin can change that on the Briefs page.`;
  const text = [
    headline + ".",
    one(input.summary, 600),
    ...parts.map(
      (s) => `${s.title}\n${s.items.map((i) => `- ${one(i, 500)}`).join("\n")}`,
    ),
    input.sources.length
      ? `Sources\n${input.sources.map((s) => `[${s.n}] ${one(s.title, 120)} ${s.url}`).join("\n")}`
      : "",
    link,
    why,
  ]
    .filter(Boolean)
    .join("\n\n");
  const p =
    'style="margin:0 0 12px;font:14px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#0B0B0C"';
  const h =
    'style="margin:18px 0 6px;font:600 13px/1.4 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#0B0B0C"';
  const html = [
    `<div style="max-width:560px;margin:0 auto;padding:24px 16px">`,
    `<p ${p}><strong>${esc(headline)}.</strong></p>`,
    input.summary ? `<p ${p}>${esc(one(input.summary, 600))}</p>` : "",
    ...parts.map(
      (s) =>
        `<p ${h}>${esc(s.title)}</p><ul style="margin:0 0 8px;padding-left:18px;font:14px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#0B0B0C">${s.items.map((i) => `<li>${esc(one(i, 500))}</li>`).join("")}</ul>`,
    ),
    input.sources.length
      ? `<p ${h}>Sources</p><ol style="margin:0;padding-left:18px;font:12px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#555">${input.sources.map((s) => `<li><a href="${esc(s.url)}" style="color:#555">${esc(one(s.title, 120))}</a></li>`).join("")}</ol>`
      : "",
    `<p style="margin:18px 0"><a href="${esc(link)}" style="display:inline-block;background:#0B0B0C;color:#ffffff;text-decoration:none;border-radius:999px;padding:10px 18px;font:600 14px -apple-system,Segoe UI,Helvetica,Arial,sans-serif">Open the lead</a></p>`,
    `<p style="margin:16px 0 0;font:12px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#6b6b6d">${esc(why)}</p>`,
    `</div>`,
  ].join("");
  return { subject, text, html };
}
