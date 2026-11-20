import { afterEach, describe, expect, it } from "vitest";
import { composeEmail, type ClaimedEmail } from "./compose";
import { fetchNew, verifyImap } from "./imap";
import { readInbound } from "./inbound";
import { sendSmtp, verifySmtp, type SmtpSettings } from "./smtp";
import {
  fakeImap,
  fakeSmtp,
  type FakeImap,
  type FakeSmtp,
} from "./testing/fake-servers";

// The real mail libraries talking to a small fake SMTP and IMAP server on a
// local port (plain text, no TLS). This proves the code handles a server's
// actual answers. It does not prove anything about Gmail's or Microsoft's
// servers, TLS, or app passwords: no real mailbox was used.

const PASSWORD = "right-password";
let smtp: FakeSmtp | undefined;
let imap: FakeImap | undefined;

afterEach(async () => {
  await smtp?.close();
  await imap?.close();
  smtp = imap = undefined;
});

const settings = (port: number, password = PASSWORD): SmtpSettings => ({
  smtp_host: "127.0.0.1",
  smtp_port: port,
  smtp_security: "starttls",
  username: "sender@fake.test",
  password,
  insecure: true,
});

const email: ClaimedEmail = {
  id: "e1",
  kind: "followup",
  mailbox_id: "m1",
  attempts: 1,
  to: "pat@company.example",
  subject: "Re: Quick question",
  body: "Hello Pat,\n\nOne more thought.\n\nAlice",
  message_id: "<abc123@fake.test>",
  in_reply_to: "<first@fake.test>",
  references: "<first@fake.test>",
  from_email: "sender@fake.test",
  sender_name: "Alice Sender",
  business_name: "Agency Ltd",
  postal_address: "1 High Street\nLondon",
  unsubscribe_token: `11111111-2222-3333-4444-555555555555.${"a".repeat(64)}`,
};

describe("SMTP", () => {
  it("logs in, and says precisely why when it can't", async () => {
    smtp = await fakeSmtp();
    expect(await verifySmtp(settings(smtp.port))).toEqual({ ok: true });

    const wrong = await verifySmtp(settings(smtp.port, "wrong-password"));
    expect(wrong).toMatchObject({ ok: false, failure: { kind: "auth" } });
    if (!wrong.ok) {
      expect(wrong.failure.message).toContain("refused the login");
      expect(wrong.failure.message).toContain("535");
      expect(wrong.failure.message).not.toContain("wrong-password");
    }

    const port = smtp.port;
    await smtp.close();
    smtp = undefined;
    const closed = await verifySmtp(settings(port));
    expect(closed).toMatchObject({
      ok: false,
      failure: { kind: "connection" },
    });
    if (!closed.ok) expect(closed.failure.message).toContain("refused");
  });

  it("sends one plain-text email with the sender, the thread and the unsubscribe headers", async () => {
    smtp = await fakeSmtp();
    const sent = await sendSmtp(settings(smtp.port), composeEmail(email));
    expect(sent).toMatchObject({ ok: true });
    expect(smtp.accepted).toHaveLength(1);
    const raw = smtp.accepted[0];
    expect(raw).toMatch(/^From: Alice Sender <sender@fake\.test>\r$/m);
    expect(raw).toMatch(/^To: pat@company\.example\r$/m);
    expect(raw).toMatch(/^Message-ID: <abc123@fake\.test>\r$/m);
    expect(raw).toMatch(/^In-Reply-To: <first@fake\.test>\r$/m);
    expect(raw).toMatch(/^References: <first@fake\.test>\r$/m);
    expect(raw).toMatch(
      /^List-Unsubscribe-Post: List-Unsubscribe=One-Click\r$/m,
    );
    expect(raw.replace(/\r\n\s+/g, " ")).toMatch(
      /List-Unsubscribe: <https:\/\/trydialvo\.com\/u\/11111111-2222-3333-4444-555555555555\.a{64}>/,
    );
    expect(raw).toMatch(/^Content-Type: text\/plain/m);
    // Plain text only: no HTML part, so nowhere for a tracking pixel.
    expect(raw).not.toMatch(/text\/html|<img|multipart/i);
    expect(raw).not.toMatch(/^(Cc|Bcc):/im);
  });

  it("tells 'try later' from 'refused for good', and neither was sent", async () => {
    smtp = await fakeSmtp({ rcpt: "451 4.7.1 Greylisted, try again later" });
    const later = await sendSmtp(settings(smtp.port), composeEmail(email));
    expect(later).toMatchObject({
      ok: false,
      failure: { kind: "temporary", code: 451 },
    });
    expect(smtp.handedOver).toBe(0);
    await smtp.close();

    smtp = await fakeSmtp({ rcpt: "550 5.1.1 No such user here" });
    const never = await sendSmtp(settings(smtp.port), composeEmail(email));
    expect(never).toMatchObject({
      ok: false,
      failure: { kind: "permanent", code: 550 },
    });
    if (!never.ok) expect(never.failure.message).toContain("No such user");
    expect(smtp.handedOver).toBe(0);
  });

  it("calls it unknown when the connection drops after the email was handed over", async () => {
    smtp = await fakeSmtp({ afterData: "drop" });
    const outcome = await sendSmtp(settings(smtp.port), composeEmail(email));
    expect(smtp.handedOver).toBe(1);
    expect(outcome).toMatchObject({ ok: false, failure: { kind: "unknown" } });
  });

  it("calls a refused login an auth failure when sending, with nothing handed over", async () => {
    smtp = await fakeSmtp();
    const outcome = await sendSmtp(
      settings(smtp.port, "wrong-password"),
      composeEmail(email),
    );
    expect(outcome).toMatchObject({ ok: false, failure: { kind: "auth" } });
    expect(smtp.handedOver).toBe(0);
  });
});

