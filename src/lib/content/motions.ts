import type { MotionId } from "./catalog";
import type { MotionContent } from "./types";

// The three motion pages: /inbound, /outbound and /expansion. Figures in the
// sample boards are invented and marked as examples.

export const MOTION_PAGES: Record<MotionId, MotionContent> = {
  inbound: {
    id: "inbound",
    title: "Inbound · AI agents that answer, qualify and book every lead",
    headline: "Turn every enquiry into a qualified meeting.",
    intro:
      "Dialvo answers each new lead by phone or chat within seconds, at any hour. It asks your qualifying questions, picks the right rep and books the meeting, so the money you spend generating leads isn't lost to slow replies.",
    description:
      "Dialvo Inbound answers every lead by voice or chat within seconds, qualifies with your questions, routes to the right rep and books the meeting, around the clock.",
    problem: {
      title: "You paid for the lead. Then it waited.",
      lead: "Inbound demand is the most expensive pipeline you have and the easiest to waste. The gaps are always the same.",
      points: [
        {
          title: "Leads arrive when nobody's free",
          body: "Evenings, weekends, the middle of a team meeting. A buyer who hears nothing for an hour has usually contacted someone else.",
        },
        {
          title: "Reps qualify by having the meeting",
          body: "Half an hour of a salesperson's day to learn there was never a budget. Multiply that by every form fill.",
        },
        {
          title: "The handoff is a name and an email",
          body: "The rep starts from nothing and asks the questions the lead already answered on the form.",
        },
        {
          title: "Not ready means forgotten",
          body: "Leads who aren't a fit today sit in a list. Nobody goes back when their situation changes.",
        },
      ],
    },
    steps: {
      title: "From first click to booked meeting, in one conversation",
      lead: "However the lead arrives, the same thing happens next.",
      items: [
        {
          title: "A lead arrives",
          body: "A form is filled in, a visitor opens the chat on your pricing page, or someone rings your number. Each one starts a conversation straight away.",
        },
        {
          title: "An agent replies within seconds",
          body: "The voice agent calls form leads back and answers your line. The chat agent talks to visitors on the site. Both say they're an AI assistant for your business.",
        },
        {
          title: "It qualifies with your questions",
          body: "Need, timing, budget, who decides, or whatever you qualify on. Product questions are answered from your knowledge base, and the lead is scored against your ideal customer.",
        },
        {
          title: "Routing picks the owner",
          body: "Territory, account owner, seniority or round robin, applied while the lead is still talking.",
        },
        {
          title: "The meeting is booked, or the call transferred",
          body: "Good fits choose a time on the rep's calendar, or are put through live with a short briefing for the rep first.",
        },
        {
          title: "Everyone else gets a next step",
          body: "No answer: follow-up by text, WhatsApp and email. Not ready: into nurture. Wrong person: asked for the right one. Every outcome is written to the CRM with the transcript.",
        },
      ],
    },
    playsLead:
      "Start with speed to lead, and add scheduling and onboarding when you're ready. Each play has its own page.",
    channels: {
      lead: "Inbound runs on the channels people chose when they got in touch.",
      items: [
        {
          id: "voice",
          body: "Answers your line and calls form leads back. Qualifies, books and transfers.",
        },
        {
          id: "chat",
          body: "Talks to visitors on your site and qualifies them without a form.",
        },
        {
          id: "messages",
          body: "Follows up by SMS and WhatsApp when a call isn't answered, with people who opted in.",
        },
        {
          id: "email",
          body: "Confirms, reminds and continues the conversation from your own inbox.",
        },
      ],
    },
    board: {
      title: "Inbound · today",
      tiles: [
        { label: "New leads", value: "46" },
        { label: "Median first reply", value: "24 s" },
        { label: "Qualified", value: "19" },
        { label: "Meetings booked", value: "12" },
      ],
      feed: [
        {
          name: "Lena Ortiz · Bright Smile Dental",
          detail: "Form 21:14 · called back · qualified",
          tag: "Booked Tue 10:30",
          strong: true,
        },
        {
          name: "Website visitor · Fernhill Logistics",
          detail: "Chat on pricing page · asked about integrations",
          tag: "Booked Thu 14:00",
          strong: true,
        },
        {
          name: "Sam Okafor · Juniper Payroll",
          detail: "Called main line · existing customer",
          tag: "Transferred to Tom",
        },
        {
          name: "Ivo Marsh · Oakline Studio",
          detail: "Form 08:02 · no answer · text sent",
          tag: "Following up",
        },
        {
          name: "Ava Lindqvist · student project",
          detail: "Chat · not a fit · pointed to resources",
          tag: "Closed politely",
        },
      ],
      stages: [
        { label: "Answered within a minute", value: 96, note: "44 of 46" },
        { label: "Reached in conversation", value: 72, note: "33" },
        { label: "Qualified", value: 41, note: "19" },
        { label: "Meeting booked", value: 26, note: "12" },
      ],
    },
    controls: {
      title: "You set the rules. You can see every conversation.",
      lead: "Nothing about the agent is hidden from you.",
      items: [
        {
          title: "Your qualification flow",
          body: "Required questions, follow-ups and what counts as qualified are yours to write and change.",
        },
        {
          title: "Readable instructions",
          body: "Tone, what to say, what never to say and when to hand over, in plain language you can edit.",
        },
        {
          title: "Recordings and transcripts",
          body: "Every call and chat is kept with the questions asked, the answers given and the reason for the outcome.",
        },
        {
          title: "Take over at any time",
          body: "Join a live chat, pick up a transferred call, or set topics that always go to a person.",
        },
        {
          title: "Quiet hours and consent",
          body: "Choose when callbacks may be placed. Texts and WhatsApp go only to people who agreed to them.",
        },
        {
          title: "Automatic checks",
          body: "Conversations are checked for answers your knowledge base doesn't support, and flagged for review.",
        },
      ],
    },
    features: [
      "ai-phone-agent",
      "inbound-lead-qualification",
      "intelligent-lead-routing",
      "knowledge-base",
      "call-deliverability-and-number-management",
      "crm-integration",
    ],
    faqs: [
      {
        q: 'How fast is "within seconds"?',
        a: "A callback is placed as soon as the form reaches Dialvo, and chat replies as the visitor types. How long the lead takes to pick up is up to them. Your dashboard shows the actual first-reply time for every lead.",
      },
      {
        q: "Do callers know they're talking to an AI?",
        a: "Yes. Every call and chat opens by saying it's an AI assistant working for your business, and calls mention that they're recorded. Anyone can ask for a person.",
      },
      {
        q: "Will it replace our inbound sales reps?",
        a: "It replaces the waiting and the first screening call. Reps get meetings with qualified buyers and the answers already written down, and spend their time on live deals.",
      },
      {
        q: "What does it need to get started?",
        a: "Your form or phone number, your qualifying questions, your reps' calendars and enough about your product to answer common questions. Most of that is a link to your website and a few sentences.",
      },
      {
        q: "Which plan includes inbound?",
        a: "Starter covers the voice agent for inbound leads, email and SMS follow-up. Pro adds website chat, WhatsApp, lead routing rules and CRM sync.",
      },
    ],
  },

  outbound: {
    id: "outbound",
    title: "Outbound · Researched cold email and LinkedIn outreach, run by AI",
    headline: "Outbound that reads like your best rep wrote it.",
    intro:
      "Dialvo finds the accounts worth contacting, researches each one and writes to every person for a reason. Cold email goes from your own inboxes and LinkedIn messages from your reps' own profiles. Replies are handled and meetings booked. Your reps make the phone calls, with the research in front of them.",
    description:
      "Dialvo Outbound finds accounts, researches each one and sends personal cold email from your inboxes and LinkedIn messages from your reps' profiles, then handles replies. Reps make the calls.",
    problem: {
      title: "Outbound works. Doing it properly doesn't scale.",
      lead: "Everyone knows what good prospecting looks like. Very few teams can afford to do it for every account.",
      points: [
        {
          title: "Lists go stale",
          body: "Built once a quarter from a static export. By the time a rep reaches row 300, people have moved and the moment has passed.",
        },
        {
          title: "Research gets skipped",
          body: "Ten minutes per prospect is the first thing to go when the target is fifty touches a day.",
        },
        {
          title: "Templates get ignored",
          body: '"Hi {first name}, I noticed {company} is growing" is what every buyer\'s inbox is full of. It also wears out your sending domain.',
        },
        {
          title: "Channels live in separate tools",
          body: "Email in one place, LinkedIn in another, the dialer in a third. Nobody knows what was already said.",
        },
        {
          title: "Replies wait",
          body: "A prospect answers at 6pm with a question. The rep sees it the next afternoon.",
        },
      ],
    },
    steps: {
      title: "From a list you haven't built to a meeting on the calendar",
      lead: "Each stage is handled by an agent, and each one is visible to you.",
      items: [
        {
          title: "Find the accounts worth working",
          body: "Describe your ideal customer, or bring your own CRM lists and CSVs. Dialvo draws on a live company and contact database and web search, and checks every lead against your criteria.",
        },
        {
          title: "Catch the moment",
          body: "Signals decide who is contacted this week: funding, hiring, a new executive, a change of tools, a visit to your site, activity on review sites, or an event you describe in your own words.",
        },
        {
          title: "Research every account",
          body: "A sourced brief on each company and contact, set against what you sell, with the angle worth leading with.",
        },
        {
          title: "Write one message per person",
          body: "No merge-field templates. A finance lead and a sales lead at the same company get different notes. You can preview real messages before launch and approve as much as you like.",
        },
        {
          title: "Send cold email from your own inboxes",
          body: "Email goes out from your connected Gmail or Outlook mailboxes under your name, with your business details and an unsubscribe link. Domains are authenticated, new inboxes are warmed up gradually, daily limits are enforced and sends rotate across mailboxes.",
        },
        {
          title: "Reach out on LinkedIn from the rep's own profile",
          body: "Connection notes and messages are drafted for each rep and sent from their own account once they approve them. Nothing is posted in someone's name without their say-so, and daily volumes stay modest.",
        },
        {
          title: "Run it as one sequence",
          body: "Email, LinkedIn and rep calls are steps in a single sequence. Each touch knows about the others, and a reply on any channel pauses the rest.",
        },
        {
          title: "Handle every reply",
          body: "Replies are read as they arrive: questions answered from your knowledge base, objections addressed, meetings booked, referrals followed, opt-outs honoured immediately.",
        },
        {
          title: "Put reps on the calls that matter",
          body: "Prospects who engage are added to the human dialer. Your rep sees who to call, why now and what to say, and makes the call. Dialvo's AI does not cold call.",
        },
      ],
    },
    playsLead:
      "Outbound isn't one campaign. Run the plays that suit your pipeline, side by side.",
    channels: {
      lead: "Cold outreach uses the channels where a first message from a stranger is acceptable. Calls to prospects are made by people.",
      items: [
        {
          id: "email",
          body: "Cold and follow-up email from your own inboxes and domains, with deliverability, sender identity and unsubscribes handled.",
        },
        {
          id: "social",
          body: "LinkedIn connection notes and messages from your reps' own profiles, sent after they approve them.",
        },
        {
          id: "dialer",
          body: "A prioritised call list for your reps, with the brief and an opening line on screen. People place the calls.",
        },
        {
          id: "messages",
          body: "SMS and WhatsApp only for prospects who have opted in, for example after they reply and ask for a text.",
        },
      ],
    },
    board: {
      title: "Outbound · this week",
      tiles: [
        { label: "Accounts researched", value: "214" },
        { label: "Emails sent", value: "388" },
        { label: "Replies", value: "41" },
        { label: "Meetings booked", value: "14" },
      ],
      feed: [
        {
          name: "Marcus Hale · Harbor Fitness",
          detail: 'Email → LinkedIn → reply: "Thursday works"',
          tag: "Booked Thu 11:00",
          strong: true,
        },
        {
          name: "Dana Whitlock · Fernhill Logistics",
          detail: "Reply: asked about routing integration · answered",
          tag: "Question answered",
          strong: true,
        },
        {
          name: "Jonas Keller · Praxis Leipzig",
          detail: "LinkedIn note drafted in German",
          tag: "Awaiting Priya's approval",
        },
        {
          name: "Ava Lindqvist · Harbor Fitness",
          detail: "Opened twice, clicked · no reply",
          tag: "On Priya's call list",
        },
        {
          name: "Lena Ortiz · Calder & Pine",
          detail: 'Reply: "please remove me"',
          tag: "Opted out everywhere",
        },
      ],
      stages: [
        { label: "priya@ · 38 of 40 today", value: 95, note: "Healthy" },
        { label: "tom@ · 22 of 40 today", value: 55, note: "Healthy" },
        { label: "sales@ · warm-up day 9", value: 30, note: "Limit 15" },
        { label: "LinkedIn · Priya · 9 of 15", value: 60, note: "Approved" },
      ],
    },
    controls: {
      title: "Your name is on every message. You stay in charge of it.",
      lead: "Outbound goes out as you, so the limits are yours to set.",
      items: [
        {
          title: "Approval levels",
          body: "Approve every message, only the first in each sequence, or let proven plays send by themselves. LinkedIn messages wait for the rep by default.",
        },
        {
          title: "Send limits and windows",
          body: "Daily caps per inbox and per profile, and sending hours in the recipient's time zone.",
        },
        {
          title: "Exclusions",
          body: "Customers, open deals, competitors and suppression lists are kept out of every audience.",
        },
        {
          title: "Unsubscribes and sender identity",
          body: "Every email carries your business details and a working unsubscribe link. Opt-outs apply across all channels and are written to your CRM.",
        },
        {
          title: "Mailbox health",
          body: "An inbox with rising bounces or complaints is slowed or paused before it damages your domain.",
        },
        {
          title: "Escalation rules",
          body: "Sensitive replies and named accounts go to a person, with the thread and a suggested answer.",
        },
      ],
    },
    features: [
      "company-and-lead-database",
      "live-web-search-prospecting",
      "deep-research",
      "ai-personalisation",
      "multi-channel-sequences",
      "sequence-builder",
      "smart-replies",
      "deliverability-and-mailbox-health",
      "review-site-intent",
    ],
    faqs: [
      {
        q: "Does Dialvo send cold email?",
        a: "Yes. It's sent from your own connected inboxes, on your domains, under your reps' names. Each email includes your business details and an unsubscribe link, and volume is kept within what each mailbox can healthily send.",
      },
      {
        q: "How does LinkedIn outreach work?",
        a: "Each rep connects their own LinkedIn profile. The agent drafts connection notes and messages from the research; the rep approves them, and they go from that rep's account at a sensible daily pace. Dialvo doesn't use fake or shared profiles.",
      },
      {
        q: "Does the AI cold call prospects?",
        a: "No. AI voice calls are for people who asked to hear from you or opted in. Calls to cold prospects are made by your reps through the human dialer, with the research and an opening line in front of them.",
      },
      {
        q: "Where does the prospect data come from?",
        a: "From Dialvo's company and contact database, live web search and your own CRM lists and CSVs. Contact details are re-checked just before outreach, and each verified contact uses a lead credit.",
      },
      {
        q: "Is cold outreach legal where I sell?",
        a: "The rules for business email and messaging differ by country. Dialvo gives you the tools (sender identity, unsubscribes, suppression lists, regional settings), and who you contact is your decision. If you're unsure, ask a lawyer where you sell.",
      },
      {
        q: "Which plan includes outbound?",
        a: "Starter includes research and personalised email from one inbox. Pro adds LinkedIn, multi-channel sequences, more inboxes, human dialer seats and CRM sync.",
      },
    ],
  },

  expansion: {
    id: "expansion",
    title: "Expansion · AI agents that grow the customers you already have",
    headline: "The revenue already sitting in your customer list.",
    intro:
      "Dialvo gives every customer the proactive attention only your largest accounts get. Agents check in when there's a reason, find who is ready for more seats, a bigger plan or a second product, and bring your team in when there's a real opportunity.",
    description:
      "Dialvo Expansion checks in with every customer when there's a reason, finds upgrade, cross-sell and renewal opportunities, and hands qualified ones to your team.",
    problem: {
      title: "Your account team can only cover the top of the list",
      lead: "The cheapest revenue to win is from people who already buy from you. Most of them never get asked.",
      points: [
        {
          title: "Attention is rationed",
          body: "Named accounts get reviews and check-ins. The long tail hears from you when the invoice is due.",
        },
        {
          title: "Signals become tasks, and tasks wait",
          body: '"Usage at 95%" joins a queue behind renewals and escalations. By the time someone calls, the customer has found a workaround.',
        },
        {
          title: "Problems surface at renewal",
          body: "You learn a customer was unhappy when they cancel, long after there was time to fix it.",
        },
        {
          title: "You don't know what they'd buy",
          body: "Nobody has asked most customers what else they need, so the demand is invisible.",
        },
      ],
    },
    steps: {
      title: "From a signal on an account to a conversation with a rep",
      lead: "Voice opens the conversation with customers who agreed to calls; email and messages carry it for everyone else.",
      items: [
        {
          title: "Find the reason to get in touch",
          body: "Seat usage, plan limits, feature adoption, a new team joining, a renewal date, a change at the company. Signals come from your CRM and from events your product sends.",
        },
        {
          title: "Cover the whole base",
          body: "Start with the strongest signals, then work through the accounts your team never gets to. Named accounts can stay with their managers.",
        },
        {
          title: "Start a real conversation",
          body: "Customers who opted in get a call from the voice agent, which says it's an AI assistant and why it's calling. Others get an email, text or WhatsApp from their account owner.",
        },
        {
          title: "Understand the need",
          body: "The agent asks what's changed, how many people it affects and who decides, and answers plan and pricing questions from your knowledge base.",
        },
        {
          title: "Hand over, with the detail",
          body: "Simple requests are passed to your team with everything confirmed. Bigger opportunities are booked on the account owner's calendar or transferred live.",
        },
        {
          title: "Learn from every answer",
          body: '"Not yet", "we\'re unhappy with X" and "we\'d pay for Y" are all saved to the account. Unhappy customers are flagged to a person at once.',
        },
      ],
    },
    playsLead:
      "Two expansion plays, plus onboarding, which decides whether there's anything to expand later.",
    channels: {
      lead: "Expansion uses the channels your customers have agreed to hear from you on.",
      items: [
        {
          id: "voice",
          body: "Calls to customers who opted in, with a specific reason for each call.",
        },
        {
          id: "email",
          body: "Check-ins and follow-ups from the account owner's inbox.",
        },
        {
          id: "messages",
          body: "SMS and WhatsApp for quick questions and reminders, with consent.",
        },
        {
          id: "chat",
          body: "In-app or website chat for customers who come to you with a question about plans.",
        },
      ],
    },
    board: {
      title: "Expansion · this month",
      tiles: [
        { label: "Accounts with a signal", value: "128" },
        { label: "Conversations", value: "74" },
        { label: "Opportunities found", value: "23" },
        { label: "At-risk flags", value: "6" },
      ],
      feed: [
        {
          name: "Harbor Fitness",
          detail: "All seats used · call: needs 8 more",
          tag: "Booked with Priya",
          strong: true,
        },
        {
          name: "Juniper Payroll",
          detail: "Using one product · asked about reporting",
          tag: "Cross-sell opportunity",
          strong: true,
        },
        {
          name: "Oakline Studio",
          detail: "Renewal in 60 days · check-in call done",
          tag: "Happy, renewing",
        },
        {
          name: "Tidewater Clinics",
          detail: "Usage down for 3 weeks · emailed",
          tag: "At risk: sent to Dana",
        },
        {
          name: "Calder & Pine",
          detail: "No opt-in for calls · email check-in",
          tag: "Replied: not yet",
        },
      ],
      stages: [
        { label: "Seat or plan limit reached", value: 78, note: "41 accounts" },
        { label: "Renewal within 90 days", value: 64, note: "34" },
        { label: "New team or site added", value: 49, note: "26" },
        { label: "Usage falling", value: 27, note: "14" },
      ],
    },
    controls: {
      title: "Your customers, your rules",
      lead: "These are relationships you've already earned. Dialvo is careful with them.",
      items: [
        {
          title: "Consent for calls",
          body: "The voice agent only calls customers with a recorded opt-in. No opt-in, no call.",
        },
        {
          title: "Which accounts are covered",
          body: "Include or exclude by segment, plan, owner or name. Keep strategic accounts entirely with their managers.",
        },
        {
          title: "Triggers and thresholds",
          body: "You decide which signals start a conversation and how strong they must be.",
        },
        {
          title: "Contact frequency",
          body: "A cap on how often any customer hears from an agent, across all plays.",
        },
        {
          title: "What agents may offer",
          body: "Agents quote plans and prices from your knowledge base. Discounts and contract changes always go to a person.",
        },
        {
          title: "Full history",
          body: "Every call recording, transcript and message is on the account in your CRM.",
        },
      ],
    },
    features: [
      "consented-outbound-calling",
      "crm-integration",
      "api",
      "knowledge-base",
      "multi-channel-sequences",
      "analytics",
    ],
    faqs: [
      {
        q: "Will my customers get calls from a robot they didn't ask for?",
        a: "No. AI calls go only to customers who agreed to receive them. The agent says it's an AI assistant at the start, explains why it's calling, and stops if asked.",
      },
      {
        q: "Can the agent close an upgrade?",
        a: "It confirms what the customer wants and passes it to your team or sends your own upgrade link. Billing changes, discounts and contracts stay with people.",
      },
      {
        q: "How does it know when a customer is ready?",
        a: "From the signals you connect: CRM fields such as renewal date and plan, and product events sent through the API, such as seats used or limits reached.",
      },
      {
        q: "What about unhappy customers?",
        a: "If a customer raises a problem, the agent doesn't sell. It records the issue, tells the customer who will follow up and alerts that person straight away.",
      },
      {
        q: "Which plan includes expansion?",
        a: "Expansion plays are part of Pro, along with CRM sync and the API they rely on.",
      },
    ],
  },
};
