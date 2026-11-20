import "server-only";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./env";

/**
 * The client the public endpoints write with: the lead form and the website
 * chat. It has no session and is only ever used to call the functions made
 * for visitors (capture_lead, chat_widget_info, chat_start, chat_post,
 * chat_poll), each of which scopes everything to the workspace that owns the
 * public token it is given.
 *
 * With SUPABASE_SECRET_KEY set it calls as the service role. Without it, it
 * calls as anon with the publishable key, which the database allows for
 * those functions and nothing else. The secret key never leaves the server.
 */
export function createCaptureClient() {
  const key = process.env.SUPABASE_SECRET_KEY || SUPABASE_PUBLISHABLE_KEY;
  return createClient(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
