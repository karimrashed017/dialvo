"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import {
  ActionProblem,
  inWorkspace,
  mustSucceed,
  type ActionContext,
  type ActionResult,
} from "@/lib/app/action";
import {
  ANSWER_TYPES,
  DATA_FIELDS,
  readOptions,
  type AnswerType,
} from "@/lib/data/answers";
import { cellsStep, defaultCellDeps } from "@/lib/data/cells";
import {
  ACCOUNTS_MAX,
  LIST_COLUMNS_MAX,
  LIST_IMPORT_MAX_BYTES,
  LIST_ROWS_MAX,
  LISTS_MAX,
  RECIPES_MAX,
  SEND_TO_PLAY_MAX,
} from "@/lib/data/config";
import { csvToRows } from "@/lib/data/csv";
import { dollars } from "@/lib/data/read";
import { createDataStore, type QueueResult } from "@/lib/data/store";
import { cleanLongText, cleanText, isUuid } from "@/lib/leads/fields";

// Lists, their rows and columns, and running columns. Writes go through the
// database's functions as the signed-in member (they check membership
// again); queuing a run and starting a playbook go through the secret key's
// functions, which take the person's id and check it.

const NOT_ON =
  "This isn't switched on yet on Dialvo's side. Nothing was started.";

const SOURCES = ["manual", "csv", "find_leads", "leads", "crm", "audience"];

/** Fills a list from what the form says, and says how it went. */
async function fill(
  { supabase, workspace }: ActionContext,
  listId: string,
  form: FormData,
): Promise<{ added: number; skipped: number; full: boolean }> {
  const source = String(form.get("source") ?? "manual");
  const call = async (name: string, args: Record<string, unknown>) => {
    const { data, error } = await supabase.rpc(name, args);
    mustSucceed({ error }, name);
    return data as { added: number; skipped: number; full: boolean };
  };
  if (source === "csv") {
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0)
      throw new ActionProblem("Choose a CSV file.", "file");
    if (file.size > LIST_IMPORT_MAX_BYTES)
      throw new ActionProblem(
        "That file is over 900 KB. Split it first.",
        "file",
      );
    const { rows } = csvToRows(await file.text(), LIST_ROWS_MAX);
    if (rows.length === 0)
      throw new ActionProblem(
        "That file has no rows under its header.",
        "file",
      );
    const total = { added: 0, skipped: 0, full: false };
    for (let i = 0; i < rows.length; i += 1000) {
      const r = await call("data_rows_add", {
        p_workspace_id: workspace.id,
        p_list_id: listId,
        p_rows: rows.slice(i, i + 1000),
        p_max: LIST_ROWS_MAX,
      });
      total.added += r.added;
      total.skipped += r.skipped;
      total.full ||= r.full;
    }
    return total;
  }
  if (source === "find_leads") {
    const search = form.get("search_id");
    if (!isUuid(search))
      throw new ActionProblem("Choose a Find leads search.", "search_id");
    return call("data_rows_from_search", {
      p_workspace_id: workspace.id,
      p_list_id: listId,
      p_search_id: search,
      p_max: LIST_ROWS_MAX,
    });
  }
  if (source === "crm")
    return call("data_rows_from_leads", {
      p_workspace_id: workspace.id,
      p_list_id: listId,
      p_lead_ids: null,
      p_crm: true,
      p_max: LIST_ROWS_MAX,
    });
  if (source === "leads" || source === "audience") {
    const audience = form.get("audience_id");
    if (source === "audience" && !isUuid(audience))
      throw new ActionProblem("Choose a saved audience.", "audience_id");
    const { data: ids, error } = await supabase.rpc("audience_lead_ids", {
      p_workspace_id: workspace.id,
      p_audience_id: source === "audience" ? audience : null,
      p_filters: {},
      p_limit: LIST_ROWS_MAX,
    });
    mustSucceed({ error }, "audience leads");
    return call("data_rows_from_leads", {
      p_workspace_id: workspace.id,
      p_list_id: listId,
      p_lead_ids: (ids as string[] | null) ?? [],
      p_crm: false,
      p_max: LIST_ROWS_MAX,
    });
  }
  return { added: 0, skipped: 0, full: false };
}

