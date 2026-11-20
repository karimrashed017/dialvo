import "server-only";

/** CRM sync runs only where the server has the secret key. */
export function crmRuntimeStatus(): { on: boolean } {
  return { on: Boolean(process.env.SUPABASE_SECRET_KEY) };
}
