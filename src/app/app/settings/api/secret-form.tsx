"use client";

import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/app/action";
import { cn } from "@/lib/utils";
import { btn, hint } from "../../_ui/kit";

/**
 * A form whose action answers with a secret (field "key"), shown once with a
 * Copy button. The secret is never stored in the page or shown again.
 */
export function SecretForm({
  action,
  children,
  submit,
  pendingText,
  disabled,
  reveal,
  note,
  className,
  confirm,
}: {
  action: (form: FormData) => Promise<ActionResult>;
  children?: React.ReactNode;
  submit: string;
  pendingText: string;
  disabled?: boolean;
  reveal: string;
  note: string;
  className?: string;
  confirm?: string;
}) {
  const [pending, start] = useTransition();
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  return (
    <div className={cn("space-y-3", className)}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (confirm && !window.confirm(confirm)) return;
          const data = new FormData(e.currentTarget);
          start(async () => {
            const r = await action(data).catch(
              () =>
                ({
                  ok: false,
                  message: "That didn't go through.",
                }) as ActionResult,
            );
            if (r.ok && r.field === "key" && r.message) {
              setSecret(r.message);
              setCopied(false);
              setError("");
            } else setError(r.message ?? "That didn't go through.");
          });
        }}
      >
        {children}
        <button
          type="submit"
          disabled={disabled || pending}
          className={cn(btn.primary, btn.small)}
        >
          {pending ? pendingText : submit}
        </button>
      </form>
      {error && (
        <p role="alert" className="text-[12.5px] text-[#B42318]">
          {error}
        </p>
      )}
      {secret && (
        <div className="rounded-xl border border-black/15 p-3">
          <p className="text-[12.5px] font-medium">{reveal}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 rounded-lg bg-black/[0.05] px-2.5 py-1.5 text-[12.5px] break-all">
              {secret}
            </code>
            <button
              type="button"
              className={cn(btn.secondary, btn.small)}
              onClick={() =>
                navigator.clipboard
                  ?.writeText(secret)
                  .then(() => setCopied(true))
                  .catch(() => {})
              }
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className={cn(hint, "mt-2")}>{note}</p>
        </div>
      )}
    </div>
  );
}
