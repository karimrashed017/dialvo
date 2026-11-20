import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./env";

/**
 * Supabase as the signed-in person, from their session cookies. Row-level
 * security applies to everything it does. For Server Components, Server
 * Actions and Route Handlers; call it per request, never share one.
 */
export async function createClient() {
  // Everything done with a session depends on the request and on the clock
  // (tokens expire), so none of it may be prerendered or prefetched ahead of
  // the request. This tells Next.js so.
  await connection();
  const store = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll(list) {
        try {
          for (const { name, value, options } of list)
            store.set(name, value, options);
        } catch {
          // A Server Component can't write cookies. The proxy refreshes the
          // session on the way in, so there is nothing to lose here.
        }
      },
    },
  });
}

export type Supabase = Awaited<ReturnType<typeof createClient>>;
