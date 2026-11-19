# Dialvo

The marketing site for Dialvo, an AI sales team: agents that work every
channel (voice, email, chat, social, SMS and WhatsApp) to find, engage, qualify
and book, across inbound, outbound and expansion, with a human dialer for
reps. Next.js 16 (App Router, Cache Components), Tailwind CSS 4. Early access:
every "Get early access" button opens an email to contact@trydialvo.com.

## Run it

```sh
npm install
npm run dev     # http://localhost:3000
npm run build   # production build
npm run check   # lint, typecheck, format check
```

## Where things are

- `src/app/page.tsx`: the home page, built from the sections in `src/app/_site/`.
  - `hero.tsx` and `dashboard.tsx`: the hero and its example workspace.
  - `channels.tsx`: the six channel tabs and their panels.
  - `sections.tsx`: tools, the three motions, plays, platform, compliance, last call.
  - `listen.tsx` and `call-player.tsx`: "You stay in control" and the sample call.
- `src/app/pricing/page.tsx`: plans, the comparison table and the FAQ.
- `src/app/privacy`, `src/app/terms`: short draft placeholders.
- `src/lib/site.ts`: name, URL, email, description, prices and allowances. Change them here.
- `src/app/_site/plans.ts`: what each plan includes.
- `src/app/_site/faqs.ts`: the FAQ.
- `public/llms.txt`: a plain description of Dialvo for AI assistants.
- `public/og.png`: the share image (1200x630).
- `docs/feature-parity.md`: the capabilities the site has to cover, and where it differs on purpose.

## Honesty rules for the site

- No customers, logos, quotes, ratings or result numbers until there are real ones.
- Product visuals use made-up businesses and are marked "Example".
- No certifications are claimed.
- The whole product is in early access; individual features aren't tagged.

## Logo

The logo is the Spark. The full kit (SVG, PNG, covers, the meadow photo) is in
`brand/`; the site uses copies in `public/brand/` (`logo.svg`,
`logo-white.svg`, `mark.svg`, `mark-white.svg`, `mark-blue.svg`,
`favicon.svg`, `app-icon.svg`), `src/app/icon.svg` (the favicon) and
`src/app/apple-icon.png` (the blue app icon, 180x180). `public/og.png` is the
logo and headline on the meadow photo.

Colours: paper `#F7F5F1`, ink `#0B0B0C`, and the logo's blue `#1F3BFF` as a
sparing accent (the active channel tab, live dots, small marks).

## The sample call

"You stay in control" plays `public/audio/demo-call.mp3` if it exists, in sync
with the transcript in `public/audio/demo-call.json`
(`[{ "t": seconds, "speaker": "Dialvo" | "Lead", "text": "..." }]`). Without
the mp3, the transcript plays on a timer. It's a sample script of an inbound
speed-to-lead call (a lead filled in a form; the agent calls back within a
minute), labelled as an example on the page; record the audio to the same
timings.

## Paintings

All public domain: William Bradford, Coast of Labrador; Martin Johnson Heade,
York Harbor, Coast of Maine (1877); John Frederick Kensett, Rocky Coast.
The meadow photo behind the channel panels (`public/images/art/meadow.jpg`)
was generated for Dialvo.
