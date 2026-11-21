"use server";

import { refresh } from "next/cache";
import {
  ActionProblem,
  inWorkspace,
  mustSucceed,
  type ActionResult,
} from "@/lib/app/action";
import { cleanText, isUuid } from "@/lib/leads/fields";

// Territories and their reps, saved by an owner or admin (the database
// checks again, including that every rep is in the workspace), and
// assigning the accounts to them.

const list = (value: FormDataEntryValue | null) =>
  String(value ?? "")
    .split(/[,\n]/)
    .map((v) => cleanText(v, 80))
    .filter(Boolean)
    .slice(0, 30);

const size = (value: FormDataEntryValue | null, field: string) => {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 10_000_000)
    throw new ActionProblem(
      "Give the company size as a number of people.",
      field,
    );
  return n;
};

export async function saveTerritory(form: FormData): Promise<ActionResult> {
  return inWorkspace(
    async ({ supabase, workspace }) => {
      const id = form.get("id");
      const name = cleanText(form.get("name"), 80);
      if (!name) throw new ActionProblem("Give the territory a name.", "name");
      const reps = form.getAll("reps").map(String).filter(isUuid);
      if (reps.length === 0)
        throw new ActionProblem("Choose its reps.", "reps");
      const lo = size(form.get("size_min"), "size_min");
      const hi = size(form.get("size_max"), "size_max");
      if (lo && hi && lo > hi)
        throw new ActionProblem(
          "The smallest size has to be under the largest.",
          "size_min",
        );
      const position = Number(form.get("position") ?? 0);
      const { error } = await supabase.rpc("territory_save", {
        p_workspace_id: workspace.id,
        p_id: isUuid(id) ? id : null,
        p_name: name,
        p_position: Number.isInteger(position)
          ? Math.min(Math.max(position, 0), 1000)
          : 0,
        p_countries: list(form.get("countries")),
        p_regions: list(form.get("regions")),
        p_size_min: lo,
        p_size_max: hi,
        p_reps: reps,
      });
      if (error?.code === "P0001")
        throw new ActionProblem("A workspace can have 50 territories.");
      if (error?.code === "22023")
        throw new ActionProblem(
          "Some of those settings are out of range, or a rep isn't in the workspace.",
        );
      mustSucceed({ error }, "save territory");
      refresh();
      return {
        ok: true,
        message: "Saved. New leads in it go to its reps from now on.",
      };
    },
    { admin: true },
  );
}

export async function deleteTerritory(form: FormData): Promise<ActionResult> {
  return inWorkspace(
    async ({ supabase, workspace }) => {
      const id = form.get("id");
      if (!isUuid(id)) throw new ActionProblem("That territory doesn't exist.");
      const { error } = await supabase.rpc("territory_delete", {
        p_workspace_id: workspace.id,
        p_id: id,
      });
      mustSucceed({ error }, "delete territory");
      refresh();
      return { ok: true, message: "Removed. Accounts keep their owners." };
    },
    { admin: true },
  );
}

export async function assignTerritories(form: FormData): Promise<ActionResult> {
  return inWorkspace(
    async ({ supabase, workspace }) => {
      const { data, error } = await supabase.rpc("territories_assign", {
        p_workspace_id: workspace.id,
        p_balance: form.get("balance") === "score" ? "score" : "count",
        p_reassign: form.get("reassign") === "on",
      });
      mustSucceed({ error }, "assign territories");
      const r = data as {
        accounts: number;
        assigned: number;
        no_territory: number;
        leads: number;
      };
      refresh();
      return {
        ok: true,
        message: `${r.assigned} of ${r.accounts} accounts given an owner${r.no_territory ? `; ${r.no_territory} fit no territory` : ""}${r.leads ? `; ${r.leads} of their leads went to the same person` : ""}.`,
      };
    },
    { admin: true },
  );
}