const filled = (r: { added: number; skipped: number; full: boolean }) =>
  `${r.added} ${r.added === 1 ? "row" : "rows"} added` +
  (r.skipped
    ? `, ${r.skipped} left out (already on the list, or no name, company or website)`
    : "") +
  (r.full
    ? `. The list is full at ${LIST_ROWS_MAX.toLocaleString("en-GB")} rows`
    : "") +
  ".";

export async function createList(form: FormData): Promise<ActionResult> {
  let id: string | null = null;
  const result = await inWorkspace(async (ctx) => {
    const name = cleanText(form.get("name"), 80);
    if (!name) throw new ActionProblem("Give the list a name.", "name");
    const kind = form.get("kind") === "people" ? "people" : "companies";
    const source = String(form.get("source") ?? "manual");
    if (!SOURCES.includes(source))
      throw new ActionProblem("Choose where the rows come from.", "source");
    const { data, error } = await ctx.supabase.rpc("data_list_save", {
      p_workspace_id: ctx.workspace.id,
      p_id: null,
      p_name: name,
      p_kind: kind,
      p_source: source,
      p_target: false,
      p_max: LISTS_MAX,
    });
    if (error?.code === "P0001")
      throw new ActionProblem(
        `This workspace has ${LISTS_MAX} lists. Remove one first.`,
      );
    mustSucceed({ error }, "create list");
    id = data as string;
    await fill(ctx, id, form);
  });
  if (result.ok && id) redirect(`/app/lists/${id}`);
  return result;
}

export async function addRows(form: FormData): Promise<ActionResult> {
  return inWorkspace(async (ctx) => {
    const id = form.get("list");
    if (!isUuid(id)) throw new ActionProblem("That list doesn't exist.");
    const r = await fill(ctx, id, form);
    refresh();
    return { ok: true, message: filled(r) };
  });
}

export async function renameList(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace }) => {
    const id = form.get("list");
    const name = cleanText(form.get("name"), 80);
    if (!isUuid(id)) throw new ActionProblem("That list doesn't exist.");
    if (!name) throw new ActionProblem("Give the list a name.", "name");
    const { error } = await supabase.rpc("data_list_save", {
      p_workspace_id: workspace.id,
      p_id: id,
      p_name: name,
      p_kind: null,
      p_source: null,
      p_target: null,
      p_max: LISTS_MAX,
    });
    mustSucceed({ error }, "rename list");
    refresh();
    return { ok: true, message: "Renamed." };
  });
}

export async function archiveList(form: FormData): Promise<ActionResult> {
  const result = await inWorkspace(async ({ supabase, workspace }) => {
    const id = form.get("list");
    if (!isUuid(id)) throw new ActionProblem("That list doesn't exist.");
    const { error } = await supabase.rpc("data_list_archive", {
      p_workspace_id: workspace.id,
      p_id: id,
    });
    mustSucceed({ error }, "archive list");
  });
  if (result.ok) redirect("/app/lists");
  return result;
}

// --- Columns ---------------------------------------------------------------------

export async function addColumn(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace }) => {
    const list = form.get("list");
    if (!isUuid(list)) throw new ActionProblem("That list doesn't exist.");
    const kind = String(form.get("kind") ?? "");
    const recipe = form.get("recipe_id");
    const args: Record<string, unknown> = {
      p_workspace_id: workspace.id,
      p_list_id: list,
      p_id: null,
      p_name: cleanText(form.get("name"), 60),
      p_kind: kind === "data" ? "data" : "research",
      p_question: null,
      p_answer_type: null,
      p_options: [],
      p_data_field: null,
      p_recipe_id: null,
      p_max: LIST_COLUMNS_MAX,
    };
    if (kind === "recipe") {
      if (!isUuid(recipe))
        throw new ActionProblem("Choose a recipe.", "recipe_id");
      args.p_recipe_id = recipe;
    } else if (kind === "data") {
      const field = String(form.get("data_field") ?? "");
      if (!(DATA_FIELDS as readonly string[]).includes(field))
        throw new ActionProblem("Choose what to look up.", "data_field");
      args.p_data_field = field;
      if (!args.p_name) args.p_name = field.replace(/_/g, " ");
    } else {
      const question = cleanLongText(form.get("question"), 600);
      const type = String(form.get("answer_type") ?? "");
      if (question.length < 5)
        throw new ActionProblem(
          "Write the question in a sentence.",
          "question",
        );
      if (!(ANSWER_TYPES as readonly string[]).includes(type))
        throw new ActionProblem(
          "Choose what kind of answer you want.",
          "answer_type",
        );
      const options =
        type === "pick_one"
          ? readOptions(String(form.get("options") ?? ""))
          : [];
      if (type === "pick_one" && options.length < 2)
        throw new ActionProblem(
          "Give two to eight options, separated by commas.",
          "options",
        );
      if (!args.p_name) args.p_name = question.slice(0, 60);
      Object.assign(args, {
        p_question: question,
        p_answer_type: type as AnswerType,
        p_options: options,
      });
    }
    const { error } = await supabase.rpc("data_column_save", args);
    if (error?.code === "P0001")
      throw new ActionProblem(`A list can have ${LIST_COLUMNS_MAX} columns.`);
    if (error?.code === "22023")
      throw new ActionProblem("Some of those settings are out of range.");
    mustSucceed({ error }, "add column");
    refresh();
    return {
      ok: true,
      message: "Column added. Choose rows and press Run to fill it.",
    };
  });
}

