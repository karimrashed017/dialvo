"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useActionState, useState } from "react";
import { ArrowRight, Check, Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  continueWithGoogle,
  logIn,
  requestPasswordReset,
  setNewPassword,
  signUp,
  type AuthState,
} from "./actions";

const field =
  "mt-1.5 w-full rounded-xl border border-black/15 bg-white px-3.5 py-3 text-[15px] text-[#0B0B0C] shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition outline-none placeholder:text-[#0B0B0C]/35 hover:border-black/30 focus:border-[#0B0B0C] focus:ring-4 focus:ring-black/[0.07] aria-[invalid=true]:border-[#B42318]";
const label = "block text-[13px] font-medium text-[#0B0B0C]/80";
const link =
  "font-medium text-[#0B0B0C] underline decoration-black/25 underline-offset-[3px] hover:decoration-black";

const start: AuthState = { ok: false };

function Submit({ pending, children }: { pending: boolean; children: string }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[#0B0B0C] text-[15px] font-medium text-white transition hover:bg-black disabled:opacity-60"
    >
      {pending ? "One moment…" : children}
      {!pending && <ArrowRight className="size-4" aria-hidden />}
    </button>
  );
}

function Problem({ state }: { state: AuthState }) {
  if (state.ok || !state.message) return null;
  return (
    <p role="alert" className="mt-4 text-[14px] leading-[1.45] text-[#B42318]">
      {state.message}
    </p>
  );
}

function Sent({ message }: { message: string }) {
  return (
    <div
      role="status"
      className="rounded-3xl border border-black/10 bg-white px-6 py-8 text-center shadow-[0_20px_60px_-30px_rgba(0,0,0,0.25)]"
    >
      <span className="mx-auto flex size-11 items-center justify-center rounded-full bg-[#0B0B0C] text-white">
        <Check className="size-5" aria-hidden />
      </span>
      <p className="mt-4 text-[15px] leading-[1.55] text-[#0B0B0C]/75">
        {message}
      </p>
    </div>
  );
}

/** Google's "G", in Google's own colours as its brand rules ask. */
function GoogleG() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden className="size-[18px]">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.33-1.58-5.04-3.71H.96v2.33A9 9 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.96 10.71A5.41 5.41 0 0 1 3.68 9c0-.6.1-1.17.28-1.71V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.04l3-2.33z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3 2.33C4.67 5.16 6.66 3.58 9 3.58z"
      />
    </svg>
  );
}

/** "Continue with Google", then a rule before the email form. */
function GoogleFirst({ next, show }: { next: string; show: boolean }) {
  if (!show) return null;
  return (
    <>
      <form action={continueWithGoogle}>
        <input type="hidden" name="next" value={next} />
        <button
          type="submit"
          className="flex h-12 w-full items-center justify-center gap-3 rounded-full border border-black/15 bg-white text-[15px] font-medium shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition hover:border-black/30 hover:bg-black/[0.02] focus-visible:ring-4 focus-visible:ring-black/[0.07] focus-visible:outline-none"
        >
          <GoogleG />
          Continue with Google
        </button>
      </form>
      <div className="my-6 flex items-center gap-4 text-[12.5px] text-[#0B0B0C]/45">
        <span className="h-px flex-1 bg-black/10" />
        or with your email
        <span className="h-px flex-1 bg-black/10" />
      </div>
    </>
  );
}

/** A password box with a show/hide button. */
function PasswordInput(props: React.ComponentProps<"input">) {
  const [shown, setShown] = useState(false);
  return (
    <span className="relative block">
      <input
        {...props}
        name="password"
        type={shown ? "text" : "password"}
        required
        maxLength={72}
        className={`${field} pr-11`}
      />
      <button
        type="button"
        onClick={() => setShown((v) => !v)}
        aria-label={shown ? "Hide password" : "Show password"}
        className="absolute top-1.5 right-1.5 bottom-0 flex w-9 items-center justify-center rounded-lg text-[#0B0B0C]/45 hover:text-[#0B0B0C]"
      >
        {shown ? (
          <EyeOff aria-hidden className="size-4" />
        ) : (
          <Eye aria-hidden className="size-4" />
        )}
      </button>
    </span>
  );
}

