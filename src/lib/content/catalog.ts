// The site's map: the four motions, every play and every platform feature,
// with the one line each gets in the menus, the footer and the cards. The
// full page copy lives beside this file (plays-*.ts, platform-*.ts,
// motions.ts); this file stays small because the navigation ships it to the
// browser.

import {
  AudioLines,
  Building2,
  BarChart3,
  BookOpen,
  CalendarCheck,
  CalendarClock,
  CalendarX,
  Bot,
  Code2,
  Database,
  DatabaseZap,
  Eye,
  FileSearch,
  Filter,
  FlaskConical,
  Gauge,
  GitBranch,
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
  Map as MapIcon,
  Megaphone,
  MessageCircle,
  MessageSquareReply,
  MessageSquareText,
  Newspaper,
  NotebookText,
  Phone,
  PhoneIncoming,
  Radar,
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
  Table2,
  Target,
  Ticket,
  TrendingUp,
  UserCheck,
  Users,
  UsersRound,
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
      "Your booking link offered the moment a lead wants to talk, in email or the website chat.",
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
  | "targeting"
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
    group: "targeting",
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
      "A first email and up to five follow-ups, each with its own wait, language and approval.",
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
      "DNS checks, a gradual ramp-up, daily limits and an automatic pause for every mailbox.",
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
      "Ready-made plays, and your own: who to pick, what to say and which sequence follows.",
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
    blurb:
      "Answers your line day and night, qualifies, sends your booking link and transfers.",
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
      "Rules by country, size, source or play hand each new lead to the right teammate.",
  },
  "crm-integration": {
    title: "CRM integration",
    group: "integrations",
    icon: RefreshCw,
    blurb:
      "HubSpot or Pipedrive: leads, conversations and meetings written in, its contacts kept out of cold email.",
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
      "Companies researching your category on review sites, from your own intent data.",
  },
  api: {
    title: "API",
    group: "integrations",
    icon: Code2,
    blurb:
      "A REST API and signed webhooks: leads, plays, meetings and product events in and out.",
  },
  "lists-and-research": {
    title: "Lists and research columns",
    group: "data",
    icon: Table2,
    blurb:
      "A spreadsheet of companies or people, with a question researched for every row.",
  },
  "market-sourcing": {
    title: "Always-on market sourcing",
    group: "data",
    icon: Radar,
    blurb: "A saved search that keeps adding new companies on a schedule.",
  },
  "crm-enrichment": {
    title: "CRM enrichment",
    group: "data",
    icon: DatabaseZap,
    blurb:
      "Missing emails, titles and company details filled in, and job changes spotted.",
  },
  "saved-audiences": {
    title: "Saved audiences",
    group: "targeting",
    icon: UsersRound,
    blurb: "Segments of your leads that keep themselves up to date.",
  },
  "saved-recipes": {
    title: "Saved recipes",
    group: "research",
    icon: FlaskConical,
    blurb:
      "Research questions and scores you write once and use on any list or play.",
  },
  "account-based-lists": {
    title: "Account-based target lists",
    group: "targeting",
    icon: Building2,
    blurb:
      "Target accounts with their buying committee, and one view per company.",
  },
  "lead-scoring": {
    title: "Lead scoring and tiers",
    group: "targeting",
    icon: Gauge,
    blurb: "Fit and engagement scores, and a tier from 1 to 3 on every lead.",
  },
  "territory-planning": {
    title: "Territory planning",
    group: "targeting",
    icon: MapIcon,
    blurb: "Territories and reps, with accounts shared out fairly.",
  },
  "company-news": {
    title: "Company news signals",
    group: "data",
    icon: Newspaper,
    blurb:
      "Funding, launches and leadership hires at the companies you track, with the source.",
  },
  "account-briefs": {
    title: "Account briefs",
    group: "research",
    icon: NotebookText,
    blurb:
      "A sourced brief before every meeting, and a short note on why a deal was lost.",
  },
  workflows: {
    title: "Workflows",
    group: "outreach",
    icon: GitBranch,
    blurb:
      "When something happens to a lead, the next steps run by themselves.",
  },
  "ad-audiences": {
    title: "Ad audiences",
    group: "targeting",
    icon: Megaphone,
    blurb:
      "Upload files for LinkedIn, Meta and Google ads, and suppression lists, from your leads.",
  },
  "mcp-server": {
    title: "MCP server for reps",
    group: "integrations",
    icon: Bot,
    blurb:
      "Use Dialvo from Claude, Cursor and other AI tools: leads, history, contacts and briefs.",
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
      f("lists-and-research"),
      f("market-sourcing"),
      f("crm-enrichment"),
      f("website-visitor-tracking"),
      f("company-news"),
    ],
  },
  {
    id: "targeting",
    title: "Scoring & accounts",
    icon: Target,
    blurb: "Which leads and accounts come first, and who owns them.",
    items: [
      f("lead-qualification"),
      f("lead-scoring"),
      f("account-based-lists"),
      f("territory-planning"),
      f("saved-audiences"),
      f("ad-audiences"),
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
      f("workflows"),
      p("event-registration"),
      p("event-follow-up"),
      p("event-no-show"),
    ],
  },
  {
    id: "research",
    title: "Research & messaging",
    icon: FileSearch,
    blurb: "What each agent knows before it writes or speaks.",
    items: [
      f("deep-research"),
      f("account-briefs"),
      f("saved-recipes"),
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
    id: "integrations",
    title: "Integrations",
    icon: Globe,
    blurb: "Dialvo inside the tools you already run on.",
    items: [
      f("crm-integration"),
      f("slack-integration"),
      f("api"),
      f("mcp-server"),
      f("review-site-intent"),
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
