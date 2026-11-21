// The site's map: the four motions, every play and every platform feature,
// with the one line each gets in the menus, the footer and the cards. The
// full page copy lives beside this file (plays-*.ts, platform-*.ts,
// motions.ts); this file stays small because the navigation ships it to the
// browser.

import {
  AudioLines,
  BarChart3,
  BookOpen,
  CalendarCheck,
  CalendarClock,
  CalendarX,
  Code2,
  Database,
  Eye,
  FileSearch,
  Filter,
  Globe,
  GraduationCap,
  Handshake,
  Hash,
  History,
  Inbox,
  Languages,
  LayoutList,
  ListTree,
  Mail,
  MailCheck,
  MessageCircle,
  MessageSquareReply,
  MessageSquareText,
  Phone,
  PhoneIncoming,
  RefreshCw,
  Route,
  Search,
  Send,
  Share2,
  ShieldCheck,
  Sparkles,
  Sprout,
  Star,
  Swords,
  Ticket,
  TrendingUp,
  UserCheck,
  Users,
  Waypoints,
  Workflow,
  Zap,
  type LucideIcon,
} from "lucide-react";

// --- Motions ---------------------------------------------------------------------

export type MotionId = "inbound" | "outbound" | "closing" | "expansion";

export const MOTIONS: {
  id: MotionId;
  name: string;
  href: string;
  icon: LucideIcon;
  blurb: string;
}[] = [
  {
    id: "inbound",
    name: "Inbound",
    href: "/inbound",
    icon: Inbox,
    blurb: "Answer, qualify and book every lead within seconds.",
  },
  {
    id: "outbound",
    name: "Outbound",
    href: "/outbound",
    icon: Send,
    blurb: "Researched email and LinkedIn outreach to the right people.",
  },
  // Closing has no plays of its own: it finishes what the others start.
  {
    id: "closing",
    name: "Closing",
    href: "/closing",
    icon: Handshake,
    blurb: "Simple sales finished on the spot, with a secure payment link.",
  },
  {
    id: "expansion",
    name: "Expansion",
    href: "/expansion",
    icon: TrendingUp,
    blurb: "Find upgrades and renewals across every customer.",
  },
];

export const motionById = (id: MotionId) => MOTIONS.find((m) => m.id === id)!;

// --- Channels --------------------------------------------------------------------

export const CHANNELS = {
  voice: { label: "Voice", icon: Phone },
  email: { label: "Email", icon: Mail },
  chat: { label: "Website chat", icon: MessageCircle },
  social: { label: "LinkedIn and social", icon: Share2 },
  messages: { label: "SMS and WhatsApp", icon: MessageSquareText },
} as const satisfies Record<string, { label: string; icon: LucideIcon }>;

export type ChannelId = keyof typeof CHANNELS;

// --- Plays -----------------------------------------------------------------------

type PlayEntry = {
  title: string;
  motion: MotionId;
  icon: LucideIcon;
  blurb: string;
};

export const PLAYS = {
  "speed-to-lead": {
    title: "Speed to lead",
    motion: "inbound",
    icon: Zap,
    blurb:
      "Every form fill gets an email or chat reply within seconds, at any hour.",
  },
  "automated-meeting-scheduling": {
    title: "Automated meeting scheduling",
    motion: "inbound",
    icon: CalendarCheck,
    blurb:
      "Meetings booked on the right rep's calendar during the first conversation.",
  },
  "customer-onboarding-operations": {
    title: "Customer onboarding operations",
    motion: "inbound",
    icon: GraduationCap,
    blurb:
      "A live onboarding conversation for every new customer, not only the big ones.",
  },
  "outbound-lead-generation": {
    title: "Outbound lead generation",
    motion: "outbound",
    icon: Send,
    blurb:
      "From a description of your ideal customer to researched outreach and booked meetings.",
  },
  "lead-nurture": {
    title: "Lead nurture",
    motion: "outbound",
    icon: Sprout,
    blurb:
      "Useful follow-up for leads who aren't ready, and a handoff the moment they are.",
  },
  "lead-reactivation": {
    title: "Lead reactivation",
    motion: "outbound",
    icon: RefreshCw,
    blurb:
      "Old leads in your CRM get a fresh reason to talk when something changes.",
  },
  "retargeting-website-visitors": {
    title: "Retargeting website visitors",
    motion: "outbound",
    icon: Eye,
    blurb:
      "Accounts reading your pricing page hear from you while it's still on their mind.",
  },
  "closed-lost": {
    title: "Closed lost",
    motion: "outbound",
    icon: History,
    blurb:
      "Lost deals revisited when the reason they said no may no longer hold.",
  },
  "competitive-takeout": {
    title: "Competitive takeout",
    motion: "outbound",
    icon: Swords,
    blurb:
      "Reach a competitor's customers at the moment they have a reason to look around.",
  },
  "event-registration": {
    title: "Event registration",
    motion: "outbound",
    icon: Ticket,
    blurb:
      "Personal invitations that get the right accounts to your webinar or event.",
  },
  "event-follow-up": {
    title: "Event follow-up",
    motion: "outbound",
    icon: CalendarClock,
    blurb:
      "Everyone who attended hears from you within a day, about what they saw.",
  },
  "event-no-show": {
    title: "Event no-show",
    motion: "outbound",
    icon: CalendarX,
    blurb:
      "People who registered and missed it get a second, better reason to talk.",
  },
  "customer-expansion": {
    title: "Customer expansion",
    motion: "expansion",
    icon: TrendingUp,
    blurb:
      "Upgrades, extra seats and second products raised at the right moment.",
  },
  "plg-conversion": {
    title: "PLG conversion",
    motion: "expansion",
    icon: Users,
    blurb:
      "Free and trial users who behave like buyers get a helpful conversation.",
  },
} as const satisfies Record<string, PlayEntry>;

