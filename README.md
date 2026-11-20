# Dialvo

The marketing site and the signed-in app (slice 1, see "The app" below) for Dialvo: inbound and outbound sales, run by AI agents.
They answer every lead within a minute, go out to find new business, follow up
on every channel (voice, email, chat, social, SMS and WhatsApp), book the
meetings and close simple sales; bigger deals go to the customer's team, and
reps get a human dialer. Next.js 16 (App Router, Cache Components), Tailwind CSS 4. Early access:
every "Join the waitlist" button opens the waitlist form at /waitlist, which saves each sign-up as a private file in the Vercel Blob store "dialvo-waitlist".

## Run it

```sh
npm install
npm run dev     # http://localhost:3000
npm run build   # production build
npm run check   # lint, typecheck, format check, tests
npm test        # the tests alone (vitest)
```

## Where things are

- `src/app/page.tsx`: the home page, built from the sections in `src/app/_site/`.
  In order: hero, the problem, the four jobs (inbound, outbound, closing,
  expansion), the live voice demo, the channel tabs, control, what it
  replaces, trust, pricing, FAQ, last call.
  - `hero.tsx` and `dashboard.tsx`: the hero and its example workspace.
  - `sections.tsx`: the problem, the four jobs, what it replaces (with the
    tools Dialvo connects to), trust, last call.
  - `voice-section.tsx`, `voice-demo.tsx`, `voice-call.tsx` and
    `voice-parts.tsx`: the live voice demo, in its own section (see "The live
    voice demo" below). It is the only live demo on the page.
  - `channels.tsx`: the six channel tabs and their example panels. The Voice
    tab is a sample transcript that links up to the live demo.
  - `listen.tsx` and `call-player.tsx`: "Nothing happens out of sight" and the
    sample call.
- `src/app/inbound`, `outbound`, `closing`, `expansion`: the four motion pages.
  Closing has no plays; its page has a "what it will and won't close" section
  instead (`scope` in its content).
- `src/app/plays`: every play as a card (the grid that used to be on the home
  page), and `src/app/plays/[slug]`: one page per play (14).
- `src/app/platform` and `src/app/platform/[slug]`: the platform overview and
  one page per feature (23).
- `src/lib/content/`: all the copy for those pages, typed. `catalog.ts` is the
  map (motions, plays, feature groups, one-liners) that the menus, footer,
  sitemap and cards read; the `plays-*.ts`, `platform-*.ts` and `motions.ts`
  files hold each page's copy. To add a page, add it to the catalog and write
  its entry: TypeScript fails until both exist.
- `src/app/_site/pages/`: the templates those pages render through
  (`play-page`, `feature-page`, `motion-page`, `platform-page`), the shared
  parts and the sample panels (`visual.tsx`).
- `src/app/_site/nav.tsx`: the nav and its two menus (panels on desktop, an
  accordion on phones).
- `src/app/pricing/page.tsx`: plans, the comparison table and the FAQ.
- `src/app/privacy`, `src/app/terms`: short draft placeholders.
- `src/lib/site.ts`: name, URL, email, description, prices and allowances. Change them here.
- `src/app/_site/plans.ts`: what each plan includes.
- `src/app/_site/faqs.ts`: the FAQ.
- `public/llms.txt`: a plain description of Dialvo for AI assistants, with a
  link to every page. Update it when the catalog changes.
- `public/og.png`: the share image (1200x630).
- `docs/feature-parity.md`: the capabilities the site has to cover, and where it differs on purpose.

## The app (slice 1)

The signed-in product, at `/app`. It needs a Supabase project: until
`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are set,
`/login` and `/app` show "Dialvo's app is being set up" and the marketing site
is unchanged. **`docs/app-setup.md` has the setup steps, the dashboard
settings and the manual test checklist.**

- **Auth** (`src/app/(auth)`, `src/app/auth/confirm`, `src/app/logout`):
  sign-up, log-in by password or emailed link, password reset, cookie
  sessions through `@supabase/ssr`. `getCurrentUser()` (`src/lib/auth/user.ts`)
  is called by every page, action and route that needs a user; `src/proxy.ts`
  only refreshes the session and redirects politely. `?next=` goes through
  `safeNextPath()` and can only lead into the app.
- **Onboarding** (`src/app/onboarding`): workspace name, what you sell (saved
  as the first knowledge item), website, time zone. Invitations to the
  signed-in address are offered here.
- **The shell and pages** (`src/app/app`): Today (four tiles, activity,
  waiting queue, pipeline, all counted from rows), Leads (search, filter, add,
  CSV import, lead page with timeline, consent, notes, do not contact), Inbox
  (queues, thread, reply, assign, close), Knowledge, Agents, Settings
  (workspace, profile, members and invitations, lead-capture forms).
  Sequences, Calls and Analytics say what's coming and show no data.
- **Honest about what isn't live:** the website chat is the one connected
  channel. On every other channel replies are stored and marked "Saved, not
  delivered"; the outbound, closing and expansion agents are settings only
  and say so; invitations say no email is sent.
- **Website chat and the inbound agent** (slice 2a): `public/widget.js` is
  the embeddable chat (`<script src="/widget.js?id=...">`), talking to the
  public endpoints in `src/app/api/chat/[token]` (CORS open on those only).
  Every chat is a lead and a conversation in the Inbox, live. The inbound
  agent (`src/lib/agents`, model `claude-haiku-4-5`) answers from the
  workspace's knowledge, either on its own or as drafts a person approves,
  edits or discards; a teammate's reply pauses it until it is handed back.
  It needs `ANTHROPIC_API_KEY` and `SUPABASE_SECRET_KEY`; without them the
  app says the agent isn't switched on and chats are still saved. Knowledge
  can be added from a web page (`src/lib/knowledge/fetch-page.ts`, which
  refuses private addresses).
- **Data access** (`src/lib/app`): `context.ts` resolves the user and their
  current workspace per request, `repo.ts` holds every read, `action.ts`
  wraps every Server Action in a session and membership check. The app talks
  to Supabase as the signed-in person, so row-level security applies to
  everything; each query also names the workspace.
- **Lead capture** (`src/app/api/leads/capture/[token]`): the public form
  endpoint, JSON or form-encoded, CORS open, validated
  (`src/lib/leads/capture.ts`), rate-limited, written by the database
  function `capture_lead()`. Consent is recorded only for the channels a
  payload includes.
- **Database** (`supabase/migrations`, tests in `supabase/tests`): tables
  `profiles`, `workspaces`, `workspace_members`, `invitations`, `leads`,
  `conversations`, `messages`, `agents`, `knowledge_items`, `meetings`,
  `calls`, `activity_events`, `lead_forms`, `chat_widgets`,
  `message_drafts`. Every table has row-level
  security from its first migration, policies go through `private.*` helper
  functions, and child tables use `(parent_id, workspace_id)` foreign keys.
  `npm test` applies the migrations to an in-memory Postgres (PGlite) and
  proves one workspace can't read or write another's rows.
- **Design preview:** `DIALVO_DEV_FIXTURES=1 npm run dev` draws the shell
  with made-up data and no database. Development only; it is compiled out of
  production builds (`scripts/check-no-preview-data.mjs`).
- **End-to-end checks:** `scripts/e2e-app.mjs` drives a browser through the
  app as two people and checks they can't see each other's data;
  `scripts/e2e-chat.mjs` does the same for the chat widget, the Inbox, drafts
  and takeover.

## Honesty rules for the site

- No customers, logos, quotes, ratings or result numbers until there are real ones.
- Product visuals use made-up businesses and are marked "Example". The live
  voice demo is the exception: it's a real AI agent, marked "Live demo", and it
  says that nothing in the demo is booked.
- The closer is for simple sales with a clear price. Never say it handles
  complex, negotiated or high-value deals: those go to the customer's team.
  Payments go through a secure link; the agent never takes card details.
- No certifications are claimed.
- The whole product is in early access; individual features aren't tagged.
- AI voice calls go only to people who asked or opted in. Cold calls are made
  by reps with the dialer.
- The site makes no claim about how the agent introduces itself (founder,
  19 Nov 2026). It must also never say or imply that the agent is a person, or
  that people can't tell. The live agent's own rules and opening lines are in
  `src/lib/voice/prompt.ts` and are a separate decision.
- Cold email goes from the customer's own inboxes with an unsubscribe link;
  LinkedIn messages go from the rep's own profile after they approve them.
- The site never names the benchmark, and no review site is named as an
  integration.

## Logo

The logo is the Spark. The full kit (SVG, PNG, covers, the meadow photo) is in
`brand/`; the site uses copies in `public/brand/` (`logo.svg`,
`logo-white.svg`, `mark.svg`, `mark-white.svg`, `mark-blue.svg`,
`favicon.svg`, `app-icon.svg`), `src/app/icon.svg` (the favicon) and
`src/app/apple-icon.png` (the blue app icon, 180x180). `public/og.png` is the
logo and headline on the meadow photo.

Colours: paper `#F7F5F1`, ink `#0B0B0C`, and the logo's blue `#1F3BFF` as a
sparing accent (the active channel tab, live dots, small marks).

## The live voice demo

The "Talk to it" section on the home page is a real conversation: the visitor
presses the orb (or "Talk to the agent" in the hero, which scrolls there and
puts focus on the button), allows the microphone, and talks with
Dialvo's AI sales agent, which answers in an ElevenLabs voice. It runs on
ElevenLabs Agents ("ElevenAgents") through `@elevenlabs/react`, over WebRTC.

- **Set it up:** put an ElevenLabs API key in `ELEVENLABS_API_KEY` (`.env.local`
  here, Environment Variables on Vercel, then redeploy). Without the key the
  tab shows the sample panel with "Live demo is being set up".
  `node scripts/check-voice.mjs https://trydialvo.com` says whether it's working.
- **The agent** is created by the server the first time someone starts a call:
  it looks for an agent named "Dialvo website demo" in the ElevenLabs account
  and creates it if it isn't there (`src/lib/voice/elevenlabs.ts`, which holds
  every setting: language model, speech model, limits, privacy). To change the
  settings later, edit that file and bump `SETTINGS_TAG`; the agent is updated
  in place. `ELEVENLABS_AGENT_ID` skips the lookup and uses that agent as is.
