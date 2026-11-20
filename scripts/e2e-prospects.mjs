// The end-to-end check for "Find leads" (slice 3a), against a real Supabase
// project, in a real browser.
//
// What it can and can't reach: the server only finds leads and writes emails
// when ANTHROPIC_API_KEY and SUPABASE_SECRET_KEY are both set, and this
// script never holds either. So it checks the section the way it looks
// without them (the "not switched on yet" state, saved searches, the
// never-contact list, the step endpoints refusing politely), and then the
// review, add-to-leads and approval screens on rows that are put in by hand:
// it prints "RUN THIS SQL" and waits (up to 5 minutes) for someone to run
// that statement in the Supabase SQL editor. The rows are made-up companies
// on .example domains, named "E2E" so nobody mistakes them for real ones.
// The model and the web search are never called.
//
// Before running it:
//   1. `npm run dev` (or point E2E_BASE at a deployment).
//   2. Two confirmed test accounts that share a password, each already in a
//      workspace of its own: E2E_USER_1, E2E_USER_2, E2E_PASSWORD.
//   3. Playwright and a Chrome, as for scripts/e2e-app.mjs.
//
// It never deletes anything. Each run leaves, in the first account's
// workspace: one saved search it made, the seeded search with its run, four
// prospects and two drafts, three leads marked "found by Dialvo", and one
// entry on the never-contact list. Remove them in the Supabase dashboard.

import { mkdirSync, readFileSync } from "node:fs";

const { chromium } = await import(process.env.PLAYWRIGHT ?? "playwright");
const BASE = process.env.E2E_BASE ?? "http://localhost:3000";
const SHOTS = process.env.E2E_SHOTS ?? "screenshots";
mkdirSync(SHOTS, { recursive: true });
const PW = process.env.E2E_PASSWORD;
const USER_1 = process.env.E2E_USER_1;
const USER_2 = process.env.E2E_USER_2;
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
// Letters only, so it is safe inside the SQL below and in a domain name.
const TAG = (process.env.E2E_TAG ?? Date.now().toString(36)).replace(
  /[^a-z0-9]/g,
  "",
);
const SEEDED = `E2E seeded search ${TAG}`;
const dom = (name) => `e2e-${TAG}-${name}.example`;

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
  page.screenshot({ path: `${SHOTS}/prospects-${name}.png`, fullPage: true });
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
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PW);
  // The form with the password, not the "Continue with Google" button.
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

// ------------------------------------------------------------ signed in
const { ctx: c1, page: p1 } = await signIn(USER_1);
const t1 = await jwt(c1);

const nav = await p1.$$eval('aside nav[aria-label="App"] a', (links) =>
  // The label only: Find leads and Inbox may carry a count after it.
  links.map((a) => a.childNodes[1]?.textContent?.trim() ?? ""),
);
ok(
  "nav: the seven sections, in the order of the jobs Dialvo does",
  nav.join(" | ") ===
    "Home | Find leads | Website chat | Inbox | Leads | Knowledge | Settings",
  nav.join(" | "),
);

await p1.click('aside a[href="/app/prospects"]');
await p1.waitForSelector("h1:has-text('Find leads')");
const first = await text(p1);
ok(
  "no keys: the page says finding leads isn't switched on yet on Dialvo's side",
  /isn.t switched on yet on Dialvo.s side/.test(first),
);
ok(
  "no keys: the Find leads button is there and can't be pressed",
  await p1.locator("button[data-find]").isDisabled(),
);
ok(
  "flow: the four steps are shown as one line, the emails step last",
  (await p1.locator("nav[aria-label='Steps'] a").count()) === 4 &&
    (await p1
      .locator("nav[aria-label='Steps'] a")
      .last()
      .getAttribute("href")) === "/app/prospects?view=emails",
);
ok(
  "no keys: no suggestion is offered, and none is asked for",
  (await p1.locator("button:has-text('Suggest from what we sell')").count()) ===
    0,
);
ok(
  "copy: says it never guesses an email address, and promises no numbers",
  /never guesses an email address/.test(first) &&
    !/\b\d+\s+(leads|meetings)\b/i.test(first),
);
await shot(p1, "1-not-switched-on");

