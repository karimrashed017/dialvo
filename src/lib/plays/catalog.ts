import {
  FEATURES,
  GROUPS,
  MENU_PLAYS,
  PLAYS,
  type FeatureSlug,
  type GroupId,
  type PlaySlug,
} from "@/lib/content/catalog";

// What the app says about every play and every platform feature the
// marketing site's menus list: where it lives in the app and whether it
// works yet. The names, slugs and groups come from the site's own catalog
// (src/lib/content/catalog.ts), so the two can't drift apart; the words here
// are the app's own, plain and short.
//
// KEEP THE STATUS TRUE. "live" means a person can use it in the app today,
// end to end. "partly" means part of what the site describes works and the
// note says which part. "building" means nothing of it runs yet: its page
// says what it will do and what it needs, and shows no data. The site's play
// and platform pages read the same status (statusLine below).

export type Status = "live" | "partly" | "building";

export const STATUS_LABEL: Record<Status, string> = {
  live: "Live",
  partly: "Partly live",
  building: "Being built",
};

/** The database's name for the drafts a play writes (outbound_drafts.play). */
export type PlayKind =
  | "speed_to_lead"
  | "nurture"
  | "reactivation"
  | "closed_lost"
  | "takeout"
  | "event_registration"
  | "event_followup"
  | "event_no_show"
  | "onboarding"
  | "expansion"
  | "plg"
  | "retargeting"
  | "intent";

export type AppPlay = {
  slug: PlaySlug;
  status: Status;
  /** What it does, in two plain sentences. */
  what: string;
  /** Who it writes to. */
  who: string;
  /** What it needs before it can run. */
  needs: string[];
  /** For "partly": what works and what doesn't yet. */
  note?: string;
  /** The drafts it writes, for its counts. */
  kinds: PlayKind[];
  /** Where it is set up, when that's another page of the app. */
  elsewhere?: { href: string; label: string };
};

