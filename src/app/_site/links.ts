// Where the site's buttons lead. Dialvo is pre-launch: every "Get early
// access" or "Start free" button opens an email to us (START_HREF), with the
// plan or brief in the email when there is one.

import { PLANS, START_HREF } from "@/lib/site";

/** "$99 a month", from PLANS. */
export const STARTER_DEAL = `$${PLANS.starter.price} a month`;

/** The early access email, optionally naming a plan or a brief. */
export function startHref(
  opts: { plan?: "starter" | "pro"; brief?: string } = {},
) {
  const lines = [
    opts.plan && `I'd like the ${PLANS[opts.plan].name} plan.`,
    opts.brief && `Who I'd like Dialvo to call: ${opts.brief}`,
  ].filter(Boolean);
  return lines.length
    ? `${START_HREF}&body=${encodeURIComponent(lines.join("\n\n"))}`
    : START_HREF;
}
