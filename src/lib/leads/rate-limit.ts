// A small sliding-window brake, kept in this server instance's memory. It
// slows one address hammering the public lead form; the database has its own
// per-form limit behind it (see capture_lead), which is the one that holds
// across instances.

export function createLimiter({
  windowMs,
  max,
}: {
  windowMs: number;
  max: number;
}) {
  const hits = new Map<string, number[]>();
  return {
    /** Seconds to wait, or 0 if this one may go ahead (and is counted). */
    take(key: string, now: number = Date.now()): number {
      const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
      if (recent.length >= max) {
        hits.set(key, recent);
        return Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000));
      }
      recent.push(now);
      hits.set(key, recent);
      // Keep the table from growing without end on a long-lived instance.
      if (hits.size > 5000)
        for (const [k, times] of hits)
          if (times.every((t) => now - t >= windowMs)) hits.delete(k);
      return 0;
    },
    reset: () => hits.clear(),
  };
}

/** The public lead form: 10 posts a minute from one address. */
export const captureLimit = createLimiter({ windowMs: 60_000, max: 10 });
