"use client";

import { useEffect } from "react";

// Links to a section of the page you're on (the nav's Product, Listen and
// FAQ, the hero's buttons) glide there slowly instead of jumping. Runs in
// the capture phase and marks the click handled, so Next's <Link> skips its
// own instant jump; other click handlers still run (the mobile menu still
// closes). Less motion asked for: a plain jump.

const NAV_ROOM = 88; // the floating nav's height, so headings aren't hidden

function ease(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function glideTo(y: number) {
  const from = window.scrollY;
  const distance = y - from;
  // Slow and even: over a second for a short hop, up to 2.4s for the page.
  const duration = Math.min(Math.max(Math.abs(distance) * 0.6, 1200), 2400);
  const start = performance.now();
  const step = (now: number) => {
    const t = Math.min((now - start) / duration, 1);
    window.scrollTo(0, from + distance * ease(t));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function SmoothAnchors() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = (e.target as Element | null)?.closest?.("a[href]");
      if (!(link instanceof HTMLAnchorElement)) return;
      const url = new URL(link.href, window.location.href);
      if (!url.hash || url.origin !== window.location.origin) return;
      if (url.pathname !== window.location.pathname) return;
      const target = document.getElementById(
        decodeURIComponent(url.hash.slice(1)),
      );
      if (!target) return;
      e.preventDefault();
      const y = target.getBoundingClientRect().top + window.scrollY - NAV_ROOM;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        window.scrollTo(0, y);
      } else {
        glideTo(y);
      }
      history.pushState(null, "", url.hash);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
  return null;
}
