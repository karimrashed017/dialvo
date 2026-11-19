# Dialvo

The marketing site for Dialvo, an AI sales team for agencies, founders and
small businesses: it calls, follows up and books meetings. Next.js 16 (App
Router, Cache Components), Tailwind CSS 4. Pre-launch: every "Get early
access" button opens an email to contact@trydialvo.com.

## Run it

```sh
npm install
npm run dev     # http://localhost:3000
npm run build   # production build
npm run check   # lint, typecheck, format check
```

## Where things are

- `src/app/page.tsx`: the home page, built from the sections in `src/app/_site/`.
- `src/app/pricing/page.tsx`: plans, the comparison table and the FAQ.
- `src/app/privacy`, `src/app/terms`: short draft placeholders.
- `src/lib/site.ts`: name, URL, email, prices and allowances. Change them here.
- `src/app/_site/plans.ts`: what each plan includes, and what's "coming soon".
- `src/app/_site/faqs.ts`: the FAQ.
- `public/llms.txt`: a plain description of Dialvo for AI assistants.
- `public/og.png`: the share image (1200x630).

## Logo

The logo is plain files in `public/brand/` (`logo.svg`, `logo-white.svg`,
`mark.svg`, `mark-white.svg`, `favicon.svg`, `app-icon.svg`). The final logo
isn't picked yet: replace those files, keeping the names, and copy the new
favicon to `src/app/icon.svg` (and regenerate `src/app/apple-icon.png`, 180x180,
and `public/og.png`).

## The sample call

"Listen to every call" plays `public/audio/demo-call.mp3` if it exists, in
sync with the transcript in `public/audio/demo-call.json`
(`[{ "t": seconds, "speaker": "Dialvo" | "Prospect", "text": "..." }]`).
Without the mp3, the transcript plays on a timer. It's a sample script,
labelled as a demo on the page; record the audio to the same timings.

## Paintings

All public domain: William Bradford, Coast of Labrador; Martin Johnson Heade,
York Harbor, Coast of Maine (1877); John Frederick Kensett, Rocky Coast.
