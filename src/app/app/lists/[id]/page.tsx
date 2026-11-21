import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft, Download, ExternalLink, Table2 } from "lucide-react";
import { getAppContext } from "@/lib/app/context";
import {
  ANSWER_LABEL,
  ANSWER_TYPES,
  DATA_FIELD_LABEL,
  DATA_FIELD_NEEDS,
  DATA_FIELDS,
  type AnswerType,
  type DataField,
} from "@/lib/data/answers";
import {
  DATA_CELL_CREDITS,
  LIST_COLUMNS_MAX,
  LIST_PAGE_SIZE,
  RESEARCH_EST_MICROS_PER_CELL,
} from "@/lib/data/config";
import { dataOptions, dollars } from "@/lib/data/read";
import { isUuid } from "@/lib/leads/fields";
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
import { LiveRefresh } from "../../_ui/live";
import {
  addColumn,
  addRows,
  archiveList,
  deleteColumn,
  renameList,
  rowsAction,
  saveColumnAsRecipe,
} from "../actions";
import { NewListFields } from "../new-list-fields";

export const metadata: Metadata = { title: "List" };

type Column = {
  id: string;
  name: string;
  kind: "research" | "data";
  question: string | null;
  answer_type: AnswerType | null;
  options: string[];
  data_field: DataField | null;
  recipe_id: string | null;
};

type Row = {
  id: string;
  name: string;
  title: string;
  company: string;
  domain: string | null;
  email: string | null;
  country: string;
  size_range: string;
  lead_id: string | null;
  account_id: string | null;
};

type Cell = {
  row_id: string;
  column_id: string;
  status: "queued" | "running" | "done" | "failed" | "skipped";
  value_text: string;
  source_url: string | null;
  reason: string;
};

const box = "size-4 accent-[#0B0B0C]";

