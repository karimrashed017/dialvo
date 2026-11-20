import { describe, expect, it } from "vitest";
import {
  composeEmail,
  footer,
  unsubscribeUrl,
  type ClaimedEmail,
} from "./compose";
import { ownText, readInbound } from "./inbound";

const TOKEN = `11111111-2222-3333-4444-555555555555.${"b".repeat(64)}`;
const OURS = "alice@agency.example";

const raw = (headers: Record<string, string>, body: string) =>
  [
    ...Object.entries({
      From: "Pat <pat@company.example>",
      To: OURS,
      Subject: "Re: Quick question",
      "Message-ID": "<r1@company.example>",
      Date: "Fri, 20 Nov 2026 10:00:00 +0000",
      "Content-Type": "text/plain; charset=utf-8",
      ...headers,
    })
      .filter(([, v]) => v !== "")
      .map(([k, v]) => `${k}: ${v}`),
    "",
    body,
  ].join("\r\n");

const claimed: ClaimedEmail = {
  id: "e1",
  kind: "first",
  mailbox_id: "m1",
  attempts: 1,
  to: "pat@company.example",
  subject: "Quick question\r\nBcc: someone@else.example",
  body: "Hello Pat,\r\n\r\nA first email.\r\n\r\nAlice",
  message_id: "<abc@agency.example>",
  in_reply_to: null,
  references: null,
  from_email: OURS,
  sender_name: "Alice\r\nSender",
  business_name: "Agency Ltd",
  postal_address: "1 High Street\nLondon\nN1 1AA",
  unsubscribe_token: TOKEN,
};

