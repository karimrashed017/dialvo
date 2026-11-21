// What the agent reads for one conversation (chat_agent_context) and what it
// hands back to be stored (chat_agent_commit). The migrations are the source
// of truth for both shapes.

export type AgentSettings = {
  id: string;
  name: string;
  instructions: string;
  qualifying_questions: string;
  approval_mode: "auto" | "approve_first";
};

export type KnowledgeEntry = {
  title: string;
  content: string;
  source_url: string | null;
};

export type ChatTurn = {
  id: string;
  author: "lead" | "agent" | "user";
  body: string;
};

export type ChatContext = {
  workspace: {
    name: string;
    website: string | null;
    /** The trial clock (see src/lib/billing/trial.ts). */
    trial_ends_at?: string | null;
    billing_status?: string | null;
  };
  /** Null when the workspace has no switched-on inbound chat agent. */
  agent: AgentSettings | null;
  /** A person has this conversation: the agent stays silent. */
  paused: boolean;
  status: "open" | "waiting_for_you" | "closed";
  outcome: Outcome | null;
  replies_today: number;
  latest_visitor_message_id: string | null;
  knowledge: KnowledgeEntry[];
  messages: ChatTurn[];
  /**
   * The workspace's booking page, when it has one. Not part of the
   * database's chat context: the runtime adds it (chat_booking_url).
   */
  booking_url?: string | null;
};

export const OUTCOMES = [
  "none",
  "qualified",
  "not_qualified",
  "needs_human",
] as const;
export type Outcome = (typeof OUTCOMES)[number];

/** One turn's decision, as the model returns it and the database stores it. */
export type AgentResult = {
  reply: string;
  outcome: Outcome;
  summary: string;
  handoff: boolean;
  stop_contact: boolean;
  /** The reply offers the booking page (only when there is one). */
  offer_booking: boolean;
  visitor_name: string;
  visitor_email: string;
};

export type CommitStatus =
  "sent" | "draft" | "silent" | "stale" | "paused" | "off";

/** The database, as the agent needs it. Faked in the unit tests. */
export interface ChatAgentStore {
  context(token: string, conversationId: string): Promise<ChatContext | null>;
  commit(
    token: string,
    conversationId: string,
    inReplyTo: string,
    result: AgentResult & { model: string },
  ): Promise<{ status: CommitStatus; handoff?: boolean } | null>;
  /** The workspace's booking page, for the chat behind this widget. */
  bookingUrl(token: string, conversationId: string): Promise<string | null>;
  /** A booking link of Dialvo's own for this conversation (its token). */
  offerBooking(token: string, conversationId: string): Promise<string | null>;
}

/** What an agent's turn in a "Try your agent" chat concluded. */
export type TestTurnMeta = {
  outcome?: Outcome;
  summary?: string;
  handoff?: boolean;
  stop_contact?: boolean;
};

/**
 * The database for "Try your agent" (agent_test_begin, agent_test_commit).
 * Faked in the unit tests.
 */
export interface TestChatStore {
  /** Saves what the teammate typed; returns what the agent needs to answer. */
  begin(input: {
    workspaceId: string;
    userId: string;
    sessionId: string;
    body: string;
  }): Promise<ChatContext | null | "limited">;
  commit(input: {
    workspaceId: string;
    userId: string;
    sessionId: string;
    inReplyTo: string;
    result: AgentResult & { model: string };
  }): Promise<{ status: "sent" | "silent" | "stale" } | null>;
  /** The workspace's booking page, offered as it is in a test chat. */
  bookingUrl(workspaceId: string): Promise<string | null>;
}
