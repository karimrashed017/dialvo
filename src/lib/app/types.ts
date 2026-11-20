// The rows the app reads, as the database returns them. Kept by hand until
// types are generated from the project; the migrations are the source of
// truth.

export const LEAD_STATUSES = [
  "new",
  "engaged",
  "qualified",
  "meeting_booked",
  "won",
  "lost",
  "unsubscribed",
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const STATUS_LABEL: Record<LeadStatus, string> = {
  new: "New",
  engaged: "Engaged",
  qualified: "Qualified",
  meeting_booked: "Meeting booked",
  won: "Won",
  lost: "Lost",
  unsubscribed: "Unsubscribed",
};

export const CHANNELS = [
  "voice",
  "email",
  "chat",
  "social",
  "sms",
  "whatsapp",
] as const;
export type Channel = (typeof CHANNELS)[number];

export const CHANNEL_LABEL: Record<Channel, string> = {
  voice: "Voice",
  email: "Email",
  chat: "Chat",
  social: "Social",
  sms: "SMS",
  whatsapp: "WhatsApp",
};

export const CONSENT_CHANNELS = ["call", "sms", "whatsapp", "email"] as const;
export type ConsentChannel = (typeof CONSENT_CHANNELS)[number];
export const CONSENT_LABEL: Record<ConsentChannel, string> = {
  call: "Calls",
  sms: "SMS",
  whatsapp: "WhatsApp",
  email: "Email",
};

export type Role = "owner" | "admin" | "member";
export type Plan = "starter" | "pro" | "scale";

export type Workspace = {
  id: string;
  name: string;
  slug: string;
  plan: Plan;
  timezone: string;
  website: string | null;
  role: Role;
};

export type Member = {
  user_id: string;
  role: Role;
  name: string;
  email: string;
  created_at: string;
};

export type Invitation = {
  id: string;
  email: string;
  role: "admin" | "member";
  status: "pending" | "accepted" | "revoked";
  created_at: string;
  expires_at: string;
};

type Consent = {
  [K in ConsentChannel as `consent_${K}`]: boolean;
} & {
  [K in ConsentChannel as `consent_${K}_at`]: string | null;
} & {
  [K in ConsentChannel as `consent_${K}_source`]: string | null;
};

export type Lead = Consent & {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  website: string | null;
  source: string;
  status: LeadStatus;
  owner_id: string | null;
  do_not_contact: boolean;
  do_not_contact_at: string | null;
  custom_fields: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type LeadRef = { id: string; name: string; company: string | null };

export type ConversationStatus = "open" | "waiting_for_you" | "closed";

export type Conversation = {
  id: string;
  lead_id: string;
  channel: Channel;
  status: ConversationStatus;
  assigned_to: string | null;
  last_message_at: string | null;
  created_at: string;
};

export type DeliveryStatus =
  "received" | "not_delivered" | "queued" | "sent" | "delivered" | "failed";

export type Message = {
  id: string;
  conversation_id: string;
  direction: "in" | "out";
  author: "agent" | "user" | "lead";
  author_user_id: string | null;
  body: string;
  delivery_status: DeliveryStatus;
  sent_at: string;
};

export type ConversationListItem = Conversation & {
  lead: LeadRef & { email: string | null };
  preview: string | null;
};

export type ConversationThread = ConversationListItem & {
  messages: Message[];
};

export type SendWindow = { days: number[]; start: string; end: string };

export type Agent = {
  id: string;
  name: string;
  role: "inbound" | "outbound" | "closing" | "expansion";
  channel: Channel;
  instructions: string;
  voice: string | null;
  enabled: boolean;
  approval_mode: "auto" | "approve_first";
  send_window: SendWindow;
};

export type KnowledgeItem = {
  id: string;
  title: string;
  kind: "text" | "url" | "file";
  content: string;
  status: "ready" | "not_fetched" | "processing" | "failed";
  updated_at: string;
};

export type Meeting = {
  id: string;
  lead_id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  booked_by: "agent" | "user" | "lead";
  channel: Channel | null;
  status: "scheduled" | "completed" | "cancelled" | "no_show";
  created_at: string;
};

export type Call = {
  id: string;
  lead_id: string;
  direction: "inbound" | "outbound";
  status: string;
  started_at: string | null;
  duration_seconds: number | null;
  summary: string | null;
  created_at: string;
};

export type ActivityEvent = {
  id: string;
  lead_id: string | null;
  kind: string;
  summary: string;
  channel: Channel | null;
  actor_id: string | null;
  created_at: string;
};

export type FeedEvent = ActivityEvent & { lead: LeadRef | null };

export type LeadForm = {
  id: string;
  name: string;
  token: string;
  enabled: boolean;
  redirect_url: string | null;
  created_at: string;
};

export type TodayData = {
  conversationsToday: number;
  channelsToday: number;
  qualifiedToday: number;
  meetingsBookedToday: number;
  waitingForYou: number;
  pipeline: Record<LeadStatus, number>;
  upcoming: (Meeting & { lead: LeadRef | null })[];
  feed: FeedEvent[];
  agentsOn: Agent["role"][];
};

export type LeadDetail = {
  lead: Lead;
  conversations: (Conversation & { messages: Message[] })[];
  calls: Call[];
  meetings: Meeting[];
  events: ActivityEvent[];
};