const LINK_ERRORS: Record<string, string> = {
  google:
    "Google didn't finish signing you in. Try again, or use your email below.",
  link: "That link has expired or was already used. Log in, or ask for a new one.",
};

export function LoginForm({ google = false }: { google?: boolean }) {
  const params = useSearchParams();
  const next = params.get("next") ?? "";
  const linkError = LINK_ERRORS[params.get("error") ?? ""];
  const [state, action, pending] = useActionState(logIn, start);

  return (
    <>
      <GoogleFirst next={next} show={google} />
      {linkError && !state.message && (
        <p role="alert" className="mb-4 text-[14px] text-[#B42318]">
          {linkError}
        </p>
      )}
      <form action={action}>
        <input type="hidden" name="next" value={next} />
        <label className={label}>
          Email
          <input
            name="email"
            type="email"
            required
            maxLength={254}
            autoComplete="email"
            defaultValue={state.email ?? ""}
            aria-invalid={state.field === "email"}
            className={field}
          />
        </label>
        <label className={`${label} mt-4`}>
          <span className="flex items-baseline justify-between">
            Password
            <Link
              href="/forgot-password"
              className="text-[12.5px] font-normal text-[#0B0B0C]/55 hover:text-[#0B0B0C]"
            >
              Forgot it?
            </Link>
          </span>
          <PasswordInput
            autoComplete="current-password"
            aria-invalid={state.field === "password"}
          />
        </label>
        <Problem state={state} />
        <Submit pending={pending}>Log in</Submit>
      </form>
    </>
  );
}

export function SignupForm({ google = false }: { google?: boolean }) {
  const [state, action, pending] = useActionState(signUp, start);
  if (state.ok && state.message) return <Sent message={state.message} />;
  return (
    <>
      <GoogleFirst next="" show={google} />
      <form action={action}>
        <label className={label}>
          Your name
          <input
            name="name"
            required
            maxLength={120}
            autoComplete="name"
            aria-invalid={state.field === "name"}
            className={field}
          />
        </label>
        <label className={`${label} mt-4`}>
          Work email
          <input
            name="email"
            type="email"
            required
            maxLength={254}
            autoComplete="email"
            defaultValue={state.email ?? ""}
            aria-invalid={state.field === "email"}
            className={field}
          />
        </label>
        <label className={`${label} mt-4`}>
          Password
          <PasswordInput
            minLength={8}
            autoComplete="new-password"
            aria-invalid={state.field === "password"}
            aria-describedby="password-hint"
          />
          <span
            id="password-hint"
            className="mt-1.5 block text-[12.5px] font-normal text-[#0B0B0C]/50"
          >
            At least 8 characters.
          </span>
        </label>
        <Problem state={state} />
        <Submit pending={pending}>Create your account</Submit>
        <p className="mt-4 text-[12.5px] leading-[1.5] text-[#0B0B0C]/45">
          By signing up you agree to the{" "}
          <Link href="/terms" className="underline underline-offset-2">
            terms
          </Link>{" "}
          and the{" "}
          <Link href="/privacy" className="underline underline-offset-2">
            privacy policy
          </Link>
          .
        </p>
      </form>
    </>
  );
}

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, start);
  if (state.ok && state.message) return <Sent message={state.message} />;
  return (
    <form action={action}>
      <label className={label}>
        Email
        <input
          name="email"
          type="email"
          required
          maxLength={254}
          autoComplete="email"
          defaultValue={state.email ?? ""}
          aria-invalid={state.field === "email"}
          className={field}
        />
      </label>
      <Problem state={state} />
      <Submit pending={pending}>Send the link</Submit>
    </form>
  );
}

export function NewPasswordForm() {
  const [state, action, pending] = useActionState(setNewPassword, start);
  return (
    <form action={action}>
      <label className={label}>
        New password
        <PasswordInput
          minLength={8}
          autoComplete="new-password"
          aria-invalid={state.field === "password"}
        />
        <span className="mt-1.5 block text-[12.5px] font-normal text-[#0B0B0C]/50">
          At least 8 characters.
        </span>
      </label>
      <Problem state={state} />
      {!state.ok && state.message?.includes("expired") && (
        <p className="mt-2 text-[14px]">
          <Link href="/forgot-password" className={link}>
            Ask for a new link
          </Link>
        </p>
      )}
      <Submit pending={pending}>Save and continue</Submit>
    </form>
  );
}
