"use server";

import { refresh } from "next/cache";
import { after } from "next/server";
import { agentRuntimeStatus } from "@/lib/agents/config";
import { runChatAgent } from "@/lib/agents/runtime";
import { sendTeamAlerts } from "@/lib/alerts/team";
import {
  ActionProblem,
  inWorkspace,
  mustSucceed,
  type ActionResult,
} from "@/lib/app/action";
import { CHANNEL_LABEL, type Channel } from "@/lib/app/types";
import { cleanLongText, isUuid } from "@/lib/leads/fields";

function conversationId(form: FormData): string {
  const id = form.get("conversation");
  if (!isUuid(id)) throw new ActionProblem("That conversation doesn't exist.");
  return id;
}

/**
 * A person's typed reply. It is stored as an outgoing message written by
 * them and marked "not delivered": no channel is connected in this slice, so
 * nothing is sent to the lead, and the thread says so.
 */
export async function reply(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace, user }) => {
    const id = conversationId(form);
    const body = cleanLongText(form.get("body"), 10000);
    if (!body) throw new ActionProblem("Write your reply first.", "body");

    const conversation = await supabase
      .from("conversations")
      .select("id, lead_id, channel, assigned_to")
      .eq("workspace_id", workspace.id)
      .eq("id", id)
      .maybeSingle();
    mustSucceed(conversation, "read conversation");
    if (!conversation.data)
      throw new ActionProblem("That conversation doesn't exist.");
    const { lead_id, channel, assigned_to } = conversation.data as {
      lead_id: string;
      channel: Channel;
      assigned_to: string | null;
    };

    const now = new Date().toISOString();
    mustSucceed(
      await supabase.from("messages").insert({
        workspace_id: workspace.id,
        conversation_id: id,
        direction: "out",
        author: "user",
        author_user_id: user.id,
        body,
        delivery_status: "not_delivered",
        metadata: { reason: "channel_not_connected" },
        sent_at: now,
      }),
      "save reply",
    );
    mustSucceed(
      await supabase
        .from("conversations")
        .update({
          last_message_at: now,
          // Answering takes it out of the waiting queue; a closed one reopens.
          status: "open",
          // Whoever answers first owns it, unless it was already someone's.
          ...(assigned_to ? {} : { assigned_to: user.id }),
        })
        .eq("workspace_id", workspace.id)
        .eq("id", id),
      "update conversation",
    );
    mustSucceed(
      await supabase.from("activity_events").insert({
        workspace_id: workspace.id,
        lead_id,
        actor_id: user.id,
        kind: "reply_saved",
        summary: `Reply written on ${CHANNEL_LABEL[channel]} (saved, not delivered: the channel isn't connected yet)`,
        channel,
        metadata: { conversation_id: id },
      }),
      "log reply",
    );
    refresh();
    return { ok: true };
  });
}

export async function assign(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace }) => {
    const id = conversationId(form);
    const to = form.get("assignee");
    const { error } = await supabase
      .from("conversations")
      .update({ assigned_to: isUuid(to) ? to : null })
      .eq("workspace_id", workspace.id)
      .eq("id", id);
    if (error?.code === "23503")
      throw new ActionProblem("Choose someone from this workspace.");
    mustSucceed({ error }, "assign conversation");
    refresh();
    return { ok: true };
  });
}

