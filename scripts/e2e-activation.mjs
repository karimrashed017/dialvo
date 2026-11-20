// The end-to-end check for slice 2b (a new sign-up reaching a working
// agent, and the trial clock), against a real Supabase project.
//
// It signs a new person up, confirms their address, onboards them with a
// website, and follows the "Get started" checklist: the site read into
// Knowledge, the test chat, the chat widget on a made-up customer site
// (another origin) and the install check, switching the agent on, the email
// alert switch, and the trial banner before and after the trial ends.
//
// Before running it:
//   1. `npm run dev` (or point E2E_BASE at a deployment).
//   2. E2E_NEW_USER: an address that has never signed up (sign-up sends a
//      real confirmation email to it). E2E_PASSWORD: the password to give it.
//      To run again with the same person, add E2E_SIGNED_UP=1: the script
//      then logs in instead, and skips onboarding if they have a workspace.
//   3. E2E_OTHER_USER (optional): a confirmed account in another workspace,
//      with the same password, to prove it can't read the new one's rows.
//   4. Playwright and a Chrome, as for scripts/e2e-app.mjs.
//
// Two things need the database's owner, which this script never is. Each
// time it prints "RUN THIS SQL" and waits (up to 5 minutes) for someone to
// run the statement in the Supabase SQL editor:
//   * the confirmation token of the new address (write the value it returns
//     into the file named by E2E_TOKEN_FILE, default .e2e-token);
//   * ending the workspace's trial, and putting it back afterwards.
//
// The model is never called and no email is sent by the app: with no
// ANTHROPIC_API_KEY and no RESEND_API_KEY the script checks the "not
// switched on yet" states instead. Set E2E_ENFORCED=1 when the server runs
// with BILLING_ENFORCED=1 to check the enforced banner.
//
// It never deletes anything: remove the test account and its workspace in
// the Supabase dashboard afterwards.

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";

// PLAYWRIGHT may name the package's file when it is installed outside this
// project (then it loads as CommonJS, with everything under `default`).
const playwright = await import(process.env.PLAYWRIGHT ?? "playwright");
const chromium = playwright.chromium ?? playwright.default.chromium;
const BASE = process.env.E2E_BASE ?? "http://localhost:3000";
const SHOTS = "screenshots";
mkdirSync(SHOTS, { recursive: true });
const PW = process.env.E2E_PASSWORD;
const EMAIL = process.env.E2E_NEW_USER;
const OTHER = process.env.E2E_OTHER_USER;
const SIGNED_UP = process.env.E2E_SIGNED_UP === "1";
const ENFORCED = process.env.E2E_ENFORCED === "1";
const TOKEN_FILE = process.env.E2E_TOKEN_FILE ?? ".e2e-token";
// The website the new workspace gives in onboarding. It has to be a real
// public https site, because the server reads it.
const WEBSITE = process.env.E2E_SITE ?? "trydialvo.com";
const WORKSPACE = process.env.E2E_WORKSPACE ?? "E2E Activation";
if (!PW || !EMAIL) throw new Error("Set E2E_NEW_USER and E2E_PASSWORD.");
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

// The customer's website: a page of its own on another origin than the app.
let customerPage = "<!doctype html><title>Empty</title>";
const customerSite = createServer((_, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(customerPage);
});
await new Promise((done) => customerSite.listen(0, "127.0.0.1", done));
const SITE = `http://127.0.0.1:${customerSite.address().port}`;
const SITE_HOST = new URL(SITE).host;
if (new URL(SITE).origin === new URL(BASE).origin)
  throw new Error("The customer site must not share the app's origin.");

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
  page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
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

/** Prints a statement for the database's owner and waits for its effect. */
async function needSql(why, sql, done) {
  console.log(`\nRUN THIS SQL (${why}):\n${sql}\n`);
  const result = await until(done, 300000);
  if (!result) throw new Error(`Timed out waiting for: ${why}`);
  return result;
}

