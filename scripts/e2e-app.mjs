// The end-to-end check for slice 1, against a real Supabase project.
//
// It drives a browser through the app as two people in two workspaces:
// log in, onboarding, add a lead, import a CSV, the public capture endpoint,
// inbox reply, knowledge, agents, settings, log out; then it checks, in the
// app and straight against the database's API with each person's own token,
// that the second person can't see or change anything of the first's.
//
// Before running it:
//   1. `npm run dev` (or point E2E_BASE at a deployment).
//   2. Two confirmed test accounts that share a password, in no workspace or
//      left over from an earlier run (it clears its own leftovers). Their
//      addresses go in E2E_USER_1 and E2E_USER_2, the password in
//      E2E_PASSWORD. See docs/app-setup.md.
//   3. Playwright and a Chrome: `npm i -D playwright` or set PLAYWRIGHT to
//      its index.mjs, and CHROME to a browser binary if it isn't bundled.
//
//   E2E_PASSWORD=... E2E_USER_1=... E2E_USER_2=... node scripts/e2e-app.mjs
//
// Screenshots go to ./screenshots (gitignored). It never deletes workspaces
// or accounts: remove the test accounts in the Supabase dashboard afterwards.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { chromium } = await import(process.env.PLAYWRIGHT ?? "playwright");
const BASE = process.env.E2E_BASE ?? "http://localhost:3000";
const SHOTS = "screenshots";
mkdirSync(SHOTS, { recursive: true });
const PW = process.env.E2E_PASSWORD;
const USER_1 = process.env.E2E_USER_1;
const USER_2 = process.env.E2E_USER_2;
if (!PW || !USER_1 || !USER_2)
  throw new Error("Set E2E_PASSWORD, E2E_USER_1 and E2E_USER_2.");
const CSV = join(tmpdir(), "dialvo-e2e-leads.csv");
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => [
      l.slice(0, l.indexOf("=")),
      l.slice(l.indexOf("=") + 1).trim(),
    ]),
);
const SB = env.NEXT_PUBLIC_SUPABASE_URL,
  KEY = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
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

