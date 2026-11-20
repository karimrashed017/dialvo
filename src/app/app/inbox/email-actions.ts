"use server";

import { refresh } from "next/cache";
import {
  ActionProblem,
  inWorkspace,
  mustSucceed,
  type ActionResult,
} from "@/lib/app/action";
import { cleanLongText, isUuid } from "@/lib/leads/fields";

/**
 * A teammate's own reply in an email conversation. It is queued in the
 * database and leaves from the mailbox the thread started from, in the same
 * thread, the next time the sender runs (about a minute). The function
 * checks membership, the never-contact list and do-not-contact itself.
 */
export async function sendEmailReply(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase }) => {
    const id = form.get("conversation");
    if (!isUuid(id))
      throw new ActionProblem("That conversation doesn't exist.");
    const body = cleanLongText(form.get("body"), 5000);
    if (!body) throw new ActionProblem("Write your reply first.", "body");
    const { error } = await supabase.rpc("mail_reply_queue", {
      p_conversation_id: id,
      p_body: body,
    });
    if (error?.code === "P0002")
      throw new ActionProblem("That conversation doesn't exist.");
    if (error?.code === "P0001")
      throw new ActionProblem(
        /mailbox/.test(error.message)
          ? "The mailbox this conversation used has been disconnected, so a reply can't be sent from here."
          : "This person asked not to be contacted, or is on your never-contact list, so Dialvo won't email them.",
      );
    if (error?.code === "22023")
      throw new ActionProblem("A reply can be up to 5,000 characters.", "body");
    mustSucceed({ error }, "queue email reply");
    refresh();
    return { ok: true };
  });
}
