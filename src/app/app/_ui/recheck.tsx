"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { btn } from "./kit";

/** Asks the server again, for "has the chat been seen on my site yet?". */
export function RecheckButton({ label = "Check again" }: { label?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      className={cn(btn.secondary, btn.small)}
      onClick={() => start(() => router.refresh())}
    >
      <RefreshCw
        aria-hidden
        className={cn("size-3.5", pending && "animate-spin")}
      />
      {pending ? "Checking…" : label}
    </button>
  );
}