// Save "who you sell to".
await p1.goto(`${BASE}/app/prospects?search=new`);
await p1.waitForSelector("#ps-description");
await p1.click("button:has-text('Save')");
ok(
  "search: an empty description isn't saved",
  await p1.$eval("#ps-description", (el) => !el.checkValidity()),
);
await p1.fill(
  "#ps-description",
  "Independent dental clinics that take private patients.",
);
await p1.fill("#ps-location", "Leeds, UK");
await p1.fill("#ps-size", "Single site");
await p1.fill("#ps-exclusions", "National chains");
await p1.fill("#ps-name", `E2E search ${TAG}`);
await p1.locator("form:has(#ps-description) button[type=submit]").click();
await p1.waitForURL(/search=[0-9a-f-]{36}/, { timeout: 20000 });
const made = new URL(p1.url()).searchParams.get("search");
await p1.reload();
// A saved description shows as a sentence; Edit opens the form.
await p1.waitForSelector("section:has(#who) summary");
ok(
  "search: a saved description is shown as text, with the form behind Edit",
  (await p1.locator("section:has(#who) summary").innerText()).includes(
    "Independent dental clinics that take private patients.",
  ) && !(await p1.locator("#ps-description").isVisible()),
);
await p1.click("section:has(#who) summary");
await p1.waitForSelector("#ps-description", { state: "visible" });
ok(
  "search: saved, and still there after a reload",
  (await p1.inputValue("#ps-description")).startsWith("Independent dental") &&
    (await p1.inputValue("#ps-location")) === "Leeds, UK" &&
    (await p1.inputValue("#ps-exclusions")) === "National chains",
);
await p1.fill("#ps-location", "Leeds and Bradford, UK");
await p1.click("button:has-text('Save changes')");
await p1.locator("form:has(#ps-description) >> text=Saved.").waitFor();
const saved = await db(
  `prospect_searches?select=name,location,company_size&id=eq.${made}`,
  { token: t1 },
);
ok(
  "search: edits are saved",
  saved.body?.[0]?.location === "Leeds and Bradford, UK" &&
    saved.body[0].name === `E2E search ${TAG}`,
);
ok(
  "search: with a saved search and no keys, Find leads still can't be pressed",
  await p1.locator("button[data-find]").isDisabled(),
);

// The step endpoints.
const post = (ctx, path) =>
  ctx.request.post(`${BASE}${path}`).then(async (r) => ({
    status: r.status(),
    body: await r.json().catch(() => null),
  }));
const anon = await browser.newContext();
const anonStep = await post(
  anon,
  "/api/prospects/runs/00000000-0000-4000-8000-000000000000/advance",
);
const anonDrafts = await post(anon, "/api/prospects/drafts/advance");
ok(
  "steps: refused without a session",
  anonStep.status === 401 && anonDrafts.status === 401,
  `${anonStep.status} ${anonDrafts.status}`,
);
const noRun = await post(
  c1,
  "/api/prospects/runs/00000000-0000-4000-8000-000000000000/advance",
);
const badRun = await post(c1, "/api/prospects/runs/not-an-id/advance");
ok(
  "steps: a run that doesn't exist is 404",
  noRun.status === 404 && badRun.status === 404,
);
const draftsStep = await post(c1, "/api/prospects/drafts/advance");
ok(
  "steps: with no keys the drafting step answers 'not configured' and writes nothing",
  draftsStep.status === 200 &&
    draftsStep.body?.status === "not_configured" &&
    draftsStep.body.written === 0,
  JSON.stringify(draftsStep.body),
);