- **What it says** is `src/lib/voice/prompt.ts`: the rules, and one script and
  opening line per scenario. **Scenarios, voices and limits** are
  `src/lib/voice/config.ts`; each voice chip maps to an ElevenLabs premade
  voice id there.
- **`/api/voice/session`** (`src/app/api/voice/session/route.ts`): `GET` says
  whether the demo is configured; `POST {scenario, voice}` checks the choice
  and the rate limit and returns a one-conversation ElevenLabs token with that
  call's script, opening line and voice. The API key never reaches the browser.
- **Limits:** 2 minutes a call (enforced by ElevenLabs); 3 calls per 10 minutes
  and 10 a day per visitor (`src/lib/voice/rate-limit.ts`: by IP address in
  memory, plus a signed cookie that survives a cold start); 100 calls a day and
  3 at once across everyone (set on the agent); a call ends after 25 seconds of
  silence.
- **Privacy:** Dialvo stores nothing. The agent is set to ElevenLabs' "maximum
  privacy": audio isn't saved and transcripts are deleted rather than kept.
  ElevenLabs and the language model's provider do process the audio and text
  to run the call.

## The sample call

"Nothing happens out of sight" plays `public/audio/demo-call.mp3` if it exists, in sync
with the transcript in `public/audio/demo-call.json`
(`[{ "t": seconds, "speaker": "Dialvo" | "Lead", "text": "..." }]`). Without
the mp3, the transcript plays on a timer. It's a sample script of an inbound
speed-to-lead call (a lead filled in a form; the agent calls back within a
minute), labelled as an example on the page; record the audio to the same
timings.

## Paintings

All public domain: William Bradford, Coast of Labrador; Martin Johnson Heade,
York Harbor, Coast of Maine (1877); John Frederick Kensett, Rocky Coast.
The meadow photo behind the voice demo and the channel panels (`public/images/art/meadow.jpg`)
was generated for Dialvo.
