"use client";

import { createContext, use, useRef, useState, useTransition } from "react";
import type { ActionResult } from "@/lib/app/action";
import { cn } from "@/lib/utils";
import { btn } from "./kit";

// One way to send a form to a Server Action: it shows "Saving…" on the
// button, the action's message underneath, and keeps what was typed when the
// action says no.

const Pending = createContext(false);

export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = false,
  confirm,
  quiet = false,
  onDone,
}: {
  action: (form: FormData) => Promise<ActionResult>;
  children: React.ReactNode;
  className?: string;
  /** Clear the fields after a successful save (for "add" forms). */
  resetOnSuccess?: boolean;
  /** Ask before sending, for deletes. */
  confirm?: string;
  /** Don't show the success message (the page changing is the feedback). */
  quiet?: boolean;
  onDone?: (result: ActionResult) => void;
}) {
  const ref = useRef<HTMLFormElement>(null);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (confirm && !window.confirm(confirm)) return;
    const data = new FormData(event.currentTarget);
    // The button that was pressed carries a value too.
    const submitter = (event.nativeEvent as SubmitEvent)
      .submitter as HTMLButtonElement | null;
    if (submitter?.name) data.set(submitter.name, submitter.value);
    start(async () => {
      let outcome: ActionResult;
      try {
        outcome = await action(data);
      } catch {
        outcome = {
          ok: false,
          message:
            "That didn't go through. Check your connection and try again.",
        };
      }
      setResult(outcome);
      if (outcome.ok && resetOnSuccess) ref.current?.reset();
      onDone?.(outcome);
    });
  }

  const show = result?.message && !(result.ok && quiet);
  return (
    <form ref={ref} onSubmit={submit} className={className} noValidate={false}>
      <Pending value={pending}>{children}</Pending>
      {show && (
        <p
          role={result.ok ? "status" : "alert"}
          className={cn(
            "mt-2 text-[12.5px] leading-[1.45]",
            result.ok ? "text-[#0B0B0C]/60" : "text-[#B42318]",
          )}
        >
          {result.message}
        </p>
      )}
    </form>
  );
}

export function SubmitButton({
  children,
  variant = "primary",
  small,
  className,
  pendingText = "Saving…",
  ...rest
}: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "type"> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  small?: boolean;
  pendingText?: string;
}) {
  const pending = use(Pending);
  return (
    <button
      type="submit"
      disabled={pending || rest.disabled}
      className={cn(btn[variant], small && btn.small, className)}
      {...rest}
    >
      {pending ? pendingText : children}
    </button>
  );
}
