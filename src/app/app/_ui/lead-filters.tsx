import { LEAD_STATUSES, STATUS_LABEL } from "@/lib/app/types";
import type { LeadFilters } from "@/lib/data/filters";
import type { AudienceRef, ListRef, RecipeRef } from "@/lib/data/read";
import { cn } from "@/lib/utils";
import { hint, input, labelCls } from "./kit";

// The fields of lead filters (src/lib/data/filters.ts), shared by saved
// audiences and playbooks. `basic` adds stage, source, size, country and
// time fields (a playbook has its own for some of them).

const optional = (
  <span className="font-normal text-[#0B0B0C]/45">(optional)</span>
);

const box = "size-4 accent-[#0B0B0C]";

export function LeadFilterFields({
  filters,
  lists,
  audiences,
  recipes,
  basic,
}: {
  filters: LeadFilters;
  lists: ListRef[];
  audiences?: AudienceRef[];
  recipes: RecipeRef[];
  basic: boolean;
}) {
  const f = filters;
  return (
    <div className="space-y-3">
      {basic && (
        <fieldset>
          <legend className={labelCls}>Stage {optional}</legend>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1.5 text-[13px]">
            {LEAD_STATUSES.map((s) => (
              <label key={s} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  name="statuses"
                  value={s}
                  defaultChecked={f.statuses?.includes(s) ?? false}
                  className={box}
                />
                {STATUS_LABEL[s]}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <fieldset>
        <legend className={labelCls}>Tier {optional}</legend>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1.5 text-[13px]">
          {[1, 2, 3].map((t) => (
            <label key={t} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                name="tiers"
                value={t}
                defaultChecked={f.tiers?.includes(t) ?? false}
                className={box}
              />
              Tier {t}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelCls}>
          Fit score at least {optional}
          <input
            name="min_fit"
            type="number"
            min={0}
            max={100}
            defaultValue={f.min_fit ?? ""}
            className={cn(input, "mt-1")}
          />
        </label>
        <label className={labelCls}>
          Engagement score at least {optional}
          <input
            name="min_engagement"
            type="number"
            min={0}
            max={100}
            defaultValue={f.min_engagement ?? ""}
            className={cn(input, "mt-1")}
          />
        </label>
        {basic && (
          <>
            <label className={labelCls}>
              Where they came from {optional}
              <input
                name="sources"
                maxLength={800}
                defaultValue={(f.sources ?? []).join(", ")}
                placeholder="form, website chat"
                className={cn(input, "mt-1")}
              />
            </label>
            <label className={labelCls}>
              Country {optional}
              <input
                name="countries"
                maxLength={800}
                defaultValue={(f.countries ?? []).join(", ")}
                placeholder="GB, Ireland"
                className={cn(input, "mt-1")}
              />
            </label>
            <label className={labelCls}>
              Company size, from {optional}
              <input
                name="size_min"
                type="number"
                min={1}
                defaultValue={f.size_min ?? ""}
                className={cn(input, "mt-1")}
              />
            </label>
            <label className={labelCls}>
              to {optional}
              <input
                name="size_max"
                type="number"
                min={1}
                defaultValue={f.size_max ?? ""}
                className={cn(input, "mt-1")}
              />
            </label>
            <label className={labelCls}>
              Active in the last {optional}
              <span className="mt-1 flex items-center gap-2 font-normal">
                <input
                  name="active_within_days"
                  type="number"
                  min={1}
                  max={730}
                  defaultValue={f.active_within_days ?? ""}
                  className={cn(input, "max-w-[120px]")}
                />
                days
              </span>
            </label>
            <label className={labelCls}>
              Quiet for at least {optional}
              <span className="mt-1 flex items-center gap-2 font-normal">
                <input
                  name="inactive_days"
                  type="number"
                  min={1}
                  max={730}
                  defaultValue={f.inactive_days ?? ""}
                  className={cn(input, "max-w-[120px]")}
                />
                days
              </span>
            </label>
          </>
        )}
        <label className={labelCls}>
          On the list {optional}
          <select
            name="list_id"
            defaultValue={f.list_id ?? ""}
            className={cn(input, "mt-1")}
          >
            <option value="">Any</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        {audiences && (
          <label className={labelCls}>
            In the saved audience {optional}
            <select
              name="audience_id"
              defaultValue={f.audience_id ?? ""}
              className={cn(input, "mt-1")}
            >
              <option value="">Any</option>
              {audiences.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {recipes.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
          <label className={labelCls}>
            A recipe&apos;s answer {optional}
            <select
              name="recipe_id"
              defaultValue={f.recipe?.id ?? ""}
              className={cn(input, "mt-1")}
            >
              <option value="">Any</option>
              {recipes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <label className={labelCls}>
            is
            <input
              name="recipe_answer"
              maxLength={80}
              defaultValue={f.recipe?.answer ?? ""}
              placeholder="yes, 70, or an option"
              className={cn(input, "mt-1")}
            />
          </label>
          <p className={cn(hint, "sm:col-span-2")}>
            Yes or no, a number for &quot;at least&quot;, or the exact option.
            Read from the latest answer on any list where the lead (or their
            company) has a row.
          </p>
        </div>
      )}
    </div>
  );
}
