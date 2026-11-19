import { fmt, PLANS } from "@/lib/site";

// Starter and Pro (founder, 19 Nov 2026). Every number comes from
// src/lib/site.ts. Features that aren't built yet sit under "Coming soon",
// set apart from what each plan includes at launch, so nobody buys
// something that isn't there yet.

export type Plan = {
  id: "starter" | "pro";
  name: string;
  price: number;
  lead: string;
  cta: string;
  intro: string;
  features: string[];
  soon: string[];
  note: string;
  featured?: boolean;
};

export const PLAN_CARDS: Plan[] = [
  {
    id: "starter",
    name: PLANS.starter.name,
    price: PLANS.starter.price,
    lead: "For founders and small teams who want meetings without making the calls.",
    cta: "Start free",
    intro: "Includes",
    features: [
      "An AI caller with a standard voice",
      `${fmt(PLANS.starter.dials)} dials a month`,
      "Calls new form leads within 60 seconds, 24/7",
      "Text follow-up to people who opted in",
      "Every call recorded and transcribed",
      "Meetings booked on Google Calendar",
      "Live transfer to you",
      "Compliance checks on every call",
    ],
    soon: [
      "AI email from your own inbox, with email follow-up",
      `${fmt(PLANS.starter.leadCredits)} lead credits a month for the prospect finder`,
    ],
    note: "Free until your first interested prospect. Cancel anytime.",
  },
  {
    id: "pro",
    name: PLANS.pro.name,
    price: PLANS.pro.price,
    lead: "For agencies and teams who want more conversations, in more places.",
    cta: "Start free",
    intro: "Everything in Starter, plus",
    features: [
      `${fmt(PLANS.pro.dials)} dials a month`,
      "A premium, ultra-realistic voice",
      "WhatsApp and text follow-up",
      "Team seats",
    ],
    soon: [
      "Email campaigns from your own inboxes",
      `${fmt(PLANS.pro.leadCredits)} lead credits a month for the prospect finder`,
      "A chat agent for your website",
      "CRM sync with HubSpot and Pipedrive",
    ],
    note: "Free until your first interested prospect. Cancel anytime.",
    featured: true,
  },
];
