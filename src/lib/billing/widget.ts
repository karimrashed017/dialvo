import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { billingEnforced, trialState, type TrialInfo } from "./trial";

/**
 * Whether the workspace behind a chat widget is locked: its trial is over,
 * it has no paid plan, and billing is enforced. Always false while
 * BILLING_ENFORCED isn't 1, and false whenever the answer can't be read:
 * a failed lookup must never switch a paying customer's agent off.
 */
export async function widgetLocked(token: string): Promise<boolean> {
  if (!billingEnforced()) return false;
  const supabase = createServiceClient();
  if (!supabase) return false;
  const { data, error } = await supabase.rpc("chat_billing_state", {
    p_token: token,
  });
  if (error || !data) {
    if (error) console.error("[billing] could not read a trial:", error.code);
    return false;
  }
  return trialState(data as TrialInfo).locked;
}