async function login() {
  const ctx = await browser.newContext({
    viewport: { width: 1360, height: 900 },
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await page.goto(`${BASE}/login`);
  return { ctx, page };
}
async function token(ctx) {
  const cookies = await ctx.cookies();
  const parts = cookies
    .filter((c) => c.name.startsWith("sb-") && c.name.includes("auth-token"))
    .sort((a, b) => a.name.localeCompare(b.name));
  let raw = parts.map((c) => c.value).join("");
  if (raw.startsWith("base64-"))
    raw = Buffer.from(raw.slice(7), "base64url").toString();
  return JSON.parse(decodeURIComponent(raw)).access_token;
}
const rest = async (path, jwt) => {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    headers: {
      apikey: KEY,
      ...(jwt ? { authorization: `Bearer ${jwt}` } : {}),
    },
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

// ---------- user 1
const { ctx: c1, page: p1 } = await login();
await shot(p1, "app-login-desktop");
await p1.fill('input[name="email"]', USER_1);
await p1.fill('input[name="password"]', "wrong-password-xx");
await p1.click('button[type="submit"]');
await p1.waitForSelector("p[role=alert]");
ok(
  "login: wrong password is refused",
  (await p1.textContent("p[role=alert]")).includes("don't match"),
);
await p1.fill('input[name="password"]', PW);
await p1.click('button[type="submit"]');
await p1.waitForURL(/\/(onboarding|app)$/, { timeout: 30000 });
if (p1.url().endsWith("/onboarding")) {
  ok("login: correct password, no workspace -> /onboarding", true);
  await shot(p1, "app-onboarding-desktop");
  await p1.fill('input[name="name"]', "E2E Agency One");
  await p1.fill(
    'textarea[name="sells"]',
    "Websites for dental clinics, from $900 a month.",
  );
  await p1.fill('input[name="website"]', "e2e-one.example");
  await p1.selectOption('select[name="timezone"]', "Europe/London");
  await p1.click('button[type="submit"]');
  await p1.waitForURL("**/app", { timeout: 30000 });
} else {
  // A re-run: clear what the last run left, as the test user, through the API.
  const jwt = await token(c1);
  const del = (path, method = "DELETE", body) =>
    fetch(`${SB}/rest/v1/${path}`, {
      method,
      headers: {
        apikey: KEY,
        authorization: `Bearer ${jwt}`,
        "content-type": "application/json",
      },
      body: body && JSON.stringify(body),
    }).then((r) => r.status);
  console.log(
    "cleanup",
    await del("leads?id=not.is.null"),
    await del("knowledge_items?title=neq.What%20we%20sell"),
    await del("invitations?id=not.is.null"),
    await del("agents?id=not.is.null", "PATCH", {
      enabled: false,
      instructions: "",
    }),
  );
  await p1.goto(`${BASE}/app`);
}
await p1.waitForSelector("text=Waiting for you");
ok(
  "today: zero state has zeros, not sample numbers",
  (await p1.locator("dd.text-\\[26px\\]").allTextContents()).every(
    (t) => t.trim() === "0",
  ),
);
await shot(p1, "app-today-empty-desktop");

// add a lead
await p1.goto(`${BASE}/app/leads`);
await p1.waitForSelector("text=No leads yet");
await shot(p1, "app-leads-empty-desktop");
await p1.click("button:has-text('Add lead')");
await p1.fill('dialog input[name="name"]', "Nora Field");
await p1.fill('dialog input[name="company"]', "Field & Co");
await p1.click("dialog button[type=submit]");
await p1.waitForSelector("dialog p[role=alert]");
ok(
  "add lead: needs an email or phone",
  (await p1.textContent("dialog p[role=alert]")).includes("email or a phone"),
);
ok(
  "add lead: typed values survive a refusal",
  (await p1.inputValue('dialog input[name="name"]')) === "Nora Field",
);
await p1.fill('dialog input[name="email"]', "Nora@Field-E2E.example");
await p1.fill('dialog input[name="phone"]', "+44 1632 960123");
await p1.click("dialog button[type=submit]");
await p1.waitForURL(/\/app\/leads\/[0-9a-f-]{36}$/, { timeout: 30000 });
const lead1Url = p1.url();
await p1.waitForSelector("h1:has-text('Nora Field')");
ok("add lead: lands on the lead page", true);
// status
await p1.selectOption('select[name="status"]', "qualified");
await p1.click("button:has-text('Update')");
await p1.waitForSelector("text=Status changed from New to Qualified");
ok("lead: status change is on the timeline", true);
await p1.fill(
  'textarea[name="note"]',
  "Met at the trade show.\nWants a quote.",
);
await p1.click("button:has-text('Save note')");
await p1.waitForSelector("text=Met at the trade show.");
ok("lead: note saved", true);
const callRow = p1.locator("li", {
  has: p1.locator('input[name="channel"][value="call"]'),
});
await callRow.locator('input[name="source"]').fill("Asked on a call");
await callRow.locator("button[type=submit]").click();
await p1.waitForSelector("text=Consent recorded for Calls");
ok(
  "lead: consent recorded with its source",
  (await callRow.textContent()).includes(
    `Asked on a call (recorded by ${USER_1})`,
  ),
);
await p1.click("button:has-text('Mark do not contact')");
await p1.waitForSelector("text=Allow contact again");
ok(
  "lead: do-not-contact switched on",
  await p1.locator("text=Do not contact").first().isVisible(),
);
await shot(p1, "app-lead-detail-real-desktop");

// duplicate add
await p1.goto(`${BASE}/app/leads`);
await p1.click("button:has-text('Add lead')");
await p1.fill('dialog input[name="email"]', "nora@field-e2e.example");
await p1.click("dialog button[type=submit]");
await p1.waitForSelector("dialog p[role=alert]");
ok(
  "add lead: duplicate email refused",
  (await p1.textContent("dialog p[role=alert]")).includes("already a lead"),
);

// CSV import
const csv =
  'First Name,Last Name,E-mail,Phone,Company,Stage\nAda,Lovelace,ada@e2e-import.example,(555) 010-1234,"Engines, Analytical",Qualified\nNora,Again,NORA@field-e2e.example,,Field,New\nBob,Dup,bob@e2e-import.example,555 010 9999,Bobco,\nBob,Dup2,BOB@e2e-import.example,,Bobco,\nNo,Contact,,,Nothing,\nBad,Email,not-an-email,,X,\nPhone,Only,,+1 555 010 7777,PhoneCo,won\n';
writeFileSync(CSV, csv);
await p1.goto(`${BASE}/app/leads/import`);
await p1.setInputFiles('input[type="file"]', CSV);
await p1.waitForSelector("text=2. Match the columns");
const counts = await p1.locator("dl dd").allTextContents();
ok(
  "import: preview counts (4 ready incl. the one already here, 1 repeat, 2 problems)",
  counts.join(",") === "4,1,2",
  counts.join(","),
);
await shot(p1, "app-import-mapping-real-desktop");
await p1.click("button:has-text('Import 4 leads')");
await p1.waitForSelector("text=3 leads imported", { timeout: 30000 });
const summary = await p1.locator("section p").first().textContent();
ok(
  "import: 3 added, 1 already in the workspace skipped",
  summary.includes("1 already in this workspace"),
  summary,
);
await p1.goto(`${BASE}/app/leads?q=lovelace`);
await p1.waitForSelector("text=Ada Lovelace");
ok(
  "leads: search finds the imported lead with its mapped status",
  (await p1.locator("tbody tr").count()) === 1 &&
    (await p1.locator("tbody tr").textContent()).includes("Qualified"),
);
await p1.goto(`${BASE}/app/leads?status=won`);
ok(
  "leads: status filter",
  (await p1.locator("tbody tr").count()) === 1 &&
    (await p1.locator("tbody tr").textContent()).includes("+15550107777"),
);

// capture
await p1.goto(`${BASE}/app/settings`);
await p1.waitForSelector("#forms code");
const captureUrl = (
  await p1.locator("#forms code").first().textContent()
).trim();
await shot(p1, "app-settings-real-desktop");
let r = await fetch(captureUrl, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    origin: "https://customer.example",
  },
  body: JSON.stringify({
    name: "Carl Capture",
    email: "carl@e2e-capture.example",
    phone: "+1 (555) 010-4444",
    company: "Capture Co",
    message: "Can you call me about pricing?",
    consent_call: true,
  }),
});
ok(
  "capture: JSON post accepted with CORS",
  r.status === 200 &&
    r.headers.get("access-control-allow-origin") === "*" &&
    (await r.json()).ok === true,
);
r = await fetch(captureUrl, {
  method: "POST",
  headers: {
    "content-type": "application/x-www-form-urlencoded",
    accept: "text/html",
  },
  body: "name=Fiona+Form&email=fiona%40e2e-capture.example&message=Hello+from+a+plain+form",
});
ok(
  "capture: plain form post gets a thank-you page",
  r.status === 200 && (await r.text()).includes("Thank you"),
);
r = await fetch(captureUrl, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ name: "No contact" }),
});
ok("capture: invalid payload refused (400)", r.status === 400);
r = await fetch(captureUrl.replace(/[0-9a-f]{64}$/, "f".repeat(64)), {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "x@e2e-capture.example" }),
});
ok("capture: unknown token is 404", r.status === 404);
r = await fetch(captureUrl, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "bot@e2e-capture.example", _hp: "x" }),
});
ok("capture: honeypot returns ok", r.status === 200);

