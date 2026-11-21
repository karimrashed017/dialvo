import type { PlaySlug } from "./catalog";
import type { PlayContent } from "./types";

// The outbound plays. Cold outreach here is email from the customer's own
// inboxes and LinkedIn messages from the rep's own profile after approval.
// Dialvo never makes outbound calls. People and businesses in the sample
// panels are made up.

export const OUTBOUND_PLAYS = {
  "outbound-lead-generation": {
    promise: "New pipeline every week, without adding to the sales team.",
    intro:
      "Describe who you sell to. Dialvo builds the list, researches every account, writes to each person from your own inbox and LinkedIn profile, handles the replies and books the meetings. Your reps spend their time on people who said yes.",
    description:
      "Dialvo runs outbound end to end: it builds the list, researches each account, sends personal email and LinkedIn outreach from your own accounts, handles replies and books meetings.",
    situation: {
      title: "Targets go up. The hours in a rep's day don't.",
      body: [
        "Good outbound is slow work: find the account, find the person, read up, write something worth answering, follow up four times. Most reps manage a handful a day before the calendar takes over.",
        "So teams fall back on volume: one template, a big list, the same message to everyone. Reply rates sink, the sending domain suffers and the market learns to ignore you.",
        "The accounts that would buy from you are out there. Most of them have never had a single thoughtful message from your company.",
      ],
    },
    steps: [
      {
        title: "Build the audience",
        body: "Describe your ideal customer, or bring a CRM list or CSV. Dialvo finds matching companies and the right contacts, and checks each one against your criteria.",
      },
      {
        title: "Find the reason to write now",
        body: "Signals such as funding, hiring, a new executive, a change of tools or a visit to your site decide who is contacted this week, and about what.",
      },
      {
        title: "Research and write, one person at a time",
        body: "An agent reads up on the account and writes a short message for that person's role. You can preview sample messages and approve them before anything goes out.",
      },
      {
        title: "Send from your own accounts",
        body: "Email goes from your connected inboxes with an unsubscribe link and your details. LinkedIn messages are drafted for your rep and sent from their own profile once they approve.",
      },
      {
        title: "Handle the replies",
        body: "Replies are sorted within minutes. Questions are answered from your knowledge base, meetings are booked, and anyone who opts out is removed everywhere.",
      },
    ],
    visual: {
      kind: "email",
      title: "New message",
      note: "from Priya's inbox",
      from: "Priya Shah <priya@northwind.example>",
      to: "Marcus Hale",
      subject: "Second Harbor Fitness site",
      body: [
        "Hi Marcus,",
        "Congratulations on the Leith opening. I saw you're hiring front-desk staff for both sites, which usually means bookings are still coming in by phone.",
        "We build booking pages for gyms so members can reserve classes at either site themselves. Worth 15 minutes next week?",
        "Priya · Northwind Agency",
      ],
      foot: "Unsubscribe link and sender details added to every email.",
    },
    channels: ["email", "social"],
    features: [
      "company-and-lead-database",
      "live-web-search-prospecting",
      "deep-research",
      "ai-personalisation",
      "multi-channel-sequences",
      "smart-replies",
      "deliverability-and-mailbox-health",
    ],
    setup: [
      "Describe your ideal customer and the offers you lead with.",
      "Connect the Gmail or Outlook inboxes to send from.",
      "Have each rep connect their LinkedIn profile and choose how approvals work.",
      "Set daily send limits, send windows and who gets escalations.",
    ],
    faqs: [
      {
        q: "Does Dialvo cold call prospects?",
        a: "No. Dialvo never makes outbound calls. Cold outreach is email and LinkedIn.",
      },
      {
        q: "Whose name is on the messages?",
        a: "Yours. Email is sent from your own inboxes and domain, and LinkedIn messages from your rep's own profile after they approve them.",
      },
      {
        q: "Will this hurt our email reputation?",
        a: "Dialvo sends from authenticated domains, warms new inboxes gradually, caps daily volume and pauses an inbox if its health drops. Sending fewer, better emails is the point.",
      },
      {
        q: "Can I check messages before they send?",
        a: "Yes. Approve every message, approve only the first of each sequence, or let trusted plays send by themselves. You choose per play.",
      },
    ],
    related: [
      "lead-reactivation",
      "retargeting-website-visitors",
      "competitive-takeout",
    ],
  },

  "lead-nurture": {
    promise:
      "Stay useful to leads who aren't ready, and know the day they are.",
    intro:
      "Most leads aren't buying this month. Dialvo keeps in touch with something worth reading, watches for signs of real interest and hands the lead to a rep with the full story the moment it shows.",
    description:
      "Dialvo's lead nurture play sends each not-yet-ready lead relevant follow-up, watches for buying signals and hands warm leads to reps with full context.",
    situation: {
      title: "Not now usually becomes never",
      body: [
        "A lead downloads a guide, attends a webinar or tells a rep to try again next quarter. Then they get the same five scheduled emails as everyone else, or nothing at all.",
        "When they do come back to the question, they've forgotten you. The supplier who stayed in touch gets the call.",
        "And when a nurtured lead does show interest, the handoff is an alert with a score. The rep phones with no idea what the person read or why they care, and the conversation starts cold.",
      ],
    },
    steps: [
      {
        title: "Sort leads by what they care about",
        body: "Dialvo groups leads by role, industry, how they arrived and what they told you, instead of putting everyone in one drip.",
      },
      {
        title: "Send something worth opening",
        body: "Each message picks up from the lead's last interaction: a deeper piece on the topic they downloaded, an answer to the question they asked, a relevant customer example from your knowledge base.",
      },
      {
        title: "Adapt to how they respond",
        body: "A lead who clicks gets more depth. A lead who goes quiet gets fewer, better-spaced touches. There is no fixed calendar to run out of.",
      },
      {
        title: "Watch for buying signals",
        body: "Repeat visits, time on the pricing page, a reply with a question, a new role or funding at their company. You decide which signals count.",
      },
      {
        title: "Hand over warm, with the story",
        body: "When a lead crosses your line, the agent offers a meeting or alerts the owner with what the lead read, clicked and asked, plus a suggested first sentence.",
      },
    ],
    visual: {
      kind: "timeline",
      title: "Nurture · Dana Whitlock",
      note: "Fernhill Logistics",
      steps: [
        {
          when: "3 Mar",
          channel: "Email",
          text: "Sent the routing guide she asked about",
          done: true,
        },
        {
          when: "19 Mar",
          channel: "Email",
          text: "Opened twice, clicked the case example",
          done: true,
        },
        {
          when: "2 Apr",
          channel: "Site",
          text: "Pricing page, two visits in a day",
          done: true,
        },
        {
          when: "2 Apr",
          channel: "Email",
          text: "Agent offered a call; she picked Friday 11:00",
          done: true,
        },
        {
          when: "2 Apr",
          channel: "Slack",
          text: "Owner briefed with what she read and asked",
        },
      ],
      foot: "Sample lead history. All made up.",
    },
    channels: ["email", "social", "messages"],
    features: [
      "multi-channel-sequences",
      "ai-personalisation",
      "website-visitor-tracking",
      "smart-replies",
      "knowledge-base",
    ],
    setup: [
      "Sync the leads to nurture from your CRM, with their stage and source.",
      "Add the articles, guides and examples agents can draw on.",
      "Define the signals that mean a lead is ready for a rep.",
      "Set how often any one person can hear from you.",
    ],
    faqs: [
      {
        q: "How is this different from a drip campaign?",
        a: "A drip sends the same emails on the same days to everyone. Here each message is written for one lead from their history, and the timing follows their behaviour.",
      },
      {
        q: "How often will leads hear from us?",
        a: "As often as you allow. You set a cap per person and a minimum gap between touches, and every email has an unsubscribe link.",
      },
      {
        q: "What does the rep get at handoff?",
        a: "A short brief: who the lead is, what they engaged with, the questions they asked and a suggested opener. It's on the CRM record and in Slack.",
      },
    ],
    related: ["lead-reactivation", "closed-lost", "speed-to-lead"],
  },

  "lead-reactivation": {
    promise: "Turn the leads already in your CRM back into pipeline.",
    intro:
      "You've paid for thousands of leads that were worked once and forgotten. Dialvo goes back through them, finds the ones whose situation has changed and gives each a specific reason to pick the conversation up.",
    description:
      "Dialvo's lead reactivation play works through dormant CRM leads, finds those whose situation has changed and re-engages each with a specific, researched reason.",
    situation: {
      title: "Your CRM is full of pipeline nobody is working",
      body: [
        "Marketing sourced them, sales tried them once, and then the quarter ended and attention moved to the next list. Those leads cost real money and most have never had a second look.",
        'The occasional "checking in" blast to the whole stale segment gets ignored, because it gives nobody a reason to answer.',
        "Meanwhile things change. People are promoted, companies raise money, the tool they chose instead of yours disappoints. Each change is an opening that nobody on your team has time to spot.",
      ],
    },
    steps: [
      {
        title: "Start from your CRM",
        body: "Dialvo reads lead and opportunity history: when they were last contacted, how far they got and what they said.",
      },
      {
        title: "Pick the leads where timing has changed",
        body: "Each dormant lead is checked against fresh signals such as a new job, new funding, hiring in the relevant team or a return visit to your site. Bounced addresses and people who opted out are dropped.",
      },
      {
        title: "Write around what's new",
        body: 'The message refers to the earlier conversation and the change: "when we spoke in May you were mid-migration; I see the new warehouse has opened since." No "just bumping this".',
      },
      {
        title: "Follow up across email and LinkedIn",
        body: "A short sequence from the original rep's inbox and profile, adjusting to opens and replies. Replies are handled and meetings booked.",
      },
      {
        title: "Keep cycling",
        body: "The play runs in the background. As signals appear on other dormant leads, they join it. Reps only see a lead once it's warm again.",
      },
    ],
    visual: {
      kind: "list",
      title: "Dormant leads",
      note: "matched to new signals",
      rows: [
        {
          name: "Tidewater Clinics",
          detail: "Last touch 8 months ago · new ops director",
          tag: "Sequence live",
          strong: true,
        },
        {
          name: "Calder & Pine",
          detail: "Went quiet after demo · hiring 3 sales roles",
          tag: "Drafted",
        },
        {
          name: "Oakline Studio",
          detail: "Asked to revisit in Q2 · back on pricing page",
          tag: "Replied",
          strong: true,
        },
        {
          name: "Brightwell Foods",
          detail: "No change found",
          tag: "Waiting",
        },
      ],
      foot: "Sample list. All made up.",
    },
    channels: ["email", "social"],
    features: [
      "crm-integration",
      "company-and-lead-database",
      "deep-research",
      "ai-personalisation",
      "multi-channel-sequences",
    ],
    setup: [
      "Connect your CRM and choose which stages and ages count as dormant.",
      "Exclude open opportunities, customers and anyone who opted out.",
      "Pick the signals that make a lead worth another try.",
      "Decide whether messages come from the original owner or a new one.",
    ],
    faqs: [
      {
        q: "Will it email people who unsubscribed?",
        a: "No. Opt-outs recorded in Dialvo or your CRM are excluded before a lead can enter the play.",
      },
      {
        q: "Our old data is a mess. Does that matter?",
        a: "Less than you'd think. Contact details are re-checked before sending, and leads whose contact has left the company are flagged so you can find the replacement.",
      },
      {
        q: "How is this different from nurture?",
        a: "Nurture keeps in touch with leads who are still in play. Reactivation goes back to leads everyone stopped working, and only contacts them when there's a new reason.",
      },
    ],
    related: ["closed-lost", "lead-nurture", "outbound-lead-generation"],
  },

  "retargeting-website-visitors": {
    promise: "Follow up with the accounts on your site while they still care.",
    intro:
      "A buyer reads your pricing page and leaves without filling in a form. Dialvo identifies the company, finds the right people, and reaches out the same day about what they were looking at.",
    description:
      "Dialvo identifies the companies visiting your website, researches them and sends relevant email and LinkedIn outreach the same day, based on the pages they read.",
    situation: {
      title: "Your best leads visited, said nothing and left",
      body: [
        "Only a small share of visitors ever fill in a form. The rest include buyers who were comparing you with two other suppliers this afternoon.",
        "Retargeting ads buy impressions, not conversations. Visitor reports land in a dashboard somebody checks on Fridays. By then the shortlist has been drawn up without you.",
        "You already paid for that traffic. Turning more of it into conversations is the cheapest pipeline you can get.",
      ],
    },
    steps: [
      {
        title: "Identify who's visiting",
        body: "A small script on your site matches visits to companies, and to known contacts when they've clicked through from your emails or filled in a form before.",
      },
      {
        title: "Keep only the visits that matter",
        body: "Accounts are checked against your ideal customer and scored by what they did: pricing and comparison pages count for more than a blog post.",
      },
      {
        title: "Find the right people",
        body: "For a matching company, Dialvo finds the likely buyers by role and checks whether anyone is already in your CRM or in an open deal.",
      },
      {
        title: "Write about what they came for",
        body: 'The agent researches the account and writes a message tied to the topic they read, without the creepy "I saw you on our site at 2:14".',
      },
      {
        title: "Follow up and hand over",
        body: "Email and LinkedIn touches adapt to engagement. Replies are answered, meetings booked, and hot accounts are flagged to the account owner.",
      },
    ],
    visual: {
      kind: "list",
      title: "Visitors today",
      note: "matching your ideal customer",
      rows: [
        {
          name: "Fernhill Logistics",
          detail: "Pricing · Integrations · 3 visits this week",
          tag: "Sequence sent",
          strong: true,
        },
        {
          name: "Juniper Payroll",
          detail: "Compare page · open deal with Tom",
          tag: "Rep alerted",
          strong: true,
        },
        {
          name: "Calder & Pine",
          detail: "Case examples · first visit",
          tag: "Researching",
        },
        {
          name: "Unknown ISP",
          detail: "Blog post · no company match",
          tag: "Ignored",
        },
      ],
      foot: "Sample visitors. All made up.",
    },
    channels: ["email", "social", "chat"],
    features: [
      "website-visitor-tracking",
      "lead-qualification",
      "deep-research",
      "multi-channel-sequences",
      "slack-integration",
    ],
    setup: [
      "Add the Dialvo script to your site and update your cookie notice.",
      "Mark your high-intent pages: pricing, comparison, booking.",
      "Set the fit criteria an account must meet before outreach.",
      "Choose what happens for accounts already owned by a rep.",
    ],
    faqs: [
      {
        q: "Does it identify individual people?",
        a: "It identifies companies. A visit is tied to a named person only when they are already known to you, for example from a form or a link in your own email.",
      },
      {
        q: "What about privacy rules?",
        a: "You control the script through your consent banner, and visits from people who decline tracking aren't recorded. The rules differ by country, so check what applies where you sell.",
      },
      {
        q: "What if the account is already in a deal?",
        a: "The agent doesn't write to them. The deal owner gets a note that the account is back on the site, and which pages it read.",
      },
    ],
    related: ["speed-to-lead", "outbound-lead-generation", "lead-nurture"],
  },

  "closed-lost": {
    promise: "Go back to the deals you lost when the reason has changed.",
    intro:
      "Closed-lost prospects already know your product and went a long way with you. Dialvo reads why each deal died, watches for the moment that reason stops being true and reopens the conversation from where it paused.",
    description:
      "Dialvo's closed-lost play reads why each deal was lost, watches for changes that reopen it and re-engages the right contact with a specific reason to reconsider.",
    situation: {
      title: "The warmest list you own is the one nobody calls",
      body: [
        "These people sat through the demo, saw the pricing and argued your case internally. Then the budget went, the timing slipped or they chose someone else. The deal was marked lost and never looked at again.",
        "Reps are measured on open pipeline, so they don't go back. Marketing has no campaign for it. All the effort that went into each deal is written off.",
        'But "no" has a shelf life. Budgets reset each year. Champions move to new companies. The rival they chose puts its prices up. You\'ve shipped the feature they asked for.',
      ],
    },
    steps: [
      {
        title: "Read the history",
        body: "Dialvo pulls each lost opportunity from your CRM: the stated reason, the people involved, how far it got and the notes from the last calls.",
      },
      {
        title: "Match the reason to a trigger",
        body: "Lost on budget: a new financial year or funding. Lost on a missing feature: your release notes. Lost to a competitor: their renewal window. Champion left: their new employer.",
      },
      {
        title: "Write as a continuation",
        body: "The message picks up the thread: what you discussed, what's different now and one clear next step. A champion at a new company gets a different note from the one who stayed.",
      },
      {
        title: "Run the follow-up",
        body: "Email and LinkedIn from the original owner where possible, with replies handled and meetings booked back onto their calendar.",
      },
      {
        title: "Reopen the opportunity",
        body: "When the contact agrees to talk, the rep gets the old deal's history and the new context together, and the CRM is updated.",
      },
    ],
    visual: {
      kind: "brief",
      title: "Closed-lost review",
      note: "Calder & Pine",
      heading: "Lost in June: chose a rival on price",
      facts: [
        ["Stage reached", "Proposal sent"],
        ["Champion", "Head of Operations, still in role"],
        ["What changed", "Rival announced a price rise for renewals"],
        ["Renewal window", "Opens in about 8 weeks"],
      ],
      points: [
        "Lead with total cost over two years, including the rise.",
        "Mention the reporting feature they asked for; it shipped in October.",
      ],
      foot: "Sample brief. All made up.",
    },
    channels: ["email", "social"],
    features: [
      "crm-integration",
      "deep-research",
      "ai-personalisation",
      "multi-channel-sequences",
      "playbooks",
    ],
    setup: [
      "Connect your CRM and make sure lost reasons are filled in.",
      "Tell Dialvo what has changed in your product and pricing.",
      "Set a minimum gap since the deal closed before anyone is contacted.",
      "Choose which lost reasons are worth revisiting and which aren't.",
    ],
    faqs: [
      {
        q: "What if our lost reasons are blank or vague?",
        a: "The agent reads call notes and emails on the opportunity to infer the reason, and shows you its reading so you can correct it before anything is sent.",
      },
      {
        q: "Won't this annoy people who already said no?",
        a: "It only writes when something relevant has changed, says so in the first line and makes it easy to decline. Anyone who opts out is removed for good.",
      },
      {
        q: "Who is the message from?",
        a: "By default the rep who ran the original deal, from their own inbox, so the thread feels continuous. You can assign a different owner.",
      },
    ],
    related: ["lead-reactivation", "competitive-takeout", "lead-nurture"],
  },

  "competitive-takeout": {
    promise: "Win the customers your competitors are about to lose.",
    intro:
      "Somewhere in a rival's customer base are companies counting down to the end of their contract. Dialvo finds them, waits for the moment they have a reason to look around and makes your case around their problem.",
    description:
      "Dialvo's competitive takeout play finds companies using a competitor, watches for signs they're open to switching and reaches them with messaging built on their pain.",
    situation: {
      title: "Everyone knows the rival's weak spots. Nobody acts on them.",
      body: [
        "Your reps hear the same complaints about a competitor on every call. That knowledge lives in a battle card that's only opened when a prospect brings the competitor up.",
        'The usual proactive attempt is a "why we\'re better" email to everyone using the other product. Nobody changes supplier because a stranger said so.',
        "People switch when something changes for them: a price rise, a bad support month, a new boss who used something else. Reach them then and the conversation is easy. Reach them at random and it's noise.",
      ],
    },
    steps: [
      {
        title: "Map who uses the competitor",
        body: "Dialvo builds a list of likely customers from technology data, job posts that name the tool, public integrations and review-site activity, then filters it to your ideal customer.",
      },
      {
        title: "Watch for an opening",
        body: "A leadership change, critical reviews, a pricing change, hiring that suggests they've outgrown the tool, or an approaching renewal if you know it.",
      },
      {
        title: "Lead with their problem",
        body: "If the rival is known for slow support, the message is about how you handle support. If a feature is missing, it's about that gap. It stays factual and never runs the other company down.",
      },
      {
        title: "Run the sequence",
        body: "Email and LinkedIn touches from your own accounts, with replies handled and switching questions answered from your battle cards.",
      },
      {
        title: "Bring in a rep for the switch",
        body: "When someone wants to talk about moving, a meeting is booked and the rep gets the account's setup, the trigger and the objections so far.",
      },
    ],
    visual: {
      kind: "list",
      title: "Takeout · accounts on a rival tool",
      note: "sorted by opening",
      rows: [
        {
          name: "Brightwell Foods",
          detail: "New COO joined from one of your customers",
          tag: "Sequence live",
          strong: true,
        },
        {
          name: "Tidewater Clinics",
          detail: "Three critical reviews of rival support this month",
          tag: "Drafted",
        },
        {
          name: "Harbor Fitness",
          detail: "Hiring for a role that names both tools",
          tag: "Researching",
        },
        {
          name: "Oakline Studio",
          detail: "No opening yet",
          tag: "Watching",
        },
      ],
      foot: "Sample accounts. All made up.",
    },
    channels: ["email", "social"],
    features: [
      "live-web-search-prospecting",
      "review-site-intent",
      "deep-research",
      "knowledge-base",
      "multi-channel-sequences",
    ],
    setup: [
      "Name the competitors and add your battle cards to the knowledge base.",
      "List the honest reasons customers switch to you, and the ones they don't.",
      "Choose the triggers that count as an opening.",
      "Add your migration offer or switching help, if you have one.",
    ],
    faqs: [
      {
        q: "How does it know who uses a competitor?",
        a: "From public sources: technology data, job adverts, integration listings and reviews. It's a well-founded guess, shown with its evidence, and the first message never assumes it's certain.",
      },
      {
        q: "Will the agent criticise competitors?",
        a: "No. It writes about the prospect's problem and how you solve it, using only claims in your knowledge base. You can require approval for every message in this play.",
      },
      {
        q: "What if we don't know their renewal date?",
        a: "The other triggers still work. If a prospect mentions a renewal date in a reply, it's saved to the CRM and the follow-up is timed around it.",
      },
    ],
    related: ["closed-lost", "outbound-lead-generation", "lead-reactivation"],
  },

  "event-registration": {
    promise: "Fill your event with the accounts you most want in the room.",
    intro:
      "A full room is only worth something if the right people are in it. Dialvo builds the invite list from your pipeline and target accounts, and sends each person an invitation that says why this event is worth their time.",
    description:
      "Dialvo's event registration play builds a targeted invite list and sends each person a personal invitation by email and LinkedIn, with follow-ups until they register.",
    situation: {
      title: "A mass invite fills seats, not pipeline",
      body: [
        "Marketing emails the whole database. Registrations come in below target, and many are from people who will never buy. Then the scramble starts.",
        "Reps are asked to invite their key accounts personally. They send a few notes in the first week and are back on live deals by the second.",
        "The event costs the same whoever turns up. The return depends almost entirely on which accounts came, and that is the part left to chance.",
      ],
    },
    steps: [
      {
        title: "Build the list from pipeline",
        body: "Dialvo picks the people for whom attending could move a deal or start one: open opportunities, target accounts, recent closed-lost and customers ready to expand, filtered by role, region and topic.",
      },
      {
        title: "Give each person their reason",
        body: "A sales leader hears about the session on forecasting; an operations lead hears about the workflow one. The invite names the session and why it suits them.",
      },
      {
        title: "Send from the person they know",
        body: "Invites go from the account owner's inbox and LinkedIn profile, so they read as a personal note with a registration link.",
      },
      {
        title: "Follow up until they decide",
        body: "Opened but didn't register? A different angle a few days later. Registered? A confirmation and a reminder before the day. Declined? Offered the recording.",
      },
      {
        title: "Hand over to the event plays",
        body: "Registrations sync to your CRM. After the event, attendees and no-shows move into the follow-up and no-show plays.",
      },
    ],
    visual: {
      kind: "email",
      title: "Invitation",
      note: "from Tom's inbox",
      from: "Tom Reyes <tom@northwind.example>",
      to: "Dana Whitlock",
      subject: "A seat for you on the 14th",
      body: [
        "Hi Dana,",
        "We're running a morning session on the 14th about cutting missed deliveries. One talk is from an operations lead who rebuilt their routing after opening a second depot, which is close to what you described in March.",
        "Shall I hold a place for you? It's 45 minutes, online.",
        "Tom · Northwind Agency",
      ],
      foot: "Unsubscribe link and sender details added to every email.",
    },
    channels: ["email", "social", "messages"],
    features: [
      "ai-personalisation",
      "multi-channel-sequences",
      "sequence-builder",
      "crm-integration",
      "playbooks",
    ],
    setup: [
      "Add the event details, sessions and registration link.",
      "Choose who to invite: stages, segments, regions and roles.",
      "Decide who each invite comes from.",
      "Set the cut-off date and how many reminders to send.",
    ],
    faqs: [
      {
        q: "Does it work for in-person events and webinars?",
        a: "Both. For in-person events, the list can be limited by location, and the invite includes the practical details.",
      },
      {
        q: "Do we need a particular event tool?",
        a: "No. Dialvo links to your existing registration page and reads registrations from your CRM, a CSV or the API.",
      },
      {
        q: "Can reps see who was invited?",
        a: "Yes. Every invite, open and registration is on the contact's CRM record, and owners get a Slack note when a key account signs up.",
      },
    ],
    related: ["event-follow-up", "event-no-show", "outbound-lead-generation"],
  },

  "event-follow-up": {
    promise: "Turn attendees into meetings before the event fades.",
    intro:
      "The day after an event decides whether it produced pipeline. Dialvo writes to every attendee within hours, about the session they sat in and the conversation they had, and books the meetings while your name is fresh.",
    description:
      "Dialvo's event follow-up play writes to every attendee within hours, referring to the sessions they attended and notes from the stand, and books meetings.",
    situation: {
      title: "The follow-up loses more than the event cost",
      body: [
        "The attendee list sits in a spreadsheet for a week while the team catches up on everything that waited during the event.",
        'When the follow-up comes, it\'s "great to meet you at the show" to everyone, including people nobody met. Each attendee gets a dozen of those from other exhibitors.',
        "The useful details (who asked about what, who wanted pricing, who brought their boss) stay in a rep's notebook and never reach the message.",
      ],
    },
    steps: [
      {
        title: "Load the list the same day",
        body: "Import attendance from your event tool, badge scans or a CSV, plus any notes reps captured. Dialvo matches people to CRM records and owners.",
      },
      {
        title: "Sort by what happened",
        body: "Had a conversation at the stand, attended a session, asked a question or simply came. Each group gets a different kind of follow-up.",
      },
      {
        title: "Write the continuation",
        body: "The message refers to the session they attended or the point they raised, adds one useful thing and suggests a next step.",
      },
      {
        title: "Cover the whole list",
        body: "Your team spoke to a fraction of the room. The agent writes to everyone else too, so the rest of the attendee list isn't wasted.",
      },
      {
        title: "Book and brief",
        body: "Replies are handled and meetings booked with the account owner, who gets the event context. The hottest conversations are flagged to a rep the same day.",
      },
    ],
    visual: {
      kind: "list",
      title: "Event follow-up",
      note: "day one after the event",
      rows: [
        {
          name: "Dana Whitlock",
          detail: "Asked about depot routing at the stand",
          tag: "Meeting booked",
          strong: true,
        },
        {
          name: "Marcus Hale",
          detail: "Attended the pricing session",
          tag: "Replied",
          strong: true,
        },
        {
          name: "Lena Ortiz",
          detail: "Attended, no conversation",
          tag: "Email sent",
        },
        {
          name: "Sam Okafor",
          detail: "Registered, didn't attend",
          tag: "No-show play",
        },
      ],
      foot: "Sample attendees. All made up.",
    },
    channels: ["email", "social"],
    features: [
      "ai-personalisation",
      "smart-replies",
      "multi-channel-sequences",
      "crm-integration",
      "playbooks",
    ],
    setup: [
      "Export attendance and session data from your event tool.",
      "Give reps a quick way to capture notes at the stand.",
      "Add the recordings, slides and offers agents can share.",
      "Choose who follows up with accounts that have no owner.",
    ],
    faqs: [
      {
        q: "How fast does the follow-up go out?",
        a: "As soon as the list is loaded and, if you've asked for it, approved. Most teams load it the evening the event ends.",
      },
      {
        q: "What if we have no notes on someone?",
        a: "The agent uses what it does know: the sessions they attended, their role and their company. It won't pretend a conversation took place.",
      },
      {
        q: "Does Dialvo call attendees?",
        a: "No. Dialvo never makes outbound calls. Follow-up is by email, and by text only for people who opted in, for example on the registration form.",
      },
    ],
    related: [
      "event-no-show",
      "event-registration",
      "automated-meeting-scheduling",
    ],
  },

  "event-no-show": {
    promise: "Win back the people who registered and didn't make it.",
    intro:
      "Someone who signed up and missed your event still had a reason to register. Dialvo follows up around what they wanted to learn and offers a conversation, not just a recording link.",
    description:
      "Dialvo's event no-show play follows up with registrants who didn't attend, built around the sessions they chose, and turns that interest into meetings.",
    situation: {
      title: "No-shows are treated as lost. They raised their hand.",
      body: [
        "A large share of people who register for any event don't attend. They got busy; a meeting ran over. Their interest in the topic didn't go away.",
        'Most teams send them nothing, or a "thanks for joining us" email that proves nobody checked. At best they get a recording link, which joins the list of things they mean to watch.',
        "You paid to get each registration. Writing off the ones who missed the hour throws away a good part of the event's return.",
      ],
    },
    steps: [
      {
        title: "Separate no-shows from attendees",
        body: "Dialvo compares registrations with attendance as soon as the event ends, so nobody is thanked for coming when they didn't.",
      },
      {
        title: "Look at what they signed up for",
        body: "The session they chose, their answers on the form and their role tell the agent what they hoped to learn.",
      },
      {
        title: "Send a short briefing",
        body: "The first message gives the two or three points that matter for someone in their position, with the recording as a resource. It acknowledges they missed it without making a point of it.",
      },
      {
        title: "Ask a real question",
        body: 'The ask is whether the problem behind the topic is worth a conversation, not "did you watch it yet?".',
      },
      {
        title: "Carry on or let go",
        body: "Interested no-shows are booked with a rep. The rest move to nurture or the next event's invite list, and opt-outs are honoured.",
      },
    ],
    visual: {
      kind: "email",
      title: "Follow-up",
      note: "to a registrant who missed it",
      from: "Tom Reyes <tom@northwind.example>",
      to: "Sam Okafor",
      subject: "The short version of Thursday",
      body: [
        "Hi Sam,",
        "Thursday's session clashed with something for a lot of people, so here's the short version for a finance lead: the two checks that caught most payroll errors, and the template the speaker used. The recording is linked below if you want the detail.",
        "You mentioned on the form that month-end takes your team four days. Is that worth a quick call?",
        "Tom · Northwind Agency",
      ],
      foot: "Unsubscribe link and sender details added to every email.",
    },
    channels: ["email", "social"],
    features: [
      "ai-personalisation",
      "multi-channel-sequences",
      "smart-replies",
      "knowledge-base",
      "crm-integration",
    ],
    setup: [
      "Sync registrations and attendance from your event tool or a CSV.",
      "Add the recording, slides and a short summary of each session.",
      "Decide how soon after the event the first message goes.",
      "Choose where uninterested no-shows go next.",
    ],
    faqs: [
      {
        q: "Isn't a recording link enough?",
        a: "It's a start, but it asks the person to find an hour. A short summary for their role and a direct question gets a conversation going without it.",
      },
      {
        q: "How many times will it follow up?",
        a: "You decide. A common setup is the briefing, one follow-up with a different angle and then a move to nurture.",
      },
      {
        q: "Does it treat customers and prospects differently?",
        a: "Yes. Customers who missed a session get a note from their account owner, and where it's relevant the expansion play takes over.",
      },
    ],
    related: ["event-follow-up", "event-registration", "lead-nurture"],
  },
} satisfies Partial<Record<PlaySlug, PlayContent>>;
