"use client";

import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/app/action";
import { cn } from "@/lib/utils";
import { btn, hint } from "../../_ui/kit";

/**
 * A form whose action answers with a secret (a key or an address) shown
 * once, here, with a copy button. It is never shown again or stored.
 */
export function SecretOnce({
  action,
  children,
  submit,
  pendingText = "Making…",
  disabled = false,
  note,
}: {
  action: (form: FormData) => Promise<ActionResult>;
  children?: React.ReactNode;
  submit: string;
  pendingText?: string;
  disabled?: boolean;
  note: string;
}) {
  const [pending, start] = useTransition();
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-3">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
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
          <p className="text-[12.5px] font-medium">
            Copy it now: it won&apos;t be shown again.
          </p>
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
