import "server-only";
import {
  G2_PAGES_PER_PULL,
  INTENT_ROWS_PER_CALL,
} from "@/lib/integrations/config";
import { G2Problem, pullG2 } from "./g2";
import type { IntentStore } from "./store";

// The daily G2 pull: one due connection per call. Rows go to the database in
// batches; the token is never logged or stored anywhere else.

export async function pullIntentStep(deps: {
  store: IntentStore;
  fetch: typeof fetch;
}): Promise<{ pulled: number; added: number } | null> {
  const claim = await deps.store.pullClaim();
  if (!claim) return null;
  // From the day before the last pull, so a day G2 filled in late isn't missed.
  const since = new Date(new Date(claim.since).getTime() - 86_400_000)
    .toISOString()
    .slice(0, 10);
  try {
    const rows = await pullG2(
      claim.token,
      since,
      G2_PAGES_PER_PULL,
      deps.fetch,
    );
    let added = 0;
    for (let i = 0; i < rows.length; i += INTENT_ROWS_PER_CALL) {
      const r = await deps.store.ingest(
        claim.workspace_id,
        "g2",
        claim.source_id,
        rows.slice(i, i + INTENT_ROWS_PER_CALL),
      );
      if (r.status === "ok") added += r.added;
      else break;
    }
    await deps.store.pullFinish(
      claim.source_id,
      claim.workspace_id,
      "ok",
      null,
    );
    return { pulled: rows.length, added };
  } catch (error) {
    const kind = error instanceof G2Problem ? error.kind : "unavailable";
    await deps.store.pullFinish(
      claim.source_id,
      claim.workspace_id,
      kind === "unavailable" ? "retry" : "revoked",
      error instanceof G2Problem ? error.message : "The pull failed.",
    );
    return { pulled: 0, added: 0 };
  }
}
