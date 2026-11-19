#!/usr/bin/env node
// Checks that the live voice demo is set up on a running site.
//
//   node scripts/check-voice.mjs https://trydialvo.com
//   node scripts/check-voice.mjs http://localhost:3000
//
// It asks the site whether the demo is configured, then asks for one call
// the way the page does and reports whether ElevenLabs issued a token. No
// conversation is started, so it costs nothing, but each run counts as one
// of your address's calls for the rate limit (3 in 10 minutes, 10 a day).
// The token itself is never printed.

const site = (process.argv[2] ?? "http://localhost:3000").replace(/\/+$/, "");
const url = `${site}/api/voice/session`;

function fail(message) {
  console.error(`FAIL  ${message}`);
  process.exit(1);
}

try {
  const status = await fetch(url);
  const { configured } = await status.json().catch(() => ({}));
  console.log(`GET  ${url} -> ${status.status}, configured: ${configured}`);
  if (configured !== true) {
    fail(
      "The server has no ELEVENLABS_API_KEY. Add it to the environment (Vercel: Settings, Environment Variables) and redeploy.",
    );
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: site },
    body: JSON.stringify({ scenario: "speed-to-lead", voice: "warm" }),
  });
  const body = await res.json().catch(() => ({}));
  console.log(`POST ${url} -> ${res.status}`);

  if (res.status === 200 && typeof body.conversationToken === "string") {
    const { tts } = body.overrides ?? {};
    console.log(
      `OK    A conversation token came back (${body.conversationToken.length} characters).`,
    );
    console.log(`      Opening line: ${body.dynamicVariables?.opening_line}`);
    console.log(`      Voice id: ${tts?.voiceId}, limit: ${body.maxSeconds}s`);
    console.log(
      "      Now open the site, press Talk to the agent and say hello: only a real call proves the sound.",
    );
  } else if (res.status === 503) {
    fail("not_configured: the server has no ELEVENLABS_API_KEY.");
  } else if (res.status === 429) {
    fail(
      `rate_limited: this address has used its calls. Try again in ${body.retryAfter}s.`,
    );
  } else if (res.status === 502) {
    fail(
      "unavailable: ElevenLabs refused. Check the key is valid and can use ElevenAgents (see the server log for ElevenLabs' answer).",
    );
  } else {
    fail(`Unexpected answer: ${JSON.stringify(body).slice(0, 300)}`);
  }
} catch (error) {
  fail(`Could not reach ${url}: ${error.message}`);
}
