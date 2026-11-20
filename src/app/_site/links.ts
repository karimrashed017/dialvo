// Where the site's buttons lead: every "Start free" button opens sign-up
// (START_HREF), carrying the plan or the play when there is one.

import { PLANS, START_HREF } from "@/lib/site";

/** "$99 a month", from PLANS. */
export const STARTER_DEAL = `$${PLANS.starter.price} a month`;

/** Sign-up, optionally naming a plan or a play. */
export function startHref(
  opts: { plan?: "starter" | "pro" | "scale"; play?: string } = {},
) {
  const q = new URLSearchParams();
  if (opts.plan) q.set("plan", opts.plan);
  if (opts.play) q.set("play", opts.play);
  const qs = q.toString();
  return qs ? `${START_HREF}?${qs}` : START_HREF;
}