// ------------------------------------------------- rows put in by hand
const members = await db(
  "workspace_members?select=workspace_id,created_at&order=created_at",
  { token: t1 },
);
const WS = members.body[0].workspace_id;
const seededRows = () =>
  db(
    `prospect_searches?select=id&workspace_id=eq.${WS}&name=eq.${encodeURIComponent(SEEDED)}`,
    { token: t1 },
  ).then((r) => r.body?.[0]?.id);
let seedId = await seededRows();
if (!seedId) {
  const fact = (d) =>
    JSON.stringify([
      {
        fact: "Example fact: they opened a second surgery in 2024.",
        quote: "we opened our second surgery in 2024",
        source_url: `https://${d}/about`,
      },
    ]);
  console.log(`
RUN THIS SQL in the Supabase SQL editor (it adds made-up test rows to the
test workspace ${WS}); waiting up to 5 minutes:

with s as (
  insert into prospect_searches (workspace_id, name, description, location)
  values ('${WS}', '${SEEDED}', 'E2E test: example dental clinics', 'Exampleton')
  returning id
), r as (
  insert into prospect_runs (workspace_id, search_id, status, brief, target_count, finished_at)
  select '${WS}', id, 'done', '{"description":"E2E test"}'::jsonb, 25, now() from s
  returning id, search_id
), p as (
  insert into prospects (workspace_id, run_id, search_id, domain, company_name, website, research_status, skip_reason,
    summary, location, contact_name, contact_role, contact_source_url, email, email_source_url, email_kind,
    phone, phone_source_url, facts, pages, created_at)
  select '${WS}', r.id, r.search_id, v.domain, v.company, 'https://' || v.domain || '/', v.status, v.skip,
    v.summary, v.location, v.contact, v.role, case when v.contact <> '' then 'https://' || v.domain || '/about' end,
    v.email, case when v.email is not null then 'https://' || v.domain || '/contact' end,
    case when v.email is not null then 'business' end,
    v.phone, case when v.phone is not null then 'https://' || v.domain || '/contact' end,
    v.facts::jsonb, jsonb_build_array('https://' || v.domain || '/'), now() - v.age
  from r, (values
    ('${dom("bright")}', 'E2E Example Bright Dental', 'found', null, 'Example: a family dental clinic.', 'Exampleton', 'Dana Example', 'Practice owner', 'hello@${dom("bright")}', '+441130000000', '${fact(dom("bright"))}', interval '1 second'),
    ('${dom("oak")}', 'E2E Example Oak Dental', 'found', null, 'Example: a private dental clinic.', 'Exampleton', '', '', 'info@${dom("oak")}', null, '[]', interval '2 seconds'),
    ('${dom("nomail")}', 'E2E Example No Mail Dental', 'found', null, 'Example: a clinic with no address on its site.', 'Exampleton', '', '', null, '+441130000001', '[]', interval '3 seconds'),
    ('${dom("skip")}', 'E2E Example Skipped', 'skipped', 'not_a_match', '', '', '', '', null, null, '[]', interval '4 seconds')
  ) as v(domain, company, status, skip, summary, location, contact, role, email, phone, facts, age)
  returning id, workspace_id, email, company_name
)
insert into outbound_drafts (workspace_id, prospect_id, to_email, subject, body, status, model)
select workspace_id, id, email, 'E2E test draft for ' || company_name,
  E'Hello,\\n\\nThis is an E2E test draft. It was not written by the model and is never sent.\\n\\nE2E', 'draft', 'e2e-fixture'
from p where email is not null;
`);
  seedId = await until(seededRows, 300000);
}
ok("seed: the test rows are there", seedId);
if (!seedId) {
  await browser.close();
  process.exit(1);
}

