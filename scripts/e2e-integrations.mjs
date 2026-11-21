// The browser check for Slack, API and webhooks, Website visitors, the
// retargeting play and review-site intent: signs in with a test account and
// visits each page at desktop (1440) and phone (390) width, saving a
// full-page screenshot of each and failing on a page error, a 404 or a 500,
// or sideways scrolling on a phone. It clicks nothing that writes.
//
//   E2E_BASE=http://localhost:3000 E2E_USER=... E2E_PASSWORD=... \
//   E2E_SHOTS=screenshots node scripts/e2e-integrations.mjs

import { mkdirSync } from "node:fs";

const pw = await import(process.env.PLAYWRIGHT ?? "playwright");
const chromium = pw.chromium ?? pw.default.chromium;
const BASE = process.env.E2E_BASE ?? "http://localhost:3000";
const SHOTS = process.env.E2E_SHOTS ?? "screenshots";
const USER = process.env.E2E_USER;
const PW = process.env.E2E_PASSWORD;
if (!USER || !PW) throw new Error("Set E2E_USER and E2E_PASSWORD.");
mkdirSync(SHOTS, { recursive: true });

const PAGES = [
  ["slack", "/app/settings/slack", /Slack/],
  ["api", "/app/settings/api", /API reference/],
  ["visitors", "/app/visitors", /Website visitors/],
  [
    "play-retargeting",
    "/app/plays/retargeting-website-visitors",
    /Who is on your site/,
  ],
  ["signals", "/app/prospects/signals", /review-site intent/i],
  ["features", "/app/features", /Slack integration/],
  ["settings", "/app/settings", /Open Slack/],
];

let failed = 0;
const ok = (name, pass, detail = "") => {
  if (!pass) failed++;
  console.log(pass ? "PASS" : "FAIL", name, detail);
};

const browser = await chromium.launch({ args: ["--no-sandbox"] });
for (const [label, width] of [
  ["desktop", 1440],
  ["phone", 390],
]) {
  const ctx = await browser.newContext({
    viewport: { width, height: width > 500 ? 900 : 844 },
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', USER);
  await page.fill('input[name="password"]', PW);
  await page.click('form:has(input[name="password"]) button[type="submit"]');
  await page.waitForURL(/\/app$/, { timeout: 60000 });
  for (const [name, path, expect] of PAGES) {
    errors.length = 0;
    const res = await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(300);
    const status = res?.status() ?? 0;
    const text = await page
      .locator("main")
      .innerText()
      .catch(() => "");
    const sideways = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    ok(
      `${label} ${path}`,
      status < 400 &&
        expect.test(text) &&
        !/Application error|could not be found/.test(text) &&
        errors.length === 0 &&
        !(label === "phone" && sideways),
      `${status} ${errors.join(" | ")}${sideways ? " (scrolls sideways)" : ""}`,
    );
    await page.screenshot({
      path: `${SHOTS}/${label}-${name}.png`,
      fullPage: true,
    });
  }
  if (label === "desktop") {
    await page.goto(`${BASE}/app/visitors`, { waitUntil: "networkidle" });
    ok(
      "the sidebar links Website visitors",
      (await page.locator('aside a[href="/app/visitors"]').count()) >= 1,
    );
    ok(
      "the visitors page names the missing company-lookup key",
      /IPAPI_IS_API_KEY/.test(await page.locator("main").innerText()),
    );
    await page.goto(`${BASE}/app/features`, { waitUntil: "networkidle" });
    const features = await page.locator("main").innerText();
    ok(
      "no feature of this scope is still being built",
      !/Slack integration[\s\S]{0,40}Being built/.test(features),
    );
  }
  await ctx.close();
}
await browser.close();
// The tracker's public endpoint answers without a session.
const cfg = await fetch(`${BASE}/api/chat/${"0".repeat(64)}/track`);
ok(
  "tracker config answers for an unknown widget",
  cfg.status === 200,
  String(cfg.status),
);
const unauth = await fetch(`${BASE}/api/v1/leads`);
ok(
  "the API refuses a request without a key",
  unauth.status === 401,
  String(unauth.status),
);
process.exit(failed ? 1 : 0);