export async function deleteColumn(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace }) => {
    const id = form.get("column");
    if (!isUuid(id)) throw new ActionProblem("That column doesn't exist.");
    const { error } = await supabase.rpc("data_column_delete", {
      p_workspace_id: workspace.id,
      p_id: id,
    });
    mustSucceed({ error }, "delete column");
    refresh();
    return { ok: true, message: "Removed." };
  });
}

export async function saveColumnAsRecipe(
  form: FormData,
): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace }) => {
    const id = form.get("column");
    if (!isUuid(id)) throw new ActionProblem("That column doesn't exist.");
    const { error } = await supabase.rpc("data_recipe_from_column", {
      p_workspace_id: workspace.id,
      p_column_id: id,
      p_max: RECIPES_MAX,
    });
    if (error?.code === "P0001")
      throw new ActionProblem(`This workspace has ${RECIPES_MAX} recipes.`);
    mustSucceed({ error }, "save recipe");
    refresh();
    return {
      ok: true,
      message: "Saved as a recipe. Add it to any list from Add column.",
    };
  });
}

// --- Rows: run, send, remove -----------------------------------------------------------

function estimateLine(r: QueueResult): string {
  const parts: string[] = [];
  if (r.research)
    parts.push(
      `${r.research} research ${r.research === 1 ? "answer" : "answers"} (about ${dollars(r.micros ?? 0)})`,
    );
  if (r.credits)
    parts.push(
      `about ${r.credits} contact database ${r.credits === 1 ? "credit" : "credits"}`,
    );
  return parts.join(" and ");
}

function leftLine(r: QueueResult): string {
  return `Left today: ${r.left_cells ?? 0} research answers, ${dollars(r.left_micros ?? 0)} of research, ${r.left_credits ?? 0} credits.`;
}

