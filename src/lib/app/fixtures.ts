import "server-only";
import type { AppContext } from "./context";
import { FIXTURES_ON } from "./fixture-flag";
import type { InboxQueue, Repo } from "./repo";
import {
  type ActivityEvent,
  type Agent,
  type Channel,
  type Conversation,
  type ConversationListItem,
  type Lead,
  type LeadStatus,
  type Meeting,
  type Message,
  type MessageDraft,
} from "./types";

// DESIGN-PREVIEW-FIXTURES
// Made-up data for a made-up business, used only to look at the app's design
// in development (see fixture-flag.ts). It is loaded with a dynamic import
// behind FIXTURES_ON, which is the constant `false` in a production build,
// and it refuses to run there as a second lock.

if (!FIXTURES_ON)
  throw new Error("The design preview is not available in this build.");

const NOW = Date.now();
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();
const inHours = (h: number) => new Date(NOW + h * 3_600_000).toISOString();
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const ME = id(1);
const PRIYA = id(2);

const noConsent = {
  consent_call: false,
  consent_call_at: null,
  consent_call_source: null,
  consent_sms: false,
  consent_sms_at: null,
  consent_sms_source: null,
  consent_whatsapp: false,
  consent_whatsapp_at: null,
  consent_whatsapp_source: null,
  consent_email: false,
  consent_email_at: null,
  consent_email_source: null,
};

function lead(
  n: number,
  name: string,
  company: string,
  status: LeadStatus,
  source: string,
  extra: Partial<Lead> = {},
): Lead {
  const slug = company.toLowerCase().replace(/[^a-z]+/g, "");
  return {
    ...noConsent,
    id: id(100 + n),
    name,
    email: `${name.split(" ")[0].toLowerCase()}@${slug}.example`,
    phone: `+1555010${String(1000 + n).slice(1)}`,
    company,
    website: `${slug}.example`,
    source,
    status,
    owner_id: n % 2 ? ME : PRIYA,
    do_not_contact: false,
    do_not_contact_at: null,
    custom_fields: {},
    created_at: minutesAgo(n * 190),
    updated_at: minutesAgo(n * 45),
    ...extra,
  };
}

const LEADS: Lead[] = [
  lead(
    1,
    "Dana Whitfield",
    "Bright Smile Dental",
    "meeting_booked",
    "form: Website form",
    {
      consent_call: true,
      consent_call_at: minutesAgo(190),
      consent_call_source: "form: Website form",
      consent_email: true,
      consent_email_at: minutesAgo(190),
      consent_email_source: "form: Website form",
    },
  ),
  lead(2, "Marcus Hale", "Harbor & Pine Marketing", "engaged", "import"),
  lead(
    3,
    "Leah Okafor",
    "Cedar Lane Fitness",
    "qualified",
    "form: Website form",
    {
      consent_sms: true,
      consent_sms_at: minutesAgo(400),
      consent_sms_source: "form: Website form",
    },
  ),
  lead(4, "Tom Brennan", "Maple Street Bakery", "new", "manual"),
  lead(5, "Ines Duarte", "Juniper Home Care", "new", "form: Website form"),
  lead(6, "Sam Kowalski", "Ridgeline Roofing", "engaged", "import"),
  lead(7, "Nadia Rahman", "Lakeshore Legal", "qualified", "import"),
  lead(8, "Owen Pryce", "Fernhill Vets", "won", "manual"),
  lead(9, "Greta Lund", "Alder & Ash Interiors", "lost", "import"),
  lead(10, "Felix Moreau", "Tidewater Plumbing", "unsubscribed", "import", {
    do_not_contact: true,
    do_not_contact_at: minutesAgo(3000),
  }),
  lead(11, "Ruth Adeyemi", "Orchard Park Physio", "new", "form: Website form"),
  lead(12, "Callum Reid", "Stonebridge Accounting", "engaged", "manual"),
];

const byId = (leadId: string) => LEADS.find((l) => l.id === leadId)!;

function conversation(
  n: number,
  leadN: number,
  channel: Channel,
  status: Conversation["status"],
  last: number,
  assigned: string | null = null,
): Conversation {
  return {
    id: id(200 + n),
    lead_id: id(100 + leadN),
    channel,
    status,
    assigned_to: assigned,
    last_message_at: minutesAgo(last),
    created_at: minutesAgo(last + 60),
    widget_id: channel === "chat" ? id(971) : null,
    agent_paused: false,
    outcome: null,
    outcome_summary: null,
  };
}

