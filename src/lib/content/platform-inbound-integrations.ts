import type { FeatureSlug } from "./catalog";
import type { FeatureContent } from "./types";

// Platform features: inbound handling and integrations. People and
// businesses in the sample panels are made up.

export const INBOUND_INTEGRATION_FEATURES = {
  "ai-phone-agent": {
    tagline: "Every call answered, day and night.",
    intro:
      "Dialvo's phone agent answers your number at any hour. It holds a real conversation from your knowledge base: it answers questions, asks your qualifying questions, texts the caller your booking link when they want a meeting, and puts them through to a person when they need one. It only answers; it never calls anyone.",
    description:
      "Dialvo's AI phone agent answers inbound calls on your Twilio number from your knowledge base, qualifies callers, texts them your booking link, transfers to your team and logs the transcript and summary on the lead. It never makes outbound calls.",
    capabilities: [
      {
        title: "Answers at once, day and night",
        body: "No hold queue and no voicemail. Put it on a number bought in the app, or forward your existing line to it.",
      },
      {
        title: "Only answers, never dials",
        body: "It picks up calls people make to your number. Dialvo never makes outbound calls, so nobody gets a call they didn't start.",
      },
      {
        title: "Transcribed, with notice",
        body: "Every call opens by telling the caller it's transcribed (and recorded, if you switch recording on).",
      },
      {
        title: "Talks from your facts",
        body: "It answers product questions from your knowledge base and doesn't state anything that isn't there.",
      },
      {
        title: "Qualifies, then sends your link",
        body: "It asks your qualifying questions and, when the caller wants a meeting, texts them your booking link.",
      },
      {
        title: "Transfers to a person",
        body: "When the caller asks for someone, or the agent can't help, it puts the call through to the number you set.",
      },
      {
        title: "A choice of voices",
        body: "Five natural English voices: American, British and Australian.",
      },
      {
        title: "A full record",
        body: "The transcript and a summary are saved on the lead as the call ends, with the recording if you switch it on.",
      },
    ],
    fit: [
      "The phone agent is the voice of the inbound motion. It answers from the same knowledge base as the website chat and the email agent, and the lead it creates is routed like any other.",
      "It only answers. Dialvo never makes outbound calls: not to leads, not to customers, not to prospects.",
    ],
    visual: {
      kind: "thread",
      title: "Inbound call · transcript",
      note: "main line, 22:40",
      messages: [
        {
          agent: true,
          text: "Thanks for calling Northwind Agency. This call is transcribed. How can I help?",
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
          text: "That's doable. I'll text you a link to book a call with our clinic team now. Pick any time that suits you.",
        },
      ],
      foot: "Sample transcript with a made-up business.",
    },
    controls: [
      {
        title: "Instructions you can read",
        body: "The agent's instructions are in plain language, and you can edit them: tone, what to ask, what never to say.",
      },
      {
        title: "A transfer number",
        body: "Choose where calls go when a person is needed. Without the agent switched on, calls go straight there.",
      },
      {
        title: "Daily and monthly limits",
        body: "Each workspace has a daily number of answered calls, and each plan a monthly allowance.",
      },
      {
        title: "English only today",
        body: "The agent's voices are English. Callers in other languages are best transferred to your team.",
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
    tagline: "Every new lead has an owner before anyone has to ask.",
    intro:
      "A lead that waits in a shared queue for someone to claim it is a lead going cold. Dialvo applies your routing rules the moment a lead arrives, gives it to the right teammate (or shares it out in turn), and tells them.",
    description:
      "Dialvo's lead routing gives each new lead and its conversations to a teammate by rules on country, company size, source or play, to one person or several in turn, and alerts them.",
    capabilities: [
      {
        title: "Rules that match your team",
        body: "Match by country, company size, where the lead came from, or the play that found it.",
      },
      {
        title: "One person or several in turn",
        body: "A rule can give leads to one teammate, or share them out round robin.",
      },
      {
        title: "In your order",
        body: "Rules are checked in the order you set; the first that matches decides.",
      },
      {
        title: "At the right moments",
        body: "When a lead is added, and again when its first email thread starts.",
      },
      {
        title: "The owner is told",
        body: "The teammate a lead goes to gets an alert, and owns its conversations.",
      },
      {
        title: "Territories first",
        body: "With territory planning, a lead goes to its account's owner or territory rep before these rules are checked.",
      },
    ],
    fit: [
      "Routing takes its input from wherever the lead came from (the chat, the phone agent, a form, a play) and hands it to a person, so nobody has to sort a queue.",
      "The same rules apply to replies from outbound plays and to customers in expansion plays, so every conversation lands with the person who should own it.",
    ],
    visual: {
      kind: "list",
      title: "Routing",
      note: "today",
      rows: [
        {
          name: "Bright Smile Dental",
          detail: "Country: UK → UK rule",
          tag: "Priya",
          strong: true,
        },
        {
          name: "Juniper Payroll",
          detail: "200+ staff → large accounts",
          tag: "Tom",
          strong: true,
        },
        {
          name: "Brightwell Foods",
          detail: "Source: website chat → inbound team",
          tag: "Dana",
        },
        {
          name: "Oakline Studio",
          detail: "Inbound team, in turn",
          tag: "Next: Sam",
        },
      ],
      foot: "Sample routing. All made up.",
    },
    controls: [
      {
        title: "Change rules at once",
        body: "When a rep joins or a market moves, edit the rule and the next lead follows it.",
      },
      {
        title: "Switch a rule off",
        body: "Turn a rule off without deleting it, and on again later.",
      },
      {
        title: "No calendar reading",
        body: "Routing decides who owns the lead. Meetings are booked on your own scheduling page.",
      },
    ],
    related: [
      "territory-planning",
      "lead-scoring",
      "inbound-lead-qualification",
    ],
    plays: ["speed-to-lead", "automated-meeting-scheduling", "plg-conversion"],
  },

  "crm-integration": {
    tagline: "Your CRM stays the source of truth. Dialvo keeps it current.",
    intro:
      "If the work isn't in the CRM, your team doesn't trust it. Connect HubSpot or Pipedrive and Dialvo writes in the leads it finds, the conversations it has and the meetings that get booked, and never cold-emails anyone your CRM already knows.",
    description:
      "Dialvo connects to HubSpot and Pipedrive: new leads become contacts, chats, emails and replies become notes, meetings are logged, deals can be opened when a lead qualifies, opt-outs are shared, and CRM contacts are never emailed cold.",
    capabilities: [
      {
        title: "HubSpot or Pipedrive",
        body: "Connect with a token from your CRM. A preview shows exactly what Dialvo will write where.",
      },
      {
        title: "Your contacts kept out of cold email",
        body: "Emails and company domains are imported, so outbound plays never cold-email people your CRM already knows.",
      },
      {
        title: "New leads written in",
        body: "As contacts or people, matched by email, with their company. Existing records are never changed.",
      },
      {
        title: "Conversations as notes",
        body: "Website chats that qualify or need a person, emails sent and replies received, on the contact and the company.",
      },
      {
        title: "Meetings logged",
        body: "Meetings are added with their time and outcome, and updated when they change.",
      },
      {
        title: "Deals when you want them",
        body: "Switch it on and a lead that qualifies or books a meeting opens a deal in the pipeline and stage you choose.",
      },
    ],
    fit: [
      "The CRM is the memory your team already uses. Dialvo's work shows up there, so nobody has to learn a new place to look.",
      "It also keeps Dialvo polite: customers and open deals in the CRM are known to Dialvo, so a prospecting play doesn't treat them as strangers.",
    ],
    visual: {
      kind: "timeline",
      title: "CRM record · Harbor Fitness",
      note: "written by Dialvo",
      steps: [
        {
          when: "Mon 09:12",
          channel: "Contact",
          text: "Marcus Hale created, matched to the company by domain",
          done: true,
        },
        {
          when: "Mon 09:40",
          channel: "Note",
          text: "First email sent from Priya's mailbox",
          done: true,
        },
        {
          when: "Wed 14:40",
          channel: "Note",
          text: "Reply received: asked about multi-site pricing",
          done: true,
        },
        {
          when: "Wed 15:05",
          channel: "Meeting",
          text: "Booked for Thursday 11:00",
          done: true,
        },
        {
          when: "Wed 15:05",
          channel: "Deal",
          text: 'Opened in "Meeting booked"',
        },
      ],
      foot: "Sample activity. All made up.",
    },
    controls: [
      {
        title: "Nothing overwritten",
        body: "Dialvo creates new records and adds notes and meetings. It never changes an existing contact's fields.",
      },
      {
        title: "Opt-outs shared",
        body: "Someone marked do not contact or unsubscribed in Dialvo is marked in your CRM too, where your token allows it; otherwise a note is added.",
      },
      {
        title: "Two CRMs today",
        body: "HubSpot and Pipedrive work today. Other CRMs aren't connected yet; use a CSV or the API.",
      },
    ],
    related: ["crm-enrichment", "api", "slack-integration"],
    plays: ["lead-reactivation", "closed-lost", "customer-expansion"],
  },

  "slack-integration": {
    tagline: "The news that matters, in the channel where your team works.",
    intro:
      "Nobody wants another dashboard to check. Paste a Slack webhook and Dialvo posts to your channel when something needs a person or deserves a cheer: an interested reply, a chat that needs someone, a meeting booked, a play finished, and each morning what's waiting for approval.",
    description:
      "Dialvo's Slack integration posts interested replies, chats that need a person, booked meetings, finished plays and a daily approvals digest to the channel of your choice, through a Slack incoming webhook. Approving stays in the app.",
    capabilities: [
      {
        title: "Set up in a minute",
        body: "Create an incoming webhook in Slack, paste it into Dialvo, and a test message is posted before it's saved.",
      },
      {
        title: "Interested replies",
        body: "When a reply is sorted as interested, the channel hears about it straight away.",
      },
      {
        title: "Chats that need a person",
        body: "When the website chat hands a visitor over, someone knows at once.",
      },
      {
        title: "Meetings booked",
        body: "Who booked, and when.",
      },
      {
        title: "A daily approvals digest",
        body: "Each day, what's waiting for your approval, with a link to the app.",
      },
      {
        title: "Plays finished",
        body: "A note when a play has worked through its leads.",
      },
    ],
    fit: [
      "Slack is where the handoff from agent to person becomes visible. The moment someone is needed, they hear about it where they're already looking.",
      "It carries a link back to the app for each post, where the full conversation and the approval buttons are.",
    ],
    visual: {
      kind: "thread",
      title: "#sales-leads",
      note: "Slack",
      messages: [
        {
          agent: true,
          text: "Interested reply: Lena Ortiz, Bright Smile Dental, asked how to get started with two clinics.",
        },
        { text: "I'll take this one." },
        {
          agent: true,
          text: "Meeting booked: Marcus Hale, Harbor Fitness, Thursday 11:00.",
        },
        {
          agent: true,
          text: "Waiting for approval: 6 first emails and 2 follow-ups.",
        },
      ],
      foot: "Sample channel. All made up.",
    },
    controls: [
      {
        title: "Choose the events",
        body: "Turn each kind of post on or off.",
      },
      {
        title: "One channel",
        body: "Posts go to the channel of the webhook you paste.",
      },
      {
        title: "Approving stays in the app",
        body: "Slack tells you something's waiting; you approve, edit or reject it in Dialvo.",
      },
    ],
    related: ["crm-integration", "workflows", "account-briefs"],
    plays: ["speed-to-lead", "retargeting-website-visitors"],
  },

  "review-site-intent": {
    tagline: "Hear about buyers while they're still comparing.",
    intro:
      "Before they talk to any supplier, many buyers read software review sites. If your review-site account gives you buyer-intent data, bring it into Dialvo: companies researching your category show up on Signals, and the ones you keep get a contact and a drafted email.",
    description:
      "Dialvo imports buyer-intent data from your own review-site account (a CSV export, a webhook or a G2 Buyer Intent token), shows the companies on Signals, and for the ones you keep finds a contact and drafts an email for your approval.",
    capabilities: [
      {
        title: "Three ways in",
        body: "Upload your review site's export as a CSV, send rows to Dialvo's webhook, or connect a G2 Buyer Intent token.",
      },
      {
        title: "On Signals",
        body: "Each company with what it was researching and when, next to your other signals.",
      },
      {
        title: "Keep the ones that fit",
        body: "You choose which companies are worth acting on.",
      },
      {
        title: "A contact, then a draft",
        body: "For a kept company, Dialvo finds a named contact and drafts a first email, which waits for your approval.",
      },
      {
        title: "The email suits the moment",
        body: "It speaks to the problem they're likely researching, and never says where the signal came from.",
      },
    ],
    fit: [
      "Review-site intent is one more signal alongside website visits and company news. It's especially useful for the competitive takeout and outbound lead generation plays.",
      "Intent data names companies, not people. Dialvo finds the likely contact; it doesn't know who was browsing.",
    ],
    visual: {
      kind: "list",
      title: "Signals · review sites",
      note: "this week",
      rows: [
        {
          name: "Fernhill Logistics",
          detail: "Researching your category",
          tag: "Draft ready",
          strong: true,
        },
        {
          name: "Tidewater Clinics",
          detail: "Viewed your listing",
          tag: "Kept",
          strong: true,
        },
        {
          name: "Calder & Pine",
          detail: "Comparing products in your category",
          tag: "New",
        },
      ],
      foot: "Sample signals. All made up.",
    },
    controls: [
      {
        title: "You need your own intent data",
        body: "Dialvo doesn't sell review-site data. This works with the buyer-intent data your own subscription provides.",
      },
      {
        title: "Company-level only",
        body: "Intent data identifies companies, not individuals, and Dialvo doesn't try to.",
      },
      {
        title: "Nothing sent by itself",
        body: "Every email that follows a signal is a draft waiting for your approval.",
      },
    ],
    related: ["company-news", "website-visitor-tracking", "lead-scoring"],
    plays: ["competitive-takeout", "outbound-lead-generation"],
  },

  api: {
    tagline: "Connect Dialvo to your own systems, in both directions.",
    intro:
      "Your product, forms and internal tools know things Dialvo should act on. The REST API lets you add leads, put them in plays and send product events; signed webhooks tell your systems when a lead arrives, someone replies or a meeting is booked.",
    description:
      "Dialvo's REST API uses workspace keys to create and read leads, conversations, plays and meetings and to send product events, with signed webhooks for new leads, replies and booked meetings.",
    capabilities: [
      {
        title: "Leads in and out",
        body: "Create leads from any form, app or script, and read them back with their stage and history.",
      },
      {
        title: "Plays",
        body: "List your plays and add leads to one.",
      },
      {
        title: "Product events",
        body: "Send events such as trial_started or limit_reached. The PLG conversion play acts on them.",
      },
      {
        title: "Conversations and meetings",
        body: "Read conversations and meetings for your own dashboards or warehouse.",
      },
      {
        title: "Signed webhooks",
        body: "Register an endpoint for lead.created, reply.received and meeting.booked. Every delivery is signed so you can check it came from Dialvo.",
      },
    ],
    fit: [
      "The API is the door for anything the built-in integrations don't cover: getting leads and product events in, and getting outcomes out.",
      "It runs on the same rules as the app. A lead added through the API is still checked against your never-contact list, limits and approvals.",
    ],
    visual: {
      kind: "code",
      title: "POST /api/v1/events",
      note: "a product event",
      lines: [
        "{",
        '  "email": "lena@···.example",',
        '  "event": "limit_reached",',
        '  "properties": { "limit": "projects" }',
        "}",
      ],
      foot: "Illustrative request. The API reference in the app has the exact fields.",
    },
    controls: [
      {
        title: "Workspace keys",
        body: "Create keys under Settings, API, and revoke them at any time.",
      },
      {
        title: "Secrets shown once",
        body: "A webhook's signing secret is shown once, when you create it.",
      },
      {
        title: "A few endpoints per workspace",
        body: "Each workspace can register a limited number of webhook endpoints.",
      },
    ],
    related: ["mcp-server", "workflows", "crm-integration"],
    plays: ["plg-conversion", "customer-expansion", "speed-to-lead"],
  },
} satisfies Partial<Record<FeatureSlug, FeatureContent>>;