// today now has data
await p1.goto(`${BASE}/app`);
await p1.waitForSelector("text=Waiting for you");
const tiles = await p1.locator("dd.text-\\[26px\\]").allTextContents();
ok(
  "today: tiles computed from rows (2 conversations, 1 qualified, 0 meetings, 2 waiting)",
  tiles.join(",") === "2,1,0,2",
  tiles.join(","),
);
await shot(p1, "app-today-real-desktop");

// inbox
await p1.goto(`${BASE}/app/inbox`);
await p1.waitForSelector("text=Carl Capture");
ok(
  "inbox: honeypot lead was not saved",
  (await p1.locator("text=bot@e2e-capture.example").count()) === 0,
);
await p1.click("a:has-text('Carl Capture')");
await p1.waitForSelector('textarea[name="body"]');
const conv1Url = p1.url();
await p1.fill(
  'textarea[name="body"]',
  "Hi Carl, happy to. Is tomorrow at 10 good?",
);
await p1.click("button:has-text('Save reply')");
await p1.waitForSelector("text=Hi Carl, happy to.");
ok(
  "inbox: reply stored and honestly marked not delivered",
  (await p1.locator("text=Saved, not delivered").count()) >= 2,
);
await shot(p1, "app-inbox-thread-real-desktop");
await p1.goto(`${BASE}/app/inbox?queue=waiting`);
await p1.waitForSelector("text=Fiona Form");
ok(
  "inbox: answered conversation left the waiting queue",
  (await p1.locator("a:has-text('Carl Capture')").count()) === 0,
);
await p1.goto(conv1Url.replace("queue=waiting", "queue=all"));
await p1.click("button:has-text('Close')");
await p1.waitForSelector("button:has-text('Reopen')");
ok("inbox: close a conversation", true);
// capture consent on lead
await p1.goto(`${BASE}/app/leads?q=carl`);
await p1.click("a:has-text('Carl Capture')");
await p1.waitForSelector("text=Consent");
const carlCall = await p1
  .locator("li", { has: p1.locator('input[name="channel"][value="call"]') })
  .textContent();
