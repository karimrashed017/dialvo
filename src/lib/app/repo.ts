import "server-only";
import { isUuid } from "@/lib/leads/fields";
import type { Supabase } from "@/lib/supabase/server";
import { startOfDayInTz } from "./time";
import {
  LEAD_STATUSES,
  type ActivityEvent,
  type Agent,
  type Call,
  type Conversation,
  type ConversationListItem,
  type ConversationThread,
  type FeedEvent,
  type Invitation,
  type KnowledgeItem,
  type Lead,
  type LeadDetail,
  type LeadForm,
  type LeadRef,
  type LeadStatus,
  type Meeting,
  type Member,
  type Message,
  type TodayData,
  type Workspace,
} from "./types";

// Everything the app's pages read, for one workspace. The pages only know
// this interface. The real one below asks Supabase as the signed-in person,
// so row-level security applies to every query; each query also names the
// workspace, because one person can belong to several.

export type InboxQueue = "waiting" | "open" | "mine" | "closed" | "all";

export interface Repo {
  today(): Promise<TodayData>;
  waitingCount(): Promise<number>;
  leads(filter: { q?: string; status?: string }): Promise<Lead[]>;
  lead(id: string): Promise<LeadDetail | null>;
  conversations(queue: InboxQueue): Promise<ConversationListItem[]>;
  conversation(id: string): Promise<ConversationThread | null>;
  knowledge(): Promise<KnowledgeItem[]>;
  agents(): Promise<Agent[]>;
  members(): Promise<Member[]>;
  invitations(): Promise<Invitation[]>;
  leadForms(): Promise<LeadForm[]>;
}

const LEAD_COLUMNS =
  "id, name, email, phone, company, website, source, status, owner_id, consent_call, consent_call_at, consent_call_source, consent_sms, consent_sms_at, consent_sms_source, consent_whatsapp, consent_whatsapp_at, consent_whatsapp_source, consent_email, consent_email_at, consent_email_source, do_not_contact, do_not_contact_at, custom_fields, created_at, updated_at";
const CONVERSATION_COLUMNS =
  "id, lead_id, channel, status, assigned_to, last_message_at, created_at";
const MESSAGE_COLUMNS =
  "id, conversation_id, direction, author, author_user_id, body, delivery_status, sent_at";
const MEETING_COLUMNS =
  "id, lead_id, title, starts_at, ends_at, booked_by, channel, status, created_at";
const EVENT_COLUMNS =
  "id, lead_id, kind, summary, channel, actor_id, created_at";

/** A failed read is a bug or an outage, not an empty list: say so. */
function rows<T>(result: {
  data: unknown;
  error: { message: string } | null;
}): T[] {
  if (result.error)
    throw new Error(`Database read failed: ${result.error.message}`);
  return (result.data ?? []) as T[];
}

function count(result: {
  count: number | null;
  error: { message: string } | null;
}): number {
  if (result.error)
    throw new Error(`Database read failed: ${result.error.message}`);
  return result.count ?? 0;
}