export const APP_PLAYS: Record<PlaySlug, AppPlay> = {
  "speed-to-lead": {
    slug: "speed-to-lead",
    status: "live",
    what: "When someone fills in your form or leaves their email in the website chat, Dialvo drafts a reply email to them straight away, from your Knowledge and what they asked. The chat itself answers visitors as they write.",
    who: "New leads from your forms and your website chat who left an email address, from the moment you switch this on.",
    needs: [
      "A connected mailbox with sending switched on",
      "Your website chat or a form on your site",
    ],
    note: "Calls and SMS replies aren't built yet: speed to lead answers by email and in the chat.",
    kinds: ["speed_to_lead"],
  },
  "automated-meeting-scheduling": {
    slug: "automated-meeting-scheduling",
    status: "partly",
    what: "Add your booking link once. When someone replies to an email wanting to talk, the reply Dialvo drafts offers that link, written out exactly. Meetings you mark as booked show on the lead and in Analytics.",
    who: "People who reply to your emails and want to meet.",
    needs: ["A booking link (any scheduling page)", "A connected mailbox"],
    note: "Email replies offer your booking link today. In the website chat, someone who wants to book is handed to your team instead; offering the link in the chat is being built. Booking straight into a calendar isn't built.",
    kinds: [],
    elsewhere: {
      href: "/app/settings/mailboxes#follow-ups",
      label: "Set your booking link",
    },
  },
  "customer-onboarding-operations": {
    slug: "customer-onboarding-operations",
    status: "partly",
    what: "A check-in email to each new customer: how to get started and where to get help, written from your Knowledge. One email per customer, no follow-ups, waiting for your approval.",
    who: "Leads marked won (or marked as a customer) in the last N days who agreed to hear from you by email or have written to you before.",
    needs: [
      "Customers marked won on Leads",
      "Their email consent, or a conversation with them",
      "A connected mailbox",
    ],
    note: "Onboarding check-in emails work. Onboarding calls and a step-by-step onboarding plan aren't built.",
    kinds: ["onboarding"],
  },
  "outbound-lead-generation": {
    slug: "outbound-lead-generation",
    status: "live",
    what: "Describe who you sell to. Dialvo finds matching companies, reads their websites, finds a named contact, and drafts a first email for the ones you keep.",
    who: "New companies that fit your description, never ones already in your leads, your CRM or your never-contact list.",
    needs: ["A description of who you sell to", "A connected mailbox to send"],
    kinds: [],
    elsewhere: { href: "/app/prospects?search=new", label: "Open Find leads" },
  },
  "lead-nurture": {
    slug: "lead-nurture",
    status: "partly",
    what: "For leads whose first emails ran their course without a reply, one useful, value-first email from your Knowledge after a long gap. At most two per lead, ever.",
    who: "New, engaged or qualified leads whose last sequence finished more than N days ago with no reply, who never replied and never said no.",
    needs: [
      "Leads you've emailed before",
      "Something useful in Knowledge",
      "A connected mailbox",
    ],
    note: "Nurture by email works. LinkedIn and SMS touches aren't built.",
    kinds: ["nurture"],
  },
  "lead-reactivation": {
    slug: "lead-reactivation",
    status: "live",
    what: "Finds leads that have gone quiet and drafts a short, honest check-in to each, which waits for your approval.",
    who: "New, engaged or qualified leads with no activity for N days (30 to start) who never said no, unsubscribed or asked not to be contacted.",
    needs: ["Leads with an email address", "A connected mailbox"],
    kinds: ["reactivation"],
  },
  "retargeting-website-visitors": {
    slug: "retargeting-website-visitors",
    status: "live",
    what: "Shows which companies and known leads are reading your site, especially your pricing page. For companies it finds a named person and drafts a first email; for known leads, a short check-in. No email says they visited, and each waits for your approval.",
    who: "Companies identified from visits to your site, and your own leads (not customers) who read your pricing page in the last two weeks.",
    needs: [
      "Website visitor tracking switched on, with the website chat's code on your site",
      "The contact database (Findymail) switched on, for companies",
      "A connected mailbox",
    ],
    note: "Known leads are tracked as they chat, fill in a form or click a link in your email. Identifying anonymous companies also needs the company-lookup key on Dialvo's side.",
    kinds: ["retargeting"],
    elsewhere: { href: "/app/visitors", label: "Open Website visitors" },
  },
  "closed-lost": {
    slug: "closed-lost",
    status: "live",
    what: "Revisits deals you lost a while ago with a brief, low-pressure note in case things have changed. Each draft waits for your approval.",
    who: "Leads marked lost more than N days ago (90 to start), never someone marked do not contact or who unsubscribed.",
    needs: ["Leads marked lost on Leads", "A connected mailbox"],
    kinds: ["closed_lost"],
  },
  "competitive-takeout": {
    slug: "competitive-takeout",
    status: "partly",
    what: "Name a competitor. Dialvo searches for companies that use it, checks each company's technology data for that product, and drafts a first email that mentions switching honestly: no criticism of the competitor and no claims you can't back.",
    who: "Companies that fit who you sell to and are found to use the competitor you name.",
    needs: [
      "The contact database (Findymail) switched on",
      "A competitor's product name",
      "A connected mailbox",
    ],
    note: "The search and the technology check run on Findymail's data. A company where the product isn't detected is shown as not confirmed, and its email doesn't mention it.",
    kinds: ["takeout"],
  },
  "event-registration": {
    slug: "event-registration",
    status: "live",
    what: "Upload your registrant list and a link. Each registrant gets a short, personal note before the event with the link.",
    who: "Everyone on the list you upload.",
    needs: ["A CSV of registrants (name, email)", "A connected mailbox"],
    kinds: ["event_registration"],
  },
  "event-follow-up": {
    slug: "event-follow-up",
    status: "live",
    what: "Upload your attendee list. Everyone who attended gets a follow-up about the event, with the link you choose (a replay or slides).",
    who: "The people on your list marked as attended.",
    needs: ["A CSV with an attended column (yes or no)", "A connected mailbox"],
    kinds: ["event_followup"],
  },
  "event-no-show": {
    slug: "event-no-show",
    status: "live",
    what: "People who registered and didn't make it get a friendly note with the replay or the next date.",
    who: "The people on your list marked as not attended.",
    needs: ["A CSV with an attended column (yes or no)", "A connected mailbox"],
    kinds: ["event_no_show"],
  },
  "customer-expansion": {
    slug: "customer-expansion",
    status: "live",
    what: "Drafts a relevant next step for existing customers, such as an upgrade or another product, written only from what your Knowledge says you offer.",
    who: "Customers (marked won, or as a customer) who agreed to hear from you by email or have written to you before.",
    needs: [
      "Customers marked won on Leads",
      "Their email consent, or a conversation with them",
      "What you offer in Knowledge",
    ],
    kinds: ["expansion"],
  },
  "plg-conversion": {
    slug: "plg-conversion",
    status: "live",
    what: "Your app sends Dialvo events such as trial_started or limit_reached. When a trial user hits a limit or their trial ends within three days, Dialvo marks them ready and drafts a helpful email.",
    who: "Trial users in your leads who reached a limit in the last N days or whose trial ends within three days.",
    needs: [
      "An API key (Settings, API) and a few lines in your app",
      "Your trial users as leads, matched by email",
    ],
    kinds: ["plg"],
  },
};