const CONVERSATIONS: Conversation[] = [
  conversation(1, 3, "chat", "waiting_for_you", 4, ME),
  conversation(2, 5, "email", "waiting_for_you", 22),
  conversation(3, 1, "voice", "open", 48, PRIYA),
  conversation(4, 2, "email", "open", 95, ME),
  conversation(5, 4, "whatsapp", "open", 180),
  conversation(6, 7, "social", "open", 320, PRIYA),
  conversation(7, 8, "sms", "closed", 1500, ME),
];

let messageN = 0;
function message(
  conv: number,
  author: Message["author"],
  body: string,
  ago: number,
  delivery: Message["delivery_status"] = author === "lead"
    ? "received"
    : "delivered",
): Message {
  return {
    id: id(300 + ++messageN),
    conversation_id: id(200 + conv),
    direction: author === "lead" ? "in" : "out",
    author,
    author_user_id: author === "user" ? ME : null,
    body,
    delivery_status: delivery,
    sent_at: minutesAgo(ago),
  };
}

const MESSAGES: Message[] = [
  message(1, "lead", "Do you redesign sites for gyms?", 12),
  message(
    1,
    "agent",
    "We do. How many locations do you run, and is the site on a builder today?",
    11,
  ),
  message(1, "lead", "Two locations. It's on an old template.", 8),
  message(
    1,
    "agent",
    "That's a good fit. Priya has Thursday at 2:00 pm free. Shall I book it?",
    7,
  ),
  message(1, "lead", "Can I talk to a person about pricing first?", 4),
  message(
    2,
    "lead",
    "Hi, we need help with care-at-home enquiries out of hours. What does it cost?",
    22,
  ),
  message(3, "lead", "Yes, tomorrow afternoon works.", 50),
  message(
    3,
    "agent",
    "Booked for 3:30 pm. You'll get a confirmation by email.",
    48,
  ),
  message(4, "lead", "What's included in the monthly plan?", 110),
  message(
    4,
    "user",
    "Everything on the pricing page, plus onboarding. Happy to walk you through it on a call.",
    95,
    "not_delivered",
  ),
  message(
    5,
    "agent",
    "Sorry we missed you. Would a call tomorrow morning suit?",
    180,
  ),
  message(6, "lead", "Thanks for the note. Send me the case study?", 320),
  message(7, "lead", "All sorted, thank you!", 1500),
];

const MEETINGS: Meeting[] = [
  {
    id: id(401),
    lead_id: id(101),
    title: "Intro call",
    starts_at: inHours(3),
    ends_at: inHours(3.5),
    booked_by: "agent",
    channel: "voice",
    status: "scheduled",
    created_at: minutesAgo(48),
  },
  {
    id: id(402),
    lead_id: id(103),
    title: "Website review",
    starts_at: inHours(50),
    ends_at: inHours(50.5),
    booked_by: "agent",
    channel: "chat",
    status: "scheduled",
    created_at: minutesAgo(300),
  },
  {
    id: id(403),
    lead_id: id(107),
    title: "Proposal walkthrough",
    starts_at: inHours(74),
    ends_at: inHours(75),
    booked_by: "user",
    channel: "email",
    status: "scheduled",
    created_at: minutesAgo(900),
  },
];

let eventN = 0;
function event(
  leadN: number,
  kind: string,
  summary: string,
  channel: Channel | null,
  ago: number,
): ActivityEvent {
  return {
    id: id(500 + ++eventN),
    lead_id: id(100 + leadN),
    kind,
    summary,
    channel,
    actor_id: null,
    created_at: minutesAgo(ago),
  };
}

const EVENTS: ActivityEvent[] = [
  event(3, "handoff", "Asked for a person: waiting for you", "chat", 4),
  event(
    5,
    "lead_captured",
    'New lead from the form "Website form"',
    "email",
    22,
  ),
  event(
    1,
    "meeting_booked",
    "Booked a meeting for tomorrow, 3:30 pm",
    "voice",
    48,
  ),
  event(2, "reply_saved", "Replied to a pricing question", "email", 95),
  event(4, "follow_up", "Followed up after a missed call", "whatsapp", 180),
  event(
    3,
    "lead_status_changed",
    "Status changed from Engaged to Qualified",
    null,
    300,
  ),
  event(
    7,
    "reply_received",
    "Replied on social and asked for a case study",
    "social",
    320,
  ),
  event(
    11,
    "lead_captured",
    'New lead from the form "Website form"',
    "email",
    410,
  ),
  event(
    12,
    "note",
    "Met at the chamber of commerce breakfast. Wants a quote in January.",
    null,
    600,
  ),
];

