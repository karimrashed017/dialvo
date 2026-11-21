import type { FeatureSlug } from "./catalog";
import type { FeatureContent } from "./types";

// Platform features: analytics and deliverability, research and messaging.
// Figures in the sample panels are invented and the panels are marked
// "Example"; they are not results.

export const ANALYTICS_RESEARCH_FEATURES = {
  analytics: {
    tagline: "See which conversations turn into pipeline, and why.",
    intro:
      "When every channel runs through one system, you can finally follow a lead from first touch to booked meeting. Dialvo's analytics show what each play, channel and message is producing, in terms a sales leader cares about: replies, qualified leads, meetings and the deals they fed.",
    description:
      "Dialvo's analytics show conversations, replies, qualified leads and meetings by channel, play and region, with the outcome of every conversation and CRM-linked pipeline.",
    capabilities: [
      {
        title: "One dashboard for every motion",
        body: "Inbound, outbound, closing and expansion side by side: leads answered, conversations held, meetings booked, simple sales closed, opportunities opened.",
      },
      {
        title: "By play and by channel",
        body: "Compare speed to lead with visitor follow-up, or email with LinkedIn, on the same measures. Keep what works; switch off what doesn't.",
      },
      {
        title: "An outcome for every conversation",
        body: "Each call, chat and thread is tagged with what happened: qualified, booked, objection raised, follow-up needed, not a fit. No need to listen to them all.",
      },
      {
        title: "Message-level detail",
        body: "See which opening angles and subject lines earn replies and which audiences convert, so the next campaign starts from evidence.",
      },
      {
        title: "Response times",
        body: "How long each inbound lead waited for a first reply, by hour and by source, including nights and weekends.",
      },
      {
        title: "Tied to your CRM",
        body: "Meetings and opportunities are matched to CRM records, so pipeline is counted from your own data and not from a guess.",
      },
      {
        title: "Quality checks",
        body: "Calls and chats flagged for a possible wrong answer or an off-script moment are listed for review, with the transcript at the right place.",
      },
    ],
    fit: [
      "Analytics read from the same records the agents write. There's no export step and no second tool to reconcile, so the meeting count a rep sees matches the one a manager sees.",
      "The findings feed back. When an angle underperforms or a qualifying question keeps confusing people, you change the play's instructions and watch the next week's numbers.",
    ],
    visual: {
      kind: "metrics",
      title: "This month",
      note: "all plays",
      tiles: [
        { label: "Conversations", value: "1,284" },
        { label: "Qualified", value: "312" },
        { label: "Meetings booked", value: "97" },
      ],
      bars: [
        { label: "Speed to lead", value: 82, note: "41 meetings" },
        { label: "Outbound lead generation", value: 56, note: "28 meetings" },
        { label: "Visitor follow-up", value: 34, note: "17 meetings" },
        { label: "Customer expansion", value: 22, note: "11 meetings" },
      ],
      foot: "Invented figures to show the layout. Not results.",
    },
    controls: [
      {
        title: "Your definitions",
        body: "Decide what counts as qualified and as a meeting held, so reports match how your team already talks.",
      },
      {
        title: "Filters and saved views",
        body: "Slice by rep, region, language, source or date, and save the views you check each week.",
      },
      {
        title: "Export and API",
        body: "Download any table as a CSV or pull the same data through the API for your own reporting.",
      },
      {
        title: "What it can't see",
        body: "Revenue and deal stages come from your CRM. If stages aren't kept up to date there, pipeline reports here will be off too.",
      },
    ],
    related: [
      "crm-integration",
      "deliverability-and-mailbox-health",
      "playbooks",
    ],
    plays: ["outbound-lead-generation", "speed-to-lead"],
  },

  "deliverability-and-mailbox-health": {
    tagline: "A good email only counts if it reaches the inbox.",
    intro:
      "Dialvo sends cold email from your own inboxes, on your own domains, as you. That makes your sender reputation worth protecting. Deliverability is built into how every sequence sends, so volume never outruns what your mailboxes can safely carry.",
    description:
      "Dialvo protects email deliverability with authenticated sending domains, gradual warm-up, daily limits, mailbox rotation, health monitoring and automatic unsubscribes.",
    capabilities: [
      {
        title: "Your inboxes, your identity",
        body: "Connect Gmail or Outlook mailboxes. Email goes out under your name and domain, with your business details in the footer.",
      },
      {
        title: "Authentication checked",
        body: "Dialvo checks SPF, DKIM and DMARC on each sending domain and tells you exactly what to fix before the first send.",
      },
      {
        title: "Separate sending domains",
        body: "Guidance on setting up a dedicated outreach domain, so your main domain's reputation is kept apart from cold email.",
      },
      {
        title: "Gradual warm-up",
        body: "New mailboxes start with a small daily volume that rises over weeks. Nothing jumps from zero to hundreds.",
      },
      {
        title: "Daily limits and rotation",
        body: "Each mailbox has a cap. Sequences spread their sends across your connected inboxes and across the day, like a person working through a list.",
      },
      {
        title: "Health monitoring",
        body: "Bounces, spam complaints and placement checks are tracked per mailbox. An inbox that starts to struggle is slowed or paused automatically.",
      },
      {
        title: "Unsubscribe on every email",
        body: "A working unsubscribe link and one-click header on every message. Opt-outs take effect at once and are written to your CRM.",
      },
      {
        title: "Addresses verified first",
        body: "Email addresses are checked before sending, which keeps the bounce rate down and your reputation up.",
      },
    ],
    fit: [
      "Every email agent sends through this layer. The sequence builder can ask for a hundred sends today; deliverability decides how many each mailbox can take and queues the rest.",
      "It works alongside personalisation. Fewer, more relevant emails draw fewer complaints, and that does more for inbox placement than any technical setting.",
    ],
    visual: {
      kind: "list",
      title: "Mailboxes",
      note: "health today",
      rows: [
        {
          name: "priya@northwind.example",
          detail: "Authenticated · 38 of 40 sent · no bounces",
          tag: "Healthy",
          strong: true,
        },
        {
          name: "tom@northwind.example",
          detail: "Authenticated · 22 of 40 sent",
          tag: "Healthy",
          strong: true,
        },
        {
          name: "sales@getnorthwind.example",
          detail: "Day 9 of warm-up · limit 15 a day",
          tag: "Warming",
        },
        {
          name: "hello@northwind.example",
          detail: "DKIM record missing",
          tag: "Fix needed",
        },
      ],
      foot: "Sample mailboxes. All made up.",
    },
    controls: [
      {
        title: "Limits you set",
        body: "Lower any mailbox's daily cap below Dialvo's default. You can't raise it past a safe ceiling.",
      },
      {
        title: "Suppression lists",
        body: "Upload domains and addresses that must never be emailed. They apply to every play.",
      },
      {
        title: "No guarantees",
        body: "Nobody controls where an inbox provider places a message. Dialvo follows good sending practice and shows you the signals; it can't promise the inbox.",
      },
      {
        title: "Extra inboxes",
        body: "Plans include a set number of sending inboxes; more can be added as an add-on.",
      },
    ],
    related: [
      "smart-replies",
      "sequence-builder",
      "call-deliverability-and-number-management",
    ],
    plays: ["outbound-lead-generation", "lead-reactivation"],
  },

  "call-deliverability-and-number-management": {
    tagline: 'Calls that show up as you, not as "Spam likely".',
    intro:
      "People answer calls they recognise. Dialvo looks after the phone numbers your voice agents and reps call from, so calls connect, your name appears where carriers allow it, and no number is worn out.",
    description:
      "Dialvo manages calling numbers for voice agents and reps: warm-up, local numbers, rotation, spam-label monitoring, branded caller ID where supported and Do Not Call checks.",
    capabilities: [
      {
        title: "Numbers set up for you",
        body: "Local numbers in the regions you call, registered to your business with the carriers.",
      },
      {
        title: "Warm-up before real calls",
        body: "A new number starts with low daily volume and builds, so it has a normal-looking history before it carries leads.",
      },
      {
        title: "Spam-label monitoring",
        body: "Each number is checked for spam or scam labels across carriers. A flagged number is taken out of rotation and remediated.",
      },
      {
        title: "Rotation and capacity",
        body: "Calls are spread across a pool so no single number places too many in a day. The pool grows as your volume does.",
      },
      {
        title: "Branded caller ID",
        body: "Where carriers support it, your business name shows on the person's screen. Coverage varies by country and network.",
      },
      {
        title: "Local presence",
        body: "Calls go out from a number in the same country or area as the person being called.",
      },
      {
        title: "Callbacks land in the right place",
        body: "When someone rings a number back, the AI phone agent answers with the context of the original call.",
      },
    ],
    fit: [
      "The inbound voice agent, consented outbound calls and the human dialer all draw on the same number pool. A speed-to-lead callback only works if the lead picks up, so number health is part of that play, not an extra.",
      "It's the voice counterpart to mailbox health. Both exist so that the work the agents do reaches the person it was meant for.",
    ],
    visual: {
      kind: "list",
      title: "Numbers",
      note: "health today",
      rows: [
        {
          name: "+44 131 ··· 0142",
          detail: "Edinburgh · 31 calls today · branded",
          tag: "Healthy",
          strong: true,
        },
        {
          name: "+44 20 ··· 0178",
          detail: "London · 27 calls today · branded",
          tag: "Healthy",
          strong: true,
        },
        {
          name: "+44 161 ··· 0119",
          detail: "Manchester · day 6 of warm-up",
          tag: "Warming",
        },
        {
          name: "+44 113 ··· 0163",
          detail: "Leeds · label reported on one carrier",
          tag: "Resting",
        },
      ],
      foot: "Sample numbers. All made up.",
    },
    controls: [
      {
        title: "Do Not Call checks",
        body: "Numbers are screened against your suppression list, and national registers where you connect them, before any call.",
      },
      {
        title: "Per-number caps",
        body: "Set the most calls a number may place per day, and the hours it may call.",
      },
      {
        title: "Bring your own numbers",
        body: "Port existing business numbers in, or keep your main line and forward it to the phone agent.",
      },
      {
        title: "Carrier decisions are theirs",
        body: "Carriers decide how calls are labelled. Dialvo monitors and responds; it can't guarantee how a given network will display a call.",
      },
    ],
    related: ["ai-phone-agent", "deliverability-and-mailbox-health"],
    plays: ["speed-to-lead", "customer-expansion"],
  },

  "deep-research": {
    tagline: "A researcher's brief on every account, before the first word.",
    intro:
      "The difference between a message that's answered and one that's deleted is usually ten minutes of reading. Dialvo does that reading for every lead: it studies the company and the person, sets what it finds against what you sell, and gives the outreach a reason to exist.",
    description:
      "Dialvo's deep research produces a sourced brief on every account from news, job posts, filings, your CRM and your knowledge base, with a suggested angle for outreach.",
    capabilities: [
      {
        title: "Reads what a good rep would read",
        body: "Company news, job adverts, product pages, leadership posts, public filings and reviews, plus the contact's role and background.",
      },
      {
        title: "Adds what you already know",
        body: "Past conversations, lost deals, support history and notes from your CRM are part of the brief.",
      },
      {
        title: "Framed against your offer",
        body: "Findings are matched to your products and positioning in the knowledge base: what this company is doing, and where you fit.",
      },
      {
        title: "A suggested angle",
        body: "Each brief ends with the one or two points most likely to matter to this person and a recommended way in.",
      },
      {
        title: "Every claim has a source",
        body: "Findings link to where they came from, so you or your rep can check anything in a click.",
      },
      {
        title: "Steerable",
        body: 'Tell the agent what to look for in a play: "find how they take bookings today", "check whether they sell abroad".',
      },
      {
        title: "The same depth for every lead",
        body: "The five-thousandth account gets the same reading as the first. Nothing is skimmed because the list was long.",
      },
    ],
    fit: [
      "Research is the step between finding a lead and contacting them. The email and social agents write from the brief; the dialer shows it to the rep before a call; the voice agent has it when an inbound lead rings.",
      "It's also what makes approval quick. When you review a message, the brief is beside it, so you can see why the agent wrote what it did.",
    ],
    visual: {
      kind: "brief",
      title: "Research brief",
      note: "Harbor Fitness · Marcus Hale",
      heading: "Two gyms, one phone line for bookings",
      facts: [
        ["Company", "Independent gym group, Edinburgh, about 60 staff"],
        ["Signal", "Opened a second site in Leith last month"],
        ["Hiring", "Two front-desk roles advertised this week"],
        ["History", "Downloaded your booking guide in February"],
      ],
      points: [
        "Angle: bookings by phone won't stretch to two sites.",
        "Lead with self-service class booking; mention the guide.",
        "Sources: company news page, two job adverts, CRM.",
      ],
      foot: "Sample brief. All made up.",
    },
    controls: [
      {
        title: "Public and permitted sources",
        body: "Agents read public pages and the systems you connect. They don't get behind logins or paywalls.",
      },
      {
        title: "Topics to avoid",
        body: "List subjects agents must never raise, such as personal social posts, health or family.",
      },
      {
        title: "Uncertainty is marked",
        body: "When a finding is a likely reading and not a stated fact, the brief says so, and the outreach doesn't present it as certain.",
      },
    ],
    related: [
      "ai-personalisation",
      "knowledge-base",
      "live-web-search-prospecting",
    ],
    plays: ["outbound-lead-generation", "closed-lost", "competitive-takeout"],
  },

  "ai-personalisation": {
    tagline: "One message, written for one person, every time.",
    intro:
      "Buyers can tell a merge field from a mile off. Dialvo's agents write each message from scratch for the person receiving it, using the research on their company, their role and your history with them.",
    description:
      "Dialvo writes each email, LinkedIn message and text for one person from real research: their role, their company's situation and your history with them. No merge-field templates.",
    capabilities: [
      {
        title: "Written from the brief",
        body: "Each message starts from the deep research brief: what's happening at the company and why it matters now.",
      },
      {
        title: "Different by role",
        body: "A finance lead and a sales lead at the same company hear about different things, because they're judged on different things.",
      },
      {
        title: "Your voice",
        body: "Give examples of emails you like and words you'd never use. Agents match the tone, length and sign-off of the person they're writing as.",
      },
      {
        title: "Right for the channel",
        body: "A LinkedIn note is short and conversational. An email has room for one idea and one ask. A text is a single line.",
      },
      {
        title: "Remembers the thread",
        body: 'Follow-ups build on what was said and how the person responded. They don\'t repeat the opener with "just checking in" on top.',
      },
      {
        title: "Only claims you can back",
        body: "Facts about your product come from your knowledge base. Agents don't invent customers, numbers or features.",
      },
    ],
    fit: [
      "Personalisation is how the research becomes something a buyer reads. It serves every agent that writes: email, LinkedIn, SMS, WhatsApp and chat, in outbound plays and in follow-up to inbound and existing customers.",
      "Because messages are written when each step falls due, they reflect the latest signal and the latest reply, not a draft from three weeks ago.",
    ],
    visual: {
      kind: "email",
      title: "Same company, two people",
      note: "second message shown",
      from: "Priya Shah <priya@northwind.example>",
      to: "Ava Lindqvist, Finance Director",
      subject: "Front-desk hours across two sites",
      body: [
        "Hi Ava,",
        "With Leith open, I'd guess front-desk hours have roughly doubled. A fair share of that time is usually spent taking class bookings by phone.",
        "We've helped gyms move that to self-service. Would a rough estimate of the hours it could free up at Harbor be useful?",
        "Priya · Northwind Agency",
      ],
      foot: "Marcus, the owner, got a different note about member experience.",
    },
    controls: [
      {
        title: "Preview and approve",
        body: "See real messages for sample leads before launch, and require approval for as much or as little as you like afterwards.",
      },
      {
        title: "Guardrails",
        body: "Set maximum length, banned phrases, required lines such as a compliance footer, and topics that are off limits.",
      },
      {
        title: "Edit and teach",
        body: "When you edit a draft, the agent takes the correction into account for the rest of the play.",
      },
    ],
    related: ["deep-research", "knowledge-base", "multi-channel-sequences"],
    plays: ["outbound-lead-generation", "event-registration", "lead-nurture"],
  },

  playbooks: {
    tagline: "Proven sales plays, ready to switch on.",
    intro:
      "You shouldn't have to design a campaign from a blank page. A playbook is a complete play: who to target, what to research, what to say, in what order and when to hand over. Pick one, fill in your details and it runs.",
    description:
      "Dialvo playbooks are ready-made sales plays, each with its own audience rules, research logic, sequence and handoff. Pick one, add your details and launch.",
    capabilities: [
      {
        title: "A play for each situation",
        body: "Speed to lead, outbound lead generation, nurture, reactivation, closed lost, competitive takeout, visitor follow-up, the three event plays, expansion, onboarding and PLG conversion.",
      },
      {
        title: "Strategy included",
        body: "Each playbook knows what it's looking for. The closed-lost play reads lost reasons; the event play reads session attendance. It's more than a sequence with a name.",
      },
      {
        title: "Set up by answering questions",
        body: "A short setup asks for the details that play needs: the event date, the competitor's name, the usage trigger. Dialvo builds the audience and sequence from your answers.",
      },
      {
        title: "A planning assistant",
        body: "Describe a goal in your own words and Dialvo proposes the audience, angle and sequence for you to edit.",
      },
      {
        title: "Run several at once",
        body: "Plays run side by side, and a lead is only ever in one at a time, so nobody gets two campaigns in the same week.",
      },
      {
        title: "Results per play",
        body: "Replies, qualified leads and meetings are reported for each play, so you can see which one is paying for itself.",
      },
    ],
    fit: [
      "A playbook ties the platform together. It draws its audience from the database or your CRM, briefs the research agent, supplies the sequence and sets the rules for replies and routing.",
      "Everything in a playbook can be edited: instructions, steps, timings and approvals are all visible. Start with the default and adjust as the results come in.",
    ],
    visual: {
      kind: "list",
      title: "Playbooks",
      note: "your workspace",
      rows: [
        {
          name: "Speed to lead",
          detail: "Inbound · form leads · voice, chat, SMS",
          tag: "Running",
          strong: true,
        },
        {
          name: "Visitor follow-up",
          detail: "Outbound · pricing-page visitors · email, LinkedIn",
          tag: "Running",
          strong: true,
        },
        {
          name: "Closed lost",
          detail: "Outbound · deals lost 6+ months ago",
          tag: "In review",
        },
        {
          name: "Customer expansion",
          detail: "Expansion · accounts at seat limit",
          tag: "Draft",
        },
      ],
      foot: "Sample workspace.",
    },
    controls: [
      {
        title: "Review before launch",
        body: "Every play shows its audience size, sample messages and schedule before it starts.",
      },
      {
        title: "Pause at any time",
        body: "Pause a play and everything in flight stops. Resume and it carries on from where it was.",
      },
      {
        title: "Priority order",
        body: "When a lead qualifies for two plays, your priority order decides which one they enter.",
      },
    ],
    related: ["sequence-builder", "analytics", "deep-research"],
    plays: ["speed-to-lead", "closed-lost", "event-follow-up"],
  },

  "knowledge-base": {
    tagline: "Agents that answer the way your best rep would.",
    intro:
      "An agent is only as good as what it knows about your business. The knowledge base is where you put that: what you sell, what it costs, who it's for, how you answer the hard questions. Every agent on every channel answers from it.",
    description:
      "Dialvo's knowledge base holds your product details, pricing, positioning, objection answers and call notes. Every agent answers from it, on every channel and in every language.",
    capabilities: [
      {
        title: "Add what you already have",
        body: "Point it at your website, upload documents and price lists, paste in FAQs, and add transcripts of your best sales calls.",
      },
      {
        title: "Positioning and objections",
        body: 'Battle cards, competitor comparisons and your preferred answers to "too expensive" and "we already have something".',
      },
      {
        title: "Scoped per play",
        body: "Limit a campaign to the product or persona it's about, so a play for one service doesn't wander into another.",
      },
      {
        title: "Per language and market",
        body: "Keep separate versions for each market, with local pricing and wording. Agents use the right one.",
      },
      {
        title: "Updates apply at once",
        body: "Change a price or add a feature and the next conversation uses it. There's nothing to retrain.",
      },
      {
        title: "Shows its working",
        body: "For any agent answer, see which entry it came from. Wrong answer? Fix the entry.",
      },
      {
        title: "Finds its own gaps",
        body: "Questions that agents couldn't answer are collected, so you know what to add next.",
      },
    ],
    fit: [
      "The knowledge base sits behind everything. The voice agent answers product questions from it mid-call; smart replies draw on it for objections; research frames each account against it; chat uses it to qualify.",
      "It's also the main lever you have over quality. Most agent mistakes trace back to something missing or out of date here, which makes them quick to put right.",
    ],
    visual: {
      kind: "list",
      title: "Knowledge base",
      note: "Northwind Agency",
      rows: [
        {
          name: "Website pages",
          detail: "42 pages · synced this morning",
          tag: "Current",
          strong: true,
        },
        {
          name: "Pricing 2026",
          detail: "PDF · care plans and build packages",
          tag: "Current",
          strong: true,
        },
        {
          name: "Objection answers",
          detail: "14 entries · edited last week",
          tag: "Current",
        },
        {
          name: "Unanswered questions",
          detail: '"Do you migrate old bookings?" asked 3 times',
          tag: "Add an answer",
        },
      ],
      foot: "Sample knowledge base. All made up.",
    },
    controls: [
      {
        title: "Nothing outside it",
        body: "Agents state facts about your business only from the knowledge base. If it isn't there, they say they'll check and hand over.",
      },
      {
        title: "Version history",
        body: "See who changed what and when, and roll an entry back.",
      },
      {
        title: "Internal-only entries",
        body: "Mark entries as internal: agents can use them to reason but never quote them to a buyer.",
      },
    ],
    related: ["smart-replies", "deep-research", "ai-phone-agent"],
    plays: [
      "customer-onboarding-operations",
      "competitive-takeout",
      "speed-to-lead",
    ],
  },
} satisfies Partial<Record<FeatureSlug, FeatureContent>>;
