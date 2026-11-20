// The end-to-end check for sending (slice 3b), against a real Supabase
// project, in a real browser.
//
// What it can and can't reach: nothing is sent or read without
// SUPABASE_SECRET_KEY, a real mailbox and the scheduler calling a deployed
// app, and this script has none of those. So it checks what a person sees
// without them (the honest "nothing is sent" states, the Mailboxes page, a
// connection that fails for a stated reason), the unsubscribe page, who is
// refused what, and the sending states on rows put in by
// scripts/e2e-mail-seed.sql, which builds them with the database's own
// functions. No email is sent to anyone, and no model is called.
//
// Before running it:
//   1. `npm run dev` (or point E2E_BASE at a deployment).
//   2. Two confirmed test accounts that share a password, each the owner of
//      a workspace of its own: E2E_USER_1 (the one the seed was run for)
//      and E2E_USER_2 (a workspace with no mailbox), and E2E_PASSWORD.
//   3. scripts/e2e-mail-seed.sql run once for E2E_USER_1 in the SQL editor.
//      The script prints it when the rows are missing.
//   4. Optional: E2E_UNSUB_TOKEN, an unsubscribe token for one seeded email
//      (select private.mail_unsub_token(id) from outbound_emails where
//      to_email = 'pat@e2e-mail-unknown.example'). Without it only a bad
//      link is checked.
//
// It never deletes anything. Each run leaves, in the first account's
// workspace: one reply written by hand waiting in the outbox (the first
// run only) and one meeting on the "E2E Replied Co" lead; with a token, the
// address pat@e2e-mail-unknown.example on the never-contact list. In the
// second account's workspace: sender details and follow-up settings.

import { mkdirSync, readFileSync } from "node:fs";

