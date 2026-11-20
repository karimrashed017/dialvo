"use client";

import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/app/action";
import { cn } from "@/lib/utils";
import { btn, hint, input, labelCls } from "../../_ui/kit";

/** Makes a key and shows it once. It is never shown again or stored. */
export function KeyMaker({
  action,
  disabled,
}: {
  action: (form: FormData) => Promise<ActionResult>;
  disabled: boolean;
}) {
  const [pending, start] = useTransition();
  const [key, setKey] = useState("");
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
              setKey(r.message);
              setError("");
            } else setError(r.message ?? "That didn't go through.");
          });
        }}
      >
        <label className={cn(labelCls, "min-w-[200px] flex-1")}>
          Name
          <input
            name="name"
            maxLength={80}
            placeholder="Production app"
            disabled={disabled}
            className={cn(input, "mt-1")}
          />
        </label>
        <button
          type="submit"
          disabled={disabled || pending}
          className={btn.primary}
        >
          {pending ? "Making…" : "Make a key"}
        </button>
      </form>
      {error && (
        <p role="alert" className="text-[12.5px] text-[#B42318]">
          {error}
        </p>
      )}
      {key && (
        <div className="rounded-xl border border-black/15 p-3">
          <p className="text-[12.5px] font-medium">
            Your new key. Copy it now: it won&apos;t be shown again.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 rounded-lg bg-black/[0.05] px-2.5 py-1.5 text-[12.5px] break-all">
              {key}
            </code>
            <button
              type="button"
              className={cn(btn.secondary, btn.small)}
              onClick={() =>
                navigator.clipboard
                  ?.writeText(key)
                  .then(() => setCopied(true))
                  .catch(() => {})
              }
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className={cn(hint, "mt-2")}>
            Keep it on your server, never in a web page or an app people
            download.
          </p>
        </div>
      )}
    </div>
  );
}
