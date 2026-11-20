import "server-only";
import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { safeNextPath } from "@/lib/auth/next-path";
import { APP_CONFIGURED } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

// Where the links in auth emails land: confirming a new address, a magic
// link, a password reset. Two link shapes are accepted:
//   ?token_hash=...&type=...  (the email templates in docs/app-setup.md;
//                              works in any browser or device)
//   ?code=...                 (Supabase's default templates; only works in
//                              the browser that asked for the email)
// Either way the visitor ends up signed in and is sent to `next`, which is
// only ever a path inside the app.

const TYPES = new Set<EmailOtpType>([
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
]);

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const failed = NextResponse.redirect(
    new URL("/login?error=link", request.url),
  );
  if (!APP_CONFIGURED) return failed;

  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");
  // A recovery link always leads to choosing a new password.
  const next =
    type === "recovery"
      ? "/reset-password"
      : safeNextPath(searchParams.get("next"));

  const supabase = await createClient();
  if (tokenHash && type && TYPES.has(type)) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) return NextResponse.redirect(new URL(next, request.url));
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, request.url));
  }
  return failed;
}
