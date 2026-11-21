import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft, KeyRound } from "lucide-react";
import { getAppContext } from "@/lib/app/context";
import { agoWords } from "@/lib/app/time";
import { API_EVENTS_PER_MINUTE, PRODUCT_EVENTS } from "@/lib/plays/config";
import { playReads } from "@/lib/plays/read";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { ActionForm, SubmitButton } from "../../_ui/form";
import {
  Badge,
  btn,
  Empty,
  input,
  labelCls,
  hint,
  PageHead,
  PageSkeleton,
  panel,
  panelHead,
} from "../../_ui/kit";
import { createApiKey, revokeApiKey } from "../../plays/actions";
import { integrationReads } from "@/lib/integrations/read";
import {
  WEBHOOK_EVENT_LABEL,
  WEBHOOK_EVENTS,
} from "@/lib/integrations/webhooks";
import { WEBHOOK_ENDPOINTS_MAX } from "@/lib/integrations/config";
import { KeyMaker } from "./key-maker";
import { ApiReference } from "./reference";
import { SecretForm } from "./secret-form";
import {
  createWebhook,
  deleteWebhook,
  retryDelivery,
  rollWebhookSecret,
  setWebhookActive,
  testWebhook,
} from "./webhook-actions";

export const metadata: Metadata = { title: "API and webhooks" };

const DELIVERY_STATUS: Record<string, string> = {
  pending: "Waiting",
  running: "Sending",
  delivered: "Delivered",
  failed: "Failed",
  skipped: "Not sent",
};