export type PlaySlug = keyof typeof PLAYS;

export const PLAY_SLUGS = Object.keys(PLAYS) as PlaySlug[];

export const playHref = (slug: PlaySlug) => `/plays/${slug}`;

export const playsIn = (motion: MotionId) =>
  PLAY_SLUGS.filter((s) => PLAYS[s].motion === motion);

/**
 * The plays the "Use cases" menu lists under each motion. The other four
 * (outbound lead generation and the three event plays) sit in the Platform
 * menu under Outreach and workflows.
 */
export const MENU_PLAYS: Record<MotionId, PlaySlug[]> = {
  inbound: [
    "speed-to-lead",
    "automated-meeting-scheduling",
    "customer-onboarding-operations",
  ],
  outbound: [
    "lead-nurture",
    "lead-reactivation",
    "retargeting-website-visitors",
    "closed-lost",
    "competitive-takeout",
  ],
  closing: [],
  expansion: ["customer-expansion", "plg-conversion"],
};

// --- Platform --------------------------------------------------------------------

export type GroupId =
  | "data"
  | "outreach"
  | "analytics"
  | "research"
  | "inbound-handling"
  | "integrations";

type FeatureEntry = {
  title: string;
  group: GroupId;
  icon: LucideIcon;
  blurb: string;
};

export const FEATURES = {
  "company-and-lead-database": {
    title: "Real-time company and lead database",
    group: "data",
    icon: Database,
    blurb:
      "Companies and contacts checked at the moment you reach out, not when you bought the list.",
  },
  "live-web-search-prospecting": {
    title: "Live web search and AI prospecting",
    group: "data",
    icon: Search,
    blurb:
      "Describe the accounts you want in a sentence; get a list with the reason for each.",
  },
  "lead-qualification": {
    title: "Lead qualification",
    group: "data",
    icon: Filter,
    blurb:
      "Every lead checked against your criteria before a single message goes out.",
  },
  "website-visitor-tracking": {
    title: "Website visitor tracking",
    group: "data",
    icon: Eye,
    blurb:
      "See which companies are on your site and what they read, then act on it.",
  },
  "multi-channel-sequences": {
    title: "Multi-channel sequences",
    group: "outreach",
    icon: Waypoints,
    blurb: "Email, LinkedIn and texts as one conversation that remembers.",
  },
  "sequence-builder": {
    title: "Sequence builder",
    group: "outreach",
    icon: ListTree,
    blurb:
      "Steps, timing, channels and branches in one place, with limits you set.",
  },
  "smart-replies": {
    title: "Smart replies",
    group: "outreach",
    icon: MessageSquareReply,
    blurb:
      "Replies sorted and answered within minutes; meetings booked; opt-outs honoured.",
  },
  "multilingual-outreach": {
    title: "Multilingual outreach",
    group: "outreach",
    icon: Languages,
    blurb:
      "Agents write and speak in your buyer's language, from knowledge you add per market.",
  },
  analytics: {
    title: "Analytics",
    group: "analytics",
    icon: BarChart3,
    blurb:
      "Conversations, replies, qualified leads and meetings by channel and by play.",
  },
  "deliverability-and-mailbox-health": {
    title: "Deliverability and mailbox health",
    group: "analytics",
    icon: MailCheck,
    blurb:
      "Authenticated domains, gradual warm-up, daily limits and rotation for your inboxes.",
  },
  "call-deliverability-and-number-management": {
    title: "Phone number management",
    group: "analytics",
    icon: ShieldCheck,
    blurb: "Local business numbers your phone agent answers, day and night.",
  },
  "deep-research": {
    title: "Deep research",
    group: "research",
    icon: FileSearch,
    blurb:
      "A sourced brief on every account, with the angle worth leading with.",
  },
  "ai-personalisation": {
    title: "AI personalisation",
    group: "research",
    icon: Sparkles,
    blurb:
      "One message for one person, written from the research. No merge fields.",
  },
  playbooks: {
    title: "Playbooks",
    group: "research",
    icon: LayoutList,
    blurb:
      "Ready-made plays with their own audience, research and follow-up logic.",
  },
  "knowledge-base": {
    title: "Knowledge base",
    group: "research",
    icon: BookOpen,
    blurb:
      "Your site, documents, pricing and call notes: what every agent answers from.",
  },
  "ai-phone-agent": {
    title: "AI phone agent",
    group: "inbound-handling",
    icon: PhoneIncoming,
    blurb: "Answers your line day and night, qualifies, books and transfers.",
  },
  "inbound-lead-qualification": {
    title: "Inbound lead qualification",
    group: "inbound-handling",
    icon: UserCheck,
    blurb:
      "Your qualifying questions asked in the first conversation, with the answers recorded.",
  },
  "intelligent-lead-routing": {
    title: "Intelligent lead routing",
    group: "inbound-handling",
    icon: Route,
    blurb:
      "Territory, owner, seniority or round robin, applied while the lead is still talking.",
  },
  "crm-integration": {
    title: "CRM integration",
    group: "integrations",
    icon: RefreshCw,
    blurb:
      "Two-way sync with Salesforce, HubSpot, Pipedrive and Zoho, field by field.",
  },
  "slack-integration": {
    title: "Slack integration",
    group: "integrations",
    icon: Hash,
    blurb:
      "A note in the right channel when a lead qualifies, books or needs a person.",
  },
  "review-site-intent": {
    title: "Review-site intent integration",
    group: "integrations",
    icon: Star,
    blurb:
      "Buyer-intent signals from software review sites, turned into timely outreach.",
  },
  api: {
    title: "API",
    group: "integrations",
    icon: Code2,
    blurb:
      "Trigger agents from your own systems and pull every outcome back out.",
  },
} as const satisfies Record<string, FeatureEntry>;

