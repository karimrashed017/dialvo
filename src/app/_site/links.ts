// Where the site's buttons lead. Dialvo is in early access: every "Join the
// waitlist" button opens the waitlist form (START_HREF), with the plan or the
// play filled in when there is one.

import { PLANS, START_HREF } from "@/lib/site";

/** "$99 a month", from PLANS. */
export const STARTER_DEAL = `$${PLANS.starter.price} a month`;

/** The waitlist form, optionally naming a plan or a play. */
export function startHref(
  opts: { plan?: "starter" | "pro"; play?: string } = {},
) {
  const q = new URLSearchParams();
  if (opts.plan) q.set("plan", opts.plan);
  if (opts.play) q.set("play", opts.play);
  const qs = q.toString();
  return qs ? `${START_HREF}?${qs}` : START_HREF;
}
