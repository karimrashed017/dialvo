import type { Metadata } from "next";
import { Suspense } from "react";
import { getAppContext } from "@/lib/app/context";
import type { FitRules } from "@/lib/data/scoring";
import { dataOptions } from "@/lib/data/read";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { ActionForm, SubmitButton } from "../../_ui/form";
import {
  hint,
  input,
  labelCls,
  PageHead,
  PageSkeleton,
  panel,
  panelHead,
} from "../../_ui/kit";
import { LEAD_TABS, SectionTabs } from "../../_ui/tabs";
import { saveScoring, suggestScoring } from "./actions";

export const metadata: Metadata = { title: "Lead scoring" };

type Settings = {
  fit: FitRules;
  recipe_id: string | null;
  recipe_weight: number;
  tier1_min: number;
  tier2_min: number;
  engagement_weight: number;
};

const DEFAULTS: Settings = {
  fit: {},
  recipe_id: null,
  recipe_weight: 1,
  tier1_min: 70,
  tier2_min: 40,
  engagement_weight: 40,
};

const POINTS: [string, string][] = [
  ["A reply or message from them (email, text, social)", "25 each, 50 at most"],
  ["Wrote in your website chat", "20"],
  ["Filled in a form", "20"],
  ["Pages read on your site", "2 each, 10 at most"],
  ["Read your pricing page", "15"],
  ["Product events from your app (API)", "10 each, 30 at most"],
  ["A meeting booked", "40"],
];

function TierFields({ s }: { s: Settings }) {
  return (
    <>
      <input type="hidden" name="tier1_min" value={s.tier1_min} />
      <input type="hidden" name="tier2_min" value={s.tier2_min} />
      <input
        type="hidden"
        name="engagement_weight"
        value={s.engagement_weight}
      />
      <input type="hidden" name="recipe_id" value={s.recipe_id ?? ""} />
      <input type="hidden" name="recipe_weight" value={s.recipe_weight} />
    </>
  );
}

