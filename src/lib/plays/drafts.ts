import "server-only";
import type { ModelClient } from "@/lib/prospects/model";
import { writeEmail } from "@/lib/prospects/model";
import { DRAFTS_PER_STEP } from "@/lib/prospects/config";
import type { PlayKind } from "./catalog";
import { linksAllowed, playSystem, playUser } from "./prompt";
import type { PlayStore } from "./store";

// Writes the next few emails of the workspace's running plays (reactivation,
// closed lost, nurture, onboarding, expansion, trial users, events, speed to
// lead). Like Find leads' drafting step: each draft is reserved in the
// database before it is written (campaign_draft_claim), under the same daily
// draft and spend caps, so a call that repeats or overlaps writes nothing
// twice. Every draft then waits for a person's approval.

const LEAD_PLAYS = new Set<string>([
  "speed_to_lead",
  "reactivation",
  "closed_lost",
  "nurture",
  "onboarding",
  "expansion",
  "plg",
  "event_registration",
  "event_followup",
  "event_no_show",
]);

export type PlayDraftResult = {
  status: "ok" | "capped" | "not_found";
  written: number;
  failed: number;
  remaining: number;
};

export async function advancePlayDrafts(
  input: { workspaceId: string; userId: string; limit?: number },
  deps: { store: PlayStore; client: ModelClient },
): Promise<PlayDraftResult> {
  const { store, client } = deps;
  const claim = await store.claimDrafts(
    input.workspaceId,
    input.userId,
    input.limit ?? DRAFTS_PER_STEP,
  );
  if (!claim)
    return { status: "not_found", written: 0, failed: 0, remaining: 0 };
  if (claim.drafts.length === 0)
    return {
      status: claim.capped && claim.remaining > 0 ? "capped" : "ok",
      written: 0,
      failed: 0,
      remaining: claim.remaining,
    };
  const results = await Promise.all(
    claim.drafts.map(async ({ draft_id, play, lead, event }) => {
      try {
        if (!LEAD_PLAYS.has(play)) throw new Error(`unknown play ${play}`);
        const written = await writeEmail(client, {
          system: playSystem(claim.context),
          user: playUser(
            play as Exclude<PlayKind, "takeout">,
            lead,
            event && event.name ? event : null,
          ),
        });
        // A link we didn't give it is thrown away, never shown.
        const ok =
          written.ok &&
          linksAllowed(`${written.subject}\n${written.body}`, [
            claim.context.workspace.website,
            claim.context.booking_url,
            event?.link,
          ]);
        await store.saveDraft(
          input.workspaceId,
          draft_id,
          ok && written.ok
            ? {
                subject: written.subject,
                body: written.body,
                model: written.model,
              }
            : null,
          written.spend.cost_micros,
        );
        return ok;
      } catch (error) {
        console.error("[plays] draft failed:", (error as Error).message);
        await store
          .saveDraft(input.workspaceId, draft_id, null, 0)
          .catch(() => {});
        return false;
      }
    }),
  );
  const written = results.filter(Boolean).length;
  return {
    status: "ok",
    written,
    failed: results.length - written,
    remaining: claim.remaining,
  };
}
