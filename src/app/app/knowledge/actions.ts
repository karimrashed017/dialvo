"use server";

import { refresh } from "next/cache";
import {
  ActionProblem,
  inWorkspace,
  mustSucceed,
  type ActionResult,
} from "@/lib/app/action";
import { cleanLongText, cleanText, isUuid } from "@/lib/leads/fields";

/** An http(s) address, tidied; "example.com/pricing" gets https://. */
function webAddress(value: string): string | null {
  const raw = value.trim();
  if (!raw || /\s/.test(raw)) return null;
  try {
    const url = new URL(
      /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`,
    );
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname.includes(".")) return null;
    return url.toString().slice(0, 2000);
  } catch {
    return null;
  }
}

/** Adds an item, or saves changes to one when the form carries its id. */
export async function saveKnowledge(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace, user }) => {
    const id = form.get("item");
    const kind = form.get("kind") === "url" ? "url" : "text";
    let title = cleanText(form.get("title"), 200);
    let content: string;
    if (kind === "url") {
      const url = webAddress(String(form.get("content") ?? ""));
      if (!url)
        throw new ActionProblem(
          "That doesn't look like a web address.",
          "content",
        );
      content = url;
      title ||= new URL(url).hostname;
    } else {
      content = cleanLongText(form.get("content"), 100000);
      if (!content) throw new ActionProblem("Add the text.", "content");
      if (!title) throw new ActionProblem("Give it a title.", "title");
    }
    // A URL is stored as an address only: reading the page comes later.
    const status = kind === "url" ? "not_fetched" : "ready";

    if (isUuid(id)) {
      const { data, error } = await supabase
        .from("knowledge_items")
        .update({ title, content, status })
        .eq("workspace_id", workspace.id)
        .eq("id", id)
        .eq("kind", kind)
        .select("id");
      mustSucceed({ error }, "update knowledge");
      if (!data?.length) throw new ActionProblem("That item doesn't exist.");
    } else
      mustSucceed(
        await supabase.from("knowledge_items").insert({
          workspace_id: workspace.id,
          title,
          kind,
          content,
          status,
          created_by: user.id,
        }),
        "add knowledge",
      );
    refresh();
    return { ok: true, message: isUuid(id) ? "Saved." : "Added." };
  });
}

export async function deleteKnowledge(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace }) => {
    const id = form.get("item");
    if (!isUuid(id)) throw new ActionProblem("That item doesn't exist.");
    mustSucceed(
      await supabase
        .from("knowledge_items")
        .delete()
        .eq("workspace_id", workspace.id)
        .eq("id", id),
      "delete knowledge",
    );
    refresh();
    return { ok: true };
  });
}
