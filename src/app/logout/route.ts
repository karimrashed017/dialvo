import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { APP_CONFIGURED } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

// Logging out is a POST (the button in the user menu), so a link or an image
// on another site can't sign anyone out. Visiting /logout just goes home.

export async function POST(request: NextRequest) {
  // Only our own pages may post here.
  const origin = request.headers.get("origin");
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (origin && host && new URL(origin).host !== host)
    return new NextResponse(null, { status: 403 });
  if (APP_CONFIGURED) {
    const supabase = await createClient();
    await supabase.auth.signOut({ scope: "local" });
  }
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}

export function GET(request: NextRequest) {
  return NextResponse.redirect(new URL("/app", request.url));
}