async function Content() {
  const { workspace, preview } = await getAppContext();
  const admin = workspace.role !== "member";
  const head = (
    <PageHead
      title="Lead scoring and tiers"
      note="Every lead gets a fit score (how well the company and person match who you sell to) and an engagement score (what they have done lately), and a tier from 1 (best) to 3. Tiers show on Leads and can be used in routing rules, audiences and playbooks."
    />
  );
  if (preview)
    return (
      <>
        {head}
        <section className={cn(panel, "p-4 text-[13px]")}>
          Scoring needs the real app. Nothing is shown here with made-up data.
        </section>
      </>
    );
  const supabase = await createClient();
  const count = (tier: number | null) => {
    let q = supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspace.id);
    q = tier === null ? q.is("tier", null) : q.eq("tier", tier);
    return q;
  };
  const [settingsRes, searchesRes, options, t1, t2, t3, none] =
    await Promise.all([
      supabase
        .from("scoring_settings")
        .select(
          "fit, recipe_id, recipe_weight, tier1_min, tier2_min, engagement_weight",
        )
        .eq("workspace_id", workspace.id)
        .maybeSingle(),
      supabase
        .from("prospect_searches")
        .select("id, name")
        .eq("workspace_id", workspace.id)
        .order("created_at", { ascending: false })
        .limit(20),
      dataOptions(supabase, workspace.id),
      count(1),
      count(2),
      count(3),
      count(null),
    ]);
  const s = (settingsRes.data as Settings | null) ?? DEFAULTS;
  const f = s.fit ?? {};
  const recipes = options.recipes.filter(
    (r) => r.answer_type === "score" || r.answer_type === "yes_no",
  );
  const searches = (searchesRes.data ?? []) as { id: string; name: string }[];
  return (
    <>
      {head}
      <SectionTabs label="Leads" tabs={LEAD_TABS} current="scoring" />
      <div className="grid gap-3 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-3">
          <section className={panel}>
            <h2 className={panelHead}>Fit: who you sell to</h2>
            <ActionForm action={saveScoring} className="space-y-3 p-4">
              <fieldset disabled={!admin} className="space-y-3">
                <p className={hint}>
                  Each rule you fill in counts equally; the fit score is the
                  share a lead meets. Empty rules don&apos;t count.
                  Firmographics come from Find leads&apos; research, the contact
                  database and the lead&apos;s own fields.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className={labelCls}>
                    Countries
                    <input
                      name="countries"
                      maxLength={800}
                      defaultValue={(f.countries ?? []).join(", ")}
                      placeholder="GB, Ireland"
                      className={cn(input, "mt-1")}
                    />
                  </label>
                  <label className={labelCls}>
                    Where they came from
                    <input
                      name="sources"
                      maxLength={800}
                      defaultValue={(f.sources ?? []).join(", ")}
                      placeholder="form, website chat"
                      className={cn(input, "mt-1")}
                    />
                  </label>
                  <label className={labelCls}>
                    Company size, from
                    <input
                      name="size_min"
                      type="number"
                      min={1}
                      defaultValue={f.size_min ?? ""}
                      className={cn(input, "mt-1")}
                    />
                  </label>
                  <label className={labelCls}>
                    to
                    <input
                      name="size_max"
                      type="number"
                      min={1}
                      defaultValue={f.size_max ?? ""}
                      className={cn(input, "mt-1")}
                    />
                  </label>
                  <label className={labelCls}>
                    Job titles with
                    <input
                      name="titles"
                      maxLength={800}
                      defaultValue={(f.titles ?? []).join(", ")}
                      placeholder="founder, head of operations"
                      className={cn(input, "mt-1")}
                    />
                  </label>
                  <label className={labelCls}>
                    Words describing the company
                    <input
                      name="keywords"
                      maxLength={800}
                      defaultValue={(f.keywords ?? []).join(", ")}
                      placeholder="gym, fitness, leisure"
                      className={cn(input, "mt-1")}
                    />
                  </label>
                </div>
                {recipes.length > 0 && (
                  <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
                    <label className={labelCls}>
                      Also count a recipe&apos;s answer
                      <select
                        name="recipe_id"
                        defaultValue={s.recipe_id ?? ""}
                        className={cn(input, "mt-1")}
                      >
                        <option value="">No</option>
                        {recipes.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={labelCls}>
                      As rules
                      <select
                        name="recipe_weight"
                        defaultValue={s.recipe_weight}
                        className={cn(input, "mt-1")}
                      >
                        <option value={1}>1</option>
                        <option value={2}>2</option>
                        <option value={3}>3</option>
                      </select>
                    </label>
                  </div>
                )}
                <h3 className="pt-2 text-[13px] font-medium">Tiers</h3>
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className={labelCls}>
                    Tier 1 from
                    <input
                      name="tier1_min"
                      type="number"
                      min={1}
                      max={100}
                      required
                      defaultValue={s.tier1_min}
                      className={cn(input, "mt-1")}
                    />
                  </label>
                  <label className={labelCls}>
                    Tier 2 from
                    <input
                      name="tier2_min"
                      type="number"
                      min={0}
                      max={99}
                      required
                      defaultValue={s.tier2_min}
                      className={cn(input, "mt-1")}
                    />
                  </label>
                  <label className={labelCls}>
                    Engagement&apos;s share (%)
                    <input
                      name="engagement_weight"
                      type="number"
                      min={0}
                      max={100}
                      required
                      defaultValue={s.engagement_weight}
                      className={cn(input, "mt-1")}
                    />
                  </label>
                </div>
                <p className={hint}>
                  The combined score is fit and engagement mixed by that share
                  (engagement alone when no fit rule is set). Below tier 2 is
                  tier 3.
                </p>
              </fieldset>
              {admin ? (
                <SubmitButton>Save and rescore</SubmitButton>
              ) : (
                <p className={hint}>
                  Only the workspace&apos;s owner or an admin can change
                  scoring.
                </p>
              )}
            </ActionForm>
          </section>
          {admin && searches.length > 0 && (
            <section className={panel}>
              <h2 className={panelHead}>
                Write the fit rules from a description
              </h2>
              <ActionForm
                action={suggestScoring}
                className="flex flex-wrap items-end gap-2 p-4"
              >
                <TierFields s={s} />
                <label className={cn(labelCls, "min-w-[220px] flex-1")}>
                  Your Find leads search
                  <select
                    name="search_id"
                    defaultValue={searches[0].id}
                    className={cn(input, "mt-1")}
                  >
                    {searches.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </select>
                </label>
                <SubmitButton variant="secondary" pendingText="Writing…">
                  Write and save the rules
                </SubmitButton>
                <p className={cn(hint, "w-full")}>
                  One short model call, counted with Find leads&apos;
                  suggestions (10 a day). It replaces the rules above.
                </p>
              </ActionForm>
            </section>
          )}
        </div>
        <aside className="min-w-0 space-y-3">
          <section className={panel}>
            <h2 className={panelHead}>Your leads by tier</h2>
            <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 p-4 text-[13px]">
              <dt>Tier 1</dt>
              <dd className="tabular-nums">{t1.count ?? 0}</dd>
              <dt>Tier 2</dt>
              <dd className="tabular-nums">{t2.count ?? 0}</dd>
              <dt>Tier 3</dt>
              <dd className="tabular-nums">{t3.count ?? 0}</dd>
              <dt className="text-[#0B0B0C]/55">Not scored yet</dt>
              <dd className="text-[#0B0B0C]/55 tabular-nums">
                {none.count ?? 0}
              </dd>
            </dl>
          </section>
          <section className={panel}>
            <h2 className={panelHead}>Engagement points</h2>
            <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 p-4 text-[12.5px]">
              {POINTS.map(([what, pts]) => (
                <div key={what} className="contents">
                  <dt className="text-[#0B0B0C]/70">{what}</dt>
                  <dd className="text-right tabular-nums">{pts}</dd>
                </div>
              ))}
            </dl>
            <p className={cn(hint, "px-4 pb-4")}>
              From the last 90 days, at most 100. Email opens aren&apos;t
              tracked, so they never count. Scores refresh every ten minutes and
              when a lead is added.
            </p>
          </section>
        </aside>
      </div>
    </>
  );
}

export default function ScoringPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content />
    </Suspense>
  );
}
