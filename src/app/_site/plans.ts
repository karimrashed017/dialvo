import { fmt, PLANS } from "@/lib/site";

// Starter and Pro (prices: founder, 19 Nov 2026). Every number comes from
// src/lib/site.ts. Dialvo as a whole is in early access; the plans describe
// the product, not a list of what's switched on for each account today.

export type Plan = {
  id: "starter" | "pro";
  name: string;
  price: number;
  lead: string;
  cta: string;
  intro: string;
  features: string[];
  note: string;
  featured?: boolean;
};

const NOTE = "Free until your first booked meeting. Cancel anytime.";

export const PLAN_CARDS: Plan[] = [
  {
    id: "starter",
    name: PLANS.starter.name,
    price: PLANS.starter.price,
    lead: "For founders and small teams who want every inbound lead answered and followed up.",
    cta: "Get early access",
    intro: "Includes",
    features: [
      "Voice agent for inbound leads: speed to lead, qualification and booking",
      `${fmt(PLANS.starter.calls)} AI calls a month`,
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
    lead: "For agencies and sales teams running inbound, outbound and expansion on every channel.",
    cta: "Get early access",
    intro: "Everything in Starter, plus",
    features: [
      "All channels: chat, social and WhatsApp agents as well",
      `${fmt(PLANS.pro.calls)} AI calls a month, with premium voices`,
      `${PLANS.pro.dialerSeats} human dialer seats for your reps`,
      `${PLANS.pro.inboxes} sending inboxes, with multi-channel sequences`,
      `${fmt(PLANS.pro.leadCredits)} lead credits a month`,
      "CRM sync: Salesforce, HubSpot, Pipedrive and Zoho",
      "Lead routing, Slack alerts and the API",
      "Approval thresholds, escalation rules and send windows",
    ],
    note: NOTE,
    featured: true,
  },
];
