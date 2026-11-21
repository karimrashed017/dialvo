// The browser check for Calls (calls, numbers, settings) and
// Sequences, channels: signs in with a test account, visits every new page
// at desktop (1440) and phone (390) width, saving a full-page screenshot of
// each and failing on a page error, a 404 or a 500. Then, on desktop, it
// uses the forms that only write to the test workspace: saves the call
// settings, adds a number to the do-not-call list, checks the outbound
// page is gone, adds a LinkedIn step, and sets a lead's time zone. Nothing
// is texted: without Twilio's keys nothing can be, and Dialvo never makes
// outbound calls.
//
//   E2E_BASE=http://localhost:3000 E2E_USER=... E2E_PASSWORD=... \
//   E2E_SHOTS=screenshots node scripts/e2e-channels.mjs

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
  ["calls", "/app/calls"],
  ["calls-numbers", "/app/calls/numbers"],
  ["calls-settings", "/app/calls/settings"],
  ["sequence-channels", "/app/sequences/channels"],
  ["sequences", "/app/sequences"],
  ["features", "/app/features"],
  ["play-nurture", "/app/plays/lead-nurture"],
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

  if (label === "desktop") {
    // Without Twilio's keys the pages say which ones are missing.
    await page.goto(`${BASE}/app/calls`);
    await page.waitForSelector("text=Transcript", { timeout: 15000 });
    const main = await page.locator("main").innerText();
    ok(
      "names the missing Twilio keys",
      main.includes("TWILIO_ACCOUNT_SID") && main.includes("TWILIO_AUTH_TOKEN"),
    );
    ok(
      "shows the seeded call's transcript",
      main.includes("how much is it") && main.includes("transcribed"),
    );

    // Settings save.
    await page.goto(`${BASE}/app/calls/settings`);
    await page.fill('input[name="transfer_number"]', "+1 500 555 0009");
    await page.click('button:has-text("Save call settings")');
    await page.waitForSelector('text="Saved."', { timeout: 15000 });
    ok("call settings save", true);
    await page.reload();
    ok(
      "transfer number kept in international form",
      (await page.inputValue('input[name="transfer_number"]')) ===
        "+15005550009",
    );
    // A window past 9 at night is refused, by the browser first.
    await page.fill('input[name="end"]', "22:00");
    ok(
      "refuses a texting window past 9 pm",
      await page.$eval('input[name="end"]', (el) => !el.checkValidity()),
    );
    await page.reload();

    // Do-not-call list.
    await page.fill('#do-not-call input[name="phone"]', "+15005550008");
    await page.click('#do-not-call button:has-text("Add")');
    await page.waitForSelector(
      "text=/won't be contacted|already on the list/",
      {
        timeout: 15000,
      },
    );
    ok("adds to the do-not-call list", true);

    // No outbound calling anywhere.
    const gone = await page.goto(`${BASE}/app/calls/outbound`);
    ok(
      "the outbound calls page is gone",
      new URL(page.url()).pathname === "/app/calls" && gone?.status() === 200,
    );

    // A LinkedIn step.
    await page.goto(`${BASE}/app/sequences/channels`);
    await page.selectOption('select[name="channel"]', "linkedin");
    await page.fill(
      'textarea[name="message"]',
      "Hi {first_name}, following up on my email.",
    );
    await page.click('button:has-text("Add step")');
    await page.waitForSelector("text=/applies to sequences that start/", {
      timeout: 15000,
    });
    await page.reload();
    await page
      .waitForSelector("text=LinkedIn message (you send it)", {
        timeout: 15000,
      })
      .catch(() => null);
    ok(
      "LinkedIn step listed",
      (await page.locator("text=LinkedIn message (you send it)").count()) >= 1,
    );

    // A lead's time zone.
    await page.goto(`${BASE}/app/leads`);
    await page.locator('a:has-text("Test Caller One"):visible').first().click();
    await page.waitForURL(/\/app\/leads\/[0-9a-f-]+$/);
    await page.selectOption('select[name="time_zone"]', "America/Chicago");
    await page.click(
      'section:has(h2:has-text("Time zone")) button:has-text("Save")',
    );
    await page.waitForTimeout(1500);
    await page.reload();
    await page.waitForSelector('select[name="time_zone"]', { timeout: 15000 });
    ok(
      "lead time zone saved",
      (await page.inputValue('select[name="time_zone"]')) === "America/Chicago",
    );
    await page.screenshot({
      path: `${SHOTS}/desktop-lead.png`,
      fullPage: true,
    });
  }
  await ctx.close();
}
await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`${results.length - failed.length} of ${results.length} passed`);
process.exit(failed.length ? 1 : 0);
