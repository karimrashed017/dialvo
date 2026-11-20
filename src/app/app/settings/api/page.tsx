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
  hint,
  PageHead,
  PageSkeleton,
  panel,
  panelHead,
} from "../../_ui/kit";
import { createApiKey, revokeApiKey } from "../../plays/actions";
import { KeyMaker } from "./key-maker";

export const metadata: Metadata = { title: "API" };

async function Content() {
  const { workspace, preview } = await getAppContext();
  const admin = workspace.role !== "member";
  const head = (
    <PageHead
      title="API"
      note="Send product events from your app, such as a trial starting or a limit being reached, so the trial-users play knows who is ready."
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
  const [keys, events] = await Promise.all([
    reads.apiKeys(),
    reads.productEvents(),
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
