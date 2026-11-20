// The end-to-end check for slice 2a (website chat and the inbound agent),
// against a real Supabase project.
//
// It drives two browsers: a visitor on a made-up customer website with the
// chat widget pasted in (another origin, so the cross-origin rules are real),
// and a teammate in the Inbox. Then a second person in a second workspace
// tries to reach the first one's chats through the database's own API.
//
// Before running it:
//   1. `npm run dev` (or point E2E_BASE at a deployment).
//   2. Two confirmed test accounts that share a password: E2E_USER_1,
//      E2E_USER_2, E2E_PASSWORD. They may be new (the script onboards them)
//      or left over from an earlier run.
//   3. Playwright and a Chrome, as for scripts/e2e-app.mjs.
//
// The agent's own writes need the secret key, which this script never has
// to hold. With SUPABASE_SECRET_KEY in the environment it stores an agent
// reply itself, through the same database function the server uses.
// Without it, it prints "RUN THIS SQL" and waits (up to 5 minutes each
// time) for someone to run the statement in the Supabase SQL editor.
// The model is never called: what the agent says is fixed text here.
//
// It never deletes anything: remove the test accounts and workspaces in the
// Supabase dashboard afterwards.

import { mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";

const { chromium } = await import(process.env.PLAYWRIGHT ?? "playwright");
const BASE = process.env.E2E_BASE ?? "http://localhost:3000";
const SHOTS = "screenshots";
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
const SECRET = process.env.SUPABASE_SECRET_KEY;
const WS_1 = "E2E Chat One";
const WS_2 = "E2E Chat Two";
// The visitor's website: a page of its own, served from another origin than
// the app (a different host and port), so the widget's requests really are
// cross-origin. It is on this machine because browsers stop a public page
// from calling a server on localhost, which is where the app runs in a test.
let customerPage = "";
const customerSite = createServer((_, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(customerPage);
});
await new Promise((done) => customerSite.listen(0, "127.0.0.1", done));
const SITE = `http://127.0.0.1:${customerSite.address().port}`;
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

async function until(what, check, ms = 20000) {
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

async function signIn(email, workspaceName) {
  const ctx = await browser.newContext({
    viewport: { width: 1360, height: 900 },
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PW);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(onboarding|app)$/, { timeout: 30000 });
  // Someone with no workspace lands on /app first and is sent on from there.
  await page.waitForSelector('textarea[name="sells"], a[href="/app/inbox"]', {
    timeout: 30000,
  });
  if (page.url().endsWith("/onboarding")) {
    await page.fill('input[name="name"]', workspaceName);
    await page.fill(
      'textarea[name="sells"]',
      "Websites for dental clinics, from $900 a month.",
    );
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/app$/, { timeout: 30000 });
  }
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

async function db(path, { token, key = KEY, body } = {}) {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      apikey: key,
      authorization: `Bearer ${token ?? key}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

const api = async (path, body, headers = {}) => {
  const r = await fetch(`${BASE}/api/chat/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "text/plain", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, headers: r.headers, body: await r.json() };
};

// ---------------------------------------------------------------- teammate
const { ctx: c1, page: p1 } = await signIn(USER_1, WS_1);
const t1 = await jwt(c1);
ok("teammate: signed in and in a workspace", p1.url().endsWith("/app"));

// Settings: create the chat, read the embed code.
await p1.goto(`${BASE}/app/chat`);
await p1.waitForSelector("#chat");
if (await p1.locator("#chat button:has-text('Create the chat')").count()) {
  await p1.click("#chat button:has-text('Create the chat')");
  await p1.waitForSelector("#chat pre");
  ok("settings: an admin creates the chat", true);
}
const snippet = (await p1.textContent("#chat pre")).trim();
const TOKEN = /widget\.js\?id=([0-9a-f]{64})/.exec(snippet)?.[1];
ok(
  "website chat: the embed code is one script tag with the widget's id",
  TOKEN &&
    snippet === `<script src="${BASE}/widget.js?id=${TOKEN}" async></script>`,
  snippet.slice(0, 60),
);
const pageText = await p1.textContent("#chat");
ok(
  "website chat: says the agent is off and chats wait in the Inbox",
  /Your agent is off/.test(pageText) || /isn.t switched on yet/.test(pageText),
);
// The widget row may be switched off from an earlier, interrupted run.
if (await p1.locator("#chat button:has-text('Switch on')").count()) {
  await p1.click("#chat button:has-text('Switch on')");
  await p1.waitForSelector("#chat button:has-text('Switch off')");
}
await shot(p1, "chat-settings");

// The preview is the real widget, loaded on the settings page.
await p1.click("#chat button:has-text('Preview on this page')");
const previewPanel = await until("preview", () =>
  p1.locator("[data-dialvo-chat] .panel").isVisible(),
);
ok("settings: the preview opens the real widget on the page", previewPanel);
await shot(p1, "chat-settings-preview");
await p1.click("#chat button:has-text('Hide preview')");
ok(
  "settings: hiding the preview removes it",
  (await p1.locator("[data-dialvo-chat]").count()) === 0,
);

// Agents: the inbound agent starts off; the page says what that means.
await p1.goto(`${BASE}/app/chat`);
await p1.waitForSelector("#agent");
const inbound = p1.locator("#agent");
if (await inbound.locator("button:has-text('Switch off')").count()) {
  await inbound.locator("button:has-text('Switch off')").click();
  await inbound.locator("button:has-text('Switch on')").waitFor();
}
ok(
  "website chat: the agent is off by default, and says chats wait in the Inbox meanwhile",
  /While it is off, chats wait for you in the Inbox/.test(
    await inbound.textContent(),
  ),
);

// ----------------------------------------------------------------- visitor
// A page on another origin with nothing but the pasted snippet.
const visitorCtx = await browser.newContext({
  viewport: { width: 1100, height: 800 },
});
customerPage = `<!doctype html><html><head><title>Bright Smile Dental</title><style>body{font-family:Georgia;color:purple} button{background:red!important}</style></head><body><h1>Bright Smile Dental</h1><p>An example customer website.</p>${snippet}</body></html>`;
const v = await visitorCtx.newPage();
const visitorErrors = [];
v.on("pageerror", (e) => visitorErrors.push(e.message));
v.on("console", (m) => m.type() === "error" && visitorErrors.push(m.text()));
await v.goto(`${SITE}/`);
const launcher = v.locator("[data-dialvo-chat] .launch");
await launcher.waitFor({ timeout: 15000 });
ok("widget: the chat button appears on another site", true);
const look = await launcher.evaluate((el) => {
  const s = getComputedStyle(el);
  return { bg: s.backgroundColor, color: s.color };
});
ok(
  "widget: ink black, and untouched by the host page's styles",
  look.bg === "rgb(11, 11, 12)" && look.color === "rgb(255, 255, 255)",
  JSON.stringify(look),
);
await shot(v, "chat-widget-closed");
await launcher.click();
const panel = v.locator("[data-dialvo-chat] .panel");
await panel.waitFor();
ok(
  "widget: opens with the title and the greeting",
  (await panel.locator(".title").textContent()) === "Chat with us" &&
    (await panel.locator(".msg.them").first().textContent()) ===
      "Hi. How can we help?",
);
ok(
  "widget: shows the Spark mark in black, and no made-up name or photo",
  (await panel.locator("img.mark").getAttribute("src")) ===
    `${BASE}/brand/mark.svg` &&
    (await panel.locator("img").count()) === 1 &&
    (await panel.locator("img.mark").evaluate((i) => i.naturalWidth > 0)),
);

const say = async (text) => {
  await panel.locator("textarea").fill(text);
  await panel.locator("textarea").press("Enter");
};
const FIRST = `Do you work with dentists? (${Date.now()})`;
await say(FIRST);
await until("sent", async () =>
  (await panel.locator(".msg.me:not(.pending)").allTextContents()).includes(
    FIRST,
  ),
);
ok(
  "widget: the message is sent and shown",
  (await panel.locator(".msg.me:not(.pending)").allTextContents()).includes(
    FIRST,
  ),
);
const teamSoon = await until("note", async () =>
  /A team member will reply here shortly/.test(
    (await panel.locator(".note").textContent()) ?? "",
  ),
);
ok(
  "widget: with no agent answering, the visitor is told a team member will reply",
  teamSoon,
);
await shot(v, "chat-widget-first-message");
const stored = await v.evaluate(
  (token) => JSON.parse(localStorage.getItem(`dialvo-chat-${token}`)),
  TOKEN,
);
ok(
  "widget: remembers the chat in this site's localStorage, and sets no cookies",
  stored?.c &&
    /^[0-9a-f]{64}$/.test(stored.k) &&
    (await visitorCtx.cookies()).length === 0,
);
const CONVERSATION = stored.c;

// --------------------------------------------------- the Inbox, live
await p1.goto(`${BASE}/app/inbox?queue=waiting`);
const row = p1.locator(`a[href*="c=${CONVERSATION}"]`);
await row.waitFor({ timeout: 15000 });
ok(
  "inbox: the chat is waiting for the team, with the visitor's message",
  (await row.textContent()).includes(FIRST.slice(0, 30)),
);
// A second message arrives while the Inbox is open: no reload.
const SECOND = `And what does it cost? (${Date.now()})`;
await say(SECOND);
const live = await until(
  "live",
  async () => (await row.textContent()).includes(SECOND.slice(0, 20)),
  20000,
);
ok("inbox: a new message shows up without reloading the page", live);
await row.click();
await p1.waitForSelector(`text=${SECOND}`);
const thread = p1.locator("section", { hasText: "Website chat" }).last();
ok(
  "inbox: the thread says nobody answers automatically",
  /nobody answers automatically/.test(await thread.textContent()),
);
await shot(p1, "chat-inbox-thread");

// Human takeover.
const HUMAN = `Hi, this is the team. Sites start at $900 a month. (${Date.now()})`;
await p1.fill("#reply-body", HUMAN);
await p1.click("button:has-text('Send reply')");
await p1.waitForSelector("text=Hand back to agent", { timeout: 15000 });
ok(
  "inbox: a teammate's reply is sent, and the agent is paused on this chat",
  /A person has this chat/.test(await thread.textContent()),
);
const seenByVisitor = await until("visitor sees", async () =>
  (await panel.locator(".msg.them").allTextContents()).includes(HUMAN),
);
ok("widget: the visitor sees the teammate's reply", seenByVisitor);
ok(
  "widget: it is labelled as a team member, and says who they are talking to",
  (await panel.locator(".who").allTextContents()).includes("Team member") &&
    /talking with a team member/.test(
      (await panel.locator(".note").textContent()) ?? "",
    ),
);
await shot(v, "chat-widget-team-reply");

// The chat survives a reload of the customer's page.
await v.reload();
await launcher.click();
const afterReload = await until("reload", async () =>
  (await panel.locator(".msg").allTextContents()).includes(HUMAN),
);
ok("widget: the chat is still there after the page reloads", afterReload);

// Hand back.
await p1.click("button:has-text('Hand back to agent')");
const handedBack = await until(
  "handed back",
  async () => !/A person has this chat/.test(await thread.textContent()),
);
ok(
  "inbox: 'Hand back to agent' un-pauses the conversation",
  handedBack &&
    (await p1.locator("button:has-text('Hand back to agent')").count()) === 0,
);

// ------------------------------------------------- the agent's replies
// Switch the inbound agent on, with qualifying questions, asking first.
await p1.goto(`${BASE}/app/chat`);
await p1.waitForSelector("#agent");
const agent = p1.locator("#agent");
await agent.locator("button:has-text('Switch on')").click();
await agent.locator("button:has-text('Switch off')").waitFor();
await agent
  .locator('textarea[name="qualifying_questions"]')
  .fill("How many locations do you have?\nWhen do you want to start?");
await agent.locator('input[value="approve_first"]').check();
await agent.locator("button:has-text('Save')").click();
await agent.locator("text=Saved.").waitFor();
await p1.reload();
ok(
  "website chat: qualifying questions are saved",
  (await p1
    .locator("#agent")
    .locator('textarea[name="qualifying_questions"]')
    .inputValue()) ===
    "How many locations do you have?\nWhen do you want to start?",
);
const agentNote = await p1.locator("#agent").textContent();
ok(
  "website chat: on this server (no agent keys) the page says the agent isn't switched on yet",
  SECRET
    ? true
    : /isn.t switched on yet on Dialvo.s side/.test(agentNote) &&
        /saved to your Inbox/.test(agentNote),
);
await shot(p1, "chat-agents");

// What the server does after the model answers, done here by hand: the
// model is not called in this test.
let commits = 0;
async function agentWrites(expect) {
  commits++;
  const reply = `Agent reply ${commits}: we build sites for clinics.`;
  const result = {
    reply,
    outcome: "qualified",
    summary: "Dental clinic with 3 locations, wants to start next month.",
    handoff: false,
    stop_contact: false,
    visitor_name: "Dana Reyes",
    visitor_email: "",
    model: "e2e",
  };
  const [latest] = (
    await db(
      `messages?conversation_id=eq.${CONVERSATION}&direction=eq.in&select=id&order=sent_at.desc,created_at.desc&limit=1`,
      { token: t1 },
    )
  ).body;
  if (SECRET) {
    const done = await db("rpc/chat_agent_commit", {
      key: SECRET,
      body: {
        p_token: TOKEN,
        p_conversation_id: CONVERSATION,
        p_in_reply_to: latest.id,
        p_result: result,
      },
    });
    if (done.body?.status !== expect)
      console.log("commit said", JSON.stringify(done.body));
  } else {
    console.log(
      `\nRUN THIS SQL (${commits}), expecting '${expect}':\n` +
        `select public.chat_agent_commit('${TOKEN}', '${CONVERSATION}', '${latest.id}', '${JSON.stringify(result).replace(/'/g, "''")}'::jsonb);\n`,
    );
  }
  return reply;
}
const pendingDraft = () =>
  until(
    "draft",
    async () =>
      (
        await db(
          `message_drafts?conversation_id=eq.${CONVERSATION}&status=eq.pending&select=id,body`,
          { token: t1 },
        )
      ).body?.[0],
    SECRET ? 20000 : 300000,
  );

await p1.goto(`${BASE}/app/inbox?queue=all&c=${CONVERSATION}`);
await p1.waitForSelector(`text=${SECOND}`);

// 1. Approve & send.
await say("We have three clinics.");
await until("saved", async () =>
  (await panel.locator(".msg.me:not(.pending)").allTextContents()).includes(
    "We have three clinics.",
  ),
);
const draft1 = await agentWrites("draft");
ok("agent (ask first): the reply is stored as a draft", await pendingDraft());
const draftShown = await until("draft shown", async () =>
  (await p1.textContent("body")).includes(draft1),
);
ok(
  "inbox: the draft appears without a reload, with Approve & send / Edit / Discard",
  draftShown &&
    (await p1.locator("button:has-text('Approve & send')").count()) === 1 &&
    (await p1.locator("summary:has-text('Edit')").count()) === 1 &&
    (await p1.locator("button:has-text('Discard')").count()) === 1,
);
await shot(p1, "chat-inbox-draft");
await sleep(3500); // one poll
ok(
  "widget: the visitor doesn't see the draft, and is told a team member will reply",
  !(await panel.locator(".msg").allTextContents()).includes(draft1) &&
    /A team member will reply here shortly/.test(
      (await panel.locator(".note").textContent()) ?? "",
    ),
);
await p1.click("button:has-text('Approve & send')");
const approved = await until("approved", async () =>
  (await panel.locator(".msg.them").allTextContents()).includes(draft1),
);
ok("inbox: Approve & send delivers the draft to the visitor", approved);
ok(
  "widget: the agent's reply is labelled 'Assistant'",
  (await panel.locator(".who").allTextContents()).includes("Assistant"),
);
await shot(v, "chat-widget-agent-reply");

// 2. Edit, then send.
await say("When could you start?");
await until("saved", async () =>
  (await panel.locator(".msg.me:not(.pending)").allTextContents()).includes(
    "When could you start?",
  ),
);
const draft2 = await agentWrites("draft");
await pendingDraft();
await until("draft 2 shown", async () =>
  (await p1.textContent("body")).includes(draft2),
);
await p1.click("summary:has-text('Edit')");
const EDITED = `Edited by a person: we can start next month. (${Date.now()})`;
await p1.fill("#draft-body", EDITED);
await p1.click("button:has-text('Send edited reply')");
const edited = await until("edited", async () => {
  const seen = await panel.locator(".msg.them").allTextContents();
  return seen.includes(EDITED) && !seen.includes(draft2);
});
ok("inbox: Edit sends the person's wording, not the draft's", edited);

// 3. Discard.
await say("Any discount?");
await until("saved", async () =>
  (await panel.locator(".msg.me:not(.pending)").allTextContents()).includes(
    "Any discount?",
  ),
);
const draft3 = await agentWrites("draft");
await pendingDraft();
await until("draft 3 shown", async () =>
  (await p1.textContent("body")).includes(draft3),
);
await p1.click("button:has-text('Discard')");
await p1.waitForSelector("button:has-text('Approve & send')", {
  state: "detached",
  timeout: 15000,
});
await sleep(3500);
ok(
  "inbox: Discard sends nothing",
  !(await panel.locator(".msg").allTextContents()).includes(draft3),
);

// 4. "Send on its own".
await p1.goto(`${BASE}/app/chat`);
await p1.waitForSelector("#agent");
const agent2 = p1.locator("#agent");
await agent2.locator('input[value="auto"]').check();
await agent2.locator("button:has-text('Save')").click();
await agent2.locator("text=Saved.").waitFor();
await say("Great, thanks.");
await until("saved", async () =>
  (await panel.locator(".msg.me:not(.pending)").allTextContents()).includes(
    "Great, thanks.",
  ),
);
const auto = await agentWrites("sent");
const autoSeen = await until(
  "auto",
  async () =>
    (await panel.locator(".msg.them").allTextContents()).includes(auto),
  SECRET ? 20000 : 300000,
);
ok("agent (send on its own): the reply reaches the visitor directly", autoSeen);
ok(
  "agent (send on its own): no draft is left waiting",
  (
    await db(
      `message_drafts?conversation_id=eq.${CONVERSATION}&status=eq.pending&select=id`,
      { token: t1 },
    )
  ).body.length === 0,
);

// The outcome, on the lead, the conversation and Home.
await p1.goto(`${BASE}/app/inbox?queue=all&c=${CONVERSATION}`);
await p1.waitForSelector(`text=${auto}`);
const threadText = await p1.textContent("body");
ok(
  "inbox: the thread shows the outcome, the agent's note and the visitor's name",
  /Qualified/.test(threadText) &&
    /Dental clinic with 3 locations/.test(threadText) &&
    /Dana Reyes/.test(threadText),
);
await shot(p1, "chat-inbox-qualified");
await p1.goto(`${BASE}/app`);
await p1.waitForSelector("text=Recent activity");
const today = (await p1.textContent("main")).replace(/\s+/g, " ");
ok(
  "home: counts the qualified lead this week, and recent activity lists the qualification",
  /[1-9]\d*\s*leads? qualified/.test(today) &&
    /Qualified in the website chat/.test(today),
  today.slice(0, 160),
);
await shot(p1, "chat-today");

// -------------------------------------------- knowledge from a web page
await p1.goto(`${BASE}/app/knowledge`);
const addPage = p1.locator("section", { hasText: "Add from a web page" });
const tryPage = async (address) => {
  // A fresh form each time, so the answer read is this attempt's.
  await p1.reload();
  await addPage.locator('input[name="url"]').fill(address);
  await addPage.locator("button:has-text('Add page')").click();
  const answer = addPage.locator("p[role=alert], p[role=status]");
  await answer.waitFor({ timeout: 30000 });
  return answer.textContent();
};
for (const [address, expected] of [
  ["https://169.254.169.254/latest/meta-data/", /private network/],
  ["https://127.0.0.1/", /private network/],
  ["https://localhost/", /public web address/],
  ["http://example.com/", /public web address/],
]) {
  const said = await tryPage(address);
  ok(`knowledge: refuses to read ${address}`, expected.test(said), said);
}
const added = await tryPage("https://example.com/");
ok("knowledge: reads a public page", /^Added/.test(added), added);
await p1.reload();
const items = await p1.locator("section", { hasText: "Items" }).textContent();
ok(
  "knowledge: the page's title and text are stored as an item",
  /Example Domain/.test(items),
  items.replace(/\s+/g, " ").slice(0, 160),
);
await shot(p1, "chat-knowledge");

// ---------------------------------------------- the public endpoints
const pre = await fetch(`${BASE}/api/chat/${TOKEN}/messages`, {
  method: "OPTIONS",
  headers: { origin: SITE, "access-control-request-method": "POST" },
});
ok(
  "api: the chat endpoints answer any origin",
  pre.status === 204 && pre.headers.get("access-control-allow-origin") === "*",
);
const other = await fetch(`${BASE}/api/leads/capture/${TOKEN}`, {
  method: "OPTIONS",
});
const page404 = await fetch(`${BASE}/app`, { redirect: "manual" });
ok(
  "api: no cross-origin headers on the app itself",
  other.status === 204 &&
    page404.headers.get("access-control-allow-origin") === null,
);
ok(
  "api: an unknown widget id is a 404",
  (await api(`${"0".repeat(64)}/messages`, { message: "Hi" })).status === 404 &&
    (await api("0".repeat(64))).status === 404,
);
ok(
  "api: an over-long message is refused",
  (await api(`${TOKEN}/messages`, { message: "x".repeat(2001) })).body
    .reason === "too_long",
);
ok(
  "api: a chat can't be read or written with the wrong key",
  (
    await api(`${TOKEN}/poll`, {
      conversation: CONVERSATION,
      key: "0".repeat(64),
    })
  ).status === 404 &&
    (
      await api(`${TOKEN}/messages`, {
        message: "Let me in",
        conversation: CONVERSATION,
        key: "0".repeat(64),
      })
    ).status === 404,
);
const mine = await api(`${TOKEN}/poll`, {
  conversation: CONVERSATION,
  key: stored.k,
});
ok(
  "api: with the right key the visitor reads sent messages only, never drafts",
  mine.status === 200 &&
    mine.body.messages.some((m) => m.body === auto) &&
    !mine.body.messages.some((m) => m.body === draft3 || m.body === draft2),
);
const card = await api(
  `${TOKEN}/messages`,
  {
    message: "My card is 4242 4242 4242 4242",
    conversation: CONVERSATION,
    key: stored.k,
  },
  { "x-real-ip": "198.51.100.20" },
);
ok(
  "api: a card number is removed before the message is stored",
  card.body.message?.body === "My card is [card number removed]" &&
    (
      await db(`messages?id=eq.${card.body.message.id}&select=body`, {
        token: t1,
      })
    ).body[0].body === "My card is [card number removed]",
);
ok(
  "api: without the agent's keys the server answers 'saved', not 'replying'",
  SECRET ? true : card.body.agent === "saved",
);
// One address may start six chats a minute.
const statuses = [];
for (let i = 0; i < 7; i++)
  statuses.push(
    (
      await api(
        `${TOKEN}/messages`,
        { message: `Rate limit check ${i + 1}` },
        { "x-real-ip": "198.51.100.21" },
      )
    ).status,
  );
ok(
  "api: the seventh new chat in a minute from one address is refused",
  statuses.slice(0, 6).every((s) => s === 200) && statuses[6] === 429,
  statuses.join(","),
);

// ------------------------------------------------ another workspace
const { ctx: c2, page: p2 } = await signIn(USER_2, WS_2);
const t2 = await jwt(c2);
for (const table of ["chat_widgets", "message_drafts"]) {
  const mineRows = await db(`${table}?select=id`, { token: t1 });
  const theirs = await db(`${table}?select=id`, { token: t2 });
  const ids = new Set(mineRows.body.map((r) => r.id));
  ok(
    `isolation: the second workspace sees none of the first's ${table}`,
    mineRows.body.length > 0 &&
      theirs.status === 200 &&
      !theirs.body.some((r) => ids.has(r.id)),
    `${mineRows.body.length} vs ${theirs.body.length}`,
  );
}
ok(
  "isolation: the second workspace can't read the chat's conversation or messages",
  (await db(`conversations?id=eq.${CONVERSATION}&select=id`, { token: t2 }))
    .body.length === 0 &&
    (
      await db(`messages?conversation_id=eq.${CONVERSATION}&select=id`, {
        token: t2,
      })
    ).body.length === 0,
);
const intrude = await db("rpc/send_chat_reply", {
  token: t2,
  body: { p_conversation_id: CONVERSATION, p_body: "Hello from outside" },
});
ok(
  "isolation: the second workspace can't reply in the first's chat",
  intrude.status >= 400 && intrude.body?.code === "P0002",
  JSON.stringify(intrude.body),
);
const [anyDraft] = (
  await db(
    `message_drafts?conversation_id=eq.${CONVERSATION}&select=id&limit=1`,
    { token: t1 },
  )
).body;
const approveOther = await db("rpc/approve_chat_draft", {
  token: t2,
  body: { p_draft_id: anyDraft.id },
});
ok(
  "isolation: nor approve its drafts",
  approveOther.status >= 400 && approveOther.body?.code === "P0002",
);
for (const fn of ["chat_agent_context", "chat_agent_commit"]) {
  const body =
    fn === "chat_agent_context"
      ? { p_token: TOKEN, p_conversation_id: CONVERSATION }
      : {
          p_token: TOKEN,
          p_conversation_id: CONVERSATION,
          p_in_reply_to: CONVERSATION,
          p_result: {},
        };
  const asAnon = await db(`rpc/${fn}`, { body });
  const asUser = await db(`rpc/${fn}`, { token: t1, body });
  ok(
    `isolation: ${fn} is refused to visitors and to signed-in people`,
    asAnon.status >= 400 && asUser.status >= 400,
    `${asAnon.status} ${asUser.status}`,
  );
}
for (const table of ["chat_widgets", "message_drafts"])
  ok(
    `isolation: a visitor can't read ${table}`,
    (await db(`${table}?select=id`)).status >= 400,
  );
await p2.goto(`${BASE}/app/inbox?queue=all&c=${CONVERSATION}`);
await p2.waitForSelector("text=That conversation doesn't exist");
ok("isolation: in the app, the first workspace's chat is 'not found'", true);

ok(
  "widget: no errors in the visitor's browser console",
  visitorErrors.length === 0,
  visitorErrors.join(" | ").slice(0, 200),
);

// --------------------------------------------- switching the chat off
await p1.goto(`${BASE}/app/chat`);
await p1.click("#chat button:has-text('Switch off')");
await p1.waitForSelector("#chat button:has-text('Switch on')");
const off = await visitorCtx.newPage();
await off.goto(`${SITE}/`);
await sleep(2500);
ok(
  "widget: a switched-off chat doesn't appear on the site at all",
  (await off.locator("[data-dialvo-chat]").count()) === 0 &&
    (await api(TOKEN)).status === 404,
);
await p1.click("#chat button:has-text('Switch on')");
await p1.waitForSelector("#chat button:has-text('Switch off')");

// Leave the agent as a new workspace has it: off, asking first.
await p1.goto(`${BASE}/app/chat`);
await p1.waitForSelector("#agent");
const agent3 = p1.locator("#agent");
await agent3.locator('input[value="approve_first"]').check();
await agent3.locator("button:has-text('Save')").click();
await agent3.locator("text=Saved.").waitFor();
await agent3.locator("button:has-text('Switch off')").click();
await agent3.locator("button:has-text('Switch on')").waitFor();

await browser.close();
customerSite.close();
const failed = results.filter((r) => !r.pass);
console.log(
  `\n${results.length - failed.length}/${results.length} checks passed`,
);
if (failed.length) {
  for (const f of failed) console.log("FAILED:", f.name, f.detail);
  process.exit(1);
}