const AGENTS: Agent[] = [
  {
    id: id(601),
    name: "Inbound agent",
    role: "inbound",
    channel: "chat",
    instructions:
      "Answer new leads within a minute. Ask how many locations they run and what they use today. Book qualified leads with Priya.",
    qualifying_questions: "",
    voice: null,
    enabled: true,
    approval_mode: "auto",
    send_window: { days: [1, 2, 3, 4, 5, 6], start: "08:00", end: "19:00" },
  },
  {
    id: id(602),
    name: "Outbound agent",
    role: "outbound",
    channel: "email",
    instructions: "",
    qualifying_questions: "",
    voice: null,
    enabled: false,
    approval_mode: "approve_first",
    send_window: { days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00" },
  },
  {
    id: id(603),
    name: "Closing agent",
    role: "closing",
    channel: "chat",
    instructions: "",
    qualifying_questions: "",
    voice: null,
    enabled: false,
    approval_mode: "approve_first",
    send_window: { days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00" },
  },
  {
    id: id(604),
    name: "Expansion agent",
    role: "expansion",
    channel: "email",
    instructions: "",
    qualifying_questions: "",
    voice: null,
    enabled: false,
    approval_mode: "approve_first",
    send_window: { days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00" },
  },
];

// One draft reply waiting for approval, so the preview shows that state.
const DRAFT: MessageDraft = {
  id: id(981),
  conversation_id: id(201),
  body: "Yes, we do. Most clinic sites go live in about three weeks. How many locations do you run?",
  created_at: minutesAgo(3),
};

function listItem(c: Conversation): ConversationListItem {
  const l = byId(c.lead_id);
  const last = MESSAGES.filter((m) => m.conversation_id === c.id).at(-1);
  return {
    ...c,
    lead: { id: l.id, name: l.name, company: l.company, email: l.email },
    preview: last?.body ?? null,
    has_draft: c.id === DRAFT.conversation_id,
  };
}

const ref = (leadId: string | null) => {
  const l = leadId ? byId(leadId) : null;
  return l ? { id: l.id, name: l.name, company: l.company } : null;
};

const repo: Repo = {
  async home() {
    const waiting = CONVERSATIONS.filter((c) => c.status === "waiting_for_you");
    return {
      needs: {
        emailDrafts: 0,
        chatDrafts: 1,
        chatsWaiting: waiting.filter((c) => c.id !== DRAFT.conversation_id)
          .length,
      },
      // Finding leads isn't part of the preview: it shows as not started.
      find: {
        searches: 0,
        running: false,
        found: 0,
        undecided: 0,
        toWrite: 0,
        drafted: 0,
        approved: 0,
      },
      week: {
        companiesFound: 0,
        emailsApproved: 0,
        chats: CONVERSATIONS.filter((c) => c.widget_id !== null).length,
        chatsAnswered: 1,
        leadsQualified: 1,
      },
      feed: EVENTS.slice(0, 6).map((e) => ({ ...e, lead: ref(e.lead_id) })),
    };
  },
  async emailDraftCount() {
    return 0;
  },
  async waitingCount() {
    return CONVERSATIONS.filter((c) => c.status === "waiting_for_you").length;
  },
  async leads({ q, status }) {
    const term = (q ?? "").trim().toLowerCase();
    return LEADS.filter(
      (l) =>
        (!status || l.status === status) &&
        (!term ||
          [l.name, l.email, l.company, l.phone].some((v) =>
            v?.toLowerCase().includes(term),
          )),
    );
  },
  async lead(leadId) {
    const found = LEADS.find((l) => l.id === leadId);
    if (!found) return null;
    return {
      lead: found,
      conversations: CONVERSATIONS.filter((c) => c.lead_id === leadId).map(
        (c) => ({
          ...c,
          messages: MESSAGES.filter((m) => m.conversation_id === c.id),
        }),
      ),
      calls:
        leadId === id(101)
          ? [
              {
                id: id(701),
                lead_id: leadId,
                direction: "outbound",
                status: "completed",
                started_at: minutesAgo(52),
                duration_seconds: 214,
                summary:
                  "Called back after the form. Two-chair practice, wants more new-patient bookings. Booked an intro call.",
                created_at: minutesAgo(52),
              },
            ]
          : [],
      meetings: MEETINGS.filter((m) => m.lead_id === leadId),
      events: EVENTS.filter((e) => e.lead_id === leadId),
    };
  },
  async conversations(queue: InboxQueue) {
    return CONVERSATIONS.filter((c) =>
      queue === "waiting"
        ? c.status === "waiting_for_you"
        : queue === "open"
          ? c.status === "open"
          : queue === "closed"
            ? c.status === "closed"
            : queue === "mine"
              ? c.assigned_to === ME && c.status !== "closed"
              : true,
    ).map(listItem);
  },
  async conversation(conversationId) {
    const c = CONVERSATIONS.find((x) => x.id === conversationId);
    if (!c) return null;
    return {
      ...listItem(c),
      messages: MESSAGES.filter((m) => m.conversation_id === c.id),
      draft: c.id === DRAFT.conversation_id ? DRAFT : null,
    };
  },
  async knowledge() {
    return [
      {
        id: id(801),
        title: "What we sell",
        kind: "text",
        content:
          "Websites and local SEO for clinics, gyms and trades. Fixed monthly plans from $900. Most projects go live in three weeks.",
        status: "ready",
        source_url: null,
        updated_at: minutesAgo(4000),
      },
      {
        id: id(802),
        title: "Pricing page",
        kind: "url",
        content: "https://northwind.example/pricing",
        status: "not_fetched",
        source_url: null,
        updated_at: minutesAgo(900),
      },
      {
        id: id(803),
        title: "Common objections",
        kind: "text",
        content:
          '"We already have a site": ask when it last brought in an enquiry. "Too expensive": compare with one new client a month.',
        status: "ready",
        source_url: null,
        updated_at: minutesAgo(300),
      },
    ];
  },
  async agents() {
    return AGENTS;
  },
  async members() {
    return [
      {
        user_id: ME,
        role: "owner",
        name: "Jordan Avery",
        email: "jordan@northwind.example",
        created_at: minutesAgo(50000),
      },
      {
        user_id: PRIYA,
        role: "admin",
        name: "Priya Nair",
        email: "priya@northwind.example",
        created_at: minutesAgo(40000),
      },
    ];
  },
  async invitations() {
    return [
      {
        id: id(901),
        email: "jamie@northwind.example",
        role: "member",
        status: "pending",
        created_at: minutesAgo(600),
        expires_at: inHours(300),
      },
    ];
  },
  async leadForms() {
    return [
      {
        id: id(951),
        name: "Website form",
        token: "0".repeat(64),
        enabled: true,
        redirect_url: null,
        created_at: minutesAgo(50000),
      },
    ];
  },
  async chatWidgets() {
    return [
      {
        id: id(971),
        name: "Website chat",
        token: "0".repeat(64),
        enabled: true,
        title: "Chat with us",
        welcome: "Hi. How can we help?",
        created_at: minutesAgo(50000),
        first_seen_at: minutesAgo(40000),
        first_seen_origin: "https://northwind.example",
        last_seen_at: minutesAgo(2),
        last_seen_origin: "https://northwind.example",
      },
    ];
  },
  async setup() {
    return {
      site_status: "done",
      site_url: "northwind.example",
      site_started_at: minutesAgo(50000),
      site_finished_at: minutesAgo(50000),
      site_pages: 3,
      tried_agent_at: null,
      dismissed_at: null,
    };
  },
  async testChat() {
    return [];
  },
  async alertEmails() {
    return true;
  },
};

export function fixtureContext(): AppContext {
  const workspace = {
    id: id(11),
    name: "Northwind Agency",
    slug: "northwind-agency",
    plan: "scale" as const,
    timezone: "America/New_York",
    website: "northwind.example",
    trial_ends_at: inHours(5 * 24 + 3),
    billing_status: "trialing" as const,
    role: "owner" as const,
  };
  return {
    user: { id: ME, email: "jordan@northwind.example", name: "Jordan Avery" },
    workspace,
    workspaces: [
      workspace,
      {
        ...workspace,
        id: id(12),
        name: "Northwind · Client: Cedar Lane",
        slug: "cedar-lane",
      },
    ],
    repo,
    preview: true,
  };
}