async function Content() {
  const { workspace, preview } = await getAppContext();
  const admin = workspace.role !== "member";
  const head = (
    <PageHead
      title="API and webhooks"
      note="Read and write your leads, conversations, plays and meetings from your own systems, send product events from your app, and get signed webhooks when leads arrive, reply or book."
    >
      <Link href="/app/settings" className={cn(btn.ghost, btn.small)}>
        <ArrowLeft aria-hidden className="size-3.5" />
        Settings
      </Link>
    </PageHead>
  );
  if (preview)
    return (
      <>
        {head}
        <section className={panel}>
          <Empty icon={KeyRound} title="Not part of the design preview" />
        </section>
      </>
    );
  const supabase = await createClient();
  const reads = playReads(supabase, workspace.id);
  const ints = integrationReads(supabase, workspace.id);
  const [keys, events, endpoints, deliveries] = await Promise.all([
    reads.apiKeys(),
    reads.productEvents(),
    ints.endpoints(),
    ints.deliveries("webhook", 20),
  ]);
  const active = keys.filter((k) => !k.revoked_at);
  return (
    <>
      {head}
      <div className="grid gap-3 lg:grid-cols-2">
        <section className={panel}>
          <h2 className={panelHead}>
            Keys
            <span className="text-[11.5px] font-normal text-[#0B0B0C]/50 tabular-nums">
              {active.length} of 3
            </span>
          </h2>
          <div className="p-4">
            {admin ? (
              <KeyMaker action={createApiKey} disabled={active.length >= 3} />
            ) : (
              <p className={hint}>
                Only the workspace&apos;s owner or an admin can make keys.
              </p>
            )}
          </div>
          {keys.length > 0 && (
            <ul className="divide-y divide-black/[0.06] border-t border-black/[0.06]">
              {keys.map((k) => (
                <li
                  key={k.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-[13px]"
                >
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{k.name}</span>{" "}
                    <code className="text-[12px] text-[#0B0B0C]/55">
                      {k.key_prefix}…
                    </code>
                    <span className="block text-[11.5px] text-[#0B0B0C]/50">
                      Made {agoWords(k.created_at)}
                      {k.last_used_at
                        ? `, last used ${agoWords(k.last_used_at)}`
                        : ", not used yet"}
                    </span>
                  </span>
                  {k.revoked_at ? (
                    <Badge tone="outline">Revoked</Badge>
                  ) : (
                    admin && (
                      <ActionForm
                        action={revokeApiKey}
                        confirm="Revoke this key? Requests with it are refused from now on."
                      >
                        <input type="hidden" name="key" value={k.id} />
                        <SubmitButton
                          variant="ghost"
                          small
                          pendingText="Revoking…"
                        >
                          Revoke
                        </SubmitButton>
                      </ActionForm>
                    )
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className={panel}>
          <h2 className={panelHead}>How to send an event</h2>
          <div className="space-y-3 p-4 text-[13px] leading-[1.5]">
            <pre className="overflow-x-auto rounded-xl bg-black/[0.04] p-3 text-[12px] leading-[1.5]">
              {`POST https://trydialvo.com/api/v1/events
Authorization: Bearer <your key>
Content-Type: application/json

{
  "email": "dana@example.com",
  "event": "trial_ending",
  "occurred_at": "2026-11-20T10:00:00Z",
  "properties": { "ends_at": "2026-11-23" }
}`}
            </pre>
            <p className={hint}>
              Events: {PRODUCT_EVENTS.join(", ")}. The email must belong to one
              of your leads (404 otherwise). Up to {API_EVENTS_PER_MINUTE}{" "}
              events a minute per key (429 over that). Properties: at most 20
              short values; the play reads &quot;limit&quot; and
              &quot;ends_at&quot;.
            </p>
          </div>
        </section>
        <section className={cn(panel, "lg:col-span-2")} id="webhooks">
          <h2 className={panelHead}>
            Webhooks
            <span className="text-[11.5px] font-normal text-[#0B0B0C]/50 tabular-nums">
              {endpoints.length} of {WEBHOOK_ENDPOINTS_MAX}
            </span>
          </h2>
          <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-[340px_1fr]">
            <div className="min-w-0">
              {admin ? (
                <SecretForm
                  action={createWebhook}
                  submit="Add endpoint"
                  pendingText="Adding…"
                  disabled={endpoints.length >= WEBHOOK_ENDPOINTS_MAX}
                  reveal="The endpoint's signing secret. Copy it now: it won't be shown again."
                  note="Keep it on your server. Use it to check the Dialvo-Signature header of every delivery."
                >
                  <label className={labelCls}>
                    Endpoint URL
                    <input
                      name="url"
                      type="url"
                      required
                      maxLength={500}
                      placeholder="https://example.com/hooks/dialvo"
                      className={cn(input, "mt-1")}
                    />
                  </label>
                  <label className={labelCls}>
                    Description{" "}
                    <span className="font-normal text-[#0B0B0C]/45">
                      (optional)
                    </span>
                    <input
                      name="description"
                      maxLength={120}
                      placeholder="Data warehouse"
                      className={cn(input, "mt-1")}
                    />
                  </label>
                  <fieldset className="space-y-1">
                    <legend className={labelCls}>Events</legend>
                    {WEBHOOK_EVENTS.map((e) => (
                      <label
                        key={e}
                        className="flex items-center gap-2 text-[12.5px]"
                      >
                        <input
                          type="checkbox"
                          name="events"
                          value={e}
                          defaultChecked
                          className="size-3.5 accent-[#0B0B0C]"
                        />
                        <code>{e}</code>
                        <span className="text-[#0B0B0C]/50">
                          {WEBHOOK_EVENT_LABEL[e]}
                        </span>
                      </label>
                    ))}
                  </fieldset>
                </SecretForm>
              ) : (
                <p className={hint}>
                  Only the workspace&apos;s owner or an admin can add endpoints.
                </p>
              )}
            </div>
            <div className="min-w-0">
              {endpoints.length === 0 ? (
                <p className="py-6 text-center text-[13px] text-[#0B0B0C]/50">
                  No endpoint yet.
                </p>
              ) : (
                <ul className="divide-y divide-black/[0.06] rounded-xl border border-black/[0.07]">
                  {endpoints.map((e) => (
                    <li
                      key={e.id}
                      className="space-y-2 px-3 py-2.5 text-[13px]"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <code className="min-w-0 flex-1 truncate text-[12.5px]">
                          {e.url}
                        </code>
                        <Badge
                          tone={
                            e.status === "active"
                              ? "ink"
                              : e.status === "disabled"
                                ? "warn"
                                : "outline"
                          }
                        >
                          {e.status === "active"
                            ? "On"
                            : e.status === "paused"
                              ? "Paused"
                              : "Switched off"}
                        </Badge>
                      </div>
                      <p className="text-[11.5px] text-[#0B0B0C]/55">
                        {e.description && `${e.description} · `}
                        {e.events.join(", ")} · secret {e.secret_prefix}…
                        {e.last_success_at &&
                          ` · last delivered ${agoWords(e.last_success_at)}`}
                      </p>
                      {(e.status_reason ||
                        (e.last_error && e.consecutive_failures > 0)) && (
                        <p className="text-[11.5px] text-[#B42318]">
                          {e.status_reason ?? `Failing: ${e.last_error}`}
                        </p>
                      )}
                      {admin && (
                        <div className="flex flex-wrap gap-1.5">
                          <ActionForm action={testWebhook}>
                            <input type="hidden" name="endpoint" value={e.id} />
                            <SubmitButton
                              variant="secondary"
                              small
                              pendingText="Sending…"
                            >
                              Send a test
                            </SubmitButton>
                          </ActionForm>
                          <ActionForm action={setWebhookActive}>
                            <input type="hidden" name="endpoint" value={e.id} />
                            {e.status !== "active" && (
                              <input type="hidden" name="active" value="on" />
                            )}
                            <SubmitButton variant="ghost" small>
                              {e.status === "active" ? "Pause" : "Switch on"}
                            </SubmitButton>
                          </ActionForm>
                          <SecretForm
                            action={rollWebhookSecret}
                            submit="New secret"
                            pendingText="Making…"
                            confirm="Make a new secret? The old one stops being used now."
                            reveal="The new signing secret. Copy it now: it won't be shown again."
                            note="Deliveries are signed with this one from now on."
                          >
                            <input type="hidden" name="endpoint" value={e.id} />
                          </SecretForm>
                          <ActionForm
                            action={deleteWebhook}
                            confirm="Delete this endpoint? Nothing more is sent to it."
                          >
                            <input type="hidden" name="endpoint" value={e.id} />
                            <SubmitButton
                              variant="ghost"
                              small
                              pendingText="Deleting…"
                            >
                              Delete
                            </SubmitButton>
                          </ActionForm>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {deliveries.length > 0 && (
                <div className="mt-3">
                  <h3 className="text-[12.5px] font-medium">
                    Latest deliveries
                  </h3>
                  <ul className="mt-1 divide-y divide-black/[0.06]">
                    {deliveries.map((d) => (
                      <li
                        key={d.id}
                        className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-[12.5px]"
                      >
                        <code>{d.event}</code>
                        <span className="min-w-0 flex-1 truncate text-[#0B0B0C]/55">
                          {d.response_status
                            ? `answered ${d.response_status}`
                            : ""}
                          {d.last_error && d.status !== "delivered"
                            ? ` ${d.last_error}`
                            : ""}
                          {d.attempts > 1 ? ` · ${d.attempts} tries` : ""}
                        </span>
                        <span className="text-[#0B0B0C]/50">
                          {agoWords(d.created_at)}
                        </span>
                        <Badge
                          tone={
                            d.status === "failed"
                              ? "warn"
                              : d.status === "delivered"
                                ? "plain"
                                : "outline"
                          }
                        >
                          {DELIVERY_STATUS[d.status] ?? d.status}
                        </Badge>
                        {admin && d.status === "failed" && (
                          <ActionForm action={retryDelivery}>
                            <input type="hidden" name="delivery" value={d.id} />
                            <SubmitButton variant="ghost" small pendingText="…">
                              Retry
                            </SubmitButton>
                          </ActionForm>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </section>

        <ApiReference />

        <section className={cn(panel, "lg:col-span-2")}>
          <h2 className={panelHead}>Latest events</h2>
          {events.length === 0 ? (
            <p className="px-4 py-6 text-center text-[13px] text-[#0B0B0C]/50">
              No event has arrived yet.
            </p>
          ) : (
            <ul className="divide-y divide-black/[0.06]">
              {events.map((e) => (
                <li
                  key={e.id}
                  className="flex flex-wrap gap-x-3 px-4 py-2 text-[13px]"
                >
                  <code className="text-[12.5px]">{e.event}</code>
                  <span className="min-w-0 flex-1 truncate text-[#0B0B0C]/65">
                    {e.lead?.name || e.lead?.email}
                  </span>
                  <span className="text-[12px] text-[#0B0B0C]/50">
                    {agoWords(e.occurred_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

export default function ApiPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content />
    </Suspense>
  );
}
