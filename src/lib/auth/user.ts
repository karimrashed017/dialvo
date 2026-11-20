import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { APP_CONFIGURED } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export type CurrentUser = { id: string; email: string };

/**
 * The signed-in person, or null. Every page, Server Action and Route Handler
 * that needs a user calls this (or requireUser); the proxy's redirect is a
 * courtesy, not a check. The session's token is verified, not just read: a
 * forged cookie yields null.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  if (!APP_CONFIGURED) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) return null;
  return {
    id: claims.sub,
    email: typeof claims.email === "string" ? claims.email : "",
  };
});

/** The signed-in person, or off to the login page. */
export async function requireUser(next = "/app"): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  return user;
}