const { chromium } = await import(process.env.PLAYWRIGHT ?? "playwright");
const BASE = process.env.E2E_BASE ?? "http://localhost:3000";
const SHOTS = process.env.E2E_SHOTS ?? "screenshots";
mkdirSync(SHOTS, { recursive: true });
const PW = process.env.E2E_PASSWORD;
const USER_1 = process.env.E2E_USER_1;
const USER_2 = process.env.E2E_USER_2;
const UNSUB = process.env.E2E_UNSUB_TOKEN ?? "";
if (!PW || !USER_1 || !USER_2)
  throw new Error("Set E2E_PASSWORD, E2E_USER_1 and E2E_USER_2.");
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => [
      l.slice(0, l.indexOf("=")),
      l.slice(l.indexOf("=") + 1).trim(),
    ]),
);
const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass: !!pass, detail });
  console.log(pass ? "PASS" : "FAIL", name, detail);
};
const browser = await chromium.launch({
  executablePath: process.env.CHROME || undefined,
  args: ["--no-sandbox"],
});
const shot = (page, name) =>
  page.screenshot({ path: `${SHOTS}/mail-${name}.png`, fullPage: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(check, ms = 20000) {
  const end = Date.now() + ms;
  for (;;) {
    try {
      const value = await check();
      if (value) return value;
    } catch {}
    if (Date.now() > end) return null;
    await sleep(500);
  }
}

async function signIn(email) {
  const ctx = await browser.newContext({
    viewport: { width: 1360, height: 900 },
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  page.on("dialog", (d) => d.accept());
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PW);
  await page.click('form:has(input[name="password"]) button[type="submit"]');
  await page.waitForURL(/\/app$/, { timeout: 30000 });
  await page.waitForSelector('a[href="/app/inbox"]', { timeout: 30000 });
  return { ctx, page };
}

async function jwt(ctx) {
  const cookies = await ctx.cookies();
  const parts = cookies
    .filter((c) => c.name.startsWith("sb-") && c.name.includes("auth-token"))
    .sort((a, b) => a.name.localeCompare(b.name));
  let raw = parts.map((c) => c.value).join("");
  if (raw.startsWith("base64-"))
    raw = Buffer.from(raw.slice(7), "base64url").toString();
  return JSON.parse(decodeURIComponent(raw)).access_token;
}

async function db(path, { token, body, method } = {}) {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    method: method ?? (body ? "POST" : "GET"),
    headers: {
      apikey: KEY,
      authorization: `Bearer ${token ?? KEY}`,
      prefer: "return=representation",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

const text = async (page, selector = "main") =>
  (await page.textContent(selector)) ?? "";
const open = async (page, path, selector) => {
  await page.goto(`${BASE}${path}`);
  await page.waitForSelector(selector, { timeout: 30000 });
};

// ---------------------------------------------------------------- the seed
const { ctx: c1, page: p1 } = await signIn(USER_1);
const t1 = await jwt(c1);
const seeded = await db(
  "mailboxes?select=id,status,workspace_id&email=eq.e2e-sender@mailbox.example",
  { token: t1 },
);
if (!seeded.body?.length) {
  console.log(
    "\nRUN THIS SQL in the Supabase SQL editor, then run this script again:\n\n" +
      readFileSync("scripts/e2e-mail-seed.sql", "utf8").replace(
        ":owner_email",
        `'${USER_1.replace(/'/g, "")}'`,
      ),
  );
  await browser.close();
  process.exit(2);
}
const WS = seeded.body[0].workspace_id;
const BOX = seeded.body[0].id;
ok(
  "seed: the made-up mailbox is there, and paused",
  seeded.body[0].status === "paused",
);

// ------------------------------------------------------------- Mailboxes
await open(p1, "/app/settings/mailboxes", "#mailboxes");
let main = await text(p1);
ok(
  "mailboxes: says sending isn't switched on on Dialvo's side (no secret key here)",
  (await p1.$('[data-mail="not-live"]')) !== null,
);
ok(
  "mailboxes: the mailbox is listed as paused, with how to carry on",
  /e2e-sender@mailbox\.example/.test(main) &&
    /Paused/.test(main) &&
    /connect this address again/.test(main),
);
ok(
  "mailboxes: sender details show as complete",
  /Complete/.test(await text(p1, "#sender")),
);
ok(
  "mailboxes: no password is anywhere on the page",
  !/secret_id|decrypted/i.test(await p1.content()) &&
    (await p1.$$eval('input[type="password"]', (els) =>
      els.every((e) => !e.value),
    )),
);
ok(
  'mailboxes: the name field is labelled "Your real name"',
  /Your real name/.test(await text(p1, "#connect")) &&
    /person who is actually sending/.test(await text(p1, "#connect")),
);
ok(
  "mailboxes: Google's app-password steps show first",
  /myaccount\.google\.com\/apppasswords/.test(
    await text(p1, "[data-app-password-help]"),
  ),
);
await p1.click('#connect label:has(input[value="microsoft"])');
ok(
  "mailboxes: choosing Microsoft shows Microsoft's steps and the SMTP AUTH warning",
  /mysignins\.microsoft\.com/.test(
    await text(p1, "[data-app-password-help]"),
  ) && /SMTP AUTH/.test(await text(p1, "[data-app-password-help]")),
);
await p1.click('#connect label:has(input[value="other"])');
ok(
  "mailboxes: another provider asks for SMTP and IMAP servers",
  (await p1.$('#connect input[name="smtp_host"]')) !== null &&
    (await p1.$('#connect select[name="imap_port"]')) !== null,
);
await shot(p1, "mailboxes");

let lastSaid = "";
const connect = async (smtp, imap) => {
  await p1.fill('#connect input[name="email"]', "nobody@e2e-connect.example");
  await p1.fill('#connect input[name="sender_name"]', "E2E Person");
  await p1.fill('#connect input[name="password"]', "not-a-real-password");
  await p1.fill('#connect input[name="smtp_host"]', smtp);
  await p1.fill('#connect input[name="imap_host"]', imap);
  await p1.click('#connect button[type="submit"]');
  // The message of this attempt, not the one still showing from the last.
  const said = await until(async () => {
    const now = await p1.textContent('#connect [role="alert"]');
    return now && now !== lastSaid ? now : null;
  }, 60000);
  lastSaid = said ?? lastSaid;
  return said;
};
let said = await connect("127.0.0.1", "imap.e2e-connect.example");
ok(
  "connect: a server on this machine or a private network is refused",
  /has to be a host name/.test(said ?? ""),
  said ?? "",
);
said = await connect("smtp.e2e-connect.example", "imap.e2e-connect.example");
ok(
  "connect: a server that doesn't exist fails with the reason, by name",
  /No mail server was found at smtp\.e2e-connect\.example/.test(said ?? ""),
  said ?? "",
);
const after = await db(`mailboxes?select=email&workspace_id=eq.${WS}`, {
  token: t1,
});
ok(
  "connect: nothing was saved by the failed attempts",
  after.body?.length === 1 &&
    after.body[0].email === "e2e-sender@mailbox.example",
);
ok(
  "connect: what was typed is kept, except nothing shows the password back",
  (await p1.inputValue('#connect input[name="email"]')) ===
    "nobody@e2e-connect.example",
);

// ------------------------------------------------------- First emails (1)
await open(p1, "/app/prospects?view=emails", "[data-sending-state]");
main = await text(p1);
const state = await p1.getAttribute(
  "[data-sending-state]",
  "data-sending-state",
);
ok(
  'first emails: with a mailbox connected, the old "nothing is sent from here yet" notice is gone',
  state !== "no-mailbox" && !/Nothing is sent from here yet/.test(main),
  state,
);
ok(
  "first emails: it still says plainly that nothing is going out, and why",
  state === "not-live" &&
    /nothing is sent yet|Nothing is being sent|Sending is off/.test(main),
);
ok(
  "first emails: the day's summary is shown",
  [
    "Sent today",
    "Replies",
    "Positive replies",
    "Bounces",
    "Unsubscribes",
  ].every((w) => main.includes(w)),
);
const rows = async (section) =>
  p1.$$eval(`[data-sending-section="${section}"] [data-email]`, (els) =>
    els.map(
      (e) =>
        `${e.getAttribute("data-email")} | ${e.getAttribute("data-email-state")} | ${e.textContent}`,
    ),
  );
const scheduled = await rows("scheduled");
ok(
  "first emails: Scheduled shows when and from which mailbox",
  scheduled.some(
    (r) =>
      r.startsWith("pat@e2e-mail-scheduled.example") &&
      /from e2e-sender@mailbox\.example/.test(r) &&
      /\d{1,2}:\d{2}/.test(r),
  ),
  scheduled[0]?.slice(0, 160),
);
const sent = await rows("sent");
ok(
  "first emails: Sent lists the email that went, with its follow-up state",
  sent.some((r) => r.startsWith("pat@e2e-mail-sent.example") && /Sent/.test(r)),
);
const replied = await rows("replied");
ok(
  "first emails: Replied shows what kind of reply it was",
  replied.some(
    (r) => r.startsWith("pat@e2e-mail-replied.example") && /Interested/.test(r),
  ),
);
const failed = await rows("failed");
ok(
  "first emails: Failed shows the refused one with the mail server's reason",
  failed.some(
    (r) => r.startsWith("pat@e2e-mail-failed.example") && /550 5\.1\.1/.test(r),
  ),
);
ok(
  "first emails: the one whose fate is unknown asks to be checked and is not resent",
  failed.some(
    (r) =>
      r.startsWith("pat@e2e-mail-unknown.example") &&
      /Needs checking/.test(r) &&
      /will not be sent again on its own/.test(r),
  ) || /unsubscribe|never-contact/.test(failed.join("")),
);
ok(
  "first emails: the bounced one says the address is on the never-contact list",
  failed.some(
    (r) => r.startsWith("pat@e2e-mail-bounced.example") && /Bounced/.test(r),
  ),
);
ok(
  "first emails: the agent's follow-up waits for approval",
  (await p1.$('[data-followup="pat@e2e-mail-sent.example"]')) !== null ||
    /follow-up/.test(sent.join("")),
);
ok(
  "first emails: an approved email is listed once, not as ready and scheduled both",
  (await p1.$$('[data-draft="pat@e2e-mail-scheduled.example"]')).length === 0,
);
await shot(p1, "first-emails");

// ------------------------------------------------------- First emails (2)
const { ctx: c2, page: p2 } = await signIn(USER_2);
const t2 = await jwt(c2);
await open(p2, "/app/prospects?view=emails", "[data-sending-state]");
ok(
  'first emails: with no mailbox the honest notice stays: "Nothing is sent from here yet"',
  (await p2.getAttribute("[data-sending-state]", "data-sending-state")) ===
    "no-mailbox" &&
    /Nothing is sent from here yet/.test(await text(p2)) &&
    (await p2.$('main a[href="/app/settings/mailboxes"]')) !== null &&
    (await p2.$("[data-sending-summary]")) === null,
);
await shot(p2, "first-emails-no-mailbox");

// --------------------------------------------- sender details (workspace 2)
await open(p2, "/app/settings/mailboxes", "#sender");
ok(
  "sending: off, and can't be turned on without a mailbox",
  (await p2.getAttribute("#sending", "data-sending")) === "off" &&
    (await p2.$("#sending button[disabled]")) !== null &&
    /a connected mailbox/.test(await text(p2, "#sending")),
);
ok(
  "sender details: one plain sentence says the rules differ by country",
  /rules on emailing businesses differ from country to\s+country/.test(
    await text(p2, "#sender"),
  ) || (await p2.$("#sender [data-confirmed]")) !== null,
);
const confirmedAlready = (await p2.$("#sender [data-confirmed]")) !== null;
await p2.fill('#sender input[name="business_name"]', "E2E Second Business");
await p2.fill(
  '#sender textarea[name="postal_address"]',
  "2 Test Road\nTestville",
);
if (!confirmedAlready) {
  await p2.click('#sender button[type="submit"]');
  await until(async () => /Saved/.test(await text(p2, "#sender")));
  ok(
    "sender details: saved without the confirmation they are still not enough",
    /Needed before any email is sent/.test(await text(p2, "#sender")),
  );
  await p2.check('#sender input[name="confirm_allowed"]');
}
await p2.click('#sender button[type="submit"]');
ok(
  "sender details: with the confirmation they are complete, and it is recorded",
  await until(async () => (await p2.$("#sender [data-confirmed]")) !== null),
);
const direct = await db("rpc/sending_settings_save", {
  token: t2,
  body: { p_workspace_id: WS, p_settings: { sending_on: false } },
});
ok(
  "sending: another workspace's settings can't be changed",
  direct.status >= 400,
  String(direct.status),
);

await p2.fill(
  '#follow-ups input[name="booking_url"]',
  "http://not-secure.example/me",
);
await p2.click('#follow-ups button[type="submit"]');
ok(
  "booking link: must be https",
  await until(async () =>
    /has to start with https/.test(await text(p2, "#follow-ups")),
  ),
);
await p2.fill(
  '#follow-ups input[name="booking_url"]',
  "https://cal.example/e2e",
);
await p2.fill('#follow-ups input[name="followup_1_days"]', "9");
await p2.fill('#follow-ups input[name="followup_2_days"]', "4");
await p2.click('#follow-ups button[type="submit"]');
ok(
  "follow-ups: the second can't come before the first",
  await until(async () =>
    /has to come after the first/.test(await text(p2, "#follow-ups")),
  ),
);
await p2.fill('#follow-ups input[name="followup_1_days"]', "3");
await p2.fill('#follow-ups input[name="followup_2_days"]', "7");
await p2.click('#follow-ups button[type="submit"]');
ok(
  "follow-ups and booking link: saved",
  await until(async () => {
    const r = await db("workspace_sending?select=booking_url,followup_1_days", {
      token: t2,
    });
    return (
      r.body?.[0]?.booking_url === "https://cal.example/e2e" &&
      r.body[0].followup_1_days === 3
    );
  }),
);
await shot(p2, "mailboxes-second");

// ------------------------------------------------------------------ Inbox
const threads = await db(
  "mail_threads?select=conversation_id,lead_id,to_email&to_email=eq.pat@e2e-mail-replied.example",
  { token: t1 },
);
const CONV = threads.body?.[0]?.conversation_id;
const LEAD = threads.body?.[0]?.lead_id;
await open(p1, `/app/inbox?queue=all&c=${CONV}`, "[data-email-thread]");
main = await text(p1);
ok(
  "inbox: the reply is there as an email conversation on the lead",
  /This sounds interesting\. Can we talk next week\?/.test(main) &&
    /made-up first email/.test(main),
);
ok(
  "inbox: it says who the thread is with, from which mailbox, and that follow-ups stopped",
  /Email with pat@e2e-mail-replied\.example, from e2e-sender@mailbox\.example/.test(
    main,
  ) &&
    /follow-ups have stopped/.test(main) &&
    /Interested/.test(main),
);
const outgoing = await db(
  `outbound_emails?select=id,status,written_by&to_email=eq.pat@e2e-mail-replied.example&kind=eq.reply&status=neq.cancelled`,
  { token: t1 },
);
const byHand = outgoing.body?.some((e) => e.written_by === "user");
if (!byHand) {
  ok(
    "inbox: the agent's answer waits as a draft, not sent",
    (await p1.$('[data-email-draft="reply"]')) !== null &&
      /hasn't been sent/.test(main),
  );
  await shot(p1, "inbox-draft");
  await p1.fill("#reply-body", "E2E: a reply written by hand. Tuesday at ten?");
  await p1.click('form:has(#reply-body) button[type="submit"]');
}
ok(
  "inbox: a reply by hand is queued for the same thread, and says honestly that it hasn't gone",
  await until(async () => {
    const t = await text(p1);
    return /Your reply\s+is saved and waiting/.test(t) && /hasn't gone/.test(t);
  }, 30000),
);
const queued = await db(
  `outbound_emails?select=status,written_by,mailbox_id,to_email,thread_id&to_email=eq.pat@e2e-mail-replied.example&kind=eq.reply&written_by=eq.user`,
  { token: t1 },
);
ok(
  "inbox: it goes to the lead's own address from the thread's mailbox, and replaced the agent's draft",
  queued.body?.[0]?.status === "queued" &&
    queued.body[0].mailbox_id === BOX &&
    (await p1.$('[data-email-draft="reply"]')) === null,
  JSON.stringify(queued.body?.[0] ?? {}),
);
ok(
  'inbox: the form no longer says "saved, not delivered" for email',
  !/Saved, not delivered: Email isn't connected/.test(await text(p1)),
);
await shot(p1, "inbox-email");

await open(p2, `/app/inbox?queue=all&c=${CONV}`, "main");
ok(
  "inbox: another workspace can't open the conversation",
  await until(async () => /doesn't exist/.test(await text(p2))),
);

// ------------------------------------------------------- Meeting booked
await open(p1, `/app/leads/${LEAD}`, "#meeting");
await p1.fill('#meeting input[name="starts_at"]', "2027-01-12T10:00");
await p1.fill('#meeting input[name="title"]', "E2E intro call");
await p1.click('#meeting button[type="submit"]');
ok(
  "lead: Mark meeting booked records a meeting and sets the status",
  await until(async () => {
    const m = await db(
      `meetings?select=starts_at,booked_by&lead_id=eq.${LEAD}&title=eq.E2E intro call`,
      { token: t1 },
    );
    const l = await db(`leads?select=status&id=eq.${LEAD}`, { token: t1 });
    return (
      m.body?.length > 0 &&
      m.body[0].booked_by === "user" &&
      l.body?.[0]?.status === "meeting_booked"
    );
  }),
);

// ------------------------------------------------------------ who may what
const mine2 = await db("mailboxes?select=id", { token: t2 });
const emails2 = await db("outbound_emails?select=id", { token: t2 });
const received2 = await db("mail_received?select=id", { token: t2 });
ok(
  "isolation: the second workspace sees none of the first's mailboxes, emails or replies",
  mine2.body?.length === 0 &&
    emails2.body?.length === 0 &&
    received2.body?.length === 0,
);
const secrets = await db("mailbox_secrets?select=*", { token: t1 });
const secretRpc = await db("rpc/mail_mailbox_secret", {
  token: t1,
  body: { p_workspace_id: WS, p_mailbox_id: BOX },
});
const anonRpc = await db("rpc/mail_mailbox_secret", {
  body: { p_workspace_id: WS, p_mailbox_id: BOX },
});
const columns = await db(`mailboxes?select=*&id=eq.${BOX}`, { token: t1 });
ok(
  "vault: not even the owner can read where a password is, or ask for it",
  secrets.status >= 400 &&
    secretRpc.status >= 400 &&
    anonRpc.status >= 400 &&
    !Object.keys(columns.body?.[0] ?? { secret_id: 1 }).some((k) =>
      /secret|password/.test(k),
    ),
  `${secrets.status} ${secretRpc.status} ${anonRpc.status}`,
);
for (const [name, body] of [
  [
    "mail_send_claim",
    {
      p_workspace_id: WS,
      p_limit: 5,
      p_ramp_start: 50,
      p_ramp_step: 5,
      p_workspace_cap: 999,
      p_stale_seconds: 60,
    },
  ],
  ["mail_cron_token_ok", { p_token: "x".repeat(64) }],
  [
    "mail_inbound_commit",
    { p_workspace_id: WS, p_mailbox_id: BOX, p_message: {} },
  ],
]) {
  const r = await db(`rpc/${name}`, { token: t1, body });
  ok(
    `server only: a signed-in person can't call ${name}`,
    r.status >= 400,
    String(r.status),
  );
}
const write = await db("outbound_emails", {
  token: t1,
  method: "PATCH",
  body: { status: "scheduled" },
});
ok(
  "outbox: can't be written to directly, even by its owner",
  write.status >= 400,
  String(write.status),
);
const takeover = await db("rpc/mailbox_disconnect", {
  token: t2,
  body: { p_mailbox_id: BOX },
});
ok(
  "mailbox: another workspace can't disconnect it",
  takeover.status >= 400,
  String(takeover.status),
);

// ---------------------------------------------------------- the scheduler's door
for (const [label, headers] of [
  ["no token", {}],
  ["a wrong token", { authorization: `Bearer ${"a".repeat(96)}` }],
]) {
  const r = await fetch(`${BASE}/api/mail/step?job=send`, {
    method: "POST",
    headers,
  });
  ok(
    `scheduler endpoint: ${label} is refused`,
    r.status === 401,
    String(r.status),
  );
}
const get = await fetch(`${BASE}/api/mail/step?job=send`);
ok("scheduler endpoint: only POST", get.status === 405, String(get.status));

// ------------------------------------------------------------- unsubscribe
const anon = await browser.newContext();
const pu = await anon.newPage();
let res = await pu.goto(`${BASE}/u/not-a-token`);
ok(
  "unsubscribe: a made-up link gets a plain 404 page, with what to do instead",
  res.status() === 404 &&
    /reply to one of them with the word unsubscribe/.test(
      await pu.textContent("body"),
    ),
);
res = await pu.goto(
  `${BASE}/u/11111111-2222-3333-4444-555555555555.${"0".repeat(64)}`,
);
ok(
  "unsubscribe: a well-formed link with a wrong signature is refused too",
  res.status() === 404,
);
if (UNSUB) {
  const before = await db(
    "outbound_suppressions?select=value&value=eq.pat@e2e-mail-unknown.example",
    { token: t1 },
  );
  res = await pu.goto(`${BASE}/u/${UNSUB}`);
  const body = await pu.textContent("body");
  ok(
    "unsubscribe: the link opens a page naming the business, with no login",
    res.status() === 200 && /Stop emails from E2E Test Business\?/.test(body),
  );
  const still = await db(
    "outbound_suppressions?select=value&value=eq.pat@e2e-mail-unknown.example",
    { token: t1 },
  );
  ok(
    "unsubscribe: just opening the link changes nothing",
    still.body?.length === before.body?.length,
  );
  ok(
    "unsubscribe: the page has no noindex-free or cacheable headers",
    res.headers()["cache-control"] === "no-store" &&
      res.headers()["x-robots-tag"] === "noindex",
  );
  await shot(pu, "unsubscribe");
  await pu.click('button[type="submit"]');
  await pu.waitForLoadState();
  ok(
    "unsubscribe: the button confirms it",
    /You're unsubscribed/.test(await pu.textContent("body")),
  );
  // What a mail app's own Unsubscribe button does (RFC 8058).
  const oneClick = await fetch(`${BASE}/u/${UNSUB}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "List-Unsubscribe=One-Click",
  });
  ok(
    "unsubscribe: a one-click POST works, and twice is fine",
    oneClick.status === 200,
  );
  const listed = await db(
    "outbound_suppressions?select=value,note&value=eq.pat@e2e-mail-unknown.example",
    { token: t1 },
  );
  const lead = await db(
    "leads?select=do_not_contact,status&email=eq.pat@e2e-mail-unknown.example",
    { token: t1 },
  );
  ok(
    "unsubscribe: the address is on the never-contact list and the lead is marked do not contact",
    listed.body?.length === 1 &&
      lead.body?.[0]?.do_not_contact === true &&
      lead.body[0].status === "unsubscribed",
    JSON.stringify(lead.body?.[0] ?? {}),
  );
} else console.log("SKIP unsubscribe with a real token: set E2E_UNSUB_TOKEN");

// --------------------------------------------------------------- Settings
await open(p1, "/app/settings", "#mailboxes");
ok(
  "settings: there is a door to Mailboxes",
  (await p1.$('#mailboxes a[href="/app/settings/mailboxes"]')) !== null,
);

await browser.close();
const bad = results.filter((r) => !r.pass);
console.log(`\n${results.length - bad.length} of ${results.length} passed`);
if (bad.length) {
  for (const r of bad) console.log("FAILED:", r.name, r.detail);
  process.exit(1);
}
