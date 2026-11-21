import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CalendarClock } from "lucide-react";
import { getAppContext } from "@/lib/app/context";
import { ago, dateTime } from "@/lib/app/time";
import {
  SOURCING_EVERY_DAYS_DEFAULT,
  SOURCING_MAX,
  SOURCING_RUNS_PER_MONTH,
} from "@/lib/data/config";
import { dataOptions } from "@/lib/data/read";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { ActionForm, SubmitButton } from "../../_ui/form";
import {
  Badge,
  Empty,
  hint,
  input,
  labelCls,
  PageHead,
  PageSkeleton,
  panel,
  panelHead,
} from "../../_ui/kit";
import { FindTabs } from "../tabs";
import { deleteSchedule, saveSchedule } from "./actions";

export const metadata: Metadata = { title: "Always-on search" };

type Schedule = {
  id: string;
  search_id: string;
  list_id: string;
  recipe_id: string | null;
  every_days: number;
  enabled: boolean;
  status: "idle" | "running";
  next_run_at: string;
  last_run_at: string | null;
  last_added: number;
  last_note: string;
  month: string | null;
  month_runs: number;
};

function ScheduleForm({
  s,
  searches,
  lists,
  recipes,
  admin,
}: {
  s: Schedule | null;
  searches: { id: string; name: string }[];
  lists: { id: string; name: string }[];
  recipes: { id: string; name: string }[];
  admin: boolean;
}) {
  return (
    <ActionForm action={saveSchedule} className="space-y-3 p-4">
      {s && <input type="hidden" name="id" value={s.id} />}
      <fieldset disabled={!admin} className="space-y-3">
        <label className={labelCls}>
          Saved search
          <select
            name="search_id"
            required
            defaultValue={s?.search_id ?? ""}
            className={cn(input, "mt-1")}
          >
            <option value="">Choose a search</option>
            {searches.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={labelCls}>
            Add new companies to
            <select
              name="list_id"
              defaultValue={s?.list_id ?? ""}
              className={cn(input, "mt-1")}
            >
              <option value="">A new list</option>
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          {!s && (
            <label className={labelCls}>
              New list&apos;s name
              <input
                name="new_list"
                maxLength={80}
                placeholder="New companies each week"
                className={cn(input, "mt-1")}
              />
            </label>
          )}
          <label className={labelCls}>
            Every
            <span className="mt-1 flex items-center gap-2 font-normal">
              <input
                name="every_days"
                type="number"
                min={1}
                max={90}
                required
                defaultValue={s?.every_days ?? SOURCING_EVERY_DAYS_DEFAULT}
                className={cn(input, "max-w-[100px]")}
              />
              days
            </span>
          </label>
          {recipes.length > 0 && (
            <label className={labelCls}>
              Answer a recipe for each{" "}
              <span className="font-normal text-[#0B0B0C]/45">(optional)</span>
              <select
                name="recipe_id"
                defaultValue={s?.recipe_id ?? ""}
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
          )}
        </div>
        <label className="flex items-center gap-1.5 text-[13px]">
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={s?.enabled ?? true}
            className="size-4 accent-[#0B0B0C]"
          />
          On
        </label>
      </fieldset>
      {admin && (
        <SubmitButton small>{s ? "Save" : "Add schedule"}</SubmitButton>
      )}
    </ActionForm>
  );
}

async function Content() {
  const { workspace, preview } = await getAppContext();
  const admin = workspace.role !== "member";
  const head = (
    <PageHead
      title="Find leads"
      note="Let a saved search keep looking on its own. Each time it runs, the new companies it finds go into a list, never ones already in your leads, your CRM, your never-contact list or the list itself."
    />
  );
  if (preview)
    return (
      <>
        {head}
        <FindTabs current="always" />
        <section className={cn(panel, "p-4 text-[13px]")}>
          This needs the real app. Nothing is shown here with made-up data.
        </section>
      </>
    );
  const supabase = await createClient();
  const [schedRes, searchRes, options] = await Promise.all([
    supabase
      .from("sourcing_schedules")
      .select(
        "id, search_id, list_id, recipe_id, every_days, enabled, status, next_run_at, last_run_at, last_added, last_note, month, month_runs",
      )
      .eq("workspace_id", workspace.id)
      .order("created_at"),
    supabase
      .from("prospect_searches")
      .select("id, name")
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false })
      .limit(50),
    dataOptions(supabase, workspace.id),
  ]);
  const schedules = (schedRes.data ?? []) as Schedule[];
  const searches = (searchRes.data ?? []) as { id: string; name: string }[];
  const lists = options.lists.filter((l) => l.kind === "companies");
  const recipes = options.recipes.filter((r) => r.applies_to === "companies");
  const searchName = new Map(searches.map((s) => [s.id, s.name]));
  const listName = new Map(options.lists.map((l) => [l.id, l.name]));
  const thisMonth = new Date().toISOString().slice(0, 7);
  const runs = schedules.reduce(
    (n, s) => n + (s.month?.startsWith(thisMonth) ? s.month_runs : 0),
    0,
  );
  return (
    <>
      {head}
      <FindTabs current="always" />
      <div className="grid gap-3 lg:grid-cols-[1fr_380px]">
        <section className={cn(panel, "min-w-0")}>
          <h2 className={panelHead}>
            Schedules
            <span className="text-[12px] font-normal text-[#0B0B0C]/50">
              {schedules.length} of {SOURCING_MAX}
            </span>
          </h2>
          {schedules.length === 0 ? (
            <Empty icon={CalendarClock} title="Nothing scheduled">
              {searches.length
                ? "Choose one of your saved searches on the right."
                : "Save a search under Search first, then schedule it here."}
            </Empty>
          ) : (
            <ul className="divide-y divide-black/[0.06]">
              {schedules.map((s) => (
                <li key={s.id}>
                  <details>
                    <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-4 py-3 text-[13px] hover:bg-black/[0.02]">
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">
                          {searchName.get(s.search_id) ?? "A search"}
                        </span>
                        <span className="block text-[12px] text-[#0B0B0C]/60">
                          Every {s.every_days}{" "}
                          {s.every_days === 1 ? "day" : "days"} into{" "}
                          <Link
                            href={`/app/lists/${s.list_id}`}
                            className="underline decoration-black/25 underline-offset-2"
                          >
                            {listName.get(s.list_id) ?? "a list"}
                          </Link>
                          {s.last_run_at
                            ? ` · last ran ${ago(s.last_run_at)}, ${s.last_added} new`
                            : " · not run yet"}
                          {s.status === "idle" && s.enabled
                            ? ` · next ${dateTime(s.next_run_at, workspace.timezone)}`
                            : ""}
                        </span>
                        {s.last_note && (
                          <span className="block text-[12px] text-[#0B0B0C]/45">
                            {s.last_note}
                          </span>
                        )}
                      </span>
                      {!s.enabled ? (
                        <Badge tone="outline">Off</Badge>
                      ) : s.status === "running" ? (
                        <Badge tone="ink">Running</Badge>
                      ) : null}
                    </summary>
                    <ScheduleForm
                      s={s}
                      searches={searches}
                      lists={lists}
                      recipes={recipes}
                      admin={admin}
                    />
                    {admin && (
                      <ActionForm
                        action={deleteSchedule}
                        confirm="Remove this schedule? The list keeps what it found."
                        className="px-4 pb-4"
                      >
                        <input type="hidden" name="id" value={s.id} />
                        <SubmitButton
                          variant="ghost"
                          small
                          pendingText="Removing…"
                        >
                          Remove schedule
                        </SubmitButton>
                      </ActionForm>
                    )}
                  </details>
                </li>
              ))}
            </ul>
          )}
        </section>
        <aside className="min-w-0 space-y-3">
          {admin && searches.length > 0 && schedules.length < SOURCING_MAX && (
            <section className={panel}>
              <h2 className={panelHead}>New schedule</h2>
              <ScheduleForm
                s={null}
                searches={searches}
                lists={lists}
                recipes={recipes}
                admin={admin}
              />
            </section>
          )}
          <section className={panel}>
            <h2 className={panelHead}>Limits</h2>
            <ul className={cn(hint, "space-y-1.5 p-4 text-[12.5px]")}>
              <li>
                {runs} of {SOURCING_RUNS_PER_MONTH} scheduled runs used this
                month (all schedules together).
              </li>
              <li>
                Each run is a normal Find leads run, with its own caps: 25
                companies, 4 runs and $3 of research a day, and the contact
                database&apos;s daily credits.
              </li>
              <li>
                If Find leads is busy or today&apos;s limit is reached, it tries
                again later.
              </li>
              <li>
                A recipe is answered within the day&apos;s research limits on
                Lists.
              </li>
            </ul>
          </section>
        </aside>
      </div>
    </>
  );
}

export default function SourcingPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content />
    </Suspense>
  );
}
