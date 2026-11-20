"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { btn, hint } from "../_ui/kit";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Keeps a run moving while this page is open: asks the server to do the
 * run's next step, shows what changed, and asks again. Each step is short
 * and leased on the server, so a second tab, or coming back to the page
 * later, simply carries on from where the run is. Draws nothing.
 */
export function RunDriver({ runId }: { runId: string }) {
  const router = useRouter();
  useEffect(() => {
    let live = true;
    (async () => {
      let failures = 0;
      while (live) {
        if (document.hidden) {
          await wait(2000);
          continue;
        }
        let status = "error";
        try {
          const response = await fetch(`/api/prospects/runs/${runId}/advance`, {
            method: "POST",
          });
          const body = (await response.json()) as { status?: string };
          status = body.status ?? "error";
        } catch {
          // The network dropped: try again shortly.
        }
        if (!live) return;
        router.refresh();
        if (
          [
            "done",
            "stopped",
            "failed",
            "not_found",
            "not_configured",
            "not_allowed",
          ].includes(status)
        )
          return;
        failures =
          status === "error" || status === "limited" ? failures + 1 : 0;
        if (failures > 5) return;
        // Someone else has the step, or something went wrong: wait longer.
        await wait(
          status === "busy"
            ? 3000
            : status === "error" || status === "limited"
              ? 6000
              : 1200,
        );
      }
    })();
    return () => {
      live = false;
    };
  }, [runId, router]);
  return null;
}

/**
 * "Write first emails": asks the server for a few drafts at a time until
 * none are left to write, showing each batch as it lands.
 */
export function DraftWriter({
  waiting,
  disabled,
}: {
  /** Kept prospects with an email address and no draft yet. */
  waiting: number;
  disabled: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  async function run() {
    setBusy(true);
    setNote("");
    let written = 0;
    let failed = 0;
    let message = "";
    for (let step = 0; step < 60 && live.current; step++) {
      let body: {
        ok?: boolean;
        status?: string;
        written?: number;
        failed?: number;
        remaining?: number;
      };
      try {
        const response = await fetch("/api/prospects/drafts/advance", {
          method: "POST",
        });
        body = await response.json();
      } catch {
        message = "Lost the connection. Press the button to carry on.";
        break;
      }
      written += body.written ?? 0;
      failed += body.failed ?? 0;
      router.refresh();
      if (body.status === "not_configured") {
        message =
          "Writing emails isn't switched on yet on Dialvo's side. Nothing was written.";
        break;
      }
      if (body.status === "capped") {
        message =
          "That's today's limit for first emails in this workspace. The rest can be written tomorrow.";
        break;
      }
      if (!body.ok) {
        message = "Something went wrong. Press the button to carry on.";
        break;
      }
      if ((body.written ?? 0) + (body.failed ?? 0) === 0) break;
      await wait(400);
    }
    if (!live.current) return;
    setBusy(false);
    setNote(
      [
        written > 0 && `${written} written.`,
        failed > 0 &&
          `${failed} couldn't be written to our standard and ${failed === 1 ? "was" : "were"} left out.`,
        message,
      ]
        .filter(Boolean)
        .join(" ") || "Nothing to write.",
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <button
        type="button"
        onClick={run}
        disabled={busy || disabled || waiting === 0}
        className={cn(btn.primary)}
      >
        {busy
          ? "Writing…"
          : waiting > 0
            ? `Write ${waiting} first ${waiting === 1 ? "email" : "emails"}`
            : "Write first emails"}
      </button>
      {note && (
        <p role="status" className={hint}>
          {note}
        </p>
      )}
    </div>
  );
}
