// The design preview: the app shell drawn with made-up data, for checking the
// look without a database. It exists only in development. NODE_ENV is fixed to
// "production" by `next build` and `next start` and is compiled into the
// code, so in a deployed build this is the constant `false` and the preview
// data (src/lib/app/fixtures.ts) is never even loaded. It also needs an
// explicit switch, so a developer's real local session is never replaced by
// accident.
export const FIXTURES_ON =
  process.env.NODE_ENV !== "production" &&
  process.env.DIALVO_DEV_FIXTURES === "1";