export async function setConversationStatus(
  form: FormData,
): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace, user }) => {
    const id = conversationId(form);
    const status = String(form.get("status"));
    if (!["open", "waiting_for_you", "closed"].includes(status))
      throw new ActionProblem("Choose a status.");
    const { data, error } = await supabase
      .from("conversations")
      .update({ status })
      .eq("workspace_id", workspace.id)
      .eq("id", id)
      .select("lead_id, channel");
    mustSucceed({ error }, "set conversation status");
    const row = data?.[0] as { lead_id: string; channel: Channel } | undefined;
    if (!row) throw new ActionProblem("That conversation doesn't exist.");
    if (status === "closed")
      mustSucceed(
        await supabase.from("activity_events").insert({
          workspace_id: workspace.id,
          lead_id: row.lead_id,
          actor_id: user.id,
          kind: "conversation_closed",
          summary: `Closed the ${CHANNEL_LABEL[row.channel]} conversation`,
          channel: row.channel,
          metadata: { conversation_id: id },
        }),
        "log close",
      );
    refresh();
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// Website chat: these go through database functions that check workspace
// membership themselves, because they do what a plain insert may not (send a
// message to a visitor, or send one in the agent's name).
// ---------------------------------------------------------------------------

function chatProblem(
  error: { code?: string; message: string } | null,
  what: string,
) {
  if (!error) return;
  if (error.code === "P0002")
    throw new ActionProblem(
      "That's no longer there. It may already have been dealt with.",
    );
  if (error.code === "22023")
    throw new ActionProblem("That can't be sent in this conversation.");
  mustSucceed({ error }, what);
}

/**
 * A person's reply in a website chat. The visitor sees it in the widget, and
 * the agent is paused on this conversation until it is handed back.
 */
export async function sendChatReply(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase }) => {
    const id = conversationId(form);
    const body = cleanLongText(form.get("body"), 10000);
    if (!body) throw new ActionProblem("Write your reply first.", "body");
    const { error } = await supabase.rpc("send_chat_reply", {
      p_conversation_id: id,
      p_body: body,
    });
    chatProblem(error, "send chat reply");
    refresh();
    return { ok: true };
  });
}

function draftId(form: FormData): string {
  const id = form.get("draft");
  if (!isUuid(id)) throw new ActionProblem("That draft doesn't exist.");
  return id;
}

/** Approve & send the agent's draft, as written or with the person's edits. */
export async function approveDraft(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase }) => {
    const edited = form.has("body");
    const body = cleanLongText(form.get("body"), 10000);
    if (edited && !body)
      throw new ActionProblem("Write the reply, or discard the draft.", "body");
    const { error } = await supabase.rpc("approve_chat_draft", {
      p_draft_id: draftId(form),
      p_body: edited ? body : null,
    });
    chatProblem(error, "approve draft");
    refresh();
    return { ok: true };
  });
}

export async function discardDraft(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase }) => {
    const { error } = await supabase.rpc("discard_chat_draft", {
      p_draft_id: draftId(form),
    });
    chatProblem(error, "discard draft");
    refresh();
    return { ok: true };
  });
}

/**
 * Hands a chat back to the agent. If the visitor's last message is still
 * unanswered, the agent answers it now (when this server can run it).
 */
export async function handBackToAgent(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace, user }) => {
    const id = conversationId(form);
    const { data, error } = await supabase
      .from("conversations")
      .update({ agent_paused: false })
      .eq("workspace_id", workspace.id)
      .eq("id", id)
      .not("widget_id", "is", null)
      .select("lead_id, widget_id");
    mustSucceed({ error }, "hand back");
    const row = data?.[0] as { lead_id: string; widget_id: string } | undefined;
    if (!row) throw new ActionProblem("That conversation doesn't exist.");
    mustSucceed(
      await supabase.from("activity_events").insert({
        workspace_id: workspace.id,
        lead_id: row.lead_id,
        actor_id: user.id,
        kind: "handed_back",
        summary: "Handed the website chat back to the agent",
        channel: "chat",
        metadata: { conversation_id: id },
      }),
      "log hand back",
    );

    const [widget, last] = await Promise.all([
      supabase
        .from("chat_widgets")
        .select("token")
        .eq("workspace_id", workspace.id)
        .eq("id", row.widget_id)
        .maybeSingle(),
      supabase
        .from("messages")
        .select("direction")
        .eq("workspace_id", workspace.id)
        .eq("conversation_id", id)
        .order("sent_at", { ascending: false })
        .limit(1),
    ]);
    const token = (widget.data as { token: string } | null)?.token;
    if (token && last.data?.[0]?.direction === "in" && agentRuntimeStatus().on)
      after(async () => {
        await runChatAgent({ token, conversationId: id });
        // The agent may hand it straight back, or leave a draft: tell the team.
        await sendTeamAlerts({ token, conversationId: id });
      });
    refresh();
    return { ok: true };
  });
}