const carlSms = await p1
  .locator("li", { has: p1.locator('input[name="channel"][value="sms"]') })
  .textContent();
ok(
  "capture: consent recorded only for the channel in the payload",
  carlCall.includes("Agreed") &&
    carlCall.includes("form: Website form") &&
    carlSms.includes("No consent"),
);

// knowledge
await p1.goto(`${BASE}/app/knowledge`);
await p1.waitForSelector("text=What we sell");
ok("knowledge: onboarding's 'what you sell' is the first item", true);
const textForm = p1.locator("section", { hasText: "Add text" }).last();
await textForm.locator('input[name="title"]').fill("Pricing");
await textForm
  .locator('textarea[name="content"]')
  .fill("Starter is $900 a month. Setup is free.");
await textForm.locator("button[type=submit]").click();
await p1.waitForSelector("summary:has-text('Pricing')");
const urlForm = p1.locator("section", { hasText: "Add a web page" }).last();
await urlForm.locator('input[name="content"]').fill("e2e-one.example/faq");
await urlForm.locator("button[type=submit]").click();
await p1.waitForSelector("text=Not fetched yet");
ok("knowledge: text and URL items added; URL marked not fetched", true);
await p1.locator("summary:has-text('Pricing')").click();
const edit = p1.locator("details[open]");
await edit.locator('textarea[name="content"]').fill("Starter is $950 a month.");
await edit.locator("button:has-text('Save changes')").click();
await p1.waitForSelector("text=Saved.");
p1.once("dialog", (d) => d.accept());
await p1.locator("summary:has-text('e2e-one.example')").click();
await p1
  .locator("details[open]")
  .last()
  .locator("button:has-text('Delete')")
  .click();
await p1.waitForFunction(
  () =>
    !document.body.textContent.includes("Not fetched yet") ||
    document.querySelectorAll("summary").length === 2,
);
ok(
  "knowledge: edit and delete",
  (await p1.locator("summary").count()) === 2,
  String(await p1.locator("summary").count()),
);
await shot(p1, "app-knowledge-real-desktop");

// agents
await p1.goto(`${BASE}/app/agents`);
await p1.waitForSelector("text=Inbound agent");
const inbound = p1.locator("section", { hasText: "Inbound agent" }).first();
await inbound
  .locator('textarea[name="instructions"]')
  .fill("Ask how many chairs the clinic has.");
