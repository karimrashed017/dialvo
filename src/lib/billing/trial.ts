import { CONTACT_EMAIL, TRIAL } from "@/lib/site";

// The free trial's clock, and the one switch that decides whether the end of
// a trial stops anything.
//
// Until customers can pay (checkout doesn't exist yet), nothing is blocked
// when a trial ends: locking someone out with no way to pay would be wrong.
// Set BILLING_ENFORCED=1 on the server once checkout is live, and a workspace
// whose trial has ended without a paid plan is "locked": its agent stops
// replying, the chat widget tells visitors the team will reply, and the app
// asks for a plan.

export type BillingStatus = "trialing" | "active" | "past_due" | "canceled";

export type TrialInfo = {
  trial_ends_at?: string | null;
  billing_status?: string | null;
};

export type TrialState = {
  /** "trial": still running. "ended": no paid plan. "paid": a plan is active. */
  phase: "trial" | "ended" | "paid";
  /** Whole days left, rounded up. 0 once the trial has ended. */
  daysLeft: number;
  /** The agent must not act. Only ever true with BILLING_ENFORCED=1. */
  locked: boolean;
};

const DAY_MS = 86_400_000;

/** True only when the server is told to enforce: BILLING_ENFORCED=1. */
export function billingEnforced(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.BILLING_ENFORCED === "1";
}

export function trialState(
  workspace: TrialInfo,
  now: Date = new Date(),
  enforced: boolean = billingEnforced(),
): TrialState {
  if (workspace.billing_status === "active")
    return { phase: "paid", daysLeft: 0, locked: false };
  const ends = workspace.trial_ends_at
    ? new Date(workspace.trial_ends_at).getTime()
    : NaN;
  // A workspace whose dates can't be read is never locked out by mistake.
  if (Number.isNaN(ends))
    return { phase: "trial", daysLeft: TRIAL.days, locked: false };
  const left = ends - now.getTime();
  const lapsed =
    workspace.billing_status === "past_due" ||
    workspace.billing_status === "canceled";
  if (left > 0 && !lapsed)
    return {
      phase: "trial",
      daysLeft: Math.ceil(left / DAY_MS),
      locked: false,
    };
  return { phase: "ended", daysLeft: 0, locked: enforced };
}

/**
 * Where the workspace stands, in a few words, for under its name:
 * "Free trial · 6 days left", "Free trial ended", or the plan once it is paid.
 */
export function planLine(state: TrialState, planName: string): string {
  if (state.phase === "paid") return `${planName} plan`;
  if (state.phase === "ended") return "Free trial ended";
  return `Free trial · ${state.daysLeft} ${state.daysLeft === 1 ? "day" : "days"} left`;
}

export type TrialBanner = {
  text: string;
  /** What to do about it, when there is something to do. */
  action?: { label: string; href: string };
  /** The trial is over: shown more firmly. */
  ended: boolean;
};

/** The line across the top of the app. Null when a plan is active. */
export function trialBanner(state: TrialState): TrialBanner | null {
  if (state.phase === "paid") return null;
  if (state.phase === "trial")
    return {
      ended: false,
      text:
        state.daysLeft === 1
          ? "1 day left in your free trial"
          : `${state.daysLeft} days left in your free trial`,
    };
  if (state.locked)
    return {
      ended: true,
      text: "Your free trial has ended. Your agent has stopped replying, and chats wait for your team in the Inbox. Pick a plan to switch it back on.",
      action: { label: "Pick a plan", href: "/pricing" },
    };
  return {
    ended: true,
    text: "Your free trial has ended. Paid plans are coming: nothing has been switched off. Email us to stay on.",
    action: { label: CONTACT_EMAIL, href: `mailto:${CONTACT_EMAIL}` },
  };
}