/** The plays in the order the site's Use cases menu lists them. */
export const PLAY_GROUPS: { id: string; title: string; plays: PlaySlug[] }[] = [
  { id: "inbound", title: "Inbound", plays: MENU_PLAYS.inbound },
  {
    id: "outbound",
    title: "Outbound",
    plays: [
      "outbound-lead-generation",
      ...MENU_PLAYS.outbound,
      "event-registration",
      "event-follow-up",
      "event-no-show",
    ],
  },
  { id: "expansion", title: "Expansion", plays: MENU_PLAYS.expansion },
];

export const playTitle = (slug: PlaySlug) => PLAYS[slug].title;

// --- Platform features ---------------------------------------------------------

export type AppFeature = {
  status: Status;
  /** Where it lives in the app; a "building" feature has its own page. */
  href: string;
  /** One line on what of it works, or what it will do. */
  note: string;
  /** For "building": what it needs before it can be built or switched on. */
  needs?: string[];
};

// A "building" feature's own page. Kept for features not yet live.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const building = (slug: FeatureSlug) => `/app/features/${slug}`;

export const APP_FEATURES: Record<FeatureSlug, AppFeature> = {
  "company-and-lead-database": {
    status: "live",
    href: "/app/prospects",
    note: "Find leads searches a live company and contact database (Findymail) for named contacts with emails, plus Lookalike and Target accounts.",
  },
  "live-web-search-prospecting": {
    status: "live",
    href: "/app/prospects",
    note: "Without the database, Find leads searches the web and reads each company's own site.",
  },
  "lead-qualification": {
    status: "live",
    href: "/app/prospects",
    note: "Each company found is checked against your description; ones that don't fit, competitors and very large companies are left out with the reason.",
  },
  "website-visitor-tracking": {
    status: "live",
    href: "/app/visitors",
    note: "Page views from your site, with consent and never with Do Not Track; known leads from chats, forms and email links; companies by network once the company-lookup key (ipapi.is) is set on Dialvo's side.",
  },
  "multi-channel-sequences": {
    status: "partly",
    href: "/app/sequences",
    note: "Email sequences work: a first email and up to two follow-ups. LinkedIn, SMS and calls in a sequence aren't built.",
  },
  "sequence-builder": {
    status: "partly",
    href: "/app/sequences",
    note: "Set how many follow-ups (none, one or two), the gaps between them and whether they wait for approval. Custom steps per sequence aren't built.",
  },
  "smart-replies": {
    status: "live",
    href: "/app/inbox",
    note: "Replies are read and sorted (interested, question, not now, not interested, unsubscribe) and an answer is drafted for you in the Inbox.",
  },
  "multilingual-outreach": {
    status: "partly",
    href: "/app/prospects?view=emails",
    note: "First emails are written in the language of the company's own website, and the chat replies in the visitor's language. Choosing a language per sequence isn't built.",
  },
  "consented-outbound-calling": {
    status: "building",
    href: "/app/calls",
    note: "Calls to people who agreed to be called. No phone provider is connected yet.",
    needs: ["A phone provider for calls and numbers"],
  },
  analytics: {
    status: "live",
    href: "/app/analytics",
    note: "Leads found, emails sent, replies, meetings and chats over 7, 30 or 90 days, by play, search and mailbox.",
  },
  "deliverability-and-mailbox-health": {
    status: "partly",
    href: "/app/settings/mailboxes",
    note: "Daily limits per mailbox, a slow ramp-up for new ones, pausing after login failures, and bounce and unsubscribe rates in Analytics. Inbox-placement tests and DNS checks aren't built.",
  },
  "call-deliverability-and-number-management": {
    status: "building",
    href: "/app/calls",
    note: "Phone numbers and caller reputation. No phone provider is connected yet.",
    needs: ["A phone provider for calls and numbers"],
  },
  "deep-research": {
    status: "live",
    href: "/app/prospects",
    note: "Each company's own website is read and the useful facts are kept with the page they came from.",
  },
  "ai-personalisation": {
    status: "live",
    href: "/app/prospects?view=emails",
    note: "Every first email opens with a fact from that company's research, and you approve it before it is sent.",
  },
  playbooks: {
    status: "partly",
    href: "/app/plays",
    note: "Ready-made plays you can start from Plays. Writing your own playbook isn't built.",
  },
  "knowledge-base": {
    status: "live",
    href: "/app/knowledge",
    note: "What every agent and email is written from: your pages, notes and answers.",
  },
  "ai-phone-agent": {
    status: "building",
    href: "/app/calls",
    note: "An agent that answers and makes calls. There is a voice demo on the website; calls from your own number aren't built.",
    needs: ["A phone provider for calls and numbers"],
  },
  "inbound-lead-qualification": {
    status: "live",
    href: "/app/chat",
    note: "The website chat answers from your Knowledge, asks your qualifying questions and hands the right visitors to your team.",
  },
  "intelligent-lead-routing": {
    status: "partly",
    href: "/app/settings#alerts",
    note: "Your team is alerted when a chat needs a person or someone replies interested. Routing to a particular teammate by rules isn't built.",
  },
  "crm-integration": {
    status: "live",
    href: "/app/settings/crm",
    note: "HubSpot or Pipedrive: leads, conversations and meetings written to your CRM, and its contacts never emailed cold.",
  },
  "slack-integration": {
    status: "live",
    href: "/app/settings/slack",
    note: "Paste a Slack webhook: hot replies, chats that need a person, meetings booked, a daily approvals digest and finished plays go to your channel. Approving stays in the app.",
  },
  "review-site-intent": {
    status: "live",
    href: "/app/prospects/signals",
    note: "Companies researching your category on review sites, from your own export (CSV), a webhook or your G2 Buyer Intent token, on Signals; keep one to find a contact and draft an email.",
  },
  api: {
    status: "live",
    href: "/app/settings/api",
    note: "A REST API with workspace keys: leads, conversations, plays, meetings and product events, plus signed webhooks for new leads, replies and meetings.",
  },
};

/** The site's Platform menu, with each item's place in the app. */
export function featureGroups() {
  return GROUPS.map((g) => ({
    id: g.id as GroupId,
    title: g.title,
    blurb: g.blurb,
    items: g.items.map((item) =>
      item.type === "feature"
        ? {
            key: `feature:${item.slug}`,
            title: FEATURES[item.slug].title,
            status: APP_FEATURES[item.slug].status,
            href: APP_FEATURES[item.slug].href,
            note: APP_FEATURES[item.slug].note,
          }
        : {
            key: `play:${item.slug}`,
            title: PLAYS[item.slug].title,
            status: APP_PLAYS[item.slug].status,
            href: `/app/plays/${item.slug}`,
            note: APP_PLAYS[item.slug].what.split(". ")[0] + ".",
          },
    ),
  }));
}

/** The one line the site's play and platform pages show. */
export function statusLine(status: Status): string {
  return status === "building" ? "Being built" : "Available in the app";
}

export const isPlaySlug = (slug: string): slug is PlaySlug =>
  Object.hasOwn(APP_PLAYS, slug);
export const isFeatureSlug = (slug: string): slug is FeatureSlug =>
  Object.hasOwn(APP_FEATURES, slug);
