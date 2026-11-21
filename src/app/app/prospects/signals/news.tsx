import { Newspaper } from "lucide-react";
import { agoWords } from "@/lib/app/time";
import {
  NEWS_COMPANIES_MAX,
  NEWS_KIND_LABEL,
  NEWS_KINDS,
  type NewsKind,
} from "@/lib/news/config";
import { prospectRuntimeStatus } from "@/lib/prospects/config";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { ActionForm, SubmitButton } from "../../_ui/form";
import { Badge, Empty, hint, panel, panelHead } from "../../_ui/kit";
import { dismissNews, keepNews, saveNewsSettings } from "./news-actions";

// Company news on the Signals tab: funding, launches, leadership hires and
// expansions at the companies you track, each with its source link, to keep
// or dismiss.

const STATUSES = [
  ["new", "New"],
  ["engaged", "Engaged"],
  ["qualified", "Qualified"],
  ["meeting_booked", "Meeting booked"],
  ["won", "Won (customers)"],
  ["lost", "Lost"],
] as const;

const hostOf = (u: string) => {
  try {
    return new URL(u).hostname;
  } catch {
    return "Source";
  }
};

type Item = {
  id: string;
  domain: string;
  company_name: string;
  kind: NewsKind;
  headline: string;
  summary: string;
  source_url: string;
  source_title: string;
  published_on: string | null;
  status: string;
  lead_id: string | null;
  created_at: string;
};

