import { fmt, PLANS } from "@/lib/site";

// Starter, Pro and Scale (prices: founder, 19 Nov 2026). Every number comes from
// src/lib/site.ts. The plans describe
// the product, not a list of what's switched on for each account today.

export type Plan = {
  id: "starter" | "pro" | "scale";
  badge?: string;
  name: string;
  price: number;
  /** What the plan is for, in a few words; the lead says who it's for. */
  tagline: string;
  lead: string;
  cta: string;
  intro: string;
  features: string[];
  note: string;
  featured?: boolean;
};

const NOTE = "7-day free trial. Cancel anytime.";

export const PLAN_CARDS: Plan[] = [
  {
    id: "starter",
    name: PLANS.starter.name,
    price: PLANS.starter.price,
    tagline: "Inbound.",
    lead: "For a business that gets leads and loses them to slow replies. Every lead answered, qualified and booked.",
    cta: "Start free",
    intro: "Includes",
    features: [
      "Phone agent that answers your number: qualification and booking",
      `${fmt(PLANS.starter.calls)} answered calls a month`,
      `Email agent that sends from your own inbox (${PLANS.starter.inboxes} inbox)`,
      "SMS follow-up with people who opted in",
      `${fmt(PLANS.starter.leadCredits)} lead credits a month for prospect data and research`,
      "Knowledge base and smart replies",
      "Google Calendar booking and live transfer to you",
      "Every call recorded and transcribed; every message in one inbox",
    ],
    note: NOTE,
  },
  {
    id: "pro",
    name: PLANS.pro.name,
    price: PLANS.pro.price,
    tagline: "Inbound, outbound, closing and expansion.",
    lead: "For agencies and sales teams that want every channel worked, new business opened and simple sales closed.",
    cta: "Start free",
    intro: "Everything in Starter, plus",
    features: [
      "All channels: chat, social and WhatsApp agents as well",
      "AI closer for simple sales: payment links, bookings and agreements",
      `${fmt(PLANS.pro.calls)} answered calls a month, with premium voices`,
      `${PLANS.pro.inboxes} sending inboxes, with multi-channel sequences`,
      `${fmt(PLANS.pro.leadCredits)} lead credits a month`,
      "CRM sync: Salesforce, HubSpot, Pipedrive and Zoho",
      "Lead routing, Slack alerts and the API",
      "Approval thresholds, escalation rules and send windows",
    ],
    note: NOTE,
    featured: true,
    badge: "Most popular",
  },
  {
    id: "scale",
    name: PLANS.scale.name,
    price: PLANS.scale.price,
    tagline: "For agencies and several brands.",
    lead: "Everything in Pro, across five workspaces, with higher limits and hands-on setup.",
    cta: "Start free",
    intro: "Everything in Pro, plus",
    features: [
      `${fmt(PLANS.scale.calls)} answered calls a month, with premium voices`,
      `${PLANS.scale.workspaces} workspaces: run separate clients or brands, each with its own agents, knowledge and reporting`,
      `${PLANS.scale.inboxes} sending inboxes, with deliverability monitoring across all of them`,
      `${fmt(PLANS.scale.leadCredits)} lead credits a month`,
      "Custom playbooks and scripts for each workspace",
      "Priority support and hands-on setup",
    ],
    note: NOTE,
  },
];
