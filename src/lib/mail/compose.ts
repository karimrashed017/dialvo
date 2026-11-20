import { SITE_URL } from "@/lib/site";

// Turning a claimed email into what the mail server is given. Pure.
//
// Every email is plain text, to one recipient, From the mailbox's own
// address with the real sender's name. Under the text goes who is writing
// (name, business, postal address) and one line on how to stop these
// emails, and the headers carry a one-click unsubscribe link. There are no
// tracking pixels and no rewritten links: the only link Dialvo adds is the
// unsubscribe one.

export type ClaimedEmail = {
  id: string;
  kind: "first" | "followup" | "reply";
  mailbox_id: string;
  attempts: number;
  to: string;
  subject: string;
  body: string;
  message_id: string;
  in_reply_to: string | null;
  references: string | null;
  from_email: string;
  sender_name: string;
  business_name: string;
  postal_address: string;
  unsubscribe_token: string;
};

export type ComposedEmail = {
  from: { name: string; address: string };
  to: string;
  subject: string;
  text: string;
  messageId: string;
  inReplyTo?: string;
  references?: string;
  headers: Record<string, string>;
};

/** One line, no control characters: nothing typed can add a header. */
export const oneLine = (text: string, max: number) =>
  text
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

export function unsubscribeUrl(token: string, base: string = SITE_URL): string {
  return `${base}/u/${token}`;
}

/** What goes under every email. */
export function footer(email: {
  sender_name: string;
  business_name: string;
  postal_address: string;
  unsubscribe_token: string;
}): string {
  const address = email.postal_address
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(", ");
  return [
    "--",
    oneLine(email.sender_name, 120),
    oneLine(email.business_name, 200),
    oneLine(address, 500),
    "",
    `If you'd rather not hear from me again, reply "unsubscribe" or use this link: ${unsubscribeUrl(email.unsubscribe_token)}`,
  ].join("\n");
}

export function composeEmail(email: ClaimedEmail): ComposedEmail {
  const body = email.body.replace(/\r\n/g, "\n").trim();
  const url = unsubscribeUrl(email.unsubscribe_token);
  return {
    from: { name: oneLine(email.sender_name, 120), address: email.from_email },
    to: email.to,
    subject: oneLine(email.subject, 200),
    text: `${body}\n\n${footer(email)}\n`,
    messageId: email.message_id,
    ...(email.in_reply_to ? { inReplyTo: email.in_reply_to } : {}),
    ...(email.references ? { references: email.references } : {}),
    headers: {
      // RFC 8058: mail apps show their own unsubscribe button and POST here.
      "List-Unsubscribe": `<${url}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}