export async function NewsSection({
  workspaceId,
  admin,
}: {
  workspaceId: string;
  admin: boolean;
}) {
  const supabase = await createClient();
  const [settings, items, tracked] = await Promise.all([
    supabase
      .from("news_settings")
      .select("*")
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
    supabase
      .from("company_news")
      .select(
        "id, domain, company_name, kind, headline, summary, source_url, source_title, published_on, status, lead_id, created_at",
      )
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(40),
    supabase
      .from("news_companies")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId),
  ]);
  const s = (settings.data ?? {
    enabled: false,
    track_accounts: true,
    track_leads: true,
    lead_statuses: ["new", "engaged", "qualified", "meeting_booked"],
    kinds: [...NEWS_KINDS],
  }) as {
    enabled: boolean;
    track_accounts: boolean;
    track_leads: boolean;
    lead_statuses: string[];
    kinds: string[];
  };
  const list = (items.data ?? []) as Item[];
  const fresh = list.filter((i) => i.status === "new");
  const decided = list.filter((i) => i.status !== "new").slice(0, 10);
  const model = prospectRuntimeStatus().on;

  return (
    <div className="mt-6">
      <h2 className="mb-2 px-1 text-[12px] font-medium tracking-wide text-[#0B0B0C]/50 uppercase">
        Company news
      </h2>
      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className={panel}>
          <h3 className={panelHead}>
            News to act on
            <span className="text-[11.5px] font-normal text-[#0B0B0C]/50">
              {fresh.length} new
            </span>
          </h3>
          {fresh.length === 0 ? (
            <Empty
              icon={Newspaper}
              title={s.enabled ? "Nothing new this week" : "Switched off"}
            >
              {s.enabled
                ? "Each tracked company is searched once a week. What turns up appears here with its source."
                : "Switch it on to hear when a company you track raises money, launches, hires a leader or expands."}
            </Empty>
          ) : (
            <ActionForm action={keepNews}>
              <ul className="divide-y divide-black/[0.06]">
                {fresh.map((n) => (
                  <li key={n.id} className="flex gap-3 px-4 py-3 text-[13px]">
                    <input
                      type="checkbox"
                      name="news"
                      value={n.id}
                      aria-label={`Keep: ${n.headline}`}
                      className="mt-1 size-3.5 accent-[#0B0B0C]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">
                          {n.company_name || n.domain}
                        </span>
                        <Badge tone="outline">
                          {NEWS_KIND_LABEL[n.kind] ?? n.kind}
                        </Badge>
                        {n.lead_id && (
                          <Badge tone="plain">Already a lead</Badge>
                        )}
                      </span>
                      <span className="mt-0.5 block">{n.headline}</span>
                      {n.summary && (
                        <span className="block text-[12.5px] text-[#0B0B0C]/60">
                          {n.summary}
                        </span>
                      )}
                      <span className="mt-0.5 block text-[11.5px] text-[#0B0B0C]/45">
                        <a
                          href={n.source_url}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                          className="underline underline-offset-2"
                        >
                          {n.source_title || hostOf(n.source_url)}
                        </a>
                        {n.published_on ? ` · ${n.published_on}` : ""} · found{" "}
                        {agoWords(n.created_at)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-center gap-2 border-t border-black/[0.06] px-4 py-3">
                <SubmitButton small pendingText="Keeping…">
                  Keep the ticked ones
                </SubmitButton>
                <p className={hint}>
                  A lead&apos;s company: a note on the lead and a fresh brief.
                  Another company: a target-accounts campaign finds a contact
                  and drafts an email for your approval.
                </p>
              </div>
            </ActionForm>
          )}
          {fresh.length > 0 && (
            <ul className="divide-y divide-black/[0.06] border-t border-black/[0.06]">
              {fresh.slice(0, 10).map((n) => (
                <li
                  key={n.id}
                  className="flex items-center gap-2 px-4 py-1.5 text-[12px] text-[#0B0B0C]/55"
                >
                  <span className="min-w-0 flex-1 truncate">{n.headline}</span>
                  <ActionForm action={dismissNews} quiet>
                    <input type="hidden" name="news" value={n.id} />
                    <SubmitButton small variant="ghost" pendingText="…">
                      Dismiss
                    </SubmitButton>
                  </ActionForm>
                </li>
              ))}
            </ul>
          )}
          {decided.length > 0 && (
            <ul className="divide-y divide-black/[0.06] border-t border-black/[0.06]">
              {decided.map((n) => (
                <li
                  key={n.id}
                  className="flex items-center gap-2 px-4 py-1.5 text-[12px] text-[#0B0B0C]/55"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {n.company_name || n.domain}: {n.headline}
                  </span>
                  <Badge tone={n.status === "kept" ? "ink" : "outline"}>
                    {n.status === "kept" ? "Kept" : "Dismissed"}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className={panel}>
          <h3 className={panelHead}>
            What to watch
            <Badge tone={s.enabled ? "ink" : "outline"}>
              {s.enabled ? "On" : "Off"}
            </Badge>
          </h3>
          <ActionForm
            action={saveNewsSettings}
            className="space-y-3 p-4 text-[13px]"
          >
            <fieldset disabled={!admin} className="space-y-3">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="enabled"
                  defaultChecked={s.enabled}
                  className="accent-[#0B0B0C]"
                />
                Check the news every week
              </label>
              <div className="space-y-1">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    name="track_accounts"
                    defaultChecked={s.track_accounts}
                    className="accent-[#0B0B0C]"
                  />
                  Target accounts
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    name="track_leads"
                    defaultChecked={s.track_leads}
                    className="accent-[#0B0B0C]"
                  />
                  Leads&apos; companies (with a website), at these stages:
                </label>
                <div className="flex flex-wrap gap-x-3 gap-y-1 pl-6">
                  {STATUSES.map(([v, label]) => (
                    <label
                      key={v}
                      className="flex items-center gap-1.5 text-[12.5px]"
                    >
                      <input
                        type="checkbox"
                        name="statuses"
                        value={v}
                        defaultChecked={s.lead_statuses.includes(v)}
                        className="accent-[#0B0B0C]"
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {NEWS_KINDS.map((k) => (
                  <label key={k} className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      name="kinds"
                      value={k}
                      defaultChecked={s.kinds.includes(k)}
                      className="accent-[#0B0B0C]"
                    />
                    {NEWS_KIND_LABEL[k]}
                  </label>
                ))}
              </div>
            </fieldset>
            {admin ? (
              <SubmitButton small>Save</SubmitButton>
            ) : (
              <p className={hint}>Only an owner or admin can change this.</p>
            )}
            <p className={cn(hint)}>
              Tracking {tracked.count ?? 0} of at most {NEWS_COMPANIES_MAX}{" "}
              companies, each searched once a week; only news from the last six
              weeks with a source link the search returned is kept.{" "}
              {!model &&
                "The search model isn't switched on yet on Dialvo's side, so nothing is checked yet."}
            </p>
          </ActionForm>
        </section>
      </div>
    </div>
  );
}
