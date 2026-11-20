// Whether the app's database is connected. The two public values are safe in
// the browser (the publishable key only ever acts under row-level security);
// Next.js inlines them at build time, so adding them needs a redeploy.

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

/** False until the project's URL and publishable key are set. */
export const APP_CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