/** Search text, stripped of what PostgREST's filter syntax gives meaning to. */
export function searchTerm(q: string | undefined): string {
  return (q ?? "")
    .replace(/[,()*%\\"':]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

export function createRepo(
  supabase: Supabase,
  workspace: Pick<Workspace, "id" | "timezone">,
  userId: string,
): Repo {
  const ws = workspace.id;
  const from = (table: string) => supabase.from(table);

  const waitingCount = async () =>
    count(
      await from("conversations")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", ws)
        .eq("status", "waiting_for_you"),
    );

  async function withPreviews(
    list: (Conversation & { lead: ConversationListItem["lead"] })[],
  ): Promise<ConversationListItem[]> {
    if (list.length === 0) return [];
    const latest = rows<Pick<Message, "conversation_id" | "body">>(
      await from("messages")
        .select("conversation_id, body")
        .eq("workspace_id", ws)
        .in(
          "conversation_id",
          list.map((c) => c.id),
        )
        .order("sent_at", { ascending: false })
        .limit(600),
    );
    const preview = new Map<string, string>();
    for (const m of latest)
      if (!preview.has(m.conversation_id))
        preview.set(m.conversation_id, m.body.slice(0, 160));
    return list.map((c) => ({ ...c, preview: preview.get(c.id) ?? null }));
  }

  return {
    waitingCount,

    async today() {
      const start = startOfDayInTz(
        new Date(),
        workspace.timezone,
      ).toISOString();
      const now = new Date().toISOString();
      const head = { count: "exact", head: true } as const;
      const [
        todays,
        qualified,
        booked,
        waiting,
        upcoming,
        feed,
        agents,
        ...byStatus
      ] = await Promise.all([
        from("conversations")
          .select("channel", { count: "exact" })
          .eq("workspace_id", ws)
          .gte("last_message_at", start)
          .limit(1000),
        from("activity_events")
          .select("id", head)
          .eq("workspace_id", ws)
          .eq("kind", "lead_status_changed")
          .eq("metadata->>to", "qualified")
          .gte("created_at", start),
        from("meetings")
          .select("id", head)
          .eq("workspace_id", ws)
          .gte("created_at", start),
        waitingCount(),
        from("meetings")
          .select(`${MEETING_COLUMNS}, lead:leads(id, name, company)`)
          .eq("workspace_id", ws)
          .eq("status", "scheduled")
          .gte("starts_at", now)
          .order("starts_at")
          .limit(4),
        from("activity_events")
          .select(`${EVENT_COLUMNS}, lead:leads(id, name, company)`)
          .eq("workspace_id", ws)
          .order("created_at", { ascending: false })
          .limit(12),
        from("agents")
          .select("role")
          .eq("workspace_id", ws)
          .eq("enabled", true),
        ...LEAD_STATUSES.map((status) =>
          from("leads")
            .select("id", head)
            .eq("workspace_id", ws)
            .eq("status", status),
        ),
      ]);
      const channels = rows<{ channel: string }>(todays);
      const pipeline = Object.fromEntries(
        LEAD_STATUSES.map((status, i) => [status, count(byStatus[i])]),
      ) as Record<LeadStatus, number>;
      return {
        conversationsToday: count(todays),
        channelsToday: new Set(channels.map((c) => c.channel)).size,
        qualifiedToday: count(qualified),
        meetingsBookedToday: count(booked),
        waitingForYou: waiting,
        pipeline,
        upcoming: rows<Meeting & { lead: LeadRef | null }>(upcoming),
        feed: rows<FeedEvent>(feed),
        agentsOn: [
          ...new Set(rows<{ role: Agent["role"] }>(agents).map((a) => a.role)),
        ],
      };
    },

    async leads({ q, status }) {
      let query = from("leads")
        .select(LEAD_COLUMNS)
        .eq("workspace_id", ws)
        .order("created_at", { ascending: false })
        .limit(200);
      if (status && (LEAD_STATUSES as readonly string[]).includes(status))
        query = query.eq("status", status);
      const term = searchTerm(q);
      if (term)
        query = query.or(
          ["name", "email", "company", "phone"]
            .map((column) => `${column}.ilike.%${term}%`)
            .join(","),
        );
      return rows<Lead>(await query);
    },

    async lead(id) {
      if (!isUuid(id)) return null;
      const [lead, conversations, messages, calls, meetings, events] =
        await Promise.all([
          from("leads")
            .select(LEAD_COLUMNS)
            .eq("workspace_id", ws)
            .eq("id", id)
            .maybeSingle(),
          from("conversations")
            .select(CONVERSATION_COLUMNS)
            .eq("workspace_id", ws)
            .eq("lead_id", id)
            .order("created_at", { ascending: false })
            .limit(50),
          from("messages")
            .select(
              `${MESSAGE_COLUMNS}, conversation:conversations!inner(lead_id)`,
            )
            .eq("workspace_id", ws)
            .eq("conversation.lead_id", id)
            .order("sent_at", { ascending: false })
            .limit(300),
          from("calls")
            .select(
              "id, lead_id, direction, status, started_at, duration_seconds, summary, created_at",
            )
            .eq("workspace_id", ws)
            .eq("lead_id", id)
            .order("created_at", { ascending: false })
            .limit(100),
          from("meetings")
            .select(MEETING_COLUMNS)
            .eq("workspace_id", ws)
            .eq("lead_id", id)
            .order("starts_at", { ascending: false })
            .limit(100),
          from("activity_events")
            .select(EVENT_COLUMNS)
            .eq("workspace_id", ws)
            .eq("lead_id", id)
            .order("created_at", { ascending: false })
            .limit(200),
        ]);
      if (lead.error)
        throw new Error(`Database read failed: ${lead.error.message}`);
      if (!lead.data) return null;
      const all = rows<Message>(messages);
      return {
        lead: lead.data as unknown as Lead,
        conversations: rows<Conversation>(conversations).map((c) => ({
          ...c,
          messages: all.filter((m) => m.conversation_id === c.id),
        })),
        calls: rows<Call>(calls),
        meetings: rows<Meeting>(meetings),
        events: rows<ActivityEvent>(events),
      };
    },

    async conversations(queue) {
      let query = from("conversations")
        .select(`${CONVERSATION_COLUMNS}, lead:leads(id, name, company, email)`)
        .eq("workspace_id", ws)
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(100);
      if (queue === "waiting") query = query.eq("status", "waiting_for_you");
      else if (queue === "open") query = query.eq("status", "open");
      else if (queue === "closed") query = query.eq("status", "closed");
      else if (queue === "mine")
        query = query.eq("assigned_to", userId).neq("status", "closed");
      return withPreviews(
        rows<Conversation & { lead: ConversationListItem["lead"] }>(
          await query,
        ),
      );
    },

    async conversation(id) {
      if (!isUuid(id)) return null;
      const [conversation, messages] = await Promise.all([
        from("conversations")
          .select(
            `${CONVERSATION_COLUMNS}, lead:leads(id, name, company, email)`,
          )
          .eq("workspace_id", ws)
          .eq("id", id)
          .maybeSingle(),
        from("messages")
          .select(MESSAGE_COLUMNS)
          .eq("workspace_id", ws)
          .eq("conversation_id", id)
          .order("sent_at")
          .limit(500),
      ]);
      if (conversation.error)
        throw new Error(`Database read failed: ${conversation.error.message}`);
      if (!conversation.data) return null;
      const list = rows<Message>(messages);
      return {
        ...(conversation.data as unknown as Conversation & {
          lead: ConversationListItem["lead"];
        }),
        preview: list.at(-1)?.body.slice(0, 160) ?? null,
        messages: list,
      };
    },

    async knowledge() {
      return rows<KnowledgeItem>(
        await from("knowledge_items")
          .select("id, title, kind, content, status, updated_at")
          .eq("workspace_id", ws)
          .order("created_at", { ascending: false })
          .limit(200),
      );
    },

    async agents() {
      const order = ["inbound", "outbound", "closing", "expansion"];
      return rows<Agent>(
        await from("agents")
          .select(
            "id, name, role, channel, instructions, voice, enabled, approval_mode, send_window",
          )
          .eq("workspace_id", ws)
          .order("created_at")
          .limit(50),
      ).sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));
    },

    async members() {
      const members = rows<Pick<Member, "user_id" | "role" | "created_at">>(
        await from("workspace_members")
          .select("user_id, role, created_at")
          .eq("workspace_id", ws)
          .order("created_at")
          .limit(200),
      );
      if (members.length === 0) return [];
      const profiles = rows<{ id: string; name: string; email: string }>(
        await from("profiles")
          .select("id, name, email")
          .in(
            "id",
            members.map((m) => m.user_id),
          ),
      );
      const byId = new Map(profiles.map((p) => [p.id, p]));
      return members.map((m) => ({
        ...m,
        name: byId.get(m.user_id)?.name ?? "",
        email: byId.get(m.user_id)?.email ?? "",
      }));
    },

    async invitations() {
      // Only admins can read these; for a member this is simply empty.
      return rows<Invitation>(
        await from("invitations")
          .select("id, email, role, status, created_at, expires_at")
          .eq("workspace_id", ws)
          .eq("status", "pending")
          .order("created_at", { ascending: false })
          .limit(100),
      );
    },

    async leadForms() {
      return rows<LeadForm>(
        await from("lead_forms")
          .select("id, name, token, enabled, redirect_url, created_at")
          .eq("workspace_id", ws)
          .order("created_at")
          .limit(50),
      );
    },
  };
}
