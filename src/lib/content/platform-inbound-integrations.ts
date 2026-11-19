import type { FeatureSlug } from "./catalog";
import type { FeatureContent } from "./types";

// Platform features: inbound handling and integrations. People and
// businesses in the sample panels are made up.

export const INBOUND_INTEGRATION_FEATURES = {
  "ai-phone-agent": {
    tagline: "Every call answered. Every form lead called back.",
    intro:
      "Dialvo's phone agent picks up your line on the first ring, at any hour, and rings new form leads back within seconds. It holds a real conversation: it qualifies, answers questions, books the meeting or puts the caller through to a person.",
    description:
      "Dialvo's AI phone agent answers inbound calls and calls form leads back within seconds, qualifies them, books meetings and transfers to your team, saying it's an AI.",
    capabilities: [
      {
        title: "Answers at once, day and night",
        body: "No hold queue and no voicemail. Put it on your main number, a campaign number or behind your existing phone menu.",
      },
      {
        title: "Calls form leads back",
        body: "A new enquiry gets a call within seconds, opening with what the person asked about on the form.",
      },
      {
        title: "Says it's an AI",
        body: "Every call opens by saying it's an AI assistant for your business and that the call is recorded.",
      },
      {
        title: "Talks like a person, from your facts",
        body: "It listens, copes with interruptions and answers product questions from your knowledge base. There's no rigid script.",
      },
      {
        title: "Qualifies and books",
        body: "It asks your qualifying questions and books good fits on the right rep's calendar while they're on the line.",
      },
      {
        title: "Warm transfers",
        body: "When the caller needs a person, it rings your rep first, gives a short spoken summary and then connects the call.",
      },
      {
        title: "A choice of voices",
        body: "Pick a voice style that suits your brand: warm, confident, upbeat, calm and more. Premium voices come with Pro.",
      },
      {
        title: "A full record",
        body: "Recording, transcript, the answers to each question and the outcome, saved to the CRM as the call ends.",
      },
    ],
    fit: [
      "The phone agent is the voice of the inbound motion. It uses inbound qualification for its questions, lead routing to pick the rep and number management so its callbacks are answered. If nobody picks up, the SMS, WhatsApp and email agents follow up.",
      "The same agent places consented calls to existing customers for expansion and onboarding. It does not cold call; reps do that with the dialer.",
    ],
    visual: {
      kind: "thread",
      title: "Inbound call · transcript",
      note: "main line, 22:40",
      messages: [
        {
          agent: true,
          text: "Thanks for calling Northwind Agency. I'm the AI assistant here, and this call is recorded. How can I help?",
        },
        {
          text: "I need a new website for my dental practice. Do you do that?",
        },
        {
          agent: true,
          text: "We do. We build sites and booking pages for clinics. Is it one location or more?",
        },
        { text: "Two. We'd want it live before the summer." },
        {
          agent: true,
          text: "That's doable. Priya leads our clinic projects. She has Tuesday at 10:30 or Wednesday at 3:00. Which is better?",
        },
      ],
      foot: "Sample transcript with a made-up business.",
    },
    controls: [
      {
        title: "Instructions you can read",
        body: "The agent's instructions are in plain language and you can edit them: tone, what to ask, what never to say.",
      },
      {
        title: "Escalation rules",
        body: "Set the phrases and situations that always go to a person, such as a complaint or an existing customer in trouble.",
      },
      {
        title: "Call allowance",
        body: "Each plan includes a monthly number of AI calls; more can be added. You're warned before you reach the limit.",
      },
      {
        title: "Automatic checks",
        body: "Calls are checked for answers that aren't backed by your knowledge base and flagged for your review.",
      },
    ],
    related: [
      "inbound-lead-qualification",
      "intelligent-lead-routing",
      "call-deliverability-and-number-management",
    ],
    plays: [
      "speed-to-lead",
      "automated-meeting-scheduling",
      "customer-onboarding-operations",
    ],
  },

  "inbound-lead-qualification": {
    tagline: "Your reps meet buyers, not everyone who filled in a form.",
    intro:
      "A job title and a company size don't tell you whether someone will buy. A conversation does. Dialvo has that first conversation with every inbound lead, by phone or chat, using your questions, and passes on only the ones worth a rep's hour.",
    description:
      "Dialvo qualifies every inbound lead in conversation, by phone or chat, with your questions and criteria. Reps get good fits with the answers attached; the rest get a next step.",
    capabilities: [
      {
        title: "Your framework",
        body: "Budget, authority, need, timing, team size, current tools, or whatever you qualify on. Mark which questions are required.",
      },
      {
        title: "Asked the way a person would",
        body: "Questions come up naturally in the conversation, with follow-ups when an answer is vague and skips when it's already been given.",
      },
      {
        title: "Scored against your ideal customer",
        body: "Answers are combined with company data and past history to give a clear result: qualified, not yet or not a fit.",
      },
      {
        title: "More than yes or no",
        body: 'Outcomes such as "right company, wrong person", "qualified but six months out" and "existing customer" each have their own next step.',
      },
      {
        title: "Nobody is dropped",
        body: "Not ready goes to nurture. Wrong person is asked for the right one. Too small is pointed to self-serve or a partner. Every lead leaves with a next step.",
      },
      {
        title: "The answers travel",
        body: "What the lead said, in their words, goes to the rep and into CRM fields, so the meeting doesn't open with the same questions.",
      },
    ],
    fit: [
      "This is the middle of the inbound motion: the phone and chat agents ask the questions, routing uses the result to choose a rep, and scheduling books the meeting. All of it happens inside one conversation.",
      "It differs from lead qualification in the data group, which checks fit from research before any contact. Here the lead is talking to you, so the agent can simply ask.",
    ],
    visual: {
      kind: "brief",
      title: "Qualification result",
      note: "Lena Ortiz · Bright Smile Dental",
      heading: "Qualified · booked with Priya",
      facts: [
        ["Need", "New site with online booking for two clinics"],
        ["Timing", "Live before summer"],
        ["Budget", "Has a figure approved; shared a range"],
        ["Decision", "Lena and her business partner"],
      ],
      points: [
        "All four required questions answered.",
        "Asked about migrating existing patient bookings: flag for the call.",
      ],
      foot: "Sample result. All made up.",
    },
    controls: [
      {
        title: "Edit the questions any time",
        body: "Change wording, order and what's required. The next conversation uses the new version.",
      },
      {
        title: "See every assessment",
        body: "Each result shows which questions were asked, what was answered and why the outcome was given.",
      },
      {
        title: "Compare with your team",
        body: "Review a sample of the agent's results beside your reps' judgement and tighten the criteria where they differ.",
      },
    ],
    related: [
      "ai-phone-agent",
      "intelligent-lead-routing",
      "lead-qualification",
    ],
    plays: ["speed-to-lead", "automated-meeting-scheduling"],
  },

  "intelligent-lead-routing": {
    tagline: "The right rep, chosen while the lead is still talking.",
    intro:
      "A qualified lead that waits in a queue for someone to assign it is a lead going cold. Dialvo applies your routing rules during the conversation, so the meeting is booked or the call transferred to the right person before it ends.",
    description:
      "Dialvo routes qualified leads during the conversation by territory, account owner, seniority, product or round robin, then books or transfers with full context.",
    capabilities: [
      {
        title: "Rules that match your team",
        body: "Route by territory, company size, industry, product line, language or deal size, with round robin among reps who qualify.",
      },
      {
        title: "Account owners respected",
        body: "A lead from a company that already has an owner in your CRM goes to that owner.",
      },
      {
        title: "Seniority matching",
        body: "Send larger or more senior leads to senior reps and smaller ones to the wider team.",
      },
      {
        title: "Book or transfer",
        body: "The agent books on the chosen rep's calendar, or transfers the call live if they're free and the lead wants to talk now.",
      },
      {
        title: "Fallbacks",
        body: "If the first-choice rep is away or fully booked, the lead goes to the next person in line. Nobody waits a week.",
      },
      {
        title: "Fair shares",
        body: "Round robin balances by meetings booked, and can be weighted for part-time reps or people who are ramping up.",
      },
      {
        title: "Works with your router",
        body: "If you already run routing in your CRM or a scheduling tool, Dialvo can hand the qualified lead to that and record the result.",
      },
    ],
    fit: [
      'Routing takes its input from inbound qualification and hands its output to scheduling. Because all three happen in one conversation, the lead goes from "hello" to "see you Tuesday with Priya" without a human assigning anything.',
      "The same rules apply to replies from outbound plays and to expansion opportunities, so every meeting lands with the person who should own it.",
    ],
    visual: {
      kind: "list",
      title: "Routing",
      note: "today",
      rows: [
        {
          name: "Bright Smile Dental",
          detail: "Clinics · 2 sites → clinic specialist",
          tag: "Priya",
          strong: true,
        },
        {
          name: "Juniper Payroll",
          detail: "Existing account → owner",
          tag: "Tom",
          strong: true,
        },
        {
          name: "Brightwell Foods",
          detail: "200+ staff → senior rep",
          tag: "Dana",
        },
        {
          name: "Oakline Studio",
          detail: "Small team → round robin",
          tag: "Next: Sam",
        },
      ],
      foot: "Sample routing. All made up.",
    },
    controls: [
      {
        title: "Change rules instantly",
        body: "When a territory moves or a rep joins, edit the rule and the next lead follows it.",
      },
      {
        title: "Working hours and time off",
        body: "Routing reads calendars, so nobody is booked on leave or transferred a call at midnight.",
      },
      {
        title: "A reason for every decision",
        body: "Each routed lead shows which rule applied, which makes disputes short.",
      },
    ],
    related: [
      "inbound-lead-qualification",
      "ai-phone-agent",
      "crm-integration",
    ],
    plays: ["automated-meeting-scheduling", "speed-to-lead", "plg-conversion"],
  },

  "crm-integration": {
    tagline: "Your CRM stays the source of truth. Dialvo keeps it current.",
    intro:
      "If the work isn't in the CRM, your team doesn't trust it. Dialvo syncs both ways with Salesforce, HubSpot, Pipedrive and Zoho: agents read the history before they act and write back everything they do.",
    description:
      "Dialvo syncs two ways with Salesforce, HubSpot, Pipedrive and Zoho: agents use CRM history for context and log every email, call, reply and outcome to the right record.",
    capabilities: [
      {
        title: "Reads before it acts",
        body: "Owner, stage, past deals, notes and last contact are in front of the agent, so it never treats a customer as a stranger.",
      },
      {
        title: "Logs everything",
        body: "Emails, LinkedIn messages, calls, transcripts, replies, meetings and outcomes are written to the contact, company and deal.",
      },
      {
        title: "Field mapping you control",
        body: "Choose which CRM fields receive qualification answers, scores, lost reasons and next steps. Use your own custom fields.",
      },
      {
        title: "Starts plays from CRM events",
        body: "A new lead, a stage change, a deal marked lost or a renewal date approaching can each start the right play.",
      },
      {
        title: "Creates and updates records",
        body: "New leads are created without duplicates. Meetings create or update opportunities according to your rules.",
      },
      {
        title: "Opt-outs in both directions",
        body: "An unsubscribe in Dialvo marks the CRM record, and a do-not-contact flag in the CRM stops Dialvo.",
      },
    ],
    fit: [
      "The CRM is the memory every agent shares. It tells the outbound agent who not to contact, gives the expansion agent the renewal date and tells the phone agent that this caller has an open deal with Tom.",
      "It's also how your team sees the agents' work without learning a new tool: everything appears where they already look.",
    ],
    visual: {
      kind: "timeline",
      title: "CRM record · Harbor Fitness",
      note: "activity written by Dialvo",
      steps: [
        {
          when: "Mon 09:12",
          channel: "Email",
          text: "Outbound email sent from Priya's inbox",
          done: true,
        },
        {
          when: "Wed 14:40",
          channel: "Reply",
          text: "Marcus asked about pricing; answered",
          done: true,
        },
        {
          when: "Wed 14:52",
          channel: "Meeting",
          text: "Booked with Priya, Thursday 11:00",
          done: true,
        },
        {
          when: "Wed 14:52",
          channel: "Deal",
          text: 'Opportunity created: stage "Meeting booked"',
          done: true,
        },
        {
          when: "Thu 11:45",
          channel: "Fields",
          text: "Need, timing and decision maker updated",
        },
      ],
      foot: "Sample activity. All made up.",
    },
    controls: [
      {
        title: "Read and write permissions",
        body: "Decide which objects and fields Dialvo may read and which it may write. Start read-only if you like.",
      },
      {
        title: "Exclusion rules",
        body: "Keep named accounts, open deals at certain stages or whole segments out of every play.",
      },
      {
        title: "Plan",
        body: "CRM sync is part of Pro. Starter works from forms, CSVs and the inbox.",
      },
    ],
    related: ["api", "slack-integration", "analytics"],
    plays: ["lead-reactivation", "closed-lost", "customer-expansion"],
  },

  "slack-integration": {
    tagline: "The news that matters, in the channel where your team works.",
    intro:
      "Nobody wants another dashboard to check. Dialvo posts to Slack when something needs a person or deserves a cheer: a lead qualified, a meeting booked, a reply that needs a human, a customer asking for an upgrade.",
    description:
      "Dialvo's Slack integration posts qualified leads, booked meetings, replies needing a person and approvals to the channels you choose, with enough context to act.",
    capabilities: [
      {
        title: "Alerts in real time",
        body: "Meeting booked, lead qualified, call finished, hot reply, visitor from a target account: posted as it happens.",
      },
      {
        title: "Sent to the right place",
        body: "Qualified leads to the sales channel, expansion interest to account management, escalations as a direct message to the owner. You decide.",
      },
      {
        title: "Enough context to act",
        body: "Each message has who, what they said, the outcome and the next step, with a link to the transcript.",
      },
      {
        title: "Threaded by account",
        body: "Updates about the same account stay in one thread, so the channel doesn't flood.",
      },
      {
        title: "Approve from Slack",
        body: "When a message needs approval, approve, edit or reject it from the notification.",
      },
      {
        title: "A daily summary",
        body: "A short morning post: yesterday's conversations, meetings and anything waiting on a person.",
      },
    ],
    fit: [
      "Slack is where the handoff from agent to human becomes visible. Agents do the first contact and the follow-up; the moment a person is needed, that person hears about it in a place they're already looking.",
      "It carries the same events the CRM records, so the two never disagree. Slack is the tap on the shoulder; the CRM is the record.",
    ],
    visual: {
      kind: "thread",
      title: "#sales-leads",
      note: "Slack",
      messages: [
        {
          agent: true,
          text: "Meeting booked: Lena Ortiz, Bright Smile Dental, with Priya on Tuesday 10:30. Two clinics, wants to go live before summer. Transcript attached.",
        },
        { text: "Great, I'll take it. Did she mention budget?" },
        {
          agent: true,
          text: "Yes. She has a figure approved and shared a range. It's in the CRM record under Budget.",
        },
        {
          agent: true,
          text: "Needs a person: Ivo Marsh replied about an invoice problem. Suggested reply drafted for Dana.",
        },
      ],
      foot: "Sample channel. All made up.",
    },
    controls: [
      {
        title: "Choose the events",
        body: "Turn each kind of alert on or off, per channel.",
      },
      {
        title: "Quiet hours",
        body: "Hold non-urgent posts overnight and deliver them in the morning summary.",
      },
      {
        title: "What's shared",
        body: "Pick how much detail a post contains. Sensitive fields can be left out and viewed in Dialvo.",
      },
      {
        title: "Plan",
        body: "Slack alerts are part of Pro.",
      },
    ],
    related: ["crm-integration", "api", "smart-replies"],
    plays: ["speed-to-lead", "retargeting-website-visitors"],
  },

  "review-site-intent": {
    tagline: "Hear about buyers while they're still comparing.",
    intro:
      "Before they talk to any supplier, many buyers read software review sites. If your review-site account provides buyer-intent data, Dialvo can use it: when a matching company researches your category, a competitor or your own listing, the right play starts.",
    description:
      "Dialvo turns buyer-intent signals from software review sites into timely outreach: companies researching your category, your competitors or your listing enter the right play.",
    capabilities: [
      {
        title: "Uses the intent data you have",
        body: "Bring buyer-intent signals from your review-site account in through its export, a webhook or the API.",
      },
      {
        title: "Three kinds of signal",
        body: "A company viewed your listing, compared you with a competitor, or browsed your category. Each says something different about where they are.",
      },
      {
        title: "Matched to accounts and people",
        body: "The company is matched to your CRM or the database, checked for fit, and the likely buyers are found.",
      },
      {
        title: "The message suits the signal",
        body: "A comparison prompts a note on the differences that matter. A category visit prompts a short introduction. A visit to your own listing prompts an offer to answer questions.",
      },
      {
        title: "Fast, because timing is the point",
        body: "Outreach starts the day the signal arrives, not when someone exports a list at the end of the month.",
      },
      {
        title: "Owners alerted",
        body: "If the account is already in a deal or is a customer, the owner is told and no automated outreach is sent.",
      },
    ],
    fit: [
      "Review-site intent is one more signal alongside website visits, hiring and funding. It feeds lead qualification and the research agent like any other, and is especially useful for the competitive takeout and outbound lead generation plays.",
      "The outreach never mentions where the signal came from. It addresses the question the buyer is likely to be asking.",
    ],
    visual: {
      kind: "list",
      title: "Review-site signals",
      note: "this week",
      rows: [
        {
          name: "Fernhill Logistics",
          detail: "Compared you with a competitor",
          tag: "Sequence sent",
          strong: true,
        },
        {
          name: "Tidewater Clinics",
          detail: "Viewed your listing twice",
          tag: "Drafted",
          strong: true,
        },
        {
          name: "Calder & Pine",
          detail: "Browsed the category page",
          tag: "Researching",
        },
        {
          name: "Juniper Payroll",
          detail: "Compared alternatives · existing customer",
          tag: "Owner alerted",
        },
      ],
      foot: "Sample signals. All made up.",
    },
    controls: [
      {
        title: "You need your own intent data",
        body: "Dialvo doesn't sell review-site data. This works with the buyer-intent data your own review-site subscription provides.",
      },
      {
        title: "Company-level signals",
        body: "Intent data identifies companies, not individuals. Dialvo finds likely contacts by role; it doesn't know who was browsing.",
      },
      {
        title: "Thresholds",
        body: "Choose which signals are strong enough to start outreach and which only add to a lead's score.",
      },
    ],
    related: [
      "website-visitor-tracking",
      "live-web-search-prospecting",
      "lead-qualification",
    ],
    plays: ["competitive-takeout", "outbound-lead-generation"],
  },

  api: {
    tagline: "Start any agent from your own systems. Get every result back.",
    intro:
      "Your product, forms and internal tools know things Dialvo should act on. One API lets you trigger agents from anywhere and receive what happened, in a structured form your systems can use.",
    description:
      "Dialvo's API lets you create leads, trigger calls and sequences, send product events and receive transcripts, replies and outcomes through webhooks and structured data.",
    capabilities: [
      {
        title: "Create leads and start plays",
        body: "Post a lead from any form, app or script and say which play to run. The speed-to-lead callback starts from one request.",
      },
      {
        title: "Send product events",
        body: "Tell Dialvo that a user reached a limit, invited teammates or went quiet. Expansion and PLG plays are triggered from these.",
      },
      {
        title: "Webhooks for outcomes",
        body: "Receive an event when a call ends, a reply arrives, a meeting is booked or a lead is qualified.",
      },
      {
        title: "Structured results",
        body: "Outcomes arrive as clean fields (qualified or not, answers to each question, next step), with the transcript alongside.",
      },
      {
        title: "Read anything back",
        body: "Fetch conversations, transcripts, recordings, sequence status and analytics for your own dashboards.",
      },
      {
        title: "Manage consent and suppression",
        body: "Record opt-ins and opt-outs from your own systems, so consent captured in your app is honoured by every agent.",
      },
    ],
    fit: [
      "The API is the door for anything the built-in integrations don't cover. Most teams use it for two things: getting leads and product events in, and getting outcomes out to a data warehouse or an internal tool.",
      "It exposes the same agents and rules as the app. A call triggered through the API still checks consent, follows your send windows and says it's an AI.",
    ],
    visual: {
      kind: "code",
      title: "POST /v1/leads",
      note: "start a play",
      lines: [
        "{",
        '  "play": "speed-to-lead",',
        '  "lead": {',
        '    "name": "Lena Ortiz",',
        '    "company": "Bright Smile Dental",',
        '    "phone": "+44 131 ··· 0142",',
        '    "consent": { "call": true, "source": "website form" }',
        "  },",
        '  "context": "Asked for a quote on a booking site"',
        "}",
      ],
      foot: "Illustrative request. Field names may differ in the final API.",
    },
    controls: [
      {
        title: "Keys and scopes",
        body: "Create keys limited to what an integration needs, such as write leads only, and revoke them at any time.",
      },
      {
        title: "Signed webhooks",
        body: "Every webhook is signed, so your server can check it came from Dialvo.",
      },
      {
        title: "Rate limits",
        body: "Requests are rate limited per key. Limits are shown in the response headers.",
      },
      {
        title: "Plan",
        body: "The API is part of Pro. Dialvo is in early access, and the API reference is shared with teams as they're brought on.",
      },
    ],
    related: ["crm-integration", "slack-integration", "analytics"],
    plays: ["plg-conversion", "customer-expansion", "speed-to-lead"],
  },
} satisfies Partial<Record<FeatureSlug, FeatureContent>>;
