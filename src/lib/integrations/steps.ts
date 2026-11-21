import "server-only";
import { DELIVERY_BACKOFF_SECONDS, DELIVERIES_PER_STEP } from "./config";
import { postJson, realPostDeps, type PostDeps, type PostResult } from "./post";
import { slackMessage, slackRevoked } from "./slack";
import type { ClaimedDelivery, IntegrationStore } from "./store";
import { webhookBody, webhookHeaders } from "./webhooks";

// One delivery step: claim what is due, send each (Slack posts and webhook
// deliveries, a few at a time), and record what happened. A step that dies
// half way is harmless: its claims' leases run out and the next step takes
// them, and a webhook receiver sees the same Dialvo-Delivery id again.

export type StepResult = {
  claimed: number;
  delivered: number;
  retried: number;
  failed: number;
};

export const backoffSeconds = (attempt: number) =>
  DELIVERY_BACKOFF_SECONDS[
    Math.min(Math.max(attempt, 1), DELIVERY_BACKOFF_SECONDS.length) - 1
  ];

export async function sendDelivery(
  d: ClaimedDelivery,
  post: PostDeps = realPostDeps,
  now: () => number = () => Math.floor(Date.now() / 1000),
): Promise<PostResult | { ok: false; skip: true; error: string }> {
  if (!d.url) return { ok: false, skip: true, error: "Not connected." };
  if (d.target === "slack") {
    const text = slackMessage(d.event, d.payload, d.workspace_name);
    if (!text) return { ok: false, skip: true, error: "Nothing to post." };
    return postJson(
      d.url,
      JSON.stringify({ text, unfurl_links: false }),
      {},
      post,
    );
  }
  if (!d.secret) return { ok: false, skip: true, error: "No signing secret." };
  const body = webhookBody({
    id: d.id,
    type: d.event,
    createdAt: d.created_at,
    data: d.payload,
  });
  return postJson(
    d.url,
    body,
    webhookHeaders({
      secret: d.secret,
      body,
      event: d.event,
      deliveryId: d.id,
      now: now(),
    }),
    post,
  );
}

export async function deliverStep(
  deps: { store: IntegrationStore; post?: PostDeps },
  options: { workspaceId?: string; limit?: number } = {},
): Promise<StepResult> {
  const claimed = await deps.store.claim(
    options.limit ?? DELIVERIES_PER_STEP,
    options.workspaceId ?? null,
  );
  const result: StepResult = {
    claimed: claimed.length,
    delivered: 0,
    retried: 0,
    failed: 0,
  };
  // Five at a time: enough to keep up, few enough not to flood a receiver.
  for (let i = 0; i < claimed.length; i += 5) {
    await Promise.all(
      claimed.slice(i, i + 5).map(async (d) => {
        let sent: Awaited<ReturnType<typeof sendDelivery>>;
        try {
          sent = await sendDelivery(d, deps.post);
        } catch (error) {
          sent = {
            ok: false,
            status: null,
            error: (error as Error).message.slice(0, 200),
            permanent: false,
          };
        }
        let outcome: "delivered" | "retry" | "failed" | "revoked";
        if (sent.ok) outcome = "delivered";
        else if ("skip" in sent) outcome = "failed";
        else if (d.target === "slack" && slackRevoked(sent.status, sent.error))
          outcome = "revoked";
        else outcome = sent.permanent ? "failed" : "retry";
        const status = sent.ok
          ? sent.status
          : "skip" in sent
            ? null
            : sent.status;
        const error = sent.ok ? null : sent.error;
        const final = await deps.store
          .finish(d.id, outcome, status, error, backoffSeconds(d.attempt))
          .catch((e) => {
            console.error(
              "[integrations] finish failed:",
              (e as Error).message,
            );
            return null;
          });
        if (final === "delivered") result.delivered++;
        else if (final === "pending") result.retried++;
        else if (final === "failed") result.failed++;
      }),
    );
  }
  return result;
}
