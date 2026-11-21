import type { PlaySlug } from "./catalog";
import type { PlayContent } from "./types";

// The expansion plays. Voice calls here go to customers and users who opted
// in to them. People and businesses in the sample panels are made up.

export const EXPANSION_PLAYS = {
  "customer-expansion": {
    promise: "Raise the upgrade at the moment a customer is ready for it.",
    intro:
      "The quickest revenue you can add is from customers who already trust you. Dialvo watches for the signs that an account has outgrown its plan, starts the conversation and brings a rep in once the interest is real.",
    description:
      "Dialvo's customer expansion play spots accounts ready for more seats, a higher plan or a second product, starts the conversation and hands real opportunities to reps.",
    situation: {
      title: "Expansion keeps slipping to next month",
      body: [
        "Your account managers know which customers could use more seats or the next plan. They also carry renewals, escalations and a new-business number that always comes first.",
        "So the conversation happens late or not at all. By the time someone calls, the customer has worked around the limit, bought a second tool or lost the internal push to do anything.",
        'Alerts don\'t fix it. A task that says "seat usage at 95%" joins forty others in a queue. Only your top accounts get a proactive call; everyone else waits to be noticed.',
      ],
    },
    steps: [
      {
        title: "Watch the signals",
        body: "Seat usage, plan limits, feature adoption, new teams joining and renewal dates, from your CRM and from events your product sends through the API.",
      },
      {
        title: "Pick the reason to get in touch",
        body: "A team at its seat limit hears about seats. A customer using one product hears how the second fits what they already do. The reason is always something they did.",
      },
      {
        title: "Start the conversation",
        body: "Customers who opted in get a call from the voice agent. Others get an email or message from their account owner.",
      },
      {
        title: "Qualify the interest",
        body: "The agent finds out what they need, how many people it affects and who signs it off, and answers plan and pricing questions from your knowledge base.",
      },
      {
        title: "Hand over with the detail",
        body: "Real opportunities are booked onto the account owner's calendar or transferred live, with a summary of what the customer wants and why now.",
      },
      {
        title: "Log every answer",
        body: 'Even a "not yet" is useful: what\'s holding them back is saved to the account, and a later check-in is scheduled.',
      },
    ],
    visual: {
      kind: "thread",
      title: "Voice call · transcript",
      note: "customer opted in to calls",
      messages: [
        {
          agent: true,
          text: "Hi Marcus, it's Northwind, and this call is recorded. Your team has used every seat on the plan since the Leith site opened. Do you have two minutes?",
        },
        { text: "Sure. We've been sharing logins, to be honest." },
        {
          agent: true,
          text: "That's common at this point. How many people need their own access across the two sites?",
        },
        { text: "Probably eight more." },
        {
          agent: true,
          text: "Thanks. Priya can walk you through the options for eight more seats. She's free tomorrow at 11:00. Shall I book it?",
        },
      ],
      foot: "Sample transcript with a made-up business.",
    },
    channels: ["voice", "email", "messages"],
    features: ["crm-integration", "api", "knowledge-base", "analytics"],
    setup: [
      "Connect your CRM and send usage events through the API.",
      "Define the triggers: seat usage, limits reached, days to renewal.",
      "Add plans, pricing and upgrade paths to the knowledge base.",
      "Record which customers have opted in to calls and texts.",
    ],
    faqs: [
      {
        q: "Can the agent complete an upgrade itself?",
        a: "It can confirm what the customer wants and send your upgrade link or pass the request to your team. Changes to billing stay with you and the customer.",
      },
      {
        q: "Who does the AI call?",
        a: "Only existing customers who agreed to receive calls. Everyone else is contacted by email or message from their account owner, and can opt out of those too.",
      },
      {
        q: "Will this step on our account managers' toes?",
        a: "You choose which accounts the play covers. Most teams keep named accounts with their managers and let Dialvo cover the long tail nobody was calling.",
      },
      {
        q: "Does it help with renewals?",
        a: "Yes. A check-in well before the renewal date surfaces problems while there's time to fix them, and flags unhappy accounts to a person.",
      },
    ],
    related: [
      "plg-conversion",
      "customer-onboarding-operations",
      "closed-lost",
    ],
  },

  "plg-conversion": {
    promise: "Find the buyers hiding in your free plan.",
    intro:
      "Some of your free and trial users are already behaving like customers. Dialvo spots them from how they use the product and reaches out the way a helpful product expert would, then passes the ones who want to talk to your reps.",
    description:
      "Dialvo's PLG conversion play spots free and trial users showing buying behaviour, offers relevant help and routes those ready to upgrade to your sales team.",
    situation: {
      title: "The signal is in your product. Nobody is reading it.",
      body: [
        "Among your free accounts are teams that have invited colleagues, built real work in the product and run into the plan's limits. Nobody has spoken to them.",
        "Reps can't study the usage of thousands of free accounts. Marketing sends the same upgrade email to a power user and to someone who signed up yesterday.",
        "Meanwhile trials expire quietly, and five people from the same large company sign up separately without anyone joining the dots.",
      ],
    },
    steps: [
      {
        title: "Read product signals",
        body: "Your product sends events through the API: a limit reached, teammates invited, a paid feature tried, a trial about to end, several signups from one company.",
      },
      {
        title: "Decide who is worth a conversation",
        body: "Usage is combined with company data to separate a student project from a growing team at a business that fits your ideal customer.",
      },
      {
        title: "Offer help, not a pitch",
        body: 'The message is about what the user was trying to do: "you\'ve reached the storage limit on the free plan; here are two ways teams your size handle that."',
      },
      {
        title: "Use the channel they chose",
        body: "Email and in-app chat by default. Users who opted in to calls can get one from the voice agent when they stall before first value.",
      },
      {
        title: "Route the ready ones",
        body: "Users who reply or ask about pricing are booked with a rep, who sees team size, usage and what was already discussed.",
      },
    ],
    visual: {
      kind: "list",
      title: "Free and trial accounts",
      note: "showing buying behaviour",
      rows: [
        {
          name: "Juniper Payroll",
          detail: "Invited 8 teammates · hit project limit",
          tag: "Booked with Tom",
          strong: true,
        },
        {
          name: "Brightwell Foods",
          detail: "4 separate signups from one domain",
          tag: "Outreach sent",
          strong: true,
        },
        {
          name: "Oakline Studio",
          detail: "Trial ends in 3 days · tried reporting",
          tag: "Replied",
        },
        {
          name: "Personal account",
          detail: "Signed up yesterday · no fit",
          tag: "Left alone",
        },
      ],
      foot: "Sample accounts. All made up.",
    },
    channels: ["email", "chat", "voice", "messages"],
    features: [
      "api",
      "lead-qualification",
      "ai-personalisation",
      "intelligent-lead-routing",
    ],
    setup: [
      "Send signup and usage events to Dialvo through the API.",
      "Define the behaviour that suggests a buyer.",
      "Add plan limits, pricing and upgrade steps to the knowledge base.",
      "Choose when a user goes to a rep and when to self-serve checkout.",
    ],
    faqs: [
      {
        q: "Self-serve users don't want a sales call. Won't this put them off?",
        a: "That's why the default is a helpful written message tied to what they were doing. A rep only gets involved when the user asks, and calls only go to users who opted in.",
      },
      {
        q: "What usage data does Dialvo need?",
        a: "Only the events you choose to send, such as limits reached or teammates invited. It doesn't need access to your users' content.",
      },
      {
        q: "Can small accounts just be pointed at checkout?",
        a: "Yes. Set a threshold: below it, the agent answers questions and links to self-serve upgrade; above it, a rep is brought in.",
      },
    ],
    related: [
      "customer-expansion",
      "customer-onboarding-operations",
      "lead-nurture",
    ],
  },
} satisfies Partial<Record<PlaySlug, PlayContent>>;
