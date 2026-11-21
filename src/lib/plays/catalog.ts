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
  | "playbook";

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
    status: "live",
    what: "Add your booking link once. When someone replies to an email wanting to talk, or a visitor in your website chat wants to meet, Dialvo offers that link and tells your team. Bookings made from the chat are recorded on the lead.",
    who: "People who reply to your emails, and website chat visitors who want to meet.",
    needs: [
      "A booking link (any scheduling page)",
      "Your scheduling page's redirect after booking set to Dialvo's link",
      "A connected mailbox for email replies",
    ],
    note: "Visitors pick a time on your own scheduling page; Dialvo doesn't read your calendar. A meeting is added with its time when your scheduling page passes the time back; otherwise the lead is marked meeting booked.",
    kinds: [],
    elsewhere: {
      href: "/app/settings/mailboxes#follow-ups",
      label: "Set your booking link",
    },
  },
  "customer-onboarding-operations": {
    slug: "customer-onboarding-operations",
    status: "live",
    what: "A welcome email to each new customer, then check-ins on the days you set: getting started, a useful tip, whether anything is in their way. Written from your Knowledge, each waiting for your approval unless you choose otherwise.",
    who: "Leads marked won (or marked as a customer) in the last N days who agreed to hear from you by email or have written to you before.",
    needs: [
      "Customers marked won on Leads",
      "Their email consent, or a conversation with them",
      "A connected mailbox",
    ],
    note: "Starts with a ready-made welcome and three check-ins (days 3, 10 and 24), which you can change in Sequences. A reply ends the check-ins for that customer.",
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
    status: "live",
    what: "For leads whose first emails ran their course without a reply, a slow email nurture: a useful, value-first email from your Knowledge, then a few more weeks apart. A reply or an unsubscribe ends it.",
    who: "New, engaged or qualified leads whose last sequence finished more than N days ago with no reply, who never replied and never said no.",
    needs: [
      "Leads you've emailed before",
      "Something useful in Knowledge",
      "A connected mailbox",
    ],
    note: "Email nurture: a ready-made sequence of a first email and three more, 2, 3 and 4 weeks apart, which you can change in Sequences. At most two nurture runs per lead.",
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
    status: "building",
    what: "Will tell you which companies are reading your site, especially your pricing page, and draft outreach to the right person there while it's still on their mind.",
    who: "Companies identified from visits to your website.",
    needs: [
      "A visitor-identification data provider, which isn't connected yet",
    ],
    kinds: [],
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
    status: "live",
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
    status: "building",
    href: building("website-visitor-tracking"),
    note: "Will show which companies visit your site. It needs a visitor-identification data provider, which isn't connected.",
    needs: [
      "A visitor-identification data provider (a paid service the founder chooses)",
      "A small tracking snippet on your site",
    ],
  },
  "multi-channel-sequences": {
    status: "partly",
    href: "/app/sequences",
    note: "Email sequences work: a first email and up to two follow-ups. LinkedIn, SMS and calls in a sequence aren't built.",
  },
  "sequence-builder": {
    status: "live",
    href: "/app/sequences",
    note: "Build sequences of a first email and up to five follow-ups: add, remove and reorder steps, each with its own wait and instructions, a language and an approval setting.",
  },
  "smart-replies": {
    status: "live",
    href: "/app/inbox",
    note: "Replies are read and sorted (interested, question, not now, not interested, unsubscribe) and an answer is drafted for you in the Inbox.",
  },
  "multilingual-outreach": {
    status: "live",
    href: "/app/sequences",
    note: "Choose a language per sequence, play or playbook, or leave it on auto (the company's own website language); first emails and follow-ups follow it, and the chat replies in the visitor's language.",
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
    status: "live",
    href: "/app/settings/mailboxes#deliverability",
    note: "DNS checks per mailbox (SPF, DKIM, DMARC, MX) with plain fixes, daily limits and a ramp-up, and automatic pausing when bounces or unsubscribes run high. No inbox-placement tests.",
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
    status: "live",
    href: "/app/plays/playbooks",
    note: "Ready-made plays, and your own playbooks: pick leads by stage, inactivity and source, set the first email's goal, the sequence and whether it waits for you.",
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
    status: "live",
    href: "/app/settings/routing",
    note: "Rules by country, company size, source or play give each new lead and its conversations to one teammate or several in turn, and alert that person.",
  },
  "crm-integration": {
    status: "live",
    href: "/app/settings/crm",
    note: "HubSpot or Pipedrive: leads, conversations and meetings written to your CRM, and its contacts never emailed cold.",
  },
  "slack-integration": {
    status: "building",
    href: building("slack-integration"),
    note: "Will post alerts and approvals to a Slack channel. Alerts go by email today.",
    needs: ["A Slack app for Dialvo, connected per workspace"],
  },
  "review-site-intent": {
    status: "building",
    href: building("review-site-intent"),
    note: "Will show companies researching your category on review sites. It needs a review-site intent data provider, which isn't connected.",
    needs: ["A review-site intent data provider (a paid service)"],
  },
  api: {
    status: "partly",
    href: "/app/settings/api",
    note: "Send product events from your app (POST /api/v1/events) with a workspace API key. A wider API isn't built.",
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