export async function rowsAction(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace, user }) => {
    const list = form.get("list");
    if (!isUuid(list)) throw new ActionProblem("That list doesn't exist.");
    const all = form.get("all") === "on";
    const rows = all
      ? null
      : form.getAll("rows").map(String).filter(isUuid).slice(0, 2000);
    const action = String(form.get("do") ?? "");
    if (rows && rows.length === 0)
      throw new ActionProblem("Tick some rows first, or choose every row.");

    if (action === "delete") {
      if (!rows) throw new ActionProblem("Tick the rows to remove.");
      const { data, error } = await supabase.rpc("data_rows_delete", {
        p_workspace_id: workspace.id,
        p_list_id: list,
        p_row_ids: rows,
      });
      mustSucceed({ error }, "delete rows");
      refresh();
      return { ok: true, message: `${data as number} removed.` };
    }

    let rowIds = rows;
    if (!rowIds && (action === "leads" || action === "play")) {
      const { data } = await supabase
        .from("data_list_rows")
        .select("id")
        .eq("workspace_id", workspace.id)
        .eq("list_id", list)
        .order("position")
        .limit(2000);
      rowIds = ((data ?? []) as { id: string }[]).map((r) => r.id);
    }

    if (action === "leads" || action === "play") {
      const { data, error } = await supabase.rpc("data_rows_to_leads", {
        p_workspace_id: workspace.id,
        p_list_id: list,
        p_row_ids: rowIds,
      });
      mustSucceed({ error }, "rows to leads");
      const r = data as {
        added: number;
        linked: number;
        skipped: number;
        lead_ids: string[];
      };
      if (action === "leads") {
        refresh();
        return {
          ok: true,
          message: `${r.added} added to Leads, ${r.linked} already there${r.skipped ? `, ${r.skipped} left out (no email, company or website)` : ""}.`,
        };
      }
      const playbook = form.get("playbook");
      if (!isUuid(playbook))
        throw new ActionProblem("Choose a playbook.", "playbook");
      const store = createDataStore();
      if (!store) throw new ActionProblem(NOT_ON);
      const started = await store.startPlaybookFor({
        workspaceId: workspace.id,
        userId: user.id,
        playbookId: playbook,
        leadIds: r.lead_ids.slice(0, 2000),
        limit: SEND_TO_PLAY_MAX,
        label: "from a list",
      });
      refresh();
      if (started.status === "not_found")
        throw new ActionProblem("That playbook doesn't exist.");
      if (started.status === "empty")
        return {
          ok: false,
          message:
            "None of these can be written to by that playbook: they need an email, mustn't be on your never-contact list or already in a sequence, and must match the playbook's own filters.",
        };
      return {
        ok: true,
        message: `Started: ${started.selected} picked${started.left_out ? `, ${started.left_out} left out by the playbook's rules` : ""}. Their first emails are written under Plays, Your playbooks.`,
      };
    }

    if (action === "estimate" || action === "run") {
      const columns = form.getAll("columns").map(String).filter(isUuid);
      if (columns.length === 0)
        throw new ActionProblem("Tick the columns to fill.", "columns");
      const store = createDataStore();
      if (!store) throw new ActionProblem(NOT_ON);
      const r = await store.queue({
        workspaceId: workspace.id,
        userId: user.id,
        listId: list,
        columnIds: columns,
        rowIds,
        rerun: form.get("rerun") === "on",
        dryRun: action === "estimate",
      });
      if (r.status === "not_found")
        throw new ActionProblem("That list doesn't exist.");
      if (r.status === "empty")
        return {
          ok: true,
          message:
            'Those cells are answered already. Tick "Answer again" to redo them.',
        };
      if (r.status === "capped")
        return {
          ok: false,
          message:
            (r.max_cells && (r.cells ?? 0) > r.max_cells
              ? `That is ${r.cells} cells; one run can do ${r.max_cells}. Choose fewer rows or columns.`
              : `That would need ${estimateLine(r)}, more than is left today. `) +
            (r.max_cells && (r.cells ?? 0) > r.max_cells ? "" : leftLine(r)),
        };
      if (action === "estimate")
        return {
          ok: true,
          message: `This would answer ${r.cells} ${r.cells === 1 ? "cell" : "cells"}: ${estimateLine(r) || "nothing paid"}. ${leftLine(r)}`,
        };
      // Start at once; the scheduler carries on every minute.
      after(async () => {
        const deps = defaultCellDeps();
        if (deps) await cellsStep(deps).catch(() => undefined);
      });
      refresh();
      return {
        ok: true,
        message: `Running ${r.cells} ${r.cells === 1 ? "cell" : "cells"}${estimateLine(r) ? `: ${estimateLine(r)}` : ""}. Answers appear as they come in.`,
      };
    }

    if (action === "accounts") {
      const { data, error } = await supabase.rpc("accounts_from_list", {
        p_workspace_id: workspace.id,
        p_list_id: list,
        p_max: ACCOUNTS_MAX,
      });
      if (error?.code === "P0001")
        throw new ActionProblem(
          `A workspace can have ${ACCOUNTS_MAX} accounts.`,
        );
      mustSucceed({ error }, "accounts from list");
      const r = data as { added: number; existing: number };
      refresh();
      return {
        ok: true,
        message: `${r.added} target ${r.added === 1 ? "account" : "accounts"} added${r.existing ? `, ${r.existing} already were` : ""}. See them under Accounts.`,
      };
    }
    throw new ActionProblem("Choose what to do.");
  });
}