// ---------------------------------------------------------------- review
await p1.goto(`${BASE}/app/prospects?search=${seedId}`);
const row = (name) => p1.locator(`li[data-prospect="${dom(name)}"]`);
await row("bright").waitFor();
const bright = await row("bright").textContent();
ok(
  "review: a result shows the company, what it does, the contact, and where each detail was found",
  bright.includes("E2E Example Bright Dental") &&
    bright.includes("Example: a family dental clinic.") &&
    bright.includes("Dana Example") &&
    bright.includes("Practice owner") &&
    bright.includes(`hello@${dom("bright")}`) &&
    /Found on/.test(bright) &&
    bright.includes("Example fact: they opened a second surgery in 2024."),
);
ok(
  "review: every email and fact links to its source page",
  (await row("bright")
    .locator(`a[href="https://${dom("bright")}/contact"]`)
    .count()) >= 1 &&
    (await row("bright")
      .locator(`a[href="https://${dom("bright")}/about"]:has-text("source")`)
      .count()) === 1,
);
ok(
  "review: the facts sit behind 'Why this company', closed until asked for",
  !(await row("bright")
    .locator("text=Example fact: they opened a second surgery in 2024.")
    .isVisible()) &&
    (await row("bright").locator("summary").innerText()).includes(
      "Why this company",
    ),
);
await row("bright").locator("summary").click();
ok(
  "review: opening it shows the facts and where the address was found",
  await row("bright")
    .locator("text=Example fact: they opened a second surgery in 2024.")
    .isVisible(),
);
ok(
  "review: the kind of mailbox is named (a shared inbox here, not a person's)",
  (await row("bright").locator("[data-email-kind]").innerText()) ===
    "General inbox",
  await row("bright").locator("[data-email-kind]").innerText(),
);
ok(
  "review: has email / no email found are marked, and a company without one is still shown",
  (await row("bright").textContent()).includes("Has email") &&
    (await row("nomail").textContent()).includes("No email found") &&
    /never guesses/.test(await row("nomail").textContent()),
);
ok(
  "review: a skipped company isn't listed, and the page says how many were left out and why",
  (await row("skip").count()) === 0 &&
    /1 more was looked at and left out: 1 didn.t match your description/.test(
      await text(p1),
    ),
);
await shot(p1, "2-review");

await row("nomail").locator("button:has-text('Remove')").click();
await row("nomail").locator("text=Removed").waitFor();
await row("nomail").locator("button:has-text('Undo')").click();
await row("nomail").locator("button:has-text('Keep')").waitFor();
await row("nomail").locator("button:has-text('Keep')").click();
await row("nomail").locator("text=Kept").waitFor();
ok("review: Remove, Undo and Keep work on a row", true);
await p1.click("button:has-text('Keep all 2 with an email')");
await row("oak").locator("text=Kept").waitFor();
await row("bright").locator("text=Kept").waitFor();
ok("review: 'Keep all with an email' keeps the rest that have one", true);

await p1.click("button:has-text('Add 3 kept to leads')");
await p1.locator("text=3 added to Leads").waitFor({ timeout: 20000 });
await row("bright").locator("a:has-text('In Leads')").waitFor();
const leadHref = await row("bright")
  .locator("a:has-text('In Leads')")
  .getAttribute("href");
const leads = await db(
  `leads?select=name,email,phone,company,website,source,consent_email,custom_fields&workspace_id=eq.${WS}&website=like.*e2e-${TAG}-*&order=company`,
  { token: t1 },
);
ok(
  "add to leads: kept prospects become leads marked 'found by Dialvo', with the research and no consent invented",
  leads.body?.length === 3 &&
    leads.body.every(
      (l) => l.source === "found by Dialvo" && l.consent_email === false,
    ) &&
    leads.body[0].email === `hello@${dom("bright")}` &&
    leads.body[0].name === "Dana Example" &&
    leads.body[0].custom_fields.research.email_source_url ===
      `https://${dom("bright")}/contact` &&
    leads.body[0].custom_fields.research.facts.length === 1 &&
    leads.body[1].email === null &&
    leads.body[1].phone === "+441130000001",
  JSON.stringify(leads.body?.map((l) => [l.company, l.email])),
);
await p1.goto(`${BASE}${leadHref}`);
await p1.waitForSelector("text=found by Dialvo");
const leadPage = await text(p1);
ok(
  "add to leads: the lead's page shows where it came from and the research on its timeline",
  /Found by Dialvo on the web/.test(leadPage) &&
    leadPage.includes("Example fact: they opened a second surgery in 2024.") &&
    leadPage.includes(`https://${dom("bright")}/contact`),
);
await shot(p1, "3-lead");

