import "server-only";
import { isUuid } from "@/lib/leads/fields";
import type { Supabase } from "@/lib/supabase/server";
import {
  LEAD_STATUSES,
  type ActivityEvent,
  type Agent,
  type Call,
  type ChatWidget,
  type Conversation,
  type ConversationListItem,
  type ConversationThread,
  type FeedEvent,
  type HomeData,
  type Invitation,
  type KnowledgeItem,
  type Lead,
  type LeadDetail,
  type LeadForm,
  type Meeting,
  type Member,
  type Message,
  type MessageDraft,
  type TestMessage,
  type Workspace,
  type WorkspaceSetup,
} from "./types";

// Everything the app's pages read, for one workspace. The pages only know
// this interface. The real one below asks Supabase as the signed-in person,
// so row-level security applies to every query; each query also names the
// workspace, because one person can belong to several.

export type InboxQueue = "waiting" | "open" | "mine" | "closed" | "all";

export interface Repo {
  home(): Promise<HomeData>;
  /** For the nav: chats waiting, and first emails waiting for a yes. */
  waitingCount(): Promise<number>;
  emailDraftCount(): Promise<number>;
  leads(filter: {
    q?: string;
    status?: string;
    tier?: number;
  }): Promise<Lead[]>;
  lead(id: string): Promise<LeadDetail | null>;
  conversations(queue: InboxQueue): Promise<ConversationListItem[]>;
  conversation(id: string): Promise<ConversationThread | null>;
  knowledge(): Promise<KnowledgeItem[]>;
  agents(): Promise<Agent[]>;
  members(): Promise<Member[]>;
  invitations(): Promise<Invitation[]>;
  leadForms(): Promise<LeadForm[]>;
  chatWidgets(): Promise<ChatWidget[]>;
  /** The "Get started" checklist's row. Null if the workspace has none. */
  setup(): Promise<WorkspaceSetup | null>;
  /** This person's latest "Try your agent" chat, oldest turn first. */
  testChat(): Promise<TestMessage[]>;
  /** Whether this person gets the team's email alerts. */
  alertEmails(): Promise<boolean>;
}

const LEAD_COLUMNS =
  "id, name, email, phone, company, website, source, status, owner_id, consent_call, consent_call_at, consent_call_source, consent_sms, consent_sms_at, consent_sms_source, consent_whatsapp, consent_whatsapp_at, consent_whatsapp_source, consent_email, consent_email_at, consent_email_source, do_not_contact, do_not_contact_at, custom_fields, created_at, updated_at, fit_score, engagement_score, tier, score_detail, account_id";
const CONVERSATION_COLUMNS =
  "id, lead_id, channel, status, assigned_to, last_message_at, created_at, widget_id, agent_paused, outcome, outcome_summary";
const MESSAGE_COLUMNS =
  "id, conversation_id, direction, author, author_user_id, body, delivery_status, sent_at";
const MEETING_COLUMNS =
  "id, lead_id, title, starts_at, ends_at, booked_by, channel, status, created_at";