const reply = [
  "From: Pat <pat@company.example>",
  "To: sender@fake.test",
  "Subject: Re: Quick question",
  "Message-ID: <reply-1@company.example>",
  "In-Reply-To: <abc123@fake.test>",
  "References: <first@fake.test> <abc123@fake.test>",
  "Date: Fri, 20 Nov 2026 10:00:00 +0000",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Yes, tell me more.",
  "",
  "On Thu, 19 Nov 2026 at 09:00, Alice Sender <sender@fake.test> wrote:",
  "> Hello Pat,",
  "",
].join("\r\n");

describe("IMAP", () => {
  const box = (port: number, password = PASSWORD) => ({
    imap_host: "127.0.0.1",
    imap_port: port,
    username: "sender@fake.test",
    password,
    insecure: true,
  });

  it("logs in, and says precisely why when it can't", async () => {
    imap = await fakeImap();
    expect(await verifyImap(box(imap.port))).toEqual({ ok: true });
    const wrong = await verifyImap(box(imap.port, "wrong-password"));
    expect(wrong).toMatchObject({ ok: false, failure: { kind: "auth" } });
    if (!wrong.ok) {
      expect(wrong.failure.message).toContain("refused the IMAP login");
      expect(wrong.failure.message).not.toContain("wrong-password");
    }
    const port = imap.port;
    await imap.close();
    imap = undefined;
    expect(await verifyImap(box(port))).toMatchObject({
      ok: false,
      failure: { kind: "connection" },
    });
  });

  it("reads what arrived since last time, and nothing twice", async () => {
    imap = await fakeImap({
      uidvalidity: 7,
      messages: [
        { uid: 3, raw: reply.replace("reply-1", "old") },
        { uid: 5, raw: reply },
      ],
    });
    const cursor = {
      uidvalidity: 7,
      last_uid: 3,
      connected_at: "2026-11-01T00:00:00Z",
    };
    const fetched = await fetchNew(box(imap.port), cursor);
    expect(fetched).toMatchObject({ ok: true, uidvalidity: 7, last_uid: 5 });
    if (!fetched.ok) return;
    expect(fetched.messages).toHaveLength(1);
    const read = await readInbound(fetched.messages[0], "sender@fake.test");
    expect(read).toMatchObject({
      kind: "reply",
      message_id: "<reply-1@company.example>",
      from_email: "pat@company.example",
      body: "Yes, tell me more.",
    });
    // The inbox is only ever opened read-only, and nothing is changed in it.
    expect(imap.commands.some((c) => /^EXAMINE/i.test(c))).toBe(true);
    expect(
      imap.commands.some((c) =>
        /STORE|EXPUNGE|DELETE|APPEND|COPY|MOVE/i.test(c),
      ),
    ).toBe(false);

    const again = await fetchNew(box(imap.port), { ...cursor, last_uid: 5 });
    expect(again).toMatchObject({ ok: true, last_uid: 5, messages: [] });
  });

  it("starts over when the server has renumbered the inbox", async () => {
    imap = await fakeImap({
      uidvalidity: 9,
      messages: [{ uid: 1, raw: reply }],
    });
    const fetched = await fetchNew(box(imap.port), {
      uidvalidity: 7,
      last_uid: 500,
      connected_at: "2026-11-01T00:00:00Z",
    });
    expect(fetched).toMatchObject({ ok: true, uidvalidity: 9, last_uid: 1 });
    if (fetched.ok) expect(fetched.messages).toHaveLength(1);
  });

  it("reports a refused login when reading", async () => {
    imap = await fakeImap();
    const fetched = await fetchNew(box(imap.port, "nope"), {
      uidvalidity: null,
      last_uid: 0,
      connected_at: "2026-11-01T00:00:00Z",
    });
    expect(fetched).toMatchObject({ ok: false, failure: { kind: "auth" } });
  });
});
