"use server";

import { redirect } from "next/navigation";
import { safeNextPath } from "@/lib/auth/next-path";
import { requestOrigin } from "@/lib/auth/origin";
import { getCurrentUser } from "@/lib/auth/user";
import { cleanText, normalizeEmail } from "@/lib/leads/fields";
import { APP_CONFIGURED } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

// Sign-up, log-in, magic link and password reset. Each answers with a
// message for the form; a successful log-in redirects instead.

export type AuthState = {
  ok: boolean;
  message?: string;
  field?: string;
  /** The email the form was sent with, so it stays filled in. */
  email?: string;
};

const NOT_READY: AuthState = {
  ok: false,
  message: "Dialvo's app is still being set up.",
};
const TRY_LATER = "That didn't work just now. Please try again in a moment.";

const MIN_PASSWORD = 8;

function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD)
    return `Use at least ${MIN_PASSWORD} characters.`;
  if (password.length > 72) return "Use 72 characters or fewer.";
  return null;
}

const confirmUrl = (origin: string, next: string) =>
  `${origin}/auth/confirm?next=${encodeURIComponent(next)}`;

export async function logIn(_: AuthState, form: FormData): Promise<AuthState> {
  if (!APP_CONFIGURED) return NOT_READY;
  const email = normalizeEmail(form.get("email"));
  const password = String(form.get("password") ?? "");
  const raw = cleanText(form.get("email"), 254);
  if (!email)
    return {
      ok: false,
      field: "email",
      message: "Enter your email address.",
      email: raw,
    };
  if (!password)
    return {
      ok: false,
      field: "password",
      message: "Enter your password.",
      email,
    };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    if (error.code === "email_not_confirmed")
      return {
        ok: false,
        email,
        message:
          "Confirm your email first: we sent you a link when you signed up.",
      };
    if (error.code === "invalid_credentials" || error.status === 400)
      return {
        ok: false,
        email,
        message: "That email and password don't match.",
      };
    if (error.status === 429)
      return {
        ok: false,
        email,
        message: "Too many attempts. Wait a minute and try again.",
      };
    console.error("[auth] log in:", error.code, error.message);
    return { ok: false, email, message: TRY_LATER };
  }
  redirect(safeNextPath(String(form.get("next") ?? "")));
}

export async function sendMagicLink(
  _: AuthState,
  form: FormData,
): Promise<AuthState> {
  if (!APP_CONFIGURED) return NOT_READY;
  const email = normalizeEmail(form.get("email"));
  if (!email)
    return {
      ok: false,
      field: "email",
      message: "Enter your email address.",
      email: cleanText(form.get("email"), 254),
    };
  const supabase = await createClient();
  const next = safeNextPath(String(form.get("next") ?? ""));
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      // A link logs in an existing account; it never creates one.
      shouldCreateUser: false,
      emailRedirectTo: confirmUrl(await requestOrigin(), next),
    },
  });
  if (error?.status === 429)
    return {
      ok: false,
      email,
      message: "Too many emails requested. Wait a minute and try again.",
    };
  if (
    error &&
    error.code !== "otp_disabled" &&
    error.code !== "user_not_found" &&
    error.status !== 400 &&
    error.status !== 422
  ) {
    console.error("[auth] magic link:", error.code, error.message);
    return { ok: false, email, message: TRY_LATER };
  }
  // The same answer whether or not the address has an account.
  return {
    ok: true,
    email,
    message: `If ${email} has a Dialvo account, a log-in link is on its way. It works once, for an hour.`,
  };
}

export async function signUp(_: AuthState, form: FormData): Promise<AuthState> {
  if (!APP_CONFIGURED) return NOT_READY;
  const name = cleanText(form.get("name"), 120);
  const email = normalizeEmail(form.get("email"));
  const password = String(form.get("password") ?? "");
  const raw = cleanText(form.get("email"), 254);
  if (!name)
    return { ok: false, field: "name", message: "Add your name.", email: raw };
  if (!email)
    return {
      ok: false,
      field: "email",
      message: "That email doesn't look right.",
      email: raw,
    };
  const problem = passwordProblem(password);
  if (problem) return { ok: false, field: "password", message: problem, email };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { name },
      emailRedirectTo: confirmUrl(await requestOrigin(), "/onboarding"),
    },
  });
  if (error) {
    if (error.code === "weak_password")
      return {
        ok: false,
        field: "password",
        email,
        message: "Choose a stronger password: longer, and not a common one.",
      };
    if (error.code === "email_address_invalid")
      return {
        ok: false,
        field: "email",
        email,
        message: "That address can't receive email. Use a different one.",
      };
    if (error.code === "over_email_send_rate_limit")
      return {
        ok: false,
        email,
        message:
          "We've sent too many emails in the last hour. Please try again a little later.",
      };
    if (error.code === "signup_disabled")
      return {
        ok: false,
        email,
        message: "Sign-ups are closed right now. Please try again soon.",
      };
    if (error.status === 429)
      return {
        ok: false,
        email,
        message:
          "Too many sign-ups from here. Wait a few minutes and try again.",
      };
    console.error("[auth] sign up:", error.code, error.message);
    return { ok: false, email, message: TRY_LATER };
  }
  // With email confirmation off there is a session already.
  if (data.session) redirect("/onboarding");
  // With it on, the answer is the same for a new address and a taken one.
  return {
    ok: true,
    email,
    message: `Check ${email}: we've sent a link to confirm your address. If you already have an account, log in instead.`,
  };
}

export async function requestPasswordReset(
  _: AuthState,
  form: FormData,
): Promise<AuthState> {
  if (!APP_CONFIGURED) return NOT_READY;
  const email = normalizeEmail(form.get("email"));
  if (!email)
    return {
      ok: false,
      field: "email",
      message: "Enter your email address.",
      email: cleanText(form.get("email"), 254),
    };
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: confirmUrl(await requestOrigin(), "/reset-password"),
  });
  if (error?.status === 429)
    return {
      ok: false,
      email,
      message: "Too many emails requested. Wait a minute and try again.",
    };
  if (error) console.error("[auth] reset request:", error.code, error.message);
  return {
    ok: true,
    email,
    message: `If ${email} has a Dialvo account, a link to choose a new password is on its way.`,
  };
}

export async function setNewPassword(
  _: AuthState,
  form: FormData,
): Promise<AuthState> {
  if (!APP_CONFIGURED) return NOT_READY;
  const user = await getCurrentUser();
  if (!user)
    return {
      ok: false,
      message: "This link has expired or was already used. Ask for a new one.",
    };
  const password = String(form.get("password") ?? "");
  const problem = passwordProblem(password);
  if (problem) return { ok: false, field: "password", message: problem };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    if (error.code === "weak_password")
      return {
        ok: false,
        field: "password",
        message: "Choose a stronger password: longer, and not a common one.",
      };
    if (error.code === "same_password")
      return {
        ok: false,
        field: "password",
        message: "That's your current password. Choose a different one.",
      };
    console.error("[auth] new password:", error.code, error.message);
    return { ok: false, message: TRY_LATER };
  }
  redirect("/app");
}