// ----------------------------------------------------------- first emails
await p1.goto(`${BASE}/app/prospects?view=emails`);
const card = (name) => p1.locator(`li[data-draft$="@${dom(name)}"]`);
await card("bright").waitFor();
const emails = await text(p1);
ok(
  "emails: says plainly that nothing is sent and sending comes with a connected mailbox",
  /Nothing is sent from here yet/.test(emails) &&
    /Sending switches on\s+when a mailbox is connected/.test(emails) &&
    /Not sent: no mailbox connected/.test(emails),
);
ok(
  "emails: with no keys the write button can't be pressed",
  await p1.locator("button:has-text('first email')").first().isDisabled(),
);
await card("bright")
  .locator('input[name="subject"]')
  .fill(`Edited subject ${TAG}`);
await card("bright").locator("button:has-text('Save edits')").click();
await card("bright").locator("text=Saved.").waitFor();
// The page catches up a moment after the action answers.
await card("bright").locator("text=Edited").first().waitFor();
ok(
  "emails: an edit is saved and the draft is marked edited, still waiting",
  (await card("bright").textContent()).includes("Waiting for you"),
);
await card("bright").locator("button:has-text('Approve')").click();
await p1
  .locator(`section:has(#ready) li[data-draft$="@${dom("bright")}"]`)
  .waitFor();
ok("emails: Approve moves a draft to Ready to send", true);
await card("bright").locator("button:has-text('Move back to waiting')").click();
await p1
  .locator(`section:has(#queue) li[data-draft$="@${dom("bright")}"]`)
  .waitFor();
ok("emails: an approved email can be moved back to waiting", true);
// "Approve all" approves every draft waiting in the workspace. That is only
// pressed when this run's two are the only ones: in a workspace that also
// holds real drafts, each of the two is approved on its own instead.
if (await p1.locator("button:has-text('Approve all 2')").count()) {
  p1.once("dialog", (d) => d.accept());
  await p1.click("button:has-text('Approve all 2')");
  await p1.locator("text=2 approved and ready to send.").waitFor();
  await p1
    .locator(`section:has(#ready) li[data-draft$="@${dom("oak")}"]`)
    .waitFor();
  ok("emails: bulk approve approves everything waiting, after asking", true);
} else {
  for (const name of ["bright", "oak"]) {
    await card(name).locator("button:has-text('Approve')").click();
    await p1
      .locator(`section:has(#ready) li[data-draft$="@${dom(name)}"]`)
      .waitFor();
  }
  console.log(
    "SKIPPED bulk approve: other drafts are waiting in this workspace, and they are not this script's to approve",
  );
}
await shot(p1, "4-emails");
await card("oak").locator("button:has-text('Discard')").click();
await card("oak").waitFor({ state: "detached" });
const stored = await db(
  `outbound_drafts?select=to_email,subject,status,edited,discard_reason&workspace_id=eq.${WS}&to_email=like.*e2e-${TAG}-*&order=to_email`,
  { token: t1 },
);
ok(
  "emails: what is stored is 'approved' (ready to send) and 'discarded'; no message was sent to anyone",
  stored.body?.length === 2 &&
    stored.body[0].status === "approved" &&
    stored.body[0].subject === `Edited subject ${TAG}` &&
    stored.body[0].edited === true &&
    stored.body[1].status === "discarded" &&
    stored.body[1].discard_reason === "by_person",
  JSON.stringify(stored.body),
);
const sent = await db(
  `messages?select=id&workspace_id=eq.${WS}&body=like.*E2E test draft*`,
  { token: t1 },
);
ok("emails: approving created no outgoing message", sent.body?.length === 0);

