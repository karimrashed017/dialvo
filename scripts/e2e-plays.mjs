// The browser check for Plays, All features, Sequences, Analytics, Calls,
// Find leads' new tabs and Settings, API: signs in with an existing test
// account and visits every new page at desktop (1440) and phone (390) width,
// saving a full-page screenshot of each and failing on a page error, a 404
// or a 500. It reads and clicks nothing that writes: no play is started, no
// key is made, no list uploaded, no email sent.
//
//   E2E_BASE=http://localhost:3000 E2E_USER=... E2E_PASSWORD=... \
//   E2E_SHOTS=screenshots node scripts/e2e-plays.mjs

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
  ["plays", "/app/plays"],
  ["play-speed", "/app/plays/speed-to-lead"],
  ["play-meetings", "/app/plays/automated-meeting-scheduling"],
  ["play-onboarding", "/app/plays/customer-onboarding-operations"],
  ["play-outbound", "/app/plays/outbound-lead-generation"],
  ["play-nurture", "/app/plays/lead-nurture"],
  ["play-reactivation", "/app/plays/lead-reactivation"],
  ["play-retargeting", "/app/plays/retargeting-website-visitors"],
  ["play-closed-lost", "/app/plays/closed-lost"],
  ["play-takeout", "/app/plays/competitive-takeout"],
  ["play-event-registration", "/app/plays/event-registration"],
  ["play-event-follow-up", "/app/plays/event-follow-up"],
  ["play-event-no-show", "/app/plays/event-no-show"],
  ["play-expansion", "/app/plays/customer-expansion"],
  ["play-plg", "/app/plays/plg-conversion"],
  ["features", "/app/features"],
  ["feature-visitor-tracking", "/app/features/website-visitor-tracking"],
  ["feature-slack", "/app/features/slack-integration"],
  ["sequences", "/app/sequences"],
  ["analytics", "/app/analytics"],
  ["analytics-90", "/app/analytics?days=90"],
  ["calls", "/app/calls"],
  ["find-accounts", "/app/prospects/accounts"],
  ["find-lookalike", "/app/prospects/lookalike"],
  ["find-signals", "/app/prospects/signals"],
  ["find-search", "/app/prospects"],
  ["find-emails", "/app/prospects?view=emails"],
  ["settings-api", "/app/settings/api"],
  ["settings", "/app/settings"],
  ["playbooks", "/app/plays/playbooks"],
  ["settings-routing", "/app/settings/routing"],
  ["settings-mailboxes", "/app/settings/mailboxes"],
];

const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass: !!pass });
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
  for (const [name, path] of PAGES) {
    errors.length = 0;
    const res = await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(300);
    const status = res?.status() ?? 0;
    const text = await page
      .locator("main")
      .innerText()
      .catch(() => "");
    const broken =
      /Application error|Something went wrong|This page could not be found/.test(
        text,
      );
    ok(
      `${label} ${path}`,
      status < 400 && !broken && errors.length === 0,
      `${status} ${errors.join(" | ")}`,
    );
    await page.screenshot({
      path: `${SHOTS}/${label}-${name}.png`,
      fullPage: true,
    });
  }
  // The sidebar's order, and the All features link.
  if (label === "desktop") {
    const nav = await page
      .locator('aside nav[aria-label="App"] a')
      .allInnerTexts();
    const names = nav.map((n) => n.replace(/\d+/g, "").trim());
    ok(
      "sidebar order",
      JSON.stringify(names) ===
        JSON.stringify([
          "Home",
          "Plays",
          "Find leads",
          "Sequences",
          "Inbox",
          "Website chat",
          "Website visitors",
          "Calls",
          "Leads",
          "Analytics",
          "Knowledge",
          "Settings",
        ]),
      names.join(", "),
    );
    ok(
      "All features link",
      (await page.locator('aside a[href="/app/features"]').count()) === 1,
    );
    const plays = await page.goto(`${BASE}/app/plays`);
    ok(
      "plays page lists 14 plays",
      plays &&
        (await page
          .locator("[data-play]:not([data-play=playbooks])")
          .count()) === 14,
    );
    await page.goto(`${BASE}/app/features`);
    ok(
      "features page lists every menu item",
      (await page.locator("[data-feature]").count()) === 26,
    );
  } else {
    await page.goto(`${BASE}/app/plays`);
    await page.click('button[aria-label^="Menu"]');
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/phone-drawer.png` });
    ok(
      "phone drawer has All features",
      (await page.locator('dialog a[href="/app/features"]').count()) === 1,
    );
  }
  await ctx.close();
}
await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(
  `\n${results.length - failed.length} passed, ${failed.length} failed`,
);
process.exit(failed.length ? 1 : 0);
