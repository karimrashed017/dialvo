import type { Faq, Point } from "./types";

// The copy for /platform. The six groups and their features come from the
// catalog.

export const PLATFORM_PAGE = {
  title: "Platform · The data, research, rules and reporting under every agent",
  description:
    "Dialvo's platform: prospect data, deep research, sequences, inbound handling, deliverability, analytics and integrations, shared by every agent on every channel.",
  headline: "One platform under every agent.",
  intro:
    "Dialvo's agents are only as good as what they know and the rules they follow. The platform is that shared ground: who to talk to, what to say, how to send it, where to log it and how to tell whether it worked. Twenty-three features in six groups, each with its own page.",
  context: {
    title: "Every agent works from the same picture",
    lead: "The voice agent, the email agent and your rep on the dialer all see the same account, so nobody asks a question twice or contradicts the last conversation.",
    items: [
      {
        title: "Your CRM",
        body: "Owners, stages, past deals and notes. Agents read it before they act and write to it afterwards.",
      },
      {
        title: "Your knowledge base",
        body: "Products, pricing, positioning and answers to hard questions. The only place agents take facts about you from.",
      },
      {
        title: "Website and product activity",
        body: "Which accounts are reading which pages, and what customers are doing in your product.",
      },
      {
        title: "Past conversations",
        body: "Every call, chat, email and message Dialvo has had with the person, on any channel.",
      },
      {
        title: "Outside signals",
        body: "Funding, hiring, job changes, new tools and review-site research, checked as they happen.",
      },
      {
        title: "Company and contact data",
        body: "Who works there, what they do and how to reach them, verified before outreach.",
      },
    ] satisfies Point[],
  },
  governance: {
    title: "You decide how much the agents do alone",
    lead: "Start with approval on everything and loosen it as you gain confidence, play by play.",
    items: [
      {
        title: "Instructions you can read and edit",
        body: "Each agent's guidance is plain language: tone, what to ask, what never to say, when to hand over.",
      },
      {
        title: "Approval thresholds",
        body: "Approve every message, only first touches, only certain topics, or nothing. Set it per play and per channel.",
      },
      {
        title: "Escalation rules",
        body: "The situations that always go to a person: complaints, discounts, legal questions, named accounts.",
      },
      {
        title: "Send windows and caps",
        body: "Hours, daily volumes and how often any one person may hear from you, across all channels.",
      },
      {
        title: "Consent enforced",
        body: "AI calls, SMS and WhatsApp only go to people with a recorded opt-in. Opt-outs apply everywhere at once.",
      },
      {
        title: "Automatic checks",
        body: "Conversations are checked for unsupported answers and off-script moments, and flagged for your review.",
      },
    ] satisfies Point[],
  },
  faqs: [
    {
      q: "Do I need every feature to start?",
      a: "No. A speed-to-lead setup needs the phone agent, your qualifying questions and a calendar. Add data, sequences and integrations as you add plays.",
    },
    {
      q: "Which features are on which plan?",
      a: "Starter covers the voice agent for inbound leads, email from one inbox, SMS follow-up, the knowledge base and smart replies. Pro adds chat, LinkedIn and WhatsApp, the human dialer, CRM sync, routing rules, Slack and the API. The pricing page has the full comparison.",
    },
    {
      q: "Is everything available today?",
      a: "Dialvo is in early access. Teams are brought on in small groups, and channels and integrations are switched on as each account needs them.",
    },
    {
      q: "Does Dialvo hold any security certifications?",
      a: "Not yet, and it doesn't claim any. Ask us anything about how data is handled and we'll answer plainly.",
    },
  ] satisfies Faq[],
};