// ---------------------------------------------------------- never contact
await p1.goto(`${BASE}/app/prospects?view=never`);
await p1.waitForSelector("#sup-value");
const add = async (value, note = "") => {
  await p1.fill("#sup-value", value);
  await p1.fill("#sup-note", note);
  await p1.click("form:has(#sup-value) button[type=submit]");
};
await add("not an address");
await p1.locator("text=Enter an email address").waitFor();
ok(
  "never contact: nonsense is refused, and what was typed stays",
  (await p1.inputValue("#sup-value")) === "not an address",
);
await add(`https://www.${dom("bright")}/contact`, "E2E test");
await p1.locator(`li[data-suppression="${dom("bright")}"]`).waitFor();
ok("never contact: a pasted web address is stored as its domain", true);
await add(dom("bright"));
await p1.locator("text=That's already on the list.").waitFor();
ok("never contact: a duplicate is refused", true);
await add(`Stop.${TAG}@Example-Stop.example`, "E2E test");
const entry = p1.locator(
  `li[data-suppression="stop.${TAG}@example-stop.example"]`,
);
await entry.waitFor();
ok("never contact: an email address is stored in lower case", true);
const after = await db(
  `outbound_drafts?select=status,discard_reason&workspace_id=eq.${WS}&to_email=eq.hello@${dom("bright")}`,
  { token: t1 },
);
ok(
  "never contact: adding a domain discards the email that was ready to send to it",
  after.body?.[0]?.status === "discarded" &&
    after.body[0].discard_reason === "suppressed",
  JSON.stringify(after.body),
);
p1.once("dialog", (d) => d.accept());
await entry.locator("button:has-text('Remove')").click();
await entry.waitFor({ state: "detached" });
ok(
  "never contact: an owner can take an entry off the list, after being asked",
  true,
);
await shot(p1, "5-never-contact");
await p1.goto(`${BASE}/app/prospects?view=emails`);
await p1.waitForSelector("#ready");
ok(
  "emails: the suppressed company's email is gone from both queues",
  (await card("bright").count()) === 0 && /\d+ discarded/.test(await text(p1)),
);

// As the signed-in person, straight at the database: what only the server may do.
const own = [
  [
    "start a run",
    "rpc/prospect_run_start",
    {
      p_workspace_id: WS,
      p_search_id: seedId,
      p_user_id: "00000000-0000-4000-8000-000000000000",
      p_target: 100,
      p_max_runs_per_day: 999,
      p_max_cost_micros_per_day: 999999999,
    },
  ],
  [
    "insert a run",
    "prospect_runs",
    { workspace_id: WS, search_id: seedId, brief: {}, target_count: 100 },
  ],
  [
    "raise a counter",
    "rpc/outbound_record_spend",
    { p_workspace_id: WS, p_cost_micros: -1 },
  ],
  [
    "claim drafts",
    "rpc/outbound_draft_claim",
    {
      p_workspace_id: WS,
      p_user_id: "00000000-0000-4000-8000-000000000000",
      p_limit: 3,
      p_max_drafts_per_day: 999,
      p_max_cost_micros_per_day: 999999999,
      p_max_attempts: 2,
    },
  ],
  [
    "insert a draft",
    "outbound_drafts",
    {
      workspace_id: WS,
      prospect_id: "00000000-0000-4000-8000-000000000000",
      to_email: "x@example.com",
    },
  ],
];
for (const [what, path, body] of own) {
  const r = await db(path, { token: t1, body });
  ok(
    `database: a signed-in person can't ${what} through the API`,
    r.status === 401 || r.status === 403 || r.status === 404,
    String(r.status),
  );
}
const tamper = await db(
  `prospects?workspace_id=eq.${WS}&domain=eq.${dom("nomail")}`,
  {
    token: t1,
    method: "PATCH",
    body: {
      email: `made-up@${dom("nomail")}`,
      email_source_url: "https://x.example/",
      email_kind: "business",
    },
  },
);
ok(
  "database: a signed-in person can't write an email address onto a prospect",
  tamper.status === 401 || tamper.status === 403,
  String(tamper.status),
);