await inbound.locator("button:has-text('Save settings')").click();
await inbound.locator("text=Saved.").waitFor();
await inbound.locator("button:has-text('Switch on')").click();
await inbound.locator("text=Switched on, but not live yet").waitFor();
ok("agents: instructions saved, switched on, labelled not live", true);
await shot(p1, "app-agents-real-desktop");

// settings: invite user 2, second workspace refused on Starter
await p1.goto(`${BASE}/app/settings`);
await p1.fill('#members input[name="email"]', USER_2);
await p1.click("#members button:has-text('Invite')");
await p1.waitForSelector("text=not emailed");
ok(
  "settings: invitation saved and says no email is sent",
  (await p1.locator("#members [role=status]").textContent()).includes(
    "don't send invitation emails yet",
  ),
);
await p1.goto(`${BASE}/onboarding?new=1`);
await p1.fill('input[name="name"]', "Second");
await p1.fill('textarea[name="sells"]', "x");
await p1.click('button[type="submit"]');
await p1.waitForSelector("p[role=alert]");
ok(
  "workspaces: a second workspace is refused on Starter",
  (await p1.textContent("p[role=alert]")).includes("Scale includes five"),
);

const jwt1 = await token(c1);
const mine = await rest("leads?select=id,email", jwt1);
ok(
  "REST as user 1: sees own 6 leads",
  mine.status === 200 && mine.body.length === 6,
  `${mine.status} ${mine.body?.length}`,
);
const lead1Id = lead1Url.split("/").pop();
const conv1Id = new URL(conv1Url).searchParams.get("c");

// log out
await p1.goto(`${BASE}/app`);
await p1.click('button[aria-label^="Account"]');
await p1.click("button:has-text('Log out')");
await p1.waitForURL("**/login");
await p1.goto(`${BASE}/app/leads`);
ok(
  "logout: /app redirects to /login with next",
  p1.url().includes("/login?next=%2Fapp%2Fleads"),
);
await c1.close();

// ---------- user 2
const { ctx: c2, page: p2 } = await login();
await p2.fill('input[name="email"]', USER_2);
await p2.fill('input[name="password"]', PW);
await p2.click('button[type="submit"]');
await p2.waitForURL(/\/(onboarding|app)$/, { timeout: 30000 });
const fresh2 = p2.url().endsWith("/onboarding");
if (!fresh2) await p2.goto(`${BASE}/onboarding?new=1`);
await p2.waitForSelector('button:has-text("Create workspace")');
ok(
  "user 2: onboarding offers the invitation to workspace one",
  (await p2.locator("text=E2E Agency One").count()) === 1,
);
await shot(p2, "app-onboarding-invited-desktop");
if (fresh2) {
  await p2.fill('input[name="name"]', "E2E Agency Two");
  await p2.fill('textarea[name="sells"]', "Accounting for cafes.");
  await p2.click('button:has-text("Create workspace")');
  await p2.waitForURL("**/app", { timeout: 30000 });
}
await p2.goto(`${BASE}/app/leads`);
await p2.waitForSelector("text=No leads yet");
ok("isolation (UI): user 2's leads list is empty", true);
await p2.goto(`${BASE}/app/inbox?queue=all`);
ok(
  "isolation (UI): user 2's inbox is empty",
  (await p2.locator("text=No conversations here").count()) === 1,
);
const res = await p2.goto(`${BASE}/app/leads/${lead1Id}`);
await p2.waitForLoadState("networkidle");
ok(
  "isolation (UI): user 1's lead page is not found for user 2",
  (await p2.locator("text=Nora Field").count()) === 0 &&
    (await p2.locator("text=/Nothing here|404|not found/i").count()) > 0,
  `status ${res.status()}`,
);
await p2.goto(`${BASE}/app/inbox?queue=all&c=${conv1Id}`);
ok(
  "isolation (UI): user 1's conversation doesn't exist for user 2",
  (await p2.locator("text=That conversation doesn't exist").count()) === 1 &&
    (await p2.locator("text=Carl").count()) === 0,
);
await p2.goto(`${BASE}/app/knowledge`);
await p2.waitForSelector("text=What we sell");
ok(
  "isolation (UI): user 2 sees only their own knowledge",
  (await p2.locator("summary:has-text('Accounting for cafes.')").count()) ===
    1 && (await p2.locator("summary").count()) === 1,
);
await p2.goto(`${BASE}/app/settings`);
ok(
  "isolation (UI): user 2's members list has only user 2",
  (await p2.locator("#members > ul > li").count()) === 1,
);

