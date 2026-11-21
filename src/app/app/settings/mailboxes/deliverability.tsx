import { agoWords } from "@/lib/app/time";
import {
  HEALTH_BOUNCE_PCT,
  HEALTH_MIN_BOUNCES,
  HEALTH_MIN_STOPS,
  HEALTH_STOP_PCT,
  HEALTH_WINDOW_DAYS,
} from "@/lib/mail/config";
import type { DnsCheck, DnsItem } from "@/lib/mail/dns";
import type { Supabase } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { ActionForm, SubmitButton } from "../../_ui/form";
import { Badge, hint, panel, panelHead } from "../../_ui/kit";
import { checkMailboxDns } from "./deliverability-actions";

// Deliverability, per mailbox: its domain's DNS (SPF, DKIM, DMARC, MX) with
// a plain fix for each problem, and its bounces and stop requests against
// the limits that pause it.

type Row = {
  id: string;
  email: string;
  status: string;
  dns_check: DnsCheck | null;
  dns_checked_at: string | null;
};
type Health = {
  mailbox_id: string;
  sent: number;
  bounced: number;
  stopped: number;
};

const LABEL = { spf: "SPF", dkim: "DKIM", dmarc: "DMARC", mx: "MX" } as const;

function Item({ name, item }: { name: string; item: DnsItem }) {
  return (
    <li className="grid gap-1 py-2 sm:grid-cols-[64px_88px_1fr] sm:gap-3">
      <span className="text-[12.5px] font-medium">{name}</span>
      <span>
        <Badge
          tone={
            item.verdict === "ok"
              ? "ink"
              : item.verdict === "warn"
                ? "outline"
                : "warn"
          }
        >
          {item.verdict === "ok"
            ? "In order"
            : item.verdict === "warn"
              ? "Check"
              : "Missing"}
        </Badge>
      </span>
      <span className="min-w-0 text-[12.5px] leading-[1.5]">
        <span className="block break-all text-[#0B0B0C]/60">{item.found}</span>
        {item.fix && <span className="block">{item.fix}</span>}
      </span>
    </li>
  );
}

const pct = (n: number, of: number) =>
  of === 0 ? "0%" : `${Math.round((n * 1000) / of) / 10}%`;

export async function Deliverability({
  supabase,
  workspaceId,
}: {
  supabase: Supabase;
  workspaceId: string;
}) {
  const [boxes, health] = await Promise.all([
    supabase
      .from("mailboxes")
      .select("id, email, status, dns_check, dns_checked_at")
      .eq("workspace_id", workspaceId)
      .neq("status", "disconnected")
      .order("created_at"),
    supabase.rpc("mailbox_health_stats", {
      p_workspace_id: workspaceId,
      p_days: HEALTH_WINDOW_DAYS,
    }),
  ]);
  const rows = (boxes.data ?? []) as Row[];
  if (rows.length === 0) return null;
  const stats = new Map(
    ((health.data ?? []) as Health[]).map((h) => [h.mailbox_id, h]),
  );
  return (
    <section
      id="deliverability"
      className={cn(panel, "scroll-mt-28 lg:col-span-2")}
    >
      <h2 className={panelHead}>Deliverability</h2>
      <ul className="divide-y divide-black/[0.06]">
        {rows.map((box) => {
          const h = stats.get(box.id);
          const check = box.dns_check;
          return (
            <li key={box.id} data-dns={box.email} className="space-y-3 p-4">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <h3 className="text-[14px] font-medium break-all">
                  {box.email}
                </h3>
                <span className="text-[12.5px] text-[#0B0B0C]/55">
                  {box.dns_checked_at
                    ? `DNS checked ${agoWords(box.dns_checked_at)}`
                    : "DNS not checked yet"}
                </span>
                <ActionForm action={checkMailboxDns} className="ml-auto">
                  <input type="hidden" name="mailbox" value={box.id} />
                  <SubmitButton
                    variant="secondary"
                    small
                    pendingText="Checking…"
                  >
                    {box.dns_checked_at ? "Check again" : "Check DNS"}
                  </SubmitButton>
                </ActionForm>
              </div>
              {check && !check.managed && (
                <ul className="divide-y divide-black/[0.05] rounded-xl border border-black/[0.07] px-3">
                  {(Object.keys(LABEL) as (keyof typeof LABEL)[]).map((k) => (
                    <Item key={k} name={LABEL[k]} item={check[k]} />
                  ))}
                </ul>
              )}
              {check?.managed && (
                <p className="text-[12.5px] text-[#0B0B0C]/65">
                  {check.domain} is a free mail domain: its SPF, DKIM and DMARC
                  are the provider&apos;s own. For sending in volume, a mailbox
                  on your own domain is better trusted.
                </p>
              )}
              <p className="text-[12.5px] leading-[1.5] text-[#0B0B0C]/70 tabular-nums">
                Last {HEALTH_WINDOW_DAYS} days: {h?.sent ?? 0} sent,{" "}
                {h?.bounced ?? 0} bounced ({pct(h?.bounced ?? 0, h?.sent ?? 0)}
                ), {h?.stopped ?? 0} asked to stop (
                {pct(h?.stopped ?? 0, h?.sent ?? 0)}).
              </p>
            </li>
          );
        })}
      </ul>
      <p className={cn(hint, "border-t border-black/[0.06] px-4 py-2.5")}>
        A mailbox is paused, and you are told, at {HEALTH_MIN_BOUNCES} or more
        bounces that are at least {HEALTH_BOUNCE_PCT}% of what it sent, or{" "}
        {HEALTH_MIN_STOPS} or more people asking to stop that are at least{" "}
        {HEALTH_STOP_PCT}%, over {HEALTH_WINDOW_DAYS} days. Resuming it starts
        the count again. Spam reports made with a mail provider&apos;s own
        button aren&apos;t sent back to your inbox by the large providers, so
        Dialvo counts unsubscribes instead. Inbox-placement tests aren&apos;t
        part of this.
      </p>
    </section>
  );
}