async function jwt(ctx) {
  const cookies = await ctx.cookies();
  const parts = cookies
    // The session cookie, possibly in numbered parts; not the PKCE verifier.
    .filter((c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  let raw = parts.map((c) => c.value).join("");
  if (raw.startsWith("base64-"))
    raw = Buffer.from(raw.slice(7), "base64url").toString();
  return JSON.parse(decodeURIComponent(raw)).access_token;
}

async function db(path, { token, method, body } = {}) {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    method: method ?? (body ? "POST" : "GET"),
    headers: {
      apikey: KEY,
      authorization: `Bearer ${token ?? KEY}`,
      ...(body
        ? {
            "content-type": "application/json",
            prefer: "return=representation",
          }
        : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

const PASSWORD_FORM = 'form:has(input[name="password"]) button[type="submit"]';
const newPage = async () => {
  const ctx = await browser.newContext({
    viewport: { width: 1360, height: 900 },
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  return { ctx, page };
};
async function logIn(page, email) {
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PW);
  await page.click(PASSWORD_FORM);
  await page.waitForURL(/\/(onboarding|app)$/, { timeout: 30000 });
  await page.waitForSelector('textarea[name="sells"], a[href="/app/inbox"]', {
    timeout: 30000,
  });
}
const step = (page, id) => page.locator(`#get-started [data-step="${id}"]`);
const stepDone = async (page, id) =>
  (await step(page, id).getAttribute("data-done")) === "true";
const progress = (page) =>
  page.locator("#get-started header span").first().innerText();

// ---------------------------------------------------------------------------
// 1. Sign up and confirm the address
// ---------------------------------------------------------------------------
const { ctx, page } = await newPage();
if (!SIGNED_UP) {
  await page.goto(`${BASE}/signup`);
  await page.fill('input[name="name"]', "E2E Activation");
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PW);
  await page.click(PASSWORD_FORM);
  const asked = await until(
    async () =>
      (await page.locator("body").innerText()).includes(
        `Check ${EMAIL}: we've sent a link`,
      ),
    30000,
  );
  ok("sign-up: asks the person to check their email", asked);
  await shot(page, "activation-signup");

  const token = await needSql(
    `the confirmation token; write the value into ${TOKEN_FILE}`,
    `select confirmation_token from auth.users where email = '${EMAIL}';`,
    () =>
      existsSync(TOKEN_FILE) &&
      readFileSync(TOKEN_FILE, "utf8").trim().length > 10
        ? readFileSync(TOKEN_FILE, "utf8").trim()
        : null,
  );
  await page.goto(
    `${BASE}/auth/confirm?token_hash=${encodeURIComponent(token)}&type=signup&next=/onboarding`,
  );
  await page.waitForSelector('textarea[name="sells"]', { timeout: 30000 });
  ok(
    "sign-up: the confirmation link signs them in and lands on onboarding",
    page.url().endsWith("/onboarding"),
    page.url(),
  );
} else {
  await logIn(page, EMAIL);
}

// ---------------------------------------------------------------------------
// 2. Onboarding, with a website
// ---------------------------------------------------------------------------
const onboarding = page.url().endsWith("/onboarding");
if (onboarding) {
  await page.fill('input[name="name"]', WORKSPACE);
  await page.fill(
    'textarea[name="sells"]',
    "An AI sales product for small teams. This is a test workspace.",
  );
  await page.fill('input[name="website"]', WEBSITE);
  await shot(page, "activation-onboarding");
  const started = Date.now();
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/app$/, { timeout: 30000 });
  await page.waitForSelector("#get-started", { timeout: 30000 });
  const took = Date.now() - started;
  ok(
    "onboarding: lands on Today without waiting for the website to be read",
    took < 15000,
    `${took} ms`,
  );
  const reading = await until(
    async () => /Reading /.test(await step(page, "teach").innerText()),
    4000,
  );
  ok(
    "checklist: says the website is being read",
    reading,
    reading ? "" : "(the read had already finished)",
  );
  if (reading) await shot(page, "activation-reading");
}
await page.waitForSelector("#get-started", { timeout: 30000 });
const token = await jwt(ctx);
const [ws] = (
  await db(
    `workspaces?select=id,name,website,trial_ends_at,created_at,billing_status,plan&order=created_at.desc&limit=1`,
    { token },
  )
).body;
console.log("workspace", ws.id, ws.name);

// The read finishes by itself, and the page shows it without a reload.
const read = await until(
  async () =>
    !/Reading /.test(await step(page, "teach").innerText()) &&
    (await stepDone(page, "teach")),
  60000,
);
ok("checklist: the read finishes and the page updates by itself", read);
const knowledge = (
  await db(
    `knowledge_items?select=title,kind,status,source_url,content&workspace_id=eq.${ws.id}&order=created_at`,
    { token },
  )
).body;
const pages = knowledge.filter((k) => k.source_url);
const siteOf = (u) => new URL(u).hostname.replace(/^www\./, "");
ok(
  "knowledge: the note from onboarding is there",
  knowledge.some((k) => k.title === "What we sell" && k.kind === "text"),
);
ok(
  "knowledge: the home page was read, and between one and four more pages",
  pages.length >= 2 &&
    pages.length <= 5 &&
    pages.some((k) => new URL(k.source_url).pathname === "/"),
  pages.map((k) => k.source_url).join(" "),
);
ok(
  "knowledge: every page is from the same site, over https, with real text",
  pages.length > 0 &&
    pages.every(
      (k) =>
        k.source_url.startsWith("https://") &&
        siteOf(k.source_url) === WEBSITE.replace(/^www\./, "") &&
        k.status === "ready" &&
        k.content.length >= 40,
    ),
);
const teachText = await step(page, "teach").innerText();
ok(
  "checklist: 'Teach your agent' is done and lists what was read",
  (await stepDone(page, "teach")) &&
    new RegExp(`${pages.length} pages? of your website`).test(teachText) &&
    pages.every((k) => teachText.includes(k.title)),
  teachText.replace(/\n+/g, " | ").slice(0, 200),
);
const setup = (
  await db(`workspace_setup?select=*&workspace_id=eq.${ws.id}`, { token })
).body[0];
ok(
  "checklist: the result is stored on the server",
  setup?.site_status === "done" && setup.site_pages === pages.length,
  JSON.stringify(setup),
);
await shot(page, "activation-checklist");

// ---------------------------------------------------------------------------
// 3. The trial clock
// ---------------------------------------------------------------------------
const days =
  (new Date(ws.trial_ends_at) - new Date(ws.created_at)) / 86_400_000;
ok(
  "trial: the workspace has seven days from when it was made",
  Math.abs(days - 7) < 0.001 && ws.billing_status === "trialing",
  `${days} days`,
);
const left = Math.ceil((new Date(ws.trial_ends_at) - Date.now()) / 86_400_000);
const banner = () => page.locator("[data-trial]");
ok(
  "trial: the banner says how many days are left",
  (await banner().innerText()) ===
    `${left} ${left === 1 ? "day" : "days"} left in your free trial` &&
    (await banner().getAttribute("data-trial")) === "running",
  await banner().innerText(),
);
const selfServe = await db(`workspaces?id=eq.${ws.id}`, {
  token,
  method: "PATCH",
  body: { trial_ends_at: "2099-01-01T00:00:00Z", billing_status: "active" },
});
const after = (
  await db(`workspaces?select=trial_ends_at,billing_status&id=eq.${ws.id}`, {
    token,
  })
).body[0];
ok(
  "trial: the owner can't extend it or mark the workspace paid through the API",
  selfServe.status >= 400 &&
    after.trial_ends_at === ws.trial_ends_at &&
    after.billing_status === "trialing",
  `status ${selfServe.status}`,
);

// ---------------------------------------------------------------------------
// 4. Try your agent
// ---------------------------------------------------------------------------
const widgets = (
  await db(
    `chat_widgets?select=id,token,enabled,last_seen_at,last_seen_origin&workspace_id=eq.${ws.id}`,
    { token },
  )
).body;
ok(
  "widget: a new workspace has a chat widget from the start, switched on",
  widgets.length === 1 && widgets[0].enabled,
  `${widgets.length} widget(s)`,
);
const WIDGET = widgets[0].token;
const runtime = !/isn't switched on yet on Dialvo's side/.test(
  await step(page, "try").innerText(),
);
await step(page, "try").locator('a[href="/app/agents/try"]').click();
await page.waitForURL(/\/app\/agents\/try$/, { timeout: 30000 });
await page.waitForSelector('[aria-label="Test chat"]', { timeout: 30000 });
if (!runtime) {
  const state = page.locator('[data-state="unavailable"]');
  ok(
    "try your agent: without the keys, says the agent isn't switched on yet on Dialvo's side",
    /isn't switched on yet on Dialvo's side/.test(await state.innerText()) &&
      (await page.locator('textarea[name="message"]').isDisabled()),
    (await state.innerText()).slice(0, 90),
  );
} else {
  await page.fill('textarea[name="message"]', "What do you sell?");
  await page.keyboard.press("Enter");
  const answered = await until(
    () => page.locator('[data-from="agent"]').count(),
    40000,
  );
  ok("try your agent: the agent answers in the app", answered);
}
ok(
  "try your agent: the page says test chats aren't leads",
  /Test chats are not leads/.test(
    await page.locator("main").first().innerText(),
  ),
);
await shot(page, "activation-try-agent");
const leadsAfterTry = (
  await db(`leads?select=id&workspace_id=eq.${ws.id}`, { token })
).body;
const conversationsAfterTry = (
  await db(`conversations?select=id&workspace_id=eq.${ws.id}`, { token })
).body;
ok(
  "try your agent: no lead and no conversation was created",
  leadsAfterTry.length === 0 && conversationsAfterTry.length === 0,
);

// ---------------------------------------------------------------------------
// 5. The install check
// ---------------------------------------------------------------------------
await page.goto(`${BASE}/app`);
await page.waitForSelector("#get-started", { timeout: 30000 });
const snippet = await step(page, "install").locator("pre").innerText();
ok(
  "install: the checklist holds the one line to paste",
  snippet === `<script src="${BASE}/widget.js?id=${WIDGET}" async></script>`,
  snippet.slice(0, 60),
);
ok(
  "install: before the code is anywhere, it says 'Not seen yet'",
  (await step(page, "install").locator("[data-seen]").innerText()) ===
    "Not seen yet" && !(await stepDone(page, "install")),
);

// The preview in Dialvo's own Settings loads the real widget. It must not
// count as the customer's site.
await page.goto(`${BASE}/app/settings`);
await page.waitForSelector("#chat", { timeout: 30000 });
await page.click('#chat button:has-text("Preview on this page")');
await page.waitForSelector("[data-dialvo-chat] .panel", { timeout: 20000 });
await sleep(2500);
await page.click('#chat button:has-text("Check again")');
await sleep(1500);
ok(
  "install: the preview inside Dialvo doesn't count as an install",
  (await page.locator("#chat [data-seen]").innerText()) === "Not seen yet",
);
await page.click('#chat button:has-text("Hide preview")');

// Now the customer's own site, on another origin.
customerPage = `<!doctype html><html><head><meta charset="utf-8"><title>Customer site</title></head>
<body><h1>A customer's website</h1>${snippet}</body></html>`;
const visitor = await newPage();
const v = visitor.page;
const seenCalls = [];
v.on("request", (r) => {
  if (r.url().includes("/seen"))
    seenCalls.push({ method: r.method(), body: r.postData(), url: r.url() });
});
await v.goto(`${SITE}/pricing?visitor=dana%40example.com`);
await v.waitForSelector("[data-dialvo-chat]", {
  state: "attached",
  timeout: 20000,
});
await until(() => seenCalls.length > 0, 10000);
ok(
  "install: the widget reports once that it loaded, with nothing but its id",
  seenCalls.length === 1 &&
    seenCalls[0].method === "POST" &&
    seenCalls[0].body === "{}" &&
    seenCalls[0].url === `${BASE}/api/chat/${WIDGET}/seen`,
  JSON.stringify(seenCalls[0] ?? null),
);
ok(
  "install: no cookies are set on the customer's site or sent to Dialvo",
  (await visitor.ctx.cookies()).length === 0,
);
const seenRow = await until(async () => {
  const [row] = (
    await db(
      `chat_widgets?select=first_seen_at,first_seen_origin,last_seen_at,last_seen_origin&token=eq.${WIDGET}`,
      { token },
    )
  ).body;
  return row.last_seen_at ? row : null;
}, 10000);
ok(
  "install: what is stored is the site's origin and the time, not the page or the visitor",
  seenRow?.last_seen_origin === SITE &&
    seenRow.first_seen_origin === SITE &&
    !JSON.stringify(seenRow).includes("dana") &&
    !JSON.stringify(seenRow).includes("pricing"),
  JSON.stringify(seenRow),
);

await page.goto(`${BASE}/app`);
await page.waitForSelector("#get-started", { timeout: 30000 });
await step(page, "install").locator('button:has-text("Check again")').click();
const seenText = await until(async () => {
  const text = await step(page, "install").locator("[data-seen]").innerText();
  return text.startsWith("Seen on") ? text : null;
}, 10000);
ok(
  "install: the checklist says where and when it was seen, and the step is done",
  new RegExp(
    `^Seen on ${SITE_HOST.replace(/\./g, "\\.")}, (just now|\\d+ minutes? ago)$`,
  ).test(seenText ?? "") && (await stepDone(page, "install")),
  seenText ?? "",
);
await shot(page, "activation-installed");
await page.goto(`${BASE}/app/settings`);
await page.waitForSelector("#chat", { timeout: 30000 });
ok(
  "install: Settings shows the same",
  (await page.locator("#chat [data-seen]").innerText()).startsWith(
    `Seen on ${SITE_HOST}, `,
  ),
  await page.locator("#chat [data-seen]").innerText(),
);

// The ping's own rules, from outside a browser.
const ping = (headers = {}, id = WIDGET) =>
  fetch(`${BASE}/api/chat/${id}/seen`, {
    method: "POST",
    headers: { "content-type": "text/plain", ...headers },
    body: "{}",
  });
const pinged = await ping({ origin: "https://another-site.example" });
ok(
  "install: the endpoint answers any site and sets no cookie",
  pinged.status === 200 &&
    pinged.headers.get("access-control-allow-origin") === "*" &&
    !pinged.headers.get("set-cookie"),
);
const afterPing = (
  await db(`chat_widgets?select=last_seen_origin&token=eq.${WIDGET}`, { token })
).body[0];
ok(
  "install: a second sighting within 30 seconds isn't written",
  afterPing.last_seen_origin === SITE,
  afterPing.last_seen_origin,
);
ok(
  "install: an unknown widget id is refused",
  (await ping({ origin: "https://x.example" }, "nope")).status === 404,
);
let limited = 0;
for (let i = 0; i < 40; i++)
  if ((await ping({ origin: "https://another-site.example" })).status === 429)
    limited++;
ok(
  "install: the ping is rate-limited",
  limited > 0,
  `${limited} of 40 refused`,
);

// ---------------------------------------------------------------------------
// 6. A visitor writes while no agent answers: saved, and an alert is queued
// ---------------------------------------------------------------------------
await v.click("[data-dialvo-chat] button.launch");
await v.fill("[data-dialvo-chat] textarea", "Hello, is anyone there?");
await v.keyboard.press("Enter");
const told = await until(
  async () =>
    /team member will reply/i.test(
      await v.locator("[data-dialvo-chat] .log").innerText(),
    ),
  20000,
);
ok(
  "chat: with the agent off, the visitor is told a team member will reply",
  told,
);
const conversations = await until(async () => {
  const rows = (
    await db(`conversations?select=id,status&workspace_id=eq.${ws.id}`, {
      token,
    })
  ).body;
  return rows.length ? rows : null;
});
ok(
  "chat: the message is in the Inbox, waiting for the team",
  conversations?.length === 1 && conversations[0].status === "waiting_for_you",
);
const alerts = (
  await db(
    `team_alerts?select=kind,status,summary,conversation_id&workspace_id=eq.${ws.id}`,
    { token },
  )
).body;
const emailLive = !(await page.locator('[data-alerts="not-live"]').count());
ok(
  "alerts: a chat nobody answers queues one alert for the team",
  alerts.length === 1 &&
    alerts[0].kind === "needs_human" &&
    alerts[0].conversation_id === conversations[0].id,
  JSON.stringify(alerts),
);
if (!emailLive)
  ok(
    "alerts: without the email key nothing is sent, and the alert stays queued",
    alerts[0]?.status === "pending",
    alerts[0]?.status,
  );
await shot(v, "activation-widget");

// ---------------------------------------------------------------------------
// 7. Email alerts in Settings
// ---------------------------------------------------------------------------
const alertsBox = page.locator("#alerts");
if (!emailLive)
  ok(
    "alerts: Settings says email alerts aren't switched on yet",
    /Email alerts aren't switched on yet/.test(await alertsBox.innerText()),
  );
ok(
  "alerts: on by default for a new person",
  /On for you/.test(await alertsBox.innerText()) &&
    (await alertsBox.innerText()).includes(EMAIL),
);
await alertsBox.locator('button:has-text("Turn my alerts off")').click();
const off = await until(async () =>
  /Off for you/.test(await alertsBox.innerText()),
);
const profileOff = (
  await db(
    `profiles?select=alert_emails&email=eq.${encodeURIComponent(EMAIL)}`,
    {
      token,
    },
  )
).body[0];
ok(
  "alerts: each person can turn their own off",
  off && profileOff?.alert_emails === false,
);
await shot(page, "activation-settings");
await alertsBox.locator('button:has-text("Turn my alerts on")').click();
ok(
  "alerts: and on again",
  await until(async () => /On for you/.test(await alertsBox.innerText())),
);

// ---------------------------------------------------------------------------
// 8. Switch the agent on, from the checklist
// ---------------------------------------------------------------------------
await page.goto(`${BASE}/app`);
await page.waitForSelector("#get-started", { timeout: 30000 });
const before = await progress(page);
if (!(await stepDone(page, "on"))) {
  await step(page, "on")
    .locator('button:has-text("Switch the agent on")')
    .click();
  await until(() => stepDone(page, "on"));
}
const agents = (
  await db(
    `agents?select=enabled,approval_mode&workspace_id=eq.${ws.id}&role=eq.inbound`,
    { token },
  )
).body;
ok(
  "checklist: 'Switch your agent on' switches the inbound agent on, asking first",
  (await stepDone(page, "on")) &&
    agents[0].enabled &&
    agents[0].approval_mode === "approve_first",
  `${before} -> ${await progress(page)}`,
);
const expected = runtime ? 3 : 3;
ok(
  "checklist: progress is counted from what really happened",
  (await progress(page)) ===
    `${(await stepDone(page, "try")) ? 4 : expected} of 4 done`,
  await progress(page),
);
if (!runtime)
  ok(
    "checklist: 'Try your agent' stays to do until the agent has really answered",
    !(await stepDone(page, "try")),
  );
await shot(page, "activation-agent-on");

// ---------------------------------------------------------------------------
// 9. Another workspace can't see any of it
// ---------------------------------------------------------------------------
if (OTHER) {
  const other = await newPage();
  await logIn(other.page, OTHER);
  const theirs = await jwt(other.ctx);
  for (const table of [
    "workspace_setup",
    "agent_test_messages",
    "team_alerts",
    "chat_widgets",
    "knowledge_items",
  ]) {
    const rows = await db(`${table}?select=*&workspace_id=eq.${ws.id}`, {
      token: theirs,
    });
    ok(
      `isolation: someone in another workspace reads nothing from ${table}`,
      rows.status === 200 && rows.body.length === 0,
      `${rows.status}`,
    );
  }
  const poke = await db(`workspace_setup?workspace_id=eq.${ws.id}`, {
    token: theirs,
    method: "PATCH",
    body: { dismissed_at: new Date().toISOString() },
  });
  ok(
    "isolation: and can't dismiss its checklist",
    Array.isArray(poke.body) ? poke.body.length === 0 : poke.status >= 400,
    `${poke.status}`,
  );
  await other.ctx.close();
}
for (const [fn, args] of [
  [
    "agent_test_begin",
    {
      p_workspace_id: ws.id,
      p_user_id: ws.id,
      p_session_id: ws.id,
      p_body: "x",
    },
  ],
  ["claim_team_alerts", { p_token: WIDGET, p_conversation_id: ws.id }],
  ["chat_billing_state", { p_token: WIDGET }],
]) {
  for (const who of [undefined, token]) {
    const r = await db(`rpc/${fn}`, { token: who, body: args });
    ok(
      `isolation: ${fn} can't be called ${who ? "by a signed-in person" : "without signing in"}`,
      r.status >= 400,
      `${r.status}`,
    );
  }
}

// ---------------------------------------------------------------------------
// 10. After the trial ends
// ---------------------------------------------------------------------------
await needSql(
  "end this workspace's trial",
  `update public.workspaces set trial_ends_at = now() - interval '1 day' where id = '${ws.id}';`,
  async () => {
    const [row] = (
      await db(`workspaces?select=trial_ends_at&id=eq.${ws.id}`, { token })
    ).body;
    return new Date(row.trial_ends_at) < new Date();
  },
);
await page.goto(`${BASE}/app`);
await page.waitForSelector("[data-trial]", { timeout: 30000 });
const ended = await banner().innerText();
ok(
  "trial: after it ends the banner says so",
  ended.startsWith("Your free trial has ended") &&
    (await banner().getAttribute("data-trial")) === "ended",
  ended,
);
if (!ENFORCED) {
  ok(
    "trial: with enforcement off, it says plans are coming and how to reach us",
    /plans are coming/i.test(ended) &&
      (await banner().locator("a").getAttribute("href")) ===
        "mailto:contact@trydialvo.com",
  );
  // Nothing is blocked: the app works and the chat still takes messages.
  await page.goto(`${BASE}/app/knowledge`);
  ok(
    "trial: with enforcement off, the app is not blocked",
    await until(async () =>
      /What we sell/.test(await page.locator("main").first().innerText()),
    ),
  );
  await v.fill("[data-dialvo-chat] textarea", "Still here after the trial?");
  await v.keyboard.press("Enter");
  const kept = await until(async () => {
    const rows = (
      await db(
        `messages?select=body&workspace_id=eq.${ws.id}&body=eq.${encodeURIComponent("Still here after the trial?")}`,
        { token },
      )
    ).body;
    return rows.length === 1;
  });
  ok("trial: with enforcement off, the chat widget still works", kept);
} else {
  ok(
    "trial: with enforcement on, the banner asks for a plan",
    /stopped replying/.test(ended) &&
      (await banner().locator("a").innerText()) === "Pick a plan",
    ended,
  );
}
await page.goto(`${BASE}/app/settings`);
await page.waitForSelector("[data-trial-line]", { timeout: 30000 });
ok(
  "trial: Settings says when it ended",
  /Your free trial ended on/.test(
    await page.locator("[data-trial-line]").innerText(),
  ),
  await page.locator("[data-trial-line]").innerText(),
);
await page.goto(`${BASE}/app`);
await page.waitForSelector("[data-trial]", { timeout: 30000 });
await shot(
  page,
  ENFORCED ? "activation-trial-enforced" : "activation-trial-ended",
);

await needSql(
  "put the trial back",
  `update public.workspaces set trial_ends_at = created_at + interval '7 days' where id = '${ws.id}';`,
  async () => {
    const [row] = (
      await db(`workspaces?select=trial_ends_at&id=eq.${ws.id}`, { token })
    ).body;
    return new Date(row.trial_ends_at) > new Date();
  },
);

// ---------------------------------------------------------------------------
// 11. Dismissing the checklist
// ---------------------------------------------------------------------------
await page.goto(`${BASE}/app`);
await page.waitForSelector("#get-started", { timeout: 30000 });
await page.click('#get-started button:has-text("Dismiss")');
const gone = await until(
  async () => !(await page.locator("#get-started").count()),
);
await page.reload();
await page.waitForSelector('a[href="/app/inbox"]', { timeout: 30000 });
ok(
  "checklist: dismissing it hides it, and it stays hidden",
  gone && !(await page.locator("#get-started").count()),
);

await browser.close();
customerSite.close();
const failed = results.filter((r) => !r.pass);
console.log(
  `\n${results.length - failed.length} of ${results.length} checks passed.`,
);
if (failed.length) {
  for (const f of failed) console.log("FAILED:", f.name, f.detail);
  process.exit(1);
}