const jwt2 = await token(c2);
for (const table of [
  "leads",
  "conversations",
  "messages",
  "activity_events",
  "knowledge_items",
  "agents",
  "lead_forms",
  "invitations",
  "workspaces",
  "workspace_members",
  "profiles",
  "meetings",
  "calls",
]) {
  const a = await rest(`${table}?select=*`, jwt1 && jwt2);
  const ws2only =
    a.status === 200 &&
    a.body.every(
      (row) => JSON.stringify(row).includes("E2E Agency One") === false,
    );
  const anon = await rest(`${table}?select=*`);
  console.log(
    "  ",
    table,
    "user2 rows:",
    a.body?.length,
    "| anon:",
    anon.status,
    JSON.stringify(anon.body).slice(0, 60),
  );
  ok(
    `REST isolation: ${table} (user 2 sees none of workspace one; anon is refused)`,
    ws2only && anon.status >= 400,
  );
}
const l2 = await rest("leads?select=id", jwt2);
ok("REST as user 2: zero leads", l2.body.length === 0);
const direct = await rest(`leads?select=id,name&id=eq.${lead1Id}`, jwt2);
ok(
  "REST as user 2: user 1's lead by id returns nothing",
  direct.body.length === 0,
);
// writes into workspace one
const ws1 = (await rest("workspaces?select=id,name", jwt1)).body[0];
const w = async (method, path, body) => {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: KEY,
      authorization: `Bearer ${jwt2}`,
      "content-type": "application/json",
      prefer: "return=representation",
    },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};
let x = await w("POST", "leads", {
  workspace_id: ws1.id,
  name: "Planted",
  email: "planted@e2e.example",
});
ok(
  "REST as user 2: insert into workspace one refused",
  x.status >= 400,
  `${x.status} ${x.body?.message}`,
);
x = await w("PATCH", `leads?id=eq.${lead1Id}`, { name: "Hacked" });
ok(
  "REST as user 2: update of user 1's lead changes nothing",
  x.status === 200 && x.body.length === 0,
  `${x.status}`,
);
x = await w("DELETE", `leads?id=eq.${lead1Id}`);
ok(
  "REST as user 2: delete of user 1's lead changes nothing",
  x.status === 200 && x.body.length === 0,
  `${x.status}`,
);
x = await w("POST", "workspace_members", {
  workspace_id: ws1.id,
  user_id: JSON.parse(Buffer.from(jwt2.split(".")[1], "base64url")).sub,
  role: "owner",
});
ok(
  "REST as user 2: can't add themselves to workspace one",
  x.status >= 400,
  `${x.status} ${x.body?.message}`,
);
x = await w("PATCH", `workspaces?name=eq.E2E Agency Two`, { plan: "scale" });
ok(
  "REST as user 2: can't upgrade their own plan",
  x.status >= 400,
  `${x.status} ${x.body?.message}`,
);
x = await w("POST", "rpc/capture_lead", {
  p_token: "x",
  p_lead: { email: "a@b.example" },
});
ok(
  "REST as signed-in user: capture_lead not callable",
  x.status >= 400,
  `${x.status}`,
);
const still = await rest(`leads?select=name&id=eq.${lead1Id}`, jwt1);
ok("user 1's lead is untouched", still.body[0]?.name === "Nora Field");
await c2.close();
await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log(
    "FAILED:",
    failed.map((f) => f.name),
  );
  process.exit(1);
}