// -------------------------------------------- another workspace entirely
const { ctx: c2, page: p2 } = await signIn(USER_2);
const t2 = await jwt(c2);
for (const table of [
  "prospect_searches",
  "prospect_runs",
  "prospects",
  "outbound_drafts",
  "outbound_suppressions",
  "outbound_usage",
]) {
  const r = await db(`${table}?select=*&workspace_id=eq.${WS}`, { token: t2 });
  ok(
    `isolation: the second workspace sees none of the first's ${table}`,
    r.status === 200 && r.body.length === 0,
    String(r.status),
  );
  const a = await db(`${table}?select=*`, {});
  ok(
    `isolation: anon can't read ${table}`,
    a.status === 401 ||
      a.status === 403 ||
      (a.status === 200 && a.body.length === 0),
    String(a.status),
  );
}
const theirDraft = await db(
  `outbound_drafts?select=id&workspace_id=eq.${WS}&to_email=eq.info@${dom("oak")}`,
  { token: t1 },
);
const theft = [
  [
    "approve the first's draft",
    "rpc/outbound_draft_decide",
    { p_draft_id: theirDraft.body[0].id, p_action: "approve" },
  ],
  [
    "add the first's prospects to leads",
    "rpc/prospects_add_to_leads",
    { p_workspace_id: WS },
  ],
  [
    "add to the first's never-contact list",
    "outbound_suppressions",
    { workspace_id: WS, kind: "domain", value: "planted.example" },
  ],
  [
    "save a search in the first workspace",
    "prospect_searches",
    { workspace_id: WS, name: "planted", description: "planted" },
  ],
];
for (const [what, path, body] of theft) {
  const r = await db(path, { token: t2, body });
  ok(
    `isolation: the second workspace can't ${what}`,
    r.status >= 400,
    String(r.status),
  );
}
const bulk = await db("rpc/outbound_drafts_approve", {
  token: t2,
  body: { p_draft_ids: [theirDraft.body[0].id] },
});
ok(
  "isolation: bulk approve from the second workspace approves nothing",
  bulk.body === 0,
  JSON.stringify(bulk.body),
);
const keep = await db(`prospects?workspace_id=eq.${WS}`, {
  token: t2,
  method: "PATCH",
  body: { decision: "removed" },
});
ok(
  "isolation: the second workspace can't keep or remove the first's prospects",
  keep.status === 200 && keep.body.length === 0,
  String(keep.status),
);
await p2.goto(`${BASE}/app/prospects?search=${seedId}`);
await p2.waitForSelector("h1:has-text('Find leads')");
ok(
  "isolation: opening the first workspace's search in the second shows none of it",
  !(await text(p2)).includes(TAG),
);
await p2.goto(`${BASE}/app/prospects?view=emails`);
await p2.waitForSelector("#queue");
ok("isolation: nor any of its emails", !(await text(p2)).includes(TAG));
const stolen = await post(
  c2,
  "/api/prospects/runs/00000000-0000-4000-8000-000000000000/advance",
);
ok("isolation: the step endpoint finds no run for it", stolen.status === 404);

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(
  `\n${results.length - failed.length}/${results.length} checks passed`,
);
if (failed.length) {
  for (const f of failed) console.log("FAILED:", f.name, f.detail);
  process.exit(1);
}
