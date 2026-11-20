import { NextResponse, type NextRequest } from "next/server";
import { FIXTURES_ON } from "@/lib/app/fixture-flag";
import { FEATURES, PLAYS } from "@/lib/content/catalog";
import { APP_CONFIGURED } from "@/lib/supabase/env";
import { refreshSession } from "@/lib/supabase/session";

// Two jobs, by address.
//
// Marketing: a play or platform address that isn't in the catalog is answered
// with a real 404 here. Without this the dynamic routes would stream their
// shell with a 200 first and only then show "not found".
//
// The app: keeps the session cookies fresh, and saves people a wasted page
// load by sending them to /login when they plainly aren't signed in (and past
// it when they plainly are). This is a courtesy, not security: every page,
// action and route checks the user itself with getCurrentUser(), and the
// database's row-level security checks again.

function catalog(request: NextRequest, section: string) {
  const [, , slug, ...rest] = request.nextUrl.pathname.split("/");
  const known =
    rest.length === 0 &&
    Object.hasOwn(section === "plays" ? PLAYS : FEATURES, slug);
  if (known) return NextResponse.next();
  return NextResponse.rewrite(new URL("/_not-found", request.url), {
    status: 404,
  });
}

const SIGNED_OUT_ONLY = new Set(["/login", "/signup", "/forgot-password"]);

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const section = pathname.split("/")[1];
  if (section === "plays" || section === "platform")
    return catalog(request, section);

  // Nothing to check until the database is connected; the pages say so.
  if (!APP_CONFIGURED || FIXTURES_ON) return NextResponse.next();

  const { response, signedIn } = await refreshSession(request);
  const redirect = (to: string) => {
    const next = NextResponse.redirect(new URL(to, request.url));
    // Keep any refreshed session cookies on the redirect.
    for (const cookie of response.cookies.getAll()) next.cookies.set(cookie);
    return next;
  };
  if (!signedIn && (section === "app" || section === "onboarding"))
    return redirect(`/login?next=${encodeURIComponent(pathname + search)}`);
  if (signedIn && SIGNED_OUT_ONLY.has(pathname)) return redirect("/app");
  return response;
}

export const config = {
  matcher: [
    "/plays/:slug+",
    "/platform/:slug+",
    "/app/:path*",
    "/onboarding",
    "/login",
    "/signup",
    "/forgot-password",
    "/reset-password",
  ],
};