function CellView({ cell }: { cell: Cell | undefined }) {
  if (!cell) return <span className="text-[#0B0B0C]/30">·</span>;
  if (cell.status === "queued")
    return <span className="text-[#0B0B0C]/45">Waiting…</span>;
  if (cell.status === "running")
    return <span className="text-[#0B0B0C]/45">Working…</span>;
  if (cell.status === "failed")
    return (
      <span title={cell.reason} className="text-[#B42318]">
        Couldn&apos;t answer
      </span>
    );
  if (cell.status === "skipped")
    return (
      <span title={cell.reason} className="text-[#0B0B0C]/40">
        Skipped
      </span>
    );
  return (
    <span
      title={cell.reason}
      className="inline-flex max-w-[260px] items-start gap-1"
    >
      <span
        className={cn("line-clamp-2", !cell.value_text && "text-[#0B0B0C]/45")}
      >
        {cell.value_text || "Not found"}
      </span>
      {cell.source_url && (
        <a
          href={cell.source_url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          aria-label="Source"
          className="mt-0.5 shrink-0 text-[#0B0B0C]/45 hover:text-[#0B0B0C]"
        >
          <ExternalLink aria-hidden className="size-3" />
        </a>
      )}
    </span>
  );
}

async function Content({
  params,
  searchParams,
}: {
  params: PageProps<"/app/lists/[id]">["params"];
  searchParams: PageProps<"/app/lists/[id]">["searchParams"];
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!isUuid(id)) notFound();
  const { workspace, preview } = await getAppContext();
  if (preview) notFound();
  const page = Math.max(1, Math.min(Number(sp.page) || 1, 100));
  const supabase = await createClient();
  const { data: list } = await supabase
    .from("data_lists")
    .select("id, name, kind, source, is_target")
    .eq("workspace_id", workspace.id)
    .eq("id", id)
    .is("archived_at", null)
    .maybeSingle();
  if (!list) notFound();
  const kind = list.kind as "companies" | "people";
  const from = (page - 1) * LIST_PAGE_SIZE;
  const [columnsRes, rowsRes, options, searchesRes, pending] =
    await Promise.all([
      supabase
        .from("data_list_columns")
        .select(
          "id, name, kind, question, answer_type, options, data_field, recipe_id",
        )
        .eq("workspace_id", workspace.id)
        .eq("list_id", id)
        .order("position"),
      supabase
        .from("data_list_rows")
        .select(
          "id, name, title, company, domain, email, country, size_range, lead_id, account_id",
          { count: "exact" },
        )
        .eq("workspace_id", workspace.id)
        .eq("list_id", id)
        .order("position")
        .range(from, from + LIST_PAGE_SIZE - 1),
      dataOptions(supabase, workspace.id),
      supabase
        .from("prospect_searches")
        .select("id, name")
        .eq("workspace_id", workspace.id)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("data_cells")
        .select("row_id", { count: "exact", head: true })
        .eq("workspace_id", workspace.id)
        .eq("list_id", id)
        .in("status", ["queued", "running"]),
    ]);
  const columns = (columnsRes.data ?? []) as Column[];
  const rows = (rowsRes.data ?? []) as Row[];
  const total = rowsRes.count ?? rows.length;
  const pages = Math.max(1, Math.ceil(total / LIST_PAGE_SIZE));
  const { data: cellData } =
    rows.length && columns.length
      ? await supabase
          .from("data_cells")
          .select("row_id, column_id, status, value_text, source_url, reason")
          .eq("workspace_id", workspace.id)
          .eq("list_id", id)
          .in(
            "row_id",
            rows.map((r) => r.id),
          )
      : { data: [] };
  const cells = new Map<string, Cell>();
  for (const c of (cellData ?? []) as Cell[])
    cells.set(`${c.row_id}:${c.column_id}`, c);
  const working = (pending.count ?? 0) > 0;
  const recipes = options.recipes.filter((r) => r.applies_to === kind);

  return (
    <>
      {working && <LiveRefresh every={4000} />}
      <PageHead
        title={list.name}
        note={`${total.toLocaleString("en-GB")} ${kind === "companies" ? "companies" : "people"}${list.is_target ? " · a target account list" : ""}${working ? ` · ${pending.count} ${pending.count === 1 ? "answer" : "answers"} on the way` : ""}`}
      >
        <Link href="/app/lists" className={cn(btn.ghost, btn.small)}>
          <ArrowLeft aria-hidden className="size-3.5" />
          Lists
        </Link>
        <a
          href={`/app/lists/${id}/export`}
          className={cn(btn.secondary, btn.small)}
        >
          <Download aria-hidden className="size-3.5" />
          Export CSV
        </a>
      </PageHead>

      <div className="grid gap-3 xl:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-3">
          <section className={cn(panel, "overflow-hidden")}>
            <ActionForm
              action={rowsAction}
              id="rows-form"
              className="space-y-3 border-b border-black/[0.06] p-4"
            >
              <input type="hidden" name="list" value={id} />
              {columns.length > 0 && (
                <fieldset>
                  <legend className={labelCls}>Fill these columns</legend>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1.5 text-[13px]">
                    {columns.map((c) => (
                      <label key={c.id} className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          name="columns"
                          value={c.id}
                          defaultChecked
                          className={box}
                        />
                        {c.name}
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" name="all" className={box} />
                  Every row ({total.toLocaleString("en-GB")}), not just the
                  ticked ones
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" name="rerun" className={box} />
                  Answer again where answered
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {columns.length > 0 && (
                  <>
                    <SubmitButton
                      name="do"
                      value="estimate"
                      variant="secondary"
                      small
                      pendingText="Working it out…"
                    >
                      Estimate cost
                    </SubmitButton>
                    <SubmitButton
                      name="do"
                      value="run"
                      small
                      pendingText="Starting…"
                    >
                      Run
                    </SubmitButton>
                  </>
                )}
                <SubmitButton
                  name="do"
                  value="leads"
                  variant="secondary"
                  small
                  pendingText="Adding…"
                >
                  Send to Leads
                </SubmitButton>
                {options.playbooks.length > 0 && (
                  <span className="flex items-center gap-1.5">
                    <select
                      name="playbook"
                      defaultValue=""
                      aria-label="Playbook"
                      className={cn(
                        input,
                        "h-8 w-auto rounded-full py-0 pr-8 text-[12.5px]",
                      )}
                    >
                      <option value="">Choose a playbook</option>
                      {options.playbooks.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <SubmitButton
                      name="do"
                      value="play"
                      variant="secondary"
                      small
                      pendingText="Starting…"
                    >
                      Start the playbook
                    </SubmitButton>
                  </span>
                )}
                {kind === "companies" && (
                  <SubmitButton
                    name="do"
                    value="accounts"
                    variant="secondary"
                    small
                    pendingText="Adding…"
                  >
                    Make target accounts
                  </SubmitButton>
                )}
                <SubmitButton
                  name="do"
                  value="delete"
                  variant="ghost"
                  small
                  pendingText="Removing…"
                >
                  Remove ticked rows
                </SubmitButton>
              </div>
              <p className={hint}>
                A research answer is estimated at{" "}
                {dollars(RESEARCH_EST_MICROS_PER_CELL)} (the model and up to two
                web searches); a lookup at {DATA_CELL_CREDITS.work_email} to{" "}
                {DATA_CELL_CREDITS.title} credits, nothing when nothing is
                found. Press Estimate cost to see a run&apos;s total and what is
                left today first. Sending to a playbook adds the rows to Leads
                and picks up to 50 of them, with every rule the playbook keeps.
              </p>
            </ActionForm>
            {rows.length === 0 ? (
              <Empty icon={Table2} title="No rows yet">
                Add rows from a CSV, Find leads, your leads or your CRM.
              </Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-[12.5px]">
                  <thead className="border-b border-black/[0.06] text-[11.5px] text-[#0B0B0C]/55">
                    <tr>
                      <th className="w-8 px-3 py-2">
                        <span className="sr-only">Choose</span>
                      </th>
                      <th className="px-3 py-2 font-medium">
                        {kind === "companies" ? "Company" : "Person"}
                      </th>
                      {kind === "people" && (
                        <th className="px-3 py-2 font-medium">Title</th>
                      )}
                      <th className="px-3 py-2 font-medium">Website</th>
                      <th className="px-3 py-2 font-medium">Email</th>
                      <th className="px-3 py-2 font-medium">Country</th>
                      <th className="px-3 py-2 font-medium">Size</th>
                      {columns.map((c) => (
                        <th
                          key={c.id}
                          className="px-3 py-2 font-medium"
                          title={c.question ?? DATA_FIELD_LABEL[c.data_field!]}
                        >
                          {c.name}
                          <span className="block font-normal text-[#0B0B0C]/40">
                            {c.kind === "research"
                              ? ANSWER_LABEL[c.answer_type!]
                              : "Lookup"}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/[0.05]">
                    {rows.map((r) => (
                      <tr
                        key={r.id}
                        className="align-top hover:bg-black/[0.015]"
                      >
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            name="rows"
                            value={r.id}
                            form="rows-form"
                            aria-label={`Choose ${r.name || r.company}`}
                            className={box}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <span className="font-medium">
                            {kind === "companies"
                              ? r.company || r.domain
                              : r.name}
                          </span>
                          {kind === "people" && r.company && (
                            <span className="block text-[#0B0B0C]/55">
                              {r.company}
                            </span>
                          )}
                          {r.lead_id && (
                            <Link
                              href={`/app/leads/${r.lead_id}`}
                              className="block text-[11.5px] text-[#0B0B0C]/55 underline decoration-black/20 underline-offset-2"
                            >
                              In Leads
                            </Link>
                          )}
                          {r.account_id && (
                            <Link
                              href={`/app/accounts/${r.account_id}`}
                              className="block text-[11.5px] text-[#0B0B0C]/55 underline decoration-black/20 underline-offset-2"
                            >
                              Account
                            </Link>
                          )}
                        </td>
                        {kind === "people" && (
                          <td className="px-3 py-2">{r.title}</td>
                        )}
                        <td className="px-3 py-2 text-[#0B0B0C]/70">
                          {r.domain}
                        </td>
                        <td className="px-3 py-2 text-[#0B0B0C]/70">
                          {r.email}
                        </td>
                        <td className="px-3 py-2 text-[#0B0B0C]/70">
                          {r.country}
                        </td>
                        <td className="px-3 py-2 text-[#0B0B0C]/70">
                          {r.size_range}
                        </td>
                        {columns.map((c) => (
                          <td key={c.id} className="px-3 py-2">
                            <CellView cell={cells.get(`${r.id}:${c.id}`)} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {pages > 1 && (
              <nav
                aria-label="Pages"
                className="flex items-center justify-between border-t border-black/[0.06] px-4 py-2 text-[12.5px]"
              >
                {page > 1 ? (
                  <Link
                    href={`/app/lists/${id}?page=${page - 1}`}
                    className={cn(btn.ghost, btn.small)}
                  >
                    Previous
                  </Link>
                ) : (
                  <span />
                )}
                <span className="text-[#0B0B0C]/55">
                  Page {page} of {pages}
                </span>
                {page < pages ? (
                  <Link
                    href={`/app/lists/${id}?page=${page + 1}`}
                    className={cn(btn.ghost, btn.small)}
                  >
                    Next
                  </Link>
                ) : (
                  <span />
                )}
              </nav>
            )}
          </section>

          {columns.length > 0 && (
            <section className={panel}>
              <h2 className={panelHead}>Columns</h2>
              <ul className="divide-y divide-black/[0.06]">
                {columns.map((c) => (
                  <li
                    key={c.id}
                    className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-[13px]"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{c.name}</span>
                      <span className="block text-[12px] text-[#0B0B0C]/55">
                        {c.kind === "research"
                          ? `"${c.question}" · ${ANSWER_LABEL[c.answer_type!]}${c.options.length ? `: ${c.options.join(", ")}` : ""}`
                          : `${DATA_FIELD_LABEL[c.data_field!]}, from the contact database. Needs ${DATA_FIELD_NEEDS[c.data_field!]}.`}
                      </span>
                    </span>
                    {c.recipe_id ? (
                      <Badge tone="outline">Recipe</Badge>
                    ) : (
                      c.kind === "research" && (
                        <ActionForm action={saveColumnAsRecipe}>
                          <input type="hidden" name="column" value={c.id} />
                          <SubmitButton
                            variant="ghost"
                            small
                            pendingText="Saving…"
                          >
                            Save as recipe
                          </SubmitButton>
                        </ActionForm>
                      )
                    )}
                    <ActionForm
                      action={deleteColumn}
                      confirm="Remove this column and its answers?"
                    >
                      <input type="hidden" name="column" value={c.id} />
                      <SubmitButton
                        variant="ghost"
                        small
                        pendingText="Removing…"
                      >
                        Remove
                      </SubmitButton>
                    </ActionForm>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <aside className="min-w-0 space-y-3">
          <section className={panel}>
            <h2 className={panelHead}>
              Add a column
              <span className="text-[12px] font-normal text-[#0B0B0C]/50">
                {columns.length} of {LIST_COLUMNS_MAX}
              </span>
            </h2>
            <ActionForm
              action={addColumn}
              resetOnSuccess
              className="space-y-3 p-4"
            >
              <input type="hidden" name="list" value={id} />
              <input type="hidden" name="kind" value="research" />
              <p className="text-[12.5px] font-medium">Ask a question</p>
              <label className={labelCls}>
                The question, for each row
                <textarea
                  name="question"
                  required
                  rows={2}
                  maxLength={600}
                  placeholder={
                    kind === "companies"
                      ? "Does this company sell to schools?"
                      : "Does this person manage a sales team?"
                  }
                  className={cn(input, "mt-1")}
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <label className={labelCls}>
                  The answer is
                  <select
                    name="answer_type"
                    defaultValue="yes_no"
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
                  Column name{" "}
                  <span className="font-normal text-[#0B0B0C]/45">
                    (optional)
                  </span>
                  <input
                    name="name"
                    maxLength={60}
                    className={cn(input, "mt-1")}
                  />
                </label>
              </div>
              <label className={labelCls}>
                Options, for &quot;one of a few&quot;
                <input
                  name="options"
                  maxLength={400}
                  placeholder="Small, Medium, Large"
                  className={cn(input, "mt-1")}
                />
              </label>
              <p className={hint}>
                Answered by the model with up to two web searches, with the page
                it came from and a short reason. &quot;Not found&quot; when it
                can&apos;t tell: it never guesses.
              </p>
              <SubmitButton small>Add the question</SubmitButton>
            </ActionForm>
            <ActionForm
              action={addColumn}
              className="space-y-3 border-t border-black/[0.06] p-4"
            >
              <input type="hidden" name="list" value={id} />
              <input type="hidden" name="kind" value="data" />
              <label className={labelCls}>
                Or look up
                <select
                  name="data_field"
                  defaultValue="work_email"
                  className={cn(input, "mt-1")}
                >
                  {DATA_FIELDS.map((f) => (
                    <option key={f} value={f}>
                      {DATA_FIELD_LABEL[f]} (needs {DATA_FIELD_NEEDS[f]})
                    </option>
                  ))}
                </select>
              </label>
              <p className={hint}>
                From the contact database. Work emails are only ever the ones it
                finds and checks, never made up from a name.
              </p>
              <SubmitButton small variant="secondary">
                Add the lookup
              </SubmitButton>
            </ActionForm>
            {recipes.length > 0 && (
              <ActionForm
                action={addColumn}
                className="space-y-3 border-t border-black/[0.06] p-4"
              >
                <input type="hidden" name="list" value={id} />
                <input type="hidden" name="kind" value="recipe" />
                <label className={labelCls}>
                  Or a saved recipe
                  <select
                    name="recipe_id"
                    defaultValue=""
                    className={cn(input, "mt-1")}
                  >
                    <option value="">Choose a recipe</option>
                    {recipes.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </label>
                <SubmitButton small variant="secondary">
                  Add the recipe
                </SubmitButton>
              </ActionForm>
            )}
          </section>

          <section className={panel}>
            <h2 className={panelHead}>Add rows</h2>
            <ActionForm
              action={addRows}
              resetOnSuccess
              className="space-y-3 p-4"
            >
              <input type="hidden" name="list" value={id} />
              <NewListFields
                searches={
                  (searchesRes.data ?? []) as { id: string; name: string }[]
                }
                audiences={options.audiences}
              />
              <SubmitButton small pendingText="Adding…">
                Add rows
              </SubmitButton>
            </ActionForm>
          </section>

          <section className={panel}>
            <h2 className={panelHead}>This list</h2>
            <ActionForm
              action={renameList}
              className="flex items-end gap-2 p-4"
            >
              <input type="hidden" name="list" value={id} />
              <label className={cn(labelCls, "flex-1")}>
                Name
                <input
                  name="name"
                  required
                  maxLength={80}
                  defaultValue={list.name}
                  className={cn(input, "mt-1")}
                />
              </label>
              <SubmitButton small variant="secondary">
                Rename
              </SubmitButton>
            </ActionForm>
            <ActionForm
              action={archiveList}
              confirm="Remove this list? Its rows and answers go too; leads made from it stay."
              className="border-t border-black/[0.06] px-4 py-3"
            >
              <input type="hidden" name="list" value={id} />
              <SubmitButton variant="ghost" small pendingText="Removing…">
                Remove list
              </SubmitButton>
            </ActionForm>
          </section>
        </aside>
      </div>
    </>
  );
}

export default function ListPage(props: PageProps<"/app/lists/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}
