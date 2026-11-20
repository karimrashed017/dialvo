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
  workspace: { name: string; website: string | null };
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
}
