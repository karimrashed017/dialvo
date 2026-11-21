// What the database hands the phone agent for one turn (call_context), and
// what the agent decides.

export type TranscriptEntry = {
  t: number;
  speaker: "agent" | "lead";
  text: string;
};

export type CallContext = {
  call: {
    id: string;
    workspace_id: string;
    lead_id: string;
    conversation_id: string;
    direction: "inbound" | "outbound";
    status: string;
    provider_sid: string | null;
    from_number: string | null;
    to_number: string | null;
    started_at: string | null;
    turns: number;
    outcome: string | null;
    transcript: TranscriptEntry[];
    /** For an outbound batch: what the team wants from the call. */
    purpose: string;
  };
  workspace: { name: string; website: string | null; timezone: string };
  phone: {
    agent_on: boolean;
    greeting: string;
    voice: string;
    language: string;
    transfer_number: string | null;
    recording_on: boolean;
    max_call_minutes: number;
    sms_ready: boolean;
  };
  agent: { instructions: string; qualifying_questions: string };
  booking_url: string | null;
  lead: {
    name: string;
    company: string | null;
    phone: string | null;
    sms_opted_out: boolean;
  };
  knowledge: { title: string; content: string; source_url: string | null }[];
};

export const CALL_OUTCOMES = [
  "none",
  "qualified",
  "not_qualified",
  "needs_human",
] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

export type TurnResult = {
  say: string;
  outcome: CallOutcome;
  summary: string;
  handoff: boolean;
  stop_calls: boolean;
  stop_contact: boolean;
  end_call: boolean;
  send_booking_link: boolean;
  caller_name: string;
  caller_email: string;
};
