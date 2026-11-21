import "server-only";
import { sendEmail, type SendDeps } from "@/lib/alerts/email";
import type { ModelClient } from "@/lib/prospects/model";
import { readSite } from "@/lib/prospects/site";
import { BRIEF_SITE_PAGES, BRIEFS_PER_STEP } from "./config";
import { buildBriefEmail } from "./email";
import { writeBrief, writeClosedLost } from "./model";
import type { BriefPage } from "./prompt";
import type { BriefStore } from "./store";

// One briefs step: claim what waits, write each (reading the company's own
// website first, for a brief), record it, and email it to the meeting's
// host or the lead's owner when the workspace wants that. A step that dies
// half way is harmless: the lease runs out and the next step takes it.

export type BriefStepDeps = {
  store: BriefStore;
  client: ModelClient;
  readPages?: (website: string) => Promise<BriefPage[]>;
  email?: Partial<SendDeps>;
};

export type BriefStepResult = {
  claimed: number;
  ready: number;
  failed: number;
  emailed: number;
};

async function defaultPages(website: string): Promise<BriefPage[]> {
  const site = await readSite(website);
  if (!site.ok) return [];
  return site.pages
    .slice(0, BRIEF_SITE_PAGES)
    .map((p) => ({ url: p.url, title: p.title, text: p.text }));
}

export async function makeOneBrief(
  deps: BriefStepDeps,
  claimed: { id: string; workspace_id: string },
): Promise<"ready" | "failed" | "emailed"> {
  const ctx = await deps.store.context(claimed.workspace_id, claimed.id);
  if (!ctx) {
    await deps.store.finish({
      workspaceId: claimed.workspace_id,
      briefId: claimed.id,
      ok: false,
      error: "The lead no longer exists.",
      costMicros: 0,
    });
    return "failed";
  }
  let result;
  if (ctx.brief.kind === "closed_lost") {
    result = await writeClosedLost(deps.client, ctx);
  } else {
    const website = ctx.lead.website || ctx.research?.website || null;
    let pages: BriefPage[] = [];
    if (website)
      pages = await (deps.readPages ?? defaultPages)(website).catch(() => []);
    result = await writeBrief(deps.client, ctx, pages);
  }
  const done = await deps.store.finish(
    result.ok
      ? {
          workspaceId: claimed.workspace_id,
          briefId: claimed.id,
          ok: true,
          content: result.content,
          summary: result.summary,
          sources: result.sources,
          costMicros: result.spend.cost_micros,
        }
      : {
          workspaceId: claimed.workspace_id,
          briefId: claimed.id,
          ok: false,
          error: result.reason,
          costMicros: result.spend.cost_micros,
        },
  );
  if (done.status !== "ready" || !result.ok) return "failed";
  if (!done.email?.to) return "ready";
  const sent = await sendEmail(
    {
      ...buildBriefEmail({
        workspace: ctx.workspace.name,
        leadId: ctx.lead.id,
        lead: ctx.lead.name || ctx.lead.email || "a lead",
        company: ctx.lead.company ?? "",
        meeting: ctx.meeting,
        brief: result.content,
        summary: result.summary,
        sources: result.sources,
      }),
      to: [done.email.to],
      idempotencyKey: `brief-${claimed.id}`,
    },
    deps.email,
  );
  if (!sent) return "ready";
  await deps.store
    .markEmailed(claimed.workspace_id, claimed.id)
    .catch(() => undefined);
  return "emailed";
}

export async function briefStep(deps: BriefStepDeps): Promise<BriefStepResult> {
  const claimed = await deps.store.claim(BRIEFS_PER_STEP);
  const result: BriefStepResult = {
    claimed: claimed.length,
    ready: 0,
    failed: 0,
    emailed: 0,
  };
  await Promise.all(
    claimed.map(async (c) => {
      try {
        const r = await makeOneBrief(deps, c);
        if (r === "failed") result.failed++;
        else result.ready++;
        if (r === "emailed") result.emailed++;
      } catch (error) {
        result.failed++;
        console.error("[briefs] brief failed:", (error as Error).message);
        await deps.store
          .finish({
            workspaceId: c.workspace_id,
            briefId: c.id,
            ok: false,
            error: "It couldn't be made.",
            costMicros: 0,
          })
          .catch(() => undefined);
      }
    }),
  );
  return result;
}
