import "server-only";
import { cacheLife } from "next/cache";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/supabase/env";

/**
 * Whether "Continue with Google" is switched on in Supabase. Asked of the
 * project itself, so the button appears when the founder enables the provider
 * and never leads to an error page before then. Cached for a few minutes.
 */
export async function googleLoginEnabled(): Promise<boolean> {
  "use cache";
  cacheLife("minutes");
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { external?: { google?: boolean } };
    return data.external?.google === true;
  } catch {
    return false;
  }
}