export type FeatureSlug = keyof typeof FEATURES;

export const FEATURE_SLUGS = Object.keys(FEATURES) as FeatureSlug[];

export const featureHref = (slug: FeatureSlug) => `/platform/${slug}`;

/** A link in a platform group: a feature page, or a play that lives there too. */
export type PlatformItem =
  { type: "feature"; slug: FeatureSlug } | { type: "play"; slug: PlaySlug };

const f = (slug: FeatureSlug): PlatformItem => ({ type: "feature", slug });
const p = (slug: PlaySlug): PlatformItem => ({ type: "play", slug });

export const GROUPS: {
  id: GroupId;
  title: string;
  icon: LucideIcon;
  blurb: string;
  items: PlatformItem[];
}[] = [
  {
    id: "data",
    title: "Data & lead generation",
    icon: Database,
    blurb: "Who to talk to, and why this week.",
    items: [
      f("company-and-lead-database"),
      f("live-web-search-prospecting"),
      f("lead-qualification"),
      f("website-visitor-tracking"),
    ],
  },
  {
    id: "outreach",
    title: "Outreach & workflows",
    icon: Workflow,
    blurb: "The sequences and plays that carry the conversation.",
    items: [
      p("outbound-lead-generation"),
      f("multi-channel-sequences"),
      f("sequence-builder"),
      f("smart-replies"),
      f("multilingual-outreach"),
      p("event-registration"),
      p("event-follow-up"),
      p("event-no-show"),
    ],
  },
  {
    id: "analytics",
    title: "Analytics & deliverability",
    icon: BarChart3,
    blurb: "What's working, and whether it's arriving.",
    items: [
      f("analytics"),
      f("deliverability-and-mailbox-health"),
      f("call-deliverability-and-number-management"),
    ],
  },
  {
    id: "research",
    title: "Research & messaging",
    icon: FileSearch,
    blurb: "What each agent knows before it writes or speaks.",
    items: [
      f("deep-research"),
      f("ai-personalisation"),
      f("playbooks"),
      f("knowledge-base"),
    ],
  },
  {
    id: "inbound-handling",
    title: "Inbound handling",
    icon: AudioLines,
    blurb: "The first conversation, done properly.",
    items: [
      f("ai-phone-agent"),
      f("inbound-lead-qualification"),
      f("intelligent-lead-routing"),
    ],
  },
  {
    id: "integrations",
    title: "Integrations",
    icon: Globe,
    blurb: "Dialvo inside the tools you already run on.",
    items: [
      f("crm-integration"),
      f("slack-integration"),
      f("review-site-intent"),
      f("api"),
    ],
  },
];

export const groupById = (id: GroupId) => GROUPS.find((g) => g.id === id)!;

/** Title, link, icon and one-liner for a platform menu item of either kind. */
export function itemInfo(item: PlatformItem) {
  const entry: { title: string; icon: LucideIcon; blurb: string } =
    item.type === "feature" ? FEATURES[item.slug] : PLAYS[item.slug];
  return {
    key: `${item.type}:${item.slug}`,
    href:
      item.type === "feature" ? featureHref(item.slug) : playHref(item.slug),
    title: entry.title,
    icon: entry.icon,
    blurb: entry.blurb,
  };
}