/** How far back Home's "this week" looks. */
const WEEK_MS = 7 * 86_400_000;
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
    const ids = list.map((c) => c.id);
    const [messages, drafts] = await Promise.all([
      from("messages")
        .select("conversation_id, body")
        .eq("workspace_id", ws)
        .in("conversation_id", ids)
        .order("sent_at", { ascending: false })
        .limit(600),
      from("message_drafts")
        .select("conversation_id")
        .eq("workspace_id", ws)
        .eq("status", "pending")
        .in("conversation_id", ids),
    ]);
    const latest = rows<Pick<Message, "conversation_id" | "body">>(messages);
    const preview = new Map<string, string>();
    for (const m of latest)
      if (!preview.has(m.conversation_id))
        preview.set(m.conversation_id, m.body.slice(0, 160));
    const waiting = new Set(
      rows<{ conversation_id: string }>(drafts).map((d) => d.conversation_id),
    );
    return list.map((c) => ({
      ...c,
      preview: preview.get(c.id) ?? null,
      has_draft: waiting.has(c.id),
    }));
  }

  return {
    waitingCount,

    async emailDraftCount() {
      return count(
        await from("outbound_drafts")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", ws)
          .eq("status", "draft"),
      );
    },

    async home() {
      const week = new Date(Date.now() - WEEK_MS).toISOString();
      const head = { count: "exact", head: true } as const;
      const [
        searches,
        running,
        found,
        undecided,
        foundThisWeek,
        kept,
        drafts,
        chatDrafts,
        waiting,
        chats,
        replies,
        qualified,
        feed,
      ] = await Promise.all([
        from("prospect_searches").select("id", head).eq("workspace_id", ws),
        from("prospect_runs")
          .select("id", head)
          .eq("workspace_id", ws)
          .in("status", ["searching", "researching"]),
        from("prospects")
          .select("id", head)
          .eq("workspace_id", ws)
          .eq("research_status", "found"),
        from("prospects")
          .select("id", head)
          .eq("workspace_id", ws)
          .eq("research_status", "found")
          .eq("decision", "undecided"),
        from("prospects")
          .select("id", head)
          .eq("workspace_id", ws)
          .eq("research_status", "found")
          .gte("created_at", week),
        from("prospects")
          .select("id")
          .eq("workspace_id", ws)
          .eq("research_status", "found")
          .eq("decision", "kept")
          .not("email", "is", null)
          .limit(1000),
        from("outbound_drafts")
          .select("prospect_id, status, decided_at")
          .eq("workspace_id", ws)
          .order("created_at", { ascending: false })
          .limit(1000),
        from("message_drafts")
          .select("conversation_id")
          .eq("workspace_id", ws)
          .eq("status", "pending")
          .limit(1000),
        from("conversations")
          .select("id")
          .eq("workspace_id", ws)
          .eq("status", "waiting_for_you")
          .limit(1000),
        from("conversations")
          .select("id", head)
          .eq("workspace_id", ws)
          .not("widget_id", "is", null)
          .gte("created_at", week),
        from("messages")
          .select(
            "conversation_id, conversation:conversations!inner(widget_id)",
          )
          .eq("workspace_id", ws)
          .eq("direction", "out")
          .not("conversation.widget_id", "is", null)
          .gte("sent_at", week)
          .limit(1000),
        from("activity_events")
          .select("id", head)
          .eq("workspace_id", ws)
          .eq("kind", "lead_status_changed")
          .eq("metadata->>to", "qualified")
          .gte("created_at", week),
        from("activity_events")
          .select(`${EVENT_COLUMNS}, lead:leads(id, name, company)`)
          .eq("workspace_id", ws)
          .order("created_at", { ascending: false })
          .limit(6),
      ]);
      const draftRows = rows<{
        prospect_id: string;
        status: string;
        decided_at: string | null;
      }>(drafts);
      // A failed draft is tried once more, so it still counts as to write.
      const written = new Set(
        draftRows
          .filter((d) => d.status !== "failed")
          .map((d) => d.prospect_id),
      );
      const emailDrafts = draftRows.filter((d) => d.status === "draft").length;
      const approved = draftRows.filter((d) => d.status === "approved");
      const withDraft = new Set(
        rows<{ conversation_id: string }>(chatDrafts).map(
          (d) => d.conversation_id,
        ),
      );
      return {
        needs: {
          emailDrafts,
          chatDrafts: withDraft.size,
          chatsWaiting: rows<{ id: string }>(waiting).filter(
            (c) => !withDraft.has(c.id),
          ).length,
        },
        find: {
          searches: count(searches),
          running: count(running) > 0,
          found: count(found),
          undecided: count(undecided),
          toWrite: rows<{ id: string }>(kept).filter((k) => !written.has(k.id))
            .length,
          drafted: emailDrafts + approved.length,
          approved: approved.length,
        },
        week: {
          companiesFound: count(foundThisWeek),
          emailsApproved: approved.filter(
            (d) => d.decided_at !== null && d.decided_at >= week,
          ).length,
          chats: count(chats),
          chatsAnswered: new Set(
            rows<{ conversation_id: string }>(replies).map(
              (m) => m.conversation_id,
            ),
          ).size,
          leadsQualified: count(qualified),
        },
        feed: rows<FeedEvent>(feed),
      };
    },

    async leads({ q, status, tier }) {
      let query = from("leads")
        .select(LEAD_COLUMNS)
        .eq("workspace_id", ws)
        .order("created_at", { ascending: false })
        .limit(200);
      if (status && (LEAD_STATUSES as readonly string[]).includes(status))
        query = query.eq("status", status);
      if (tier === 1 || tier === 2 || tier === 3)
        query = query.eq("tier", tier);
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
      const [conversation, messages, drafts] = await Promise.all([
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
        from("message_drafts")
          .select("id, conversation_id, body, created_at")
          .eq("workspace_id", ws)
          .eq("conversation_id", id)
          .eq("status", "pending")
          .limit(1),
      ]);
      if (conversation.error)
        throw new Error(`Database read failed: ${conversation.error.message}`);
      if (!conversation.data) return null;
      const list = rows<Message>(messages);
      const draft = rows<MessageDraft>(drafts)[0] ?? null;
      return {
        ...(conversation.data as unknown as Conversation & {
          lead: ConversationListItem["lead"];
        }),
        preview: list.at(-1)?.body.slice(0, 160) ?? null,
        has_draft: draft !== null,
        messages: list,
        draft,
      };
    },

    async knowledge() {
      return rows<KnowledgeItem>(
        await from("knowledge_items")
          .select("id, title, kind, content, status, source_url, updated_at")
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
            "id, name, role, channel, instructions, qualifying_questions, voice, enabled, approval_mode, send_window",
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

    async chatWidgets() {
      return rows<ChatWidget>(
        await from("chat_widgets")
          .select(
            "id, name, token, enabled, title, welcome, created_at, first_seen_at, first_seen_origin, last_seen_at, last_seen_origin",
          )
          .eq("workspace_id", ws)
          .order("created_at")
          .limit(20),
      );
    },

    async setup() {
      return (
        rows<WorkspaceSetup>(
          await from("workspace_setup")
            .select(
              "site_status, site_url, site_started_at, site_finished_at, site_pages, tried_agent_at, dismissed_at",
            )
            .eq("workspace_id", ws)
            .limit(1),
        )[0] ?? null
      );
    },

    async testChat() {
      const recent = rows<TestMessage>(
        await from("agent_test_messages")
          .select("id, session_id, author, body, metadata, created_at")
          .eq("workspace_id", ws)
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(80),
      );
      const session = recent[0]?.session_id;
      return recent.filter((m) => m.session_id === session).reverse();
    },

    async alertEmails() {
      const mine = rows<{ alert_emails: boolean }>(
        await from("profiles").select("alert_emails").eq("id", userId).limit(1),
      );
      return mine[0]?.alert_emails ?? true;
    },
  };
}
