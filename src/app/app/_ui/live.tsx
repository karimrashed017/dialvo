"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Keeps a page current without a reload: asks the server for it again every
 * few seconds while the tab is in view, and at once when the tab comes back.
 * What someone is typing is kept (only the server-rendered parts change).
 */
export function LiveRefresh({ every = 5000 }: { every?: number }) {
  const router = useRouter();
  useEffect(() => {
    const tick = () => {
      if (!document.hidden) router.refresh();
    };
    const timer = setInterval(tick, every);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [router, every]);
  return null;
}
