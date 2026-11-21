import type { Faq, Point } from "./types";

// The copy for /platform. The groups and their features come from the
// catalog, so no count is written here.

export const PLATFORM_PAGE = {
  title: "Platform · The data, research, rules and reporting under every agent",
  description:
    "Dialvo's platform: prospect data, lists and research, scoring and accounts, sequences and workflows, inbound handling, deliverability, analytics and integrations, shared by every agent on every channel.",
  headline: "One platform under every agent.",
  intro:
    "Dialvo's agents are only as good as what they know and the rules they follow. The platform is that shared ground: who to talk to, what to say, how to send it, where to log it and how to tell whether it worked. Every feature has its own page.",
  context: {
    title: "Every agent works from the same picture",
    lead: "The phone agent, the email agent and your reps all see the same account, so nobody asks a question twice or contradicts the last conversation.",
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
        body: "Funding, launches, leadership hires, job changes and review-site research, each with its source.",
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
        title: "Approval your way",
        body: "Approve every email, or let a play send within your limits. Set it per play, playbook and sequence.",
      },
      {
        title: "Handoffs to a person",
        body: "The chat hands visitors to your team when they need someone, and the phone agent transfers calls.",
      },
      {
        title: "Limits on sending",
        body: "Daily limits per mailbox and per workspace, a gradual ramp-up, and a small daily number of LinkedIn tasks.",
      },
      {
        title: "Consent enforced",
        body: "Dialvo never makes outbound calls. Texts only go to people with a recorded opt-in. Opt-outs apply everywhere at once.",
      },
      {
        title: "A never-contact list",
        body: "People and domains on it are never written to, by any play, playbook or workflow.",
      },
    ] satisfies Point[],
  },
  faqs: [
    {
      q: "Do I need every feature to start?",
      a: "No. Speed to lead needs a connected mailbox and your website chat or a form. Add data, sequences and integrations as you add plays.",
    },
    {
      q: "Which features are on which plan?",
      a: "Starter covers the phone agent that answers your calls, email from one inbox, SMS follow-up, the knowledge base and smart replies. Pro adds chat, LinkedIn and WhatsApp, CRM sync, routing rules, Slack and the API. The pricing page has the full comparison.",
    },
    {
      q: "Is everything available today?",
      a: "Each feature page says whether it's available in the app today, what it needs, and its limits. Write to us and we'll tell you plainly what's ready for your setup.",
    },
  ] satisfies Faq[],
};
