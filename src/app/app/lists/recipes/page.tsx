import type { Metadata } from "next";
import { Suspense } from "react";
import { FlaskConical } from "lucide-react";
import { getAppContext } from "@/lib/app/context";
import { ANSWER_LABEL, ANSWER_TYPES } from "@/lib/data/answers";
import { RECIPES_MAX } from "@/lib/data/config";
import type { RecipeRef } from "@/lib/data/read";
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
import { LIST_TABS, SectionTabs } from "../../_ui/tabs";
import { archiveRecipe, saveRecipe } from "./actions";

export const metadata: Metadata = { title: "Recipes" };

function RecipeForm({ recipe }: { recipe: RecipeRef | null }) {
  return (
    <ActionForm
      action={saveRecipe}
      resetOnSuccess={!recipe}
      className="space-y-3 p-4"
    >
      {recipe && <input type="hidden" name="id" value={recipe.id} />}
      <label className={labelCls}>
        Name
        <input
          name="name"
          required
          maxLength={60}
          defaultValue={recipe?.name ?? ""}
          placeholder="Sells to schools"
          className={cn(input, "mt-1")}
        />
      </label>
      <label className={labelCls}>
        The question
        <textarea
          name="question"
          required
          rows={3}
          maxLength={600}
          defaultValue={recipe?.question ?? ""}
          placeholder="How well does this company fit a business that sells booking software to multi-site gyms? 100 is a perfect fit."
          className={cn(input, "mt-1")}
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelCls}>
          The answer is
          <select
            name="answer_type"
            defaultValue={recipe?.answer_type ?? "yes_no"}
            className={cn(input, "mt-1")}
          >
            {ANSWER_TYPES.map((t) => (
              <option key={t} value={t}>
                {ANSWER_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <label className={labelCls}>
          About
          <select
            name="applies_to"
            defaultValue={recipe?.applies_to ?? "companies"}
            className={cn(input, "mt-1")}
          >
            <option value="companies">Companies</option>
            <option value="people">People</option>
          </select>
        </label>
      </div>
      <label className={labelCls}>
        Options, for &quot;one of a few&quot;
        <input
          name="options"
          maxLength={400}
          defaultValue={recipe?.options.join(", ") ?? ""}
          className={cn(input, "mt-1")}
        />
      </label>
      <SubmitButton small>{recipe ? "Save" : "Save recipe"}</SubmitButton>
    </ActionForm>
  );
}

async function Content() {
  const { workspace, preview } = await getAppContext();
  const head = (
    <PageHead
      title="Recipes"
      note="A research question or a score you use again and again, saved once. Add it to any list, have an always-on search answer it for every new company, count it in lead scoring, and pick leads by its answer in audiences and playbooks."
    />
  );
  if (preview)
    return (
      <>
        {head}
        <section className={cn(panel, "p-4 text-[13px]")}>
          Recipes need the real app. Nothing is shown here with made-up data.
        </section>
      </>
    );
  const supabase = await createClient();
  const [recipesRes, columnsRes] = await Promise.all([
    supabase
      .from("data_recipes")
      .select("id, name, kind, applies_to, question, answer_type, options")
      .eq("workspace_id", workspace.id)
      .is("archived_at", null)
      .order("created_at"),
    supabase
      .from("data_list_columns")
      .select("recipe_id")
      .eq("workspace_id", workspace.id)
      .not("recipe_id", "is", null)
      .limit(1000),
  ]);
  const recipes = (recipesRes.data ?? []) as RecipeRef[];
  const used = new Map<string, number>();
  for (const c of (columnsRes.data ?? []) as { recipe_id: string }[])
    used.set(c.recipe_id, (used.get(c.recipe_id) ?? 0) + 1);
  return (
    <>
      {head}
      <SectionTabs
        label="Lists and recipes"
        tabs={LIST_TABS}
        current="recipes"
      />
      <div className="grid gap-3 lg:grid-cols-[1fr_380px]">
        <section className={cn(panel, "min-w-0")}>
          <h2 className={panelHead}>
            Saved recipes
            <span className="text-[12px] font-normal text-[#0B0B0C]/50">
              {recipes.length} of {RECIPES_MAX}
            </span>
          </h2>
          {recipes.length === 0 ? (
            <Empty icon={FlaskConical} title="No recipes yet">
              Save one here, or press &quot;Save as recipe&quot; on a
              list&apos;s research column.
            </Empty>
          ) : (
            <ul className="divide-y divide-black/[0.06]">
              {recipes.map((r) => (
                <li key={r.id}>
                  <details>
                    <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-4 py-3 text-[13px] hover:bg-black/[0.02]">
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">{r.name}</span>
                        <span className="block text-[12px] text-[#0B0B0C]/55">
                          &quot;{r.question}&quot; ·{" "}
                          {ANSWER_LABEL[r.answer_type]} · about {r.applies_to}
                        </span>
                      </span>
                      {r.kind === "score" && (
                        <Badge tone="outline">Score</Badge>
                      )}
                      <span className="text-[12px] text-[#0B0B0C]/50">
                        On {used.get(r.id) ?? 0}{" "}
                        {(used.get(r.id) ?? 0) === 1 ? "list" : "lists"}
                      </span>
                    </summary>
                    <RecipeForm recipe={r} />
                    <ActionForm
                      action={archiveRecipe}
                      confirm="Remove this recipe?"
                      className="px-4 pb-4"
                    >
                      <input type="hidden" name="id" value={r.id} />
                      <SubmitButton
                        variant="ghost"
                        small
                        pendingText="Removing…"
                      >
                        Remove recipe
                      </SubmitButton>
                    </ActionForm>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </section>
        <aside className="min-w-0 space-y-3">
          <section className={panel}>
            <h2 className={panelHead}>New recipe</h2>
            <RecipeForm recipe={null} />
          </section>
          <section className={panel}>
            <h2 className={panelHead}>Where recipes work</h2>
            <ul className={cn(hint, "space-y-1.5 p-4 text-[12.5px]")}>
              <li>Lists: Add a column, then Or a saved recipe.</li>
              <li>
                Find leads, Always on: answered for every new company a
                scheduled search finds.
              </li>
              <li>
                Leads, Scoring and tiers: a score or yes/no recipe can count
                toward fit.
              </li>
              <li>
                Audiences and playbooks: pick leads by a recipe&apos;s answer.
              </li>
            </ul>
          </section>
        </aside>
      </div>
    </>
  );
}

export default function RecipesPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content />
    </Suspense>
  );
}
