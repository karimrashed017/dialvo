import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft, Map as MapIcon } from "lucide-react";
import { getAppContext } from "@/lib/app/context";
import type { Member } from "@/lib/app/types";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { ActionForm, SubmitButton } from "../../_ui/form";
import {
  Badge,
  btn,
  Empty,
  hint,
  input,
  labelCls,
  PageHead,
  PageSkeleton,
  panel,
  panelHead,
} from "../../_ui/kit";
import { assignTerritories, deleteTerritory, saveTerritory } from "./actions";

export const metadata: Metadata = { title: "Territories" };

type Territory = {
  id: string;
  name: string;
  position: number;
  countries: string[];
  regions: string[];
  size_min: number | null;
  size_max: number | null;
};

const optional = (
  <span className="font-normal text-[#0B0B0C]/45">(optional)</span>
);

function describe(t: Territory) {
  const parts = [
    t.countries.length ? t.countries.join(", ") : "",
    t.regions.length ? t.regions.join(", ") : "",
    t.size_min && t.size_max
      ? `${t.size_min} to ${t.size_max} people`
      : t.size_min
        ? `${t.size_min}+ people`
        : t.size_max
          ? `up to ${t.size_max} people`
          : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Everywhere, any size";
}

function TerritoryForm({
  t,
  reps,
  members,
  next,
  admin,
}: {
  t: Territory | null;
  reps: string[];
  members: Member[];
  next: number;
  admin: boolean;
}) {
  return (
    <ActionForm
      action={saveTerritory}
      resetOnSuccess={!t}
      className="space-y-3 p-4"
    >
      {t && <input type="hidden" name="id" value={t.id} />}
      <fieldset disabled={!admin} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-[1fr_110px]">
          <label className={labelCls}>
            Name
            <input
              name="name"
              required
              maxLength={80}
              defaultValue={t?.name ?? ""}
              placeholder="UK and Ireland, mid-market"
              className={cn(input, "mt-1")}
            />
          </label>
          <label className={labelCls}>
            Order
            <input
              name="position"
              type="number"
              min={0}
              max={1000}
              defaultValue={t?.position ?? next}
              className={cn(input, "mt-1")}
            />
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={labelCls}>
            Countries {optional}
            <input
              name="countries"
              maxLength={800}
              defaultValue={t?.countries.join(", ") ?? ""}
              placeholder="GB, Ireland"
              className={cn(input, "mt-1")}
            />
          </label>
          <label className={labelCls}>
            States or regions {optional}
            <input
              name="regions"
              maxLength={800}
              defaultValue={t?.regions.join(", ") ?? ""}
              placeholder="California, Texas"
              className={cn(input, "mt-1")}
            />
          </label>
          <label className={labelCls}>
            Company size, from {optional}
            <input
              name="size_min"
              type="number"
              min={1}
              defaultValue={t?.size_min ?? ""}
              className={cn(input, "mt-1")}
            />
          </label>
          <label className={labelCls}>
            to {optional}
            <input
              name="size_max"
              type="number"
              min={1}
              defaultValue={t?.size_max ?? ""}
              className={cn(input, "mt-1")}
            />
          </label>
        </div>
        <fieldset>
          <legend className={labelCls}>Reps</legend>
          <div className="mt-1.5 grid gap-1.5 text-[13px] sm:grid-cols-2">
            {members.map((m) => (
              <label key={m.user_id} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  name="reps"
                  value={m.user_id}
                  defaultChecked={reps.includes(m.user_id)}
                  className="size-4 accent-[#0B0B0C]"
                />
                {m.name || m.email}
              </label>
            ))}
          </div>
        </fieldset>
      </fieldset>
      {admin && (
        <SubmitButton small>
          {t ? "Save territory" : "Add territory"}
        </SubmitButton>
      )}
    </ActionForm>
  );
}

async function Content() {
  const { workspace, preview, repo } = await getAppContext();
  const admin = workspace.role !== "member";
  const head = (
    <PageHead
      title="Territories"
      note="Split your market by country, state or region and company size, and give each part its reps. Accounts are shared out among a territory's reps, evenly by number or by score, and new leads in a territory go to its rep with the fewest open leads."
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
        <section className={cn(panel, "p-4 text-[13px]")}>
          Territories need the real app. Nothing is shown here with made-up
          data.
        </section>
      </>
    );
  const supabase = await createClient();
  const [members, tRes, rRes, aRes] = await Promise.all([
    repo.members(),
    supabase
      .from("territories")
      .select("id, name, position, countries, regions, size_min, size_max")
      .eq("workspace_id", workspace.id)
      .order("position")
      .order("created_at"),
    supabase
      .from("territory_reps")
      .select("territory_id, user_id")
      .eq("workspace_id", workspace.id),
    supabase
      .from("accounts")
      .select("owner_id, territory_id, fit_score")
      .eq("workspace_id", workspace.id)
      .limit(2000),
  ]);
  const territories = (tRes.data ?? []) as Territory[];
  const reps = new Map<string, string[]>();
  for (const r of (rRes.data ?? []) as {
    territory_id: string;
    user_id: string;
  }[])
    reps.set(r.territory_id, [...(reps.get(r.territory_id) ?? []), r.user_id]);
  const nameOf = new Map(members.map((m) => [m.user_id, m.name || m.email]));
  const load = new Map<string, { n: number; score: number }>();
  const inT = new Map<string, number>();
  for (const a of (aRes.data ?? []) as {
    owner_id: string | null;
    territory_id: string | null;
    fit_score: number | null;
  }[]) {
    if (a.owner_id) {
      const l = load.get(a.owner_id) ?? { n: 0, score: 0 };
      load.set(a.owner_id, { n: l.n + 1, score: l.score + (a.fit_score ?? 0) });
    }
    if (a.territory_id)
      inT.set(a.territory_id, (inT.get(a.territory_id) ?? 0) + 1);
  }
  const next = territories.length
    ? Math.max(...territories.map((t) => t.position)) + 1
    : 0;
  return (
    <>
      {head}
      <div className="grid gap-3 lg:grid-cols-[1fr_380px]">
        <div className="min-w-0 space-y-3">
          <section className={panel}>
            <h2 className={panelHead}>
              Territories, in order
              <span className="text-[12px] font-normal text-[#0B0B0C]/50">
                {territories.length} of 50
              </span>
            </h2>
            {territories.length === 0 ? (
              <Empty icon={MapIcon} title="No territories yet">
                Until there is one, accounts and leads are routed by their owner
                and your routing rules only.
              </Empty>
            ) : (
              <ul className="divide-y divide-black/[0.06]">
                {territories.map((t) => (
                  <li key={t.id}>
                    <details>
                      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-4 py-3 text-[13px] hover:bg-black/[0.02]">
                        <span className="grid size-5 shrink-0 place-items-center rounded-full bg-[#0B0B0C] text-[11px] text-white tabular-nums">
                          {t.position}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="font-medium">{t.name}</span>
                          <span className="block text-[12px] text-[#0B0B0C]/60">
                            {describe(t)} ·{" "}
                            {(reps.get(t.id) ?? [])
                              .map((u) => nameOf.get(u) ?? "someone")
                              .join(", ")}
                          </span>
                        </span>
                        <Badge tone="outline">
                          {inT.get(t.id) ?? 0} accounts
                        </Badge>
                      </summary>
                      <TerritoryForm
                        t={t}
                        reps={reps.get(t.id) ?? []}
                        members={members}
                        next={next}
                        admin={admin}
                      />
                      {admin && (
                        <ActionForm
                          action={deleteTerritory}
                          confirm="Remove this territory?"
                          className="px-4 pb-4"
                        >
                          <input type="hidden" name="id" value={t.id} />
                          <SubmitButton
                            variant="ghost"
                            small
                            pendingText="Removing…"
                          >
                            Remove territory
                          </SubmitButton>
                        </ActionForm>
                      )}
                    </details>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {admin && (
            <section className={panel}>
              <h2 className={panelHead}>New territory</h2>
              <TerritoryForm
                t={null}
                reps={[]}
                members={members}
                next={next}
                admin={admin}
              />
            </section>
          )}
        </div>
        <aside className="min-w-0 space-y-3">
          <section className={panel}>
            <h2 className={panelHead}>Assign the accounts</h2>
            <ActionForm
              action={assignTerritories}
              confirm="Share the accounts out among the reps now?"
              className="space-y-3 p-4"
            >
              <fieldset disabled={!admin} className="space-y-2 text-[13px]">
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="balance"
                    value="count"
                    defaultChecked
                    className="size-4 accent-[#0B0B0C]"
                  />
                  Even by number of accounts
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="balance"
                    value="score"
                    className="size-4 accent-[#0B0B0C]"
                  />
                  Even by total fit score
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    name="reassign"
                    className="size-4 accent-[#0B0B0C]"
                  />
                  Also move accounts that have an owner
                </label>
              </fieldset>
              <p className={hint}>
                Each account goes to the first territory it matches (by its
                country, region and size), then to the rep with the least so
                far, best accounts first. Their leads without an owner follow.
              </p>
              {admin && (
                <SubmitButton small pendingText="Assigning…">
                  Assign now
                </SubmitButton>
              )}
            </ActionForm>
          </section>
          <section className={panel}>
            <h2 className={panelHead}>Accounts per rep</h2>
            {load.size === 0 ? (
              <p className="p-4 text-[13px] text-[#0B0B0C]/55">
                Nobody owns an account yet.
              </p>
            ) : (
              <dl className="grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-1.5 p-4 text-[12.5px]">
                {[...load.entries()].map(([u, l]) => (
                  <div key={u} className="contents">
                    <dt>{nameOf.get(u) ?? "A former teammate"}</dt>
                    <dd className="tabular-nums">{l.n}</dd>
                    <dd className="text-[#0B0B0C]/55 tabular-nums">
                      fit {l.score}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </section>
          <section className={panel}>
            <h2 className={panelHead}>With lead routing</h2>
            <p className={cn(hint, "p-4")}>
              A new lead goes to its account&apos;s owner first, then to its
              territory&apos;s rep, then through your{" "}
              <Link href="/app/settings/routing" className="underline">
                routing rules
              </Link>
              . Leads that already have an owner never move.
            </p>
          </section>
        </aside>
      </div>
    </>
  );
}

export default function TerritoriesPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content />
    </Suspense>
  );
}
