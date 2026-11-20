"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useActionState, useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  logIn,
  requestPasswordReset,
  sendMagicLink,
  setNewPassword,
  signUp,
  type AuthState,
} from "./actions";

const field =
  "mt-1.5 w-full rounded-xl border border-black/15 bg-white px-3.5 py-2.5 text-[15px] text-[#0B0B0C] outline-none placeholder:text-[#0B0B0C]/35 focus:border-[#1F3BFF] focus:ring-2 focus:ring-[#1F3BFF]/20 aria-[invalid=true]:border-[#B42318]";
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
    <div role="status" className="py-2 text-center">
      <span className="mx-auto flex size-11 items-center justify-center rounded-full bg-[#1F3BFF] text-white">
        <Check className="size-5" aria-hidden />
      </span>
      <p className="mt-4 text-[15px] leading-[1.55] text-[#0B0B0C]/75">
        {message}
      </p>
    </div>
  );
}

const LINK_ERRORS: Record<string, string> = {
  link: "That link has expired or was already used. Log in, or ask for a new one.",
};

export function LoginForm() {
  const params = useSearchParams();
  const next = params.get("next") ?? "";
  const linkError = LINK_ERRORS[params.get("error") ?? ""];
  const [mode, setMode] = useState<"password" | "link">("password");
  const [password, passwordAction, passwordPending] = useActionState(
    logIn,
    start,
  );
  const [magic, magicAction, magicPending] = useActionState(
    sendMagicLink,
    start,
  );
  const state = mode === "password" ? password : magic;

  if (mode === "link" && magic.ok && magic.message)
    return <Sent message={magic.message} />;

  return (
    <>
      <div
        role="tablist"
        aria-label="How to log in"
        className="mb-5 grid grid-cols-2 rounded-full bg-black/[0.05] p-1 text-[13.5px] font-medium"
      >
        {(
          [
            ["password", "Password"],
            ["link", "Email me a link"],
          ] as const
        ).map(([id, text]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={mode === id}
            onClick={() => setMode(id)}
            className={cn(
              "h-9 rounded-full transition",
              mode === id
                ? "bg-white shadow-[0_1px_2px_rgba(0,0,0,0.12)]"
                : "text-[#0B0B0C]/55 hover:text-[#0B0B0C]",
            )}
          >
            {text}
          </button>
        ))}
      </div>
      {linkError && !state.message && (
        <p role="alert" className="mb-4 text-[14px] text-[#B42318]">
          {linkError}
        </p>
      )}
      <form action={mode === "password" ? passwordAction : magicAction}>
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
        {mode === "password" && (
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
            <input
              name="password"
              type="password"
              required
              maxLength={72}
              autoComplete="current-password"
              aria-invalid={state.field === "password"}
              className={field}
            />
          </label>
        )}
        {mode === "link" && (
          <p className="mt-3 text-[13px] leading-[1.5] text-[#0B0B0C]/55">
            We&apos;ll email a link that logs you in. No password needed.
          </p>
        )}
        <Problem state={state} />
        <Submit pending={passwordPending || magicPending}>
          {mode === "password" ? "Log in" : "Email me a link"}
        </Submit>
      </form>
    </>
  );
}

export function SignupForm() {
  const [state, action, pending] = useActionState(signUp, start);
  if (state.ok && state.message) return <Sent message={state.message} />;
  return (
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
        <input
          name="password"
          type="password"
          required
          minLength={8}
          maxLength={72}
          autoComplete="new-password"
          aria-invalid={state.field === "password"}
          aria-describedby="password-hint"
          className={field}
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
      <p className="mt-3 text-center text-[12px] leading-[1.5] text-[#0B0B0C]/45">
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
        <input
          name="password"
          type="password"
          required
          minLength={8}
          maxLength={72}
          autoComplete="new-password"
          aria-invalid={state.field === "password"}
          className={field}
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
