import { simpleParser, type ParsedMail } from "mailparser";
import { asksToStop, redactCardNumbers } from "@/lib/agents/guard";
import { REPLY_CHARS_KEPT } from "./config";

// Reading one incoming email: what kind it is (a real reply, a bounce, an
// auto-reply), what it refers to, and the text the person actually wrote.
// Nothing here decides which thread it belongs to: the database does that
// (mail_inbound_commit), from the ids and addresses found here.
//
// Everything in an incoming email is untrusted. This file only ever reads
// it; nothing in it is followed, and the address a reply came from is never
// used as somewhere to send to.

export type InboundKind = "reply" | "bounce" | "auto_reply";

export type InboundMessage = {
  message_id: string;
  from_email: string;
  subject: string;
  kind: InboundKind;
  body: string;
  received_at: string;
  /** Message-IDs this email refers to, newest first. */
  references: string[];
  /** For a bounce: the addresses that failed. */
  failed_recipients: string[];
  /** A real reply that plainly asks not to be contacted again. */
  asks_to_stop: boolean;
};

const ADDRESS = /[^\s<>@,;:"']+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi;
const MESSAGE_ID = /<[^<>\s]+@[^<>\s]+>/g;

const headerText = (mail: ParsedMail, name: string): string => {
  const value = mail.headers.get(name);
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(String).join(" ");
  if (typeof value === "object" && "value" in value)
    return String((value as { value: unknown }).value);
  return String(value);
};

const idsIn = (text: string): string[] => text.match(MESSAGE_ID) ?? [];

function isAutoReply(mail: ParsedMail, subject: string): boolean {
  const auto = headerText(mail, "auto-submitted").toLowerCase();
  if (auto && !auto.startsWith("no")) return true;
  if (mail.headers.has("x-autoreply") || mail.headers.has("x-autorespond"))
    return true;
  if (/^(auto_reply|bulk|junk)/i.test(headerText(mail, "precedence")))
    return true;
  return /^\s*(auto(matic)?[ -]?(reply|response)|out of (the )?office|abwesen|automatische antwort|r[ée]ponse automatique|respuesta autom[aá]tica|risposta automatica)/i.test(
    subject,
  );
}

/** Everything in the email that isn't the visible text: report parts. */
function attachedText(mail: ParsedMail): string {
  return mail.attachments
    .filter((a) =>
      /^(message\/|text\/rfc822-headers|text\/plain)/i.test(a.contentType),
    )
    .map((a) => a.content.toString("utf8").slice(0, 20_000))
    .join("\n");
}

function readBounce(
  mail: ParsedMail,
  from: string,
  subject: string,
): { failed: string[]; originals: string[] } | "not_a_bounce" | "not_final" {
  const type = headerText(mail, "content-type").toLowerCase();
  const report =
    type.includes("multipart/report") && type.includes("delivery-status");
  const daemon = /^(mailer-daemon|postmaster)@/i.test(from);
  const failedHeader = headerText(mail, "x-failed-recipients");
  const looksLikeOne =
    /undeliver|delivery status notification|returned to sender|failure notice|delivery (has )?failed|mail delivery (failed|subsystem)|could not be delivered|non remis|unzustellbar/i.test(
      subject,
    );
  if (!report && !failedHeader && !(daemon && looksLikeOne))
    return "not_a_bounce";
  const parts = attachedText(mail);
  const all = `${mail.text ?? ""}\n${parts}`;
  // "Delayed" and "delivered" notices are not failures.
  const action = /^Action:\s*(\w+)/im.exec(all)?.[1]?.toLowerCase();
  if (action && action !== "failed") return "not_final";
  const failed = new Set<string>();
  for (const a of failedHeader.match(ADDRESS) ?? [])
    failed.add(a.toLowerCase());
  for (const line of all.match(
    /^(Final-Recipient|Original-Recipient):.*$/gim,
  ) ?? [])
    for (const a of line.match(ADDRESS) ?? []) failed.add(a.toLowerCase());
  return { failed: [...failed], originals: idsIn(parts) };
}

/** Lines that start a quoted earlier email, in the common mail apps. */
const QUOTE_STARTS = [
  /^\s*On .{5,200}wrote:\s*$/im,
  /^\s*On .{5,120}\n.{0,120}wrote:\s*$/im,
  /^\s*-{2,}\s*Original Message\s*-{2,}/im,
  /^\s*_{5,}\s*$/m,
  /^\s*From:\s.+\n\s*(Sent|Date):\s.+/im,
  /^\s*Am .{5,200}schrieb.{0,200}:\s*$/im,
  /^\s*Le .{5,200}a écrit\s*:\s*$/im,
  /^\s*El .{5,200}escribió\s*:\s*$/im,
  /^\s*Il .{5,200}ha scritto\s*:\s*$/im,
];

/**
 * The part of a reply the person wrote themselves: the text above the
 * quoted email. Our own footer line is removed wherever it appears, so the
 * word "unsubscribe" in it is never mistaken for the person asking to stop.
 */
export function ownText(text: string): string {
  let cut = text.replace(/\r\n/g, "\n");
  let end = cut.length;
  for (const pattern of QUOTE_STARTS) {
    const at = cut.search(pattern);
    if (at >= 0 && at < end) end = at;
  }
  cut = cut.slice(0, end);
  const lines = cut
    .split("\n")
    .filter(
      (line) =>
        !/^\s*>/.test(line) &&
        !/If you'd rather not hear from me again/i.test(line) &&
        !/\/u\/[0-9a-f-]{36}\.[0-9a-f]{64}/.test(line),
    );
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Reads one raw email. Null when it is nothing to act on: the mailbox's own
 * outgoing mail, a notice that isn't final, or an email with no Message-ID.
 */
export async function readInbound(
  source: Buffer | string,
  mailboxEmail: string,
): Promise<InboundMessage | null> {
  let mail: ParsedMail;
  try {
    mail = await simpleParser(source, {
      skipHtmlToText: false,
      skipTextToHtml: true,
      skipImageLinks: true,
    });
  } catch {
    return null;
  }
  const messageId = (mail.messageId ?? "").trim().slice(0, 300);
  const from = (mail.from?.value?.[0]?.address ?? "").toLowerCase();
  if (!messageId || !from) return null;
  if (from === mailboxEmail.toLowerCase()) return null;
  const subject = (mail.subject ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
  const refs = [
    ...idsIn(String(mail.inReplyTo ?? "")),
    ...idsIn(
      Array.isArray(mail.references)
        ? mail.references.join(" ")
        : String(mail.references ?? ""),
    ).reverse(),
  ];
  const base = {
    message_id: messageId,
    from_email: from,
    subject,
    received_at: (mail.date ?? new Date()).toISOString(),
  };

  const bounce = readBounce(mail, from, subject);
  if (bounce === "not_final") return null;
  if (bounce !== "not_a_bounce")
    return {
      ...base,
      kind: "bounce",
      body: "",
      references: [...new Set([...bounce.originals, ...refs])].slice(0, 30),
      failed_recipients: bounce.failed.slice(0, 10),
      asks_to_stop: false,
    };

  const references = [...new Set(refs)].slice(0, 30);
  const text = redactCardNumbers(ownText(mail.text ?? "")).slice(
    0,
    REPLY_CHARS_KEPT,
  );
  if (isAutoReply(mail, subject))
    return {
      ...base,
      kind: "auto_reply",
      body: text,
      references,
      failed_recipients: [],
      asks_to_stop: false,
    };
  return {
    ...base,
    kind: "reply",
    body: text,
    references,
    failed_recipients: [],
    asks_to_stop: asksToStop(text),
  };
}
