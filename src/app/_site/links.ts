// Where the site's buttons lead. Dialvo is in early access: every "Get early
// access" button opens an email to us (START_HREF), with the plan or the play
// in the email when there is one.

import { PLANS, START_HREF } from "@/lib/site";

/** "$99 a month", from PLANS. */
export const STARTER_DEAL = `$${PLANS.starter.price} a month`;

/** The early access email, optionally naming a plan or a play. */
export function startHref(
  opts: { plan?: "starter" | "pro"; play?: string } = {},
) {
  const lines = [
    opts.plan && `I'd like the ${PLANS[opts.plan].name} plan.`,
    opts.play && `The play I'd like to run first: ${opts.play}`,
  ].filter(Boolean);
  return lines.length
    ? `${START_HREF}&body=${encodeURIComponent(lines.join("\n\n"))}`
    : START_HREF;
}
