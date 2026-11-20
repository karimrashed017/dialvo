import "server-only";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "./env";

/**
 * Supabase with the secret key: no session, and row-level security does not
 * apply, so every caller must scope what it does to one workspace itself.
 * Only the agent runtime uses it, and only to call the two functions that do
 * that scoping in the database (chat_agent_context, chat_agent_commit).
 *
 * Null when SUPABASE_SECRET_KEY isn't set. The key never leaves the server.
 */
export function createServiceClient() {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key || !SUPABASE_URL) return null;
  return createClient(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