describe("what goes out", () => {
  it("carries the sender's name, the business, its postal address and one opt-out line", () => {
    const email = composeEmail(claimed);
    expect(email.text).toBe(
      [
        "Hello Pat,",
        "",
        "A first email.",
        "",
        "Alice",
        "",
        "--",
        "Alice Sender",
        "Agency Ltd",
        "1 High Street, London, N1 1AA",
        "",
        `If you'd rather not hear from me again, reply "unsubscribe" or use this link: https://trydialvo.com/u/${TOKEN}`,
        "",
      ].join("\n"),
    );
    expect(email.from).toEqual({ name: "Alice Sender", address: OURS });
    expect(email.to).toBe("pat@company.example");
  });

  it("has the one-click unsubscribe headers and no way to add others", () => {
    const email = composeEmail(claimed);
    expect(email.headers).toEqual({
      "List-Unsubscribe": `<https://trydialvo.com/u/${TOKEN}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
    // A line break typed into a subject or a name can't start a new header.
    expect(email.subject).toBe("Quick question Bcc: someone@else.example");
    expect(email.subject).not.toMatch(/[\r\n]/);
    expect(email.from.name).not.toMatch(/[\r\n]/);
    expect(email.inReplyTo).toBeUndefined();
  });

  it("adds no link but the unsubscribe one, and rewrites none", () => {
    const withLink = composeEmail({
      ...claimed,
      body: "See https://agency.example/pricing for more.",
    });
    expect(withLink.text).toContain(
      "See https://agency.example/pricing for more.",
    );
    expect(withLink.text.match(/https?:\/\//g)).toHaveLength(2);
    expect(unsubscribeUrl(TOKEN)).toBe(`https://trydialvo.com/u/${TOKEN}`);
    expect(footer(claimed).split("\n")[0]).toBe("--");
  });
});

describe("reading a reply", () => {
  it("keeps what the person wrote and the ids it answers", async () => {
    const m = await readInbound(
      raw(
        {
          "In-Reply-To": "<abc@agency.example>",
          References: "<first@agency.example> <abc@agency.example>",
        },
        [
          "Sounds good, when can we talk?",
          "",
          "On Thu, 19 Nov 2026 at 09:00, Alice Sender <alice@agency.example> wrote:",
          "> Hello Pat,",
          "> A first email.",
          `> If you'd rather not hear from me again, reply "unsubscribe" or use this link: https://trydialvo.com/u/${TOKEN}`,
        ].join("\r\n"),
      ),
      OURS,
    );
    expect(m).toEqual({
      message_id: "<r1@company.example>",
      from_email: "pat@company.example",
      subject: "Re: Quick question",
      kind: "reply",
      body: "Sounds good, when can we talk?",
      received_at: "2026-11-20T10:00:00.000Z",
      references: ["<abc@agency.example>", "<first@agency.example>"],
      failed_recipients: [],
      asks_to_stop: false,
    });
  });

  it("notices a plain request to stop", async () => {
    for (const text of [
      "Please unsubscribe me.",
      "Remove me from your list",
      "Do not contact me again.",
    ]) {
      const m = await readInbound(raw({}, text), OURS);
      expect(m?.asks_to_stop, text).toBe(true);
    }
  });

  it("doesn't mistake our own quoted footer for the person asking to stop", async () => {
    const quotedOddly = [
      "Interesting. Send me details.",
      "",
      "---- Alice wrote ----",
      "Hello Pat,",
      `If you'd rather not hear from me again, reply "unsubscribe" or use this link: https://trydialvo.com/u/${TOKEN}`,
    ].join("\r\n");
    const m = await readInbound(raw({}, quotedOddly), OURS);
    expect(m?.kind).toBe("reply");
    expect(m?.asks_to_stop).toBe(false);
    expect(m?.body).not.toContain("unsubscribe");
  });

  it("cuts quoted history in the usual shapes", () => {
    expect(ownText("Yes.\n\n-----Original Message-----\nFrom: A\nold")).toBe(
      "Yes.",
    );
    expect(
      ownText(
        "Ja.\n\nAm 19.11.2026 um 09:00 schrieb Alice <a@b.example>:\n> alt",
      ),
    ).toBe("Ja.");
    expect(
      ownText(
        "OK\n\nFrom: Alice <a@b.example>\nSent: Thursday\nTo: Pat\n\nold",
      ),
    ).toBe("OK");
    expect(ownText("Top\n> quoted\nBottom")).toBe("Top\nBottom");
  });

  it("takes card numbers out of what is stored", async () => {
    const m = await readInbound(
      raw({}, "Charge 4242 4242 4242 4242 please."),
      OURS,
    );
    expect(m?.body).toBe("Charge [card number removed] please.");
  });

  it("ignores the mailbox's own mail and mail with no id or sender", async () => {
    expect(
      await readInbound(raw({ From: `Alice <${OURS}>` }, "Me"), OURS),
    ).toBeNull();
    expect(await readInbound(raw({ "Message-ID": "" }, "x"), OURS)).toBeNull();
    expect(await readInbound(raw({ From: "" }, "x"), OURS)).toBeNull();
  });
});

describe("auto-replies", () => {
  it("are recognised by their headers", async () => {
    for (const headers of [
      { "Auto-Submitted": "auto-replied" },
      { "X-Autoreply": "yes" },
      { Precedence: "auto_reply" },
      { Subject: "Automatic reply: Quick question" },
      { Subject: "Out of Office: Quick question" },
    ] as Record<string, string>[]) {
      const m = await readInbound(
        raw(headers, "I am away until Monday. Please unsubscribe from worry."),
        OURS,
      );
      expect(m?.kind, JSON.stringify(headers)).toBe("auto_reply");
      // An out-of-office never counts as asking to stop.
      expect(m?.asks_to_stop).toBe(false);
    }
  });

  it("aren't confused with a person's reply", async () => {
    const m = await readInbound(raw({ "Auto-Submitted": "no" }, "Hello"), OURS);
    expect(m?.kind).toBe("reply");
  });
});

describe("bounces", () => {
  const dsn = (action: string) =>
    [
      "From: Mail Delivery Subsystem <mailer-daemon@mx.example>",
      `To: ${OURS}`,
      "Subject: Delivery Status Notification (Failure)",
      "Message-ID: <dsn1@mx.example>",
      "Date: Fri, 20 Nov 2026 10:00:00 +0000",
      'Content-Type: multipart/report; report-type=delivery-status; boundary="b1"',
      "",
      "--b1",
      "Content-Type: text/plain",
      "",
      "The address couldn't be found.",
      "--b1",
      "Content-Type: message/delivery-status",
      "",
      "Reporting-MTA: dns; mx.example",
      "",
      "Final-Recipient: rfc822; Pat@Company.example",
      `Action: ${action}`,
      "Status: 5.1.1",
      "--b1",
      "Content-Type: text/rfc822-headers",
      "",
      "From: Alice <alice@agency.example>",
      "To: pat@company.example",
      "Message-ID: <abc@agency.example>",
      "Subject: Quick question",
      "--b1--",
      "",
    ].join("\r\n");

  it("give the address that failed and the email that bounced", async () => {
    const m = await readInbound(dsn("failed"), OURS);
    expect(m).toMatchObject({
      kind: "bounce",
      failed_recipients: ["pat@company.example"],
      asks_to_stop: false,
    });
    expect(m?.references).toContain("<abc@agency.example>");
  });

  it("ignore a notice that delivery is only delayed", async () => {
    expect(await readInbound(dsn("delayed"), OURS)).toBeNull();
  });

  it("are recognised without a report, from the daemon and the failed-recipients header", async () => {
    const m = await readInbound(
      raw(
        {
          From: "MAILER-DAEMON@mx.example",
          Subject: "Undelivered Mail Returned to Sender",
          "X-Failed-Recipients": "pat@company.example",
        },
        "Sorry.",
      ),
      OURS,
    );
    expect(m).toMatchObject({
      kind: "bounce",
      failed_recipients: ["pat@company.example"],
    });
    // Someone merely writing the word "undeliverable" isn't a bounce.
    const person = await readInbound(
      raw({ Subject: "Re: undeliverable parcel" }, "Hi"),
      OURS,
    );
    expect(person?.kind).toBe("reply");
  });
});
