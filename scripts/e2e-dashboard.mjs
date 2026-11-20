// The end-to-end check for the app's layout: the navigation, Home, Website
// chat, the Find leads flow, the old addresses, and phones. It looks, and
// presses only what changes nothing: it saves the chat agent's settings
// exactly as they already are, and opens and closes things. It adds no rows
// and deletes none, so it is safe to run against a workspace with real data.
//
// Before running it:
//   1. `npm run dev` (or point E2E_BASE at a deployment).
//   2. One confirmed account that is already in a workspace: E2E_USER_1 and
//      E2E_PASSWORD. A workspace with some leads and chats checks more.
//   3. Playwright and a Chrome, as for scripts/e2e-app.mjs.
//
//   E2E_PASSWORD=... E2E_USER_1=... node scripts/e2e-dashboard.mjs
//
// Screenshots go to ./screenshots (gitignored), or to E2E_SHOTS.

import { mkdirSync } from "node:fs";

const playwright = await import(process.env.PLAYWRIGHT ?? "playwright");
const chromium = playwright.chromium ?? playwright.default.chromium;
const BASE = process.env.E2E_BASE ?? "http://localhost:3000";
const SHOTS = process.env.E2E_SHOTS ?? "screenshots";
mkdirSync(SHOTS, { recursive: true });
const PW = process.env.E2E_PASSWORD;
const USER_1 = process.env.E2E_USER_1;
if (!PW || !USER_1) throw new Error("Set E2E_PASSWORD and E2E_USER_1.");

// The app's own sidebar (the login page has an aside of its own).
const SIDEBAR = 'aside:has(nav[aria-label="App"])';
const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(
    `${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`,
  );
};
const browser = await chromium.launch({
  executablePath: process.env.CHROME || undefined,
  args: ["--no-sandbox"],
});
const shot = (page, name) =>
  page.screenshot({ path: `${SHOTS}/dashboard-${name}.png`, fullPage: true });

async function signIn(viewport) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => ok(`no page error (${e.message})`, false));
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', USER_1);
  await page.fill('input[name="password"]', PW);
  // The form with the password, not the "Continue with Google" button.
  await page.click('form:has(input[name="password"]) button[type="submit"]');
  await page.waitForURL(/\/app$/, { timeout: 30000 });
  // Load Home afresh: after a client-side move, Next.js keeps the page it
  // came from (the login form) in the document, hidden.
  await page.goto(`${BASE}/app`);
  await page.waitForSelector("[data-needs]", { timeout: 30000 });
  return { ctx, page };
}

const open = async (page, path, selector = "main h1") => {
  await page.goto(`${BASE}${path}`);
  await page.waitForSelector(selector, { timeout: 30000 });
};

// ------------------------------------------------------------------ desktop
const { ctx: desk, page } = await signIn({ width: 1440, height: 900 });

const nav = await page.$$eval('aside nav[aria-label="App"] a', (links) =>
  links.map((a) => a.childNodes[1]?.textContent?.trim() ?? ""),
);
ok(
  "nav: seven sections, in the order of the jobs Dialvo does",
  nav.join(" | ") ===
    "Home | Find leads | Website chat | Inbox | Leads | Knowledge | Settings",
  nav.join(" | "),
);
const aside = await page.locator(SIDEBAR).innerText();
ok(
  "nav: no Agents, Sequences, Calls or Analytics",
  !/Agents|Sequences|Calls|Analytics/.test(aside),
);

// The workspace header says where the workspace really stands.
const planLine = page.locator(`${SIDEBAR} [data-plan-line]`);
const phase = await planLine.getAttribute("data-plan-line");
const line = await planLine.innerText();
ok(
  "header: a trial is called a free trial with its days, a plan only once it is paid",
  phase === "trial"
    ? /^Free trial · \d+ days? left$/.test(line)
    : phase === "ended"
      ? line === "Free trial ended"
      : /^(Starter|Pro|Scale) plan$/.test(line),
  `${phase}: ${line}`,
);
ok(
  "header: a running trial is said once, not also in a line across the top",
  phase === "ended"
    ? (await page.locator("[data-trial]").count()) === 1
    : (await page.locator("[data-trial]").count()) === 0 &&
        !/left in your free trial/.test(await page.locator("body").innerText()),
);

