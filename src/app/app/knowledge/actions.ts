"use server";

import { refresh } from "next/cache";
import {
  ActionProblem,
  inWorkspace,
  mustSucceed,
  type ActionResult,
} from "@/lib/app/action";
import { fetchPage, PageFetchError } from "@/lib/knowledge/fetch-page";
import { cleanLongText, cleanText, isUuid } from "@/lib/leads/fields";
import { createLimiter } from "@/lib/leads/rate-limit";

/** Reading web pages: 10 a minute per person. */
const pageLimit = createLimiter({ windowMs: 60_000, max: 10 });

/** Fetches a page for a teammate, turning its failures into plain words. */
async function readPage(userId: string, address: string) {
  if (pageLimit.take(userId) > 0)
    throw new ActionProblem(
      "That's a lot of pages at once. Try again in a minute.",
      "url",
    );
  try {
    return await fetchPage(address);
  } catch (error) {
    if (error instanceof PageFetchError)
      throw new ActionProblem(error.message, "url");
    throw error;
  }
}

/**
 * "Add from a web page": this server fetches the page (public https pages
 * only, see fetch-page.ts), keeps its readable text as a knowledge item and
 * remembers where it came from.
 */
export async function addKnowledgePage(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace, user }) => {
    const page = await readPage(user.id, String(form.get("url") ?? ""));
    const title =
      cleanText(form.get("title"), 200) ||
      page.title ||
      new URL(page.url).hostname;
    mustSucceed(
      await supabase.from("knowledge_items").insert({
        workspace_id: workspace.id,
        title,
        kind: "url",
        content: page.text,
        status: "ready",
        source_url: page.url.slice(0, 2000),
        created_by: user.id,
      }),
      "add knowledge page",
    );
    refresh();
    return {
      ok: true,
      message: page.truncated
        ? "Added. The page was long, so only its first part was kept."
        : "Added.",
    };
  });
}

/** Reads a saved page again, replacing its text with what is there now. */
export async function refreshKnowledgePage(
  form: FormData,
): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace, user }) => {
    const id = form.get("item");
    if (!isUuid(id)) throw new ActionProblem("That item doesn't exist.");
    const item = await supabase
      .from("knowledge_items")
      .select("content, source_url, status")
      .eq("workspace_id", workspace.id)
      .eq("id", id)
      .eq("kind", "url")
      .maybeSingle();
    mustSucceed(item, "read knowledge");
    if (!item.data) throw new ActionProblem("That item doesn't exist.");
    const row = item.data as {
      content: string;
      source_url: string | null;
      status: string;
    };
    // An address saved before pages could be read has it in `content`.
    const page = await readPage(user.id, row.source_url ?? row.content);
    mustSucceed(
      await supabase
        .from("knowledge_items")
        .update({
          content: page.text,
          status: "ready",
          source_url: page.url.slice(0, 2000),
        })
        .eq("workspace_id", workspace.id)
        .eq("id", id),
      "refresh knowledge page",
    );
    refresh();
    return { ok: true, message: "Read again just now." };
  });
}

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
    // An address saved this way is not read; "Add from a web page" reads it.
    const status = kind === "url" ? "not_fetched" : "ready";

    if (isUuid(id)) {
      let update = supabase
        .from("knowledge_items")
        .update({ title, content, status })
        .eq("workspace_id", workspace.id)
        .eq("id", id);
      // Text edits apply to text items and to pages whose text was read; an
      // address edit only to a page that hasn't been read yet.
      update =
        kind === "url"
          ? update.eq("kind", "url").is("source_url", null)
          : update.or("kind.eq.text,source_url.not.is.null");
      const { data, error } = await update.select("id");
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
