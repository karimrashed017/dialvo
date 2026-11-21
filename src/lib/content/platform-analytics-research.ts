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
      "Dialvo sends from your own mailboxes, on your own domains, as you. That makes your sender reputation worth protecting. Every mailbox is checked, ramped up slowly, kept under a daily limit and paused by itself if people start bouncing or asking to stop.",
    description:
      "Dialvo protects email deliverability with DNS checks per mailbox (SPF, DKIM, DMARC and MX) and plain fixes, a gradual ramp-up, daily limits, spacing between sends, and an automatic pause when bounces or unsubscribes run high.",
    capabilities: [
      {
        title: "Your mailboxes, your identity",
        body: "Connect your own address. Email goes out under your name and domain, with an unsubscribe link and your details.",
      },
      {
        title: "DNS checked, fixes in plain words",
        body: "SPF, DKIM, DMARC and MX are checked for each mailbox's domain, with exactly what to change when something's missing.",
      },
      {
        title: "A gradual ramp-up",
        body: "A new mailbox starts at 10 emails a day and adds 5 a day until it reaches its limit.",
      },
      {
        title: "Daily limits",
        body: "30 a day per mailbox once ramped up, unless you set it lower, and never more than 50. The workspace has a daily total too.",
      },
      {
        title: "Spaced like a person",
        body: "Emails from one mailbox go out minutes apart, at varied gaps, not in a burst.",
      },
      {
        title: "Paused automatically",
        body: "If bounces or unsubscribes pass a threshold over two weeks, the mailbox stops sending and your team is told.",
      },
    ],
    fit: [
      "Every email Dialvo sends goes through these limits. A play can draft a hundred emails today; each mailbox sends only what it safely can, and the rest wait their turn.",
      "Fewer, more relevant emails draw fewer complaints, which does more for where your mail lands than any technical setting.",
    ],
    visual: {
      kind: "list",
      title: "Mailboxes",
      note: "health today",
      rows: [
        {
          name: "priya@northwind.example",
          detail: "DNS checked · 24 of 30 sent · no bounces",
          tag: "Healthy",
          strong: true,
        },
        {
          name: "tom@northwind.example",
          detail: "DNS checked · 18 of 30 sent",
          tag: "Healthy",
          strong: true,
        },
        {
          name: "sales@getnorthwind.example",
          detail: "Ramping up · 20 a day today",
          tag: "Ramping",
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
        body: "Lower any mailbox's daily limit. It can't be raised past the safe ceiling.",
      },
      {
        title: "Never-contact list",
        body: "Addresses and domains on it are never emailed, by any play.",
      },
      {
        title: "No placement tests",
        body: "Dialvo doesn't run inbox-placement tests, and nobody controls where a provider puts a message. It follows good practice and shows you the signals.",
      },
      {
        title: "Resume when fixed",
        body: "A paused mailbox stays paused until someone resumes it, and the count starts again.",
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
    tagline: "A business number your customers can call, answered every time.",
    intro:
      "Your phone agent needs a number people can ring. Dialvo gets you a local business number, points it at the agent and keeps a record of every call it answers. It never dials out from it.",
    description:
      "Dialvo manages the business phone numbers its AI phone agent answers: buy and release local numbers, forward your existing line, and see every call each number receives. Dialvo never makes outbound calls.",
    capabilities: [
      {
        title: "Numbers in minutes",
        body: "Pick a local number in the US or Canada. The monthly price is shown before you buy.",
      },
      {
        title: "Answered by the agent",
        body: "Every number goes straight to the AI phone agent, day and night, with your greeting and your knowledge base.",
      },
      {
        title: "Keep your main line",
        body: "Forward your existing business number to the agent instead of buying a new one.",
      },
      {
        title: "Texts to the same number",
        body: "People who text the number reach your inbox, and STOP is honoured at once.",
      },
      {
        title: "Every call on record",
        body: "See how many calls each number received this week and today, with the transcript of each on the lead.",
      },
      {
        title: "Never used to dial out",
        body: "Dialvo never makes outbound calls, from these numbers or any other.",
      },
    ],
    fit: [
      "Numbers are the front door of the phone agent. A caller who rings is answered, qualified and booked or put through to a person.",
      "It's the phone counterpart to mailbox health: both exist so the conversations people start with you reach the right place.",
    ],
    visual: {
      kind: "list",
      title: "Numbers",
      note: "this week",
      rows: [
        {
          name: "+1 415 ··· 0142",
          detail: "San Francisco · 31 calls answered",
          tag: "In use",
          strong: true,
        },
        {
          name: "+1 312 ··· 0178",
          detail: "Chicago · 12 calls answered",
          tag: "In use",
          strong: true,
        },
      ],
      foot: "Sample numbers. All made up.",
    },
    controls: [
      {
        title: "Owner-only buying",
        body: "Only the workspace's owner can buy or release a number, and the price is confirmed first.",
      },
      {
        title: "Do not contact",
        body: "Numbers on your do-not-contact list are never texted, and a caller who asks is added at once.",
      },
      {
        title: "Bring your own numbers",
        body: "Keep your main line and forward it to the phone agent.",
      },
      {
        title: "Transcription notice",
        body: "Every call opens by telling the caller it's transcribed, and recorded if you switch recording on.",
      },
    ],
    related: ["ai-phone-agent", "deliverability-and-mailbox-health"],
    plays: ["automated-meeting-scheduling"],
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
      "Research is the step between finding a lead and contacting them. The email and social agents write from the brief, and the phone agent has it when a lead rings.",
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
    tagline: "Ready-made plays, and your own.",
    intro:
      "Dialvo comes with plays for the common situations: a new lead, a quiet lead, a lost deal, an event. When yours doesn't fit any of them, write a playbook: who it picks, what the first email should do, which sequence follows and whether it waits for you.",
    description:
      "Dialvo's playbooks are ready-made sales plays plus your own custom ones: pick leads by stage, inactivity and source, set the first email's goal, the sequence and the language, and choose whether each draft waits for approval.",
    capabilities: [
      {
        title: "A play for each situation",
        body: "Speed to lead, outbound lead generation, nurture, reactivation, closed lost, competitive takeout, website visitors, the three event plays, onboarding, expansion and PLG conversion.",
      },
      {
        title: "Your own playbooks",
        body: "For anything the ready-made plays don't cover, write a playbook of your own.",
      },
      {
        title: "Who it picks",
        body: "Leads by stage, how long they've been quiet and where they came from.",
      },
      {
        title: "What the first email should do",
        body: "Say the goal in a sentence. The email is written for each person from your Knowledge.",
      },
      {
        title: "Which sequence follows",
        body: "Choose a sequence and its language, so the follow-ups are set up once.",
      },
      {
        title: "Approval your way",
        body: "Have each draft wait for you, or let the playbook send within your limits.",
      },
    ],
    fit: [
      "Playbooks tie the rest together: an audience or a list decides who, the knowledge base decides what's true, and the sequence decides what follows.",
      "Results are counted per play in Analytics, so you can see which ones earn their place.",
    ],
    visual: {
      kind: "list",
      title: "Playbooks",
      note: "running",
      rows: [
        {
          name: "Quiet trial users",
          detail: "Stage: trial · quiet 14 days · source: signup",
          tag: "Your playbook",
          strong: true,
        },
        {
          name: "Lead reactivation",
          detail: "Quiet 30 days · drafts wait for approval",
          tag: "Ready-made",
          strong: true,
        },
        {
          name: "Event follow-up",
          detail: "Attendees from the November webinar",
          tag: "Ready-made",
        },
        {
          name: "Partner referrals",
          detail: "Source: partner · German sequence",
          tag: "Your playbook",
        },
      ],
      foot: "Sample playbooks. All made up.",
    },
    controls: [
      {
        title: "The never-contact rules",
        body: "No playbook writes to anyone on your never-contact list, anyone who unsubscribed or anyone who asked not to be contacted.",
      },
      {
        title: "Not the same lead too soon",
        body: "A playbook doesn't pick a lead again within the number of days you set.",
      },
      {
        title: "A cap on every start",
        body: "Each time a playbook starts, it picks a limited number of leads, so one click can't email your whole database.",
      },
    ],
    related: ["sequence-builder", "saved-audiences", "workflows"],
    plays: ["lead-reactivation", "closed-lost", "event-follow-up"],
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
      "The knowledge base sits behind everything. The phone agent answers product questions from it mid-call; smart replies draw on it for objections; research frames each account against it; chat uses it to qualify.",
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