// Home.
const home = page.locator("main");
ok(
  "home: greets in one line",
  /^Good (morning|afternoon|evening)/.test(
    await home.locator("h1").innerText(),
  ),
  await home.locator("h1").innerText(),
);
const needs = await page.locator("[data-needs]").getAttribute("data-needs");
if (needs === "some") {
  const rows = page.locator("[data-need]");
  const counts = await rows.evaluateAll((all) =>
    all.map((row) => ({
      text: row.querySelector("span")?.textContent ?? "",
      buttons: row.querySelectorAll("a, button").length,
    })),
  );
  ok(
    "home: each thing that needs a yes is one row with a count and one button",
    counts.length > 0 &&
      counts.every((c) => /^[1-9]\d* /.test(c.text) && c.buttons === 1),
    counts.map((c) => c.text).join(" | "),
  );
} else {
  ok(
    "home: with nothing waiting it says so in one line",
    (await page.locator("[data-needs]").innerText()).trim() ===
      "Nothing needs your yes right now.",
  );
}
const jobs = await page.locator("[data-job]").evaluateAll((all) =>
  all.map((card) => ({
    id: card.getAttribute("data-job"),
    title: card.querySelector("h2")?.textContent ?? "",
    status: card.querySelector("[data-job-status]")?.textContent ?? "",
    steps: card.querySelectorAll("[data-step]").length,
    // The card's own next step: links and buttons outside the setup steps.
    actions: [...card.querySelectorAll("a, button")].filter(
      (el) => !el.closest("ol"),
    ).length,
  })),
);
ok(
  "home: two job cards, Find new customers and Answer website visitors",
  jobs.map((j) => j.title).join(" | ") ===
    "Find new customers | Answer website visitors",
  jobs.map((j) => j.title).join(" | "),
);
ok(
  "home: each card states where it stands and has exactly one next action (or its setup steps)",
  jobs.every(
    (j) =>
      j.status.trim().length > 10 &&
      (j.steps > 0 ? j.actions === 0 : j.actions === 1),
  ),
  jobs.map((j) => `${j.id}: ${j.status} [${j.actions}]`).join(" | "),
);
const facts = await page
  .locator("[data-week] dd")
  .evaluateAll((all) => all.map((dd) => Number(dd.textContent)));
ok(
  "home: this week's numbers appear only when they are not zero",
  facts.every((value) => value > 0),
  facts.join(","),
);
ok(
  "home: no tile grid, no pipeline panel, no sample numbers",
  !/Pipeline|Upcoming meetings|Meetings booked/.test(await home.innerText()),
);
await shot(page, "home-desktop");

// The old addresses.
for (const [from, to] of [
  ["/app/agents", "/app/chat"],
  ["/app/agents/try", "/app/chat/try"],
  ["/app/sequences", "/app"],
  ["/app/calls", "/app"],
  ["/app/analytics", "/app"],
]) {
  await page.goto(`${BASE}${from}`);
  await page.waitForSelector("main h1", { timeout: 30000 });
  ok(
    `old address: ${from} lands on ${to}`,
    new URL(page.url()).pathname === to,
    page.url(),
  );
}

// Website chat: the agent's settings and the install code on one page.
await open(page, "/app/chat", "#agent");
const agent = page.locator("#agent");
ok(
  "website chat: the agent's switch, mode, instructions and qualifying questions are here",
  (await agent.locator('input[name="approval_mode"]').count()) === 2 &&
    (await agent.locator('textarea[name="instructions"]').count()) === 1 &&
    (await agent.locator('textarea[name="qualifying_questions"]').count()) ===
      1 &&
    /Switch (on|off)/.test(await agent.innerText()),
);
ok(
  "website chat: the code for the site and the install check are here",
  (await page.locator("#chat pre").count()) >= 1 &&
    (await page.locator("#chat [data-seen]").count()) >= 1,
);
ok(
  "website chat: only the agent that answers the chat is shown",
  !/Closing|Expansion|Outbound/.test(await page.locator("main").innerText()),
);
// Saving what is already there changes nothing, and proves the form works.
const admin = !(await agent.locator("fieldset[disabled]").count());
if (admin) {
  await agent.locator("button:has-text('Save')").click();
  await agent.locator("text=Saved.").waitFor({ timeout: 20000 });
  ok("website chat: the agent's settings save", true);
}
await shot(page, "chat-desktop");
await page.click('main a[href="/app/chat/try"]');
await page.waitForSelector('[aria-label="Test chat"]', { timeout: 30000 });
ok(
  "website chat: Try your agent opens the test chat",
  new URL(page.url()).pathname === "/app/chat/try",
);

// Find leads: one flow.
await open(page, "/app/prospects");
const steps = await page
  .locator("nav[aria-label='Steps'] a")
  .evaluateAll((all) =>
    all.map((a) => a.textContent.replace(/\s+/g, " ").trim()),
  );
