import "server-only";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./env";

/**
 * The client the public lead form writes with. It has no session and is only
 * ever used to call capture_lead(), which scopes everything to the workspace
 * that owns the form's token.
 *
 * With SUPABASE_SECRET_KEY set it calls as the service role. Without it, it
 * calls as anon with the publishable key, which the database allows for this
 * one function and nothing else. The secret key never leaves the server.
 */
export function createCaptureClient() {
  const key = process.env.SUPABASE_SECRET_KEY || SUPABASE_PUBLISHABLE_KEY;
  return createClient(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
