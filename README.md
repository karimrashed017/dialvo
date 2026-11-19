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
- `src/app/inbound`, `outbound`, `expansion`: the three motion pages.
- `src/app/plays/[slug]`: one page per play (14).
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

## Honesty rules for the site

- No customers, logos, quotes, ratings or result numbers until there are real ones.
- Product visuals use made-up businesses and are marked "Example".
- No certifications are claimed.
- The whole product is in early access; individual features aren't tagged.
- AI voice calls go only to people who asked or opted in, and say they're an
  AI. Cold calls are made by reps with the dialer.
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