ok(
  "find leads: four steps across the top, in order",
  steps.length === 4 &&
    /Who you sell to/.test(steps[0]) &&
    /Find/.test(steps[1]) &&
    /Review/.test(steps[2]) &&
    /First emails/.test(steps[3]),
  steps.join(" > "),
);
ok(
  "find leads: at most one step is marked as the next one",
  (await page.locator("nav[aria-label='Steps'] a[aria-current]").count()) <= 1,
);
ok(
  "find leads: saved searches are a switcher, never a wall of pills",
  (await page.locator("nav[aria-label='Saved searches']").count()) === 0,
);
const rows = page.locator("li[data-prospect]");
if (await rows.count()) {
  const first = rows.first();
  ok(
    "review: a row shows the company and whether it has an email, with the facts closed",
    /Has email|No email found/.test(await first.innerText()) &&
      (await first.locator("summary").innerText()).includes(
        "Why this company",
      ) &&
      !(await first.locator("details").evaluate((d) => d.open)),
  );
  await first.locator("summary").click();
  ok(
    "review: Why this company opens what was found and how to reach them",
    /Found on their website/.test(await first.innerText()) &&
      /How to reach them/.test(await first.innerText()),
  );
}
await shot(page, "find-desktop");
await open(page, "/app/prospects?view=emails", "#instructions");
ok(
  "first emails: the instructions for writing them live here, and nothing claims to send",
  (await page
    .locator("#instructions textarea[name='instructions']")
    .count()) === 1 &&
    /Nothing is sent from here yet/.test(
      await page.locator("main").innerText(),
    ),
);

// Empty and first-time wording never asks for a list.
for (const path of ["/app/inbox", "/app/leads", "/app/knowledge"]) {
  await open(page, path);
  ok(
    `${path}: never asks you to add your first lead`,
    !/Add your first lead/i.test(await page.locator("main").innerText()),
  );
}
await open(page, "/app/leads");
ok(
  "leads: Find leads is the main action; adding by hand and CSV import are still there",
  (await page.locator("main a[href='/app/prospects']").count()) >= 1 &&
    (await page.locator("main button:has-text('Add lead')").count()) >= 1 &&
    (await page.locator("main a[href='/app/leads/import']").count()) >= 1,
);
await desk.close();

// -------------------------------------------------------------------- phone
const { ctx: phoneCtx, page: phone } = await signIn({
  width: 390,
  height: 844,
});
const sideways = async () =>
  phone.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
for (const [name, path, selector] of [
  ["home", "/app", "[data-needs]"],
  ["find", "/app/prospects", "main h1"],
  ["emails", "/app/prospects?view=emails", "main h1"],
  ["never", "/app/prospects?view=never", "main h1"],
  ["chat", "/app/chat", "#agent"],
  ["try", "/app/chat/try", "main h1"],
  ["inbox", "/app/inbox", "main h1"],
  ["leads", "/app/leads", "main h1"],
  ["knowledge", "/app/knowledge", "main h1"],
  ["settings", "/app/settings", "main h1"],
]) {
  await open(phone, path, selector);
  const over = await sideways();
  ok(`phone (390 px): ${path} doesn't scroll sideways`, over <= 0, `${over}px`);
  await shot(phone, `${name}-phone`);
}
await open(phone, "/app/leads");
if (await phone.locator("main table").count())
  ok(
    "phone: leads are cards, not a table",
    !(await phone.locator("main table").isVisible()) &&
      (await phone.locator("main ul li a").first().isVisible()),
  );
const thread = phone.locator('main a[href*="/app/inbox?queue="][href*="&c="]');
await open(phone, "/app/inbox?queue=all");
if (await thread.count()) {
  await thread.first().click();
  await phone.waitForSelector("#reply-body", { timeout: 30000 });
  const over = await sideways();
  ok(
    "phone: an open conversation doesn't scroll sideways",
    over <= 0,
    `${over}px`,
  );
}

await open(phone, "/app", "[data-needs]");
ok(
  "phone: the sidebar is gone and a menu button takes its place",
  !(await phone.locator(SIDEBAR).isVisible()) &&
    (await phone.locator('header button[aria-label^="Menu"]').isVisible()),
);
await phone.click('header button[aria-label^="Menu"]');
const drawer = phone.locator('dialog[aria-label="Menu"]');
await drawer.waitFor({ state: "visible" });
const drawerNav = await drawer
  .locator("nav a")
  .evaluateAll((links) =>
    links.map((a) => a.childNodes[1]?.textContent?.trim() ?? ""),
  );
ok(
  "phone: the menu holds the same seven sections",
  drawerNav.join(" | ") ===
    "Home | Find leads | Website chat | Inbox | Leads | Knowledge | Settings",
  drawerNav.join(" | "),
);
await shot(phone, "menu-phone");
await drawer.locator('a[href="/app/chat"]').click();
await phone.waitForURL(/\/app\/chat$/, { timeout: 30000 });
await phone.waitForSelector("#agent", { timeout: 30000 });
ok(
  "phone: choosing a section goes there and closes the menu",
  !(await drawer.isVisible()),
);
await phoneCtx.close();

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(
  `\n${results.length - failed.length}/${results.length} checks passed`,
);
if (failed.length) {
  for (const f of failed) console.log("FAILED:", f.name, f.detail);
  process.exit(1);
}
