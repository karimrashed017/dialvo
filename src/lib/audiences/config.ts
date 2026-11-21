// Every limit on ad audiences, in one place. Exports cost nothing outside
// Dialvo: the files are made here and downloaded; nothing is sent to an ad
// platform (direct sync needs each platform's partner approval, which
// Dialvo doesn't have).

/** Audiences a workspace may save. */
export const AUDIENCES_MAX = 50;

/** Rows in one export file, at most (the rest are left out and the page says so). */
export const AUDIENCE_EXPORT_MAX_ROWS = 20_000;
