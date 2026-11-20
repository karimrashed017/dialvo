"use server";

import { refresh } from "next/cache";
import {
  ActionProblem,
  inWorkspace,
  mustSucceed,
  type ActionResult,
} from "@/lib/app/action";
import { cleanLongText, cleanText, isUuid } from "@/lib/leads/fields";

// What a teammate decides about emails after the first one: a follow-up the
// agent drafted, and an email that failed or whose fate isn't known. Both go
// through database functions that check membership themselves.

function emailId(form: FormData): string {
  const id = form.get("email");
  if (!isUuid(id)) throw new ActionProblem("That email doesn't exist.");
  return id;
}

function problem(
  error: { code?: string; message: string } | null,
  what: string,
) {
  if (!error) return;
  if (error.code === "P0002")
    throw new ActionProblem(
      "That's no longer there. It may already have been dealt with.",
    );
  if (error.code === "P0001")
    throw new ActionProblem(
      "This lead is on your never-contact list or marked do not contact, so it can't be emailed.",
    );
  if (error.code === "22023")
    throw new ActionProblem("The email is too long. Shorten it and try again.");
  mustSucceed({ error }, what);
}

/** Approve, edit or discard a follow-up (or a reply) the agent drafted. */
export async function decideEmail(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase }) => {
    const action = String(form.get("action"));
    if (!["approve", "save", "discard"].includes(action))
      throw new ActionProblem("Choose what to do with it.");
    const body = cleanLongText(form.get("body"), 5000);
    if (action !== "discard" && form.has("body") && !body)
      throw new ActionProblem("Write the email, or discard it.", "body");
    const { error } = await supabase.rpc("outbound_email_decide", {
      p_email_id: emailId(form),
      p_action: action,
      p_subject: cleanText(form.get("subject"), 200) || null,
      p_body: body || null,
    });
    problem(error, "decide email");
    refresh();
    return { ok: true, message: action === "save" ? "Saved." : undefined };
  });
}

/** Settle an email that failed, or that may or may not have been sent. */
export async function resolveEmail(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase }) => {
    const action = String(form.get("action"));
    if (!["sent", "resend", "cancel"].includes(action))
      throw new ActionProblem("Choose what to do with it.");
    const { error } = await supabase.rpc("outbound_email_resolve", {
      p_email_id: emailId(form),
      p_action: action,
    });
    problem(error, "resolve email");
    refresh();
    return { ok: true };
  });
}
