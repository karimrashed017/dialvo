"use server";

import { refresh } from "next/cache";
import {
  ActionProblem,
  inWorkspace,
  mustSucceed,
  type ActionResult,
} from "@/lib/app/action";
import { cleanText, isUuid } from "@/lib/leads/fields";
import { ROUTING_PLAYS, type RoutingMatch } from "@/lib/routing/rules";

// Lead routing rules, saved by an owner or admin through routing_rule_save
// (the database checks again, including that every teammate on a rule is in
// the workspace).

const list = (value: FormDataEntryValue | null, max: number) =>
  String(value ?? "")
    .split(/[,\n]/)
    .map((v) => cleanText(v, 80))
    .filter(Boolean)
    .slice(0, max);

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

export async function saveRule(form: FormData): Promise<ActionResult> {
  return inWorkspace(
    async ({ supabase, workspace }) => {
      const id = form.get("id");
      const name = cleanText(form.get("name"), 80);
      if (!name) throw new ActionProblem("Give the rule a name.", "name");
      const match: RoutingMatch = {
        countries: list(form.get("countries"), 30),
        sources: list(form.get("sources"), 30),
        plays: form
          .getAll("plays")
          .map(String)
          .filter((p) => Object.hasOwn(ROUTING_PLAYS, p)),
        tiers: form
          .getAll("tiers")
          .map(Number)
          .filter((t) => t === 1 || t === 2 || t === 3),
        size_min: size(form.get("size_min"), "size_min"),
        size_max: size(form.get("size_max"), "size_max"),
      };
      if (
        match.size_min != null &&
        match.size_max != null &&
        match.size_min > match.size_max
      )
        throw new ActionProblem(
          "The smallest size has to be under the largest.",
          "size_min",
        );
      const people = form.getAll("assignees").map(String).filter(isUuid);
      if (people.length === 0)
        throw new ActionProblem("Choose who gets these leads.", "assignees");
      const position = Number(form.get("position") ?? 0);
      const { error } = await supabase.rpc("routing_rule_save", {
        p_workspace_id: workspace.id,
        p_id: isUuid(id) ? id : null,
        p_name: name,
        p_enabled: form.get("enabled") === "on",
        p_position: Number.isInteger(position)
          ? Math.min(Math.max(position, 0), 1000)
          : 0,
        p_match: match,
        p_mode: form.get("mode") === "round_robin" ? "round_robin" : "one",
        p_assignees: people,
      });
      if (error?.code === "P0001")
        throw new ActionProblem(
          "This workspace has 30 rules. Remove one first.",
        );
      if (error?.code === "22023")
        throw new ActionProblem(
          "Some of those settings are out of range, or someone chosen isn't in the workspace.",
        );
      mustSucceed({ error }, "save routing rule");
      refresh();
      return {
        ok: true,
        message: isUuid(id)
          ? "Saved. New leads are routed with it from now on."
          : "Rule added. New leads are routed with it from now on.",
      };
    },
    { admin: true },
  );
}

export async function deleteRule(form: FormData): Promise<ActionResult> {
  return inWorkspace(
    async ({ supabase, workspace }) => {
      const id = form.get("id");
      if (!isUuid(id)) throw new ActionProblem("That rule doesn't exist.");
      const { error } = await supabase.rpc("routing_rule_delete", {
        p_workspace_id: workspace.id,
        p_id: id,
      });
      mustSucceed({ error }, "delete routing rule");
      refresh();
      return { ok: true, message: "Removed." };
    },
    { admin: true },
  );
}
