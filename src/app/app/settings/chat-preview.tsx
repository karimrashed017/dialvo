"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { btn } from "../_ui/kit";

type Handle = { open(): void; remove(): void };
type Registry = Record<string, Handle | true | undefined>;

/**
 * Shows the real widget on this page, loaded exactly as a customer's site
 * loads it. It is the live chat, not a mock-up: a message sent from it
 * arrives in the Inbox like any visitor's.
 */
export function ChatPreview({ src, token }: { src: string; token: string }) {
  const [on, setOn] = useState(false);

  useEffect(() => {
    if (!on) return;
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.dataset.open = "";
    document.body.appendChild(script);
    return () => {
      script.remove();
      const registry = (window as unknown as { __dialvoChat?: Registry })
        .__dialvoChat;
      const handle = registry?.[token];
      if (handle && handle !== true) handle.remove();
      else if (registry) delete registry[token];
    };
  }, [on, src, token]);

  return (
    <button
      type="button"
      aria-pressed={on}
      className={cn(btn.secondary, btn.small)}
      onClick={() => setOn((v) => !v)}
    >
      {on ? "Hide preview" : "Preview on this page"}
    </button>
  );
}
