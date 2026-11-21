import type { FeatureSlug } from "./catalog";
import type { FeatureContent } from "./types";

// Platform features: data and lead generation, outreach and workflows.
// People and businesses in the sample panels are made up.

export const DATA_OUTREACH_FEATURES = {
  "company-and-lead-database": {
    tagline: "Prospect data that's checked on the day you use it.",
    intro:
      "A bought list starts going stale the day it arrives: people change jobs, companies are acquired, inboxes close. Dialvo's database of companies and contacts is re-checked at the moment an agent is about to reach out, so your outreach lands with the right person.",
    description:
      "Dialvo's company and lead database gives agents current firmographics, contacts and buying signals, re-checked at the moment of outreach. Bring your own lists too.",
    capabilities: [
      {
        title: "Search by what matters to you",
        body: "Filter companies by industry, size, location, growth and the tools they use, and contacts by role, seniority and department.",
      },
      {
        title: "Checked before every send",
        body: "Job titles and email addresses are verified again just before a sequence starts. A contact who has moved on is replaced or dropped.",
      },
      {
        title: "Signals on the record",
        body: "Funding, hiring, leadership changes and new technology sit on the company record itself, so the reason to write is next to the person to write to.",
      },
      {
        title: "Your own lists welcome",
        body: "Sync leads from your CRM or upload a CSV. Dialvo fills the gaps, removes duplicates and flags the rows it can't verify.",
      },
      {
        title: "The buying group, not one name",
        body: "For each account you get the likely decision maker, the day-to-day user and the person who signs it off, so sequences can speak to each differently.",
      },
      {
        title: "Lead credits you can see",
        body: "Each verified contact uses one lead credit from your plan. You see the balance before a list is built, and unverifiable contacts cost nothing.",
      },
    ],
    fit: [
      "Every outbound play starts here. The outbound agents draw their audience from the database, and the research agent uses the company record as its starting point.",
      "Because the data is shared, a change is seen everywhere. When a contact replies that they've left the company, the record is updated, the sequence stops and the account is flagged for a new contact.",
    ],
    visual: {
      kind: "list",
      title: "Audience · multi-site gyms, UK",
      note: "checked today",
      rows: [
        {
          name: "Harbor Fitness",
          detail: "2 sites · 60 staff · opened Leith site last month",
          tag: "Verified",
          strong: true,
        },
        {
          name: "Northgate Leisure",
          detail: "5 sites · hiring an operations manager",
          tag: "Verified",
          strong: true,
        },
        {
          name: "Riverside Health Club",
          detail: "1 site · contact left in August",
          tag: "Replaced",
        },
        {
          name: "Peak Climbing",
          detail: "3 sites · email could not be verified",
          tag: "Skipped",
        },
      ],
      foot: "Sample audience. All made up.",
    },
    controls: [
      {
        title: "Exclusion lists",
        body: "Customers, open deals, competitors and anyone who opted out are kept out of every audience automatically.",
      },
      {
        title: "Credit limits",
        body: "Cap how many lead credits a play may use each month, so a broad search can't empty the allowance.",
      },
      {
        title: "Know the limits",
        body: "Coverage varies by country and industry, and no database is complete. Dialvo shows how many matches it could verify before you commit.",
      },
    ],
    related: [
      "live-web-search-prospecting",
      "lead-qualification",
      "deep-research",
    ],
    plays: ["outbound-lead-generation", "lead-reactivation"],
  },

  "live-web-search-prospecting": {
    tagline: "Describe the accounts you want. Get a list with the reasons.",
    intro:
      'Some of the best audiences can\'t be built with filters: "logistics firms that opened a new depot this year", "clinics advertising for a practice manager". Dialvo searches the live web for companies that match a plain-English description and shows why each one qualifies.',
    description:
      "Dialvo's live web search builds prospect lists from a plain-English description, using news, job posts and company sites, with the reasoning and sources for each match.",
    capabilities: [
      {
        title: "Plain-English audiences",
        body: "Write the description the way you'd brief a researcher. No query language and no list of industry codes.",
      },
      {
        title: "Built from what's happening now",
        body: "Agents read press releases, job adverts, company announcements, product pages and public filings, not a snapshot from last year.",
      },
      {
        title: "A reason and a source for each match",
        body: "Every company on the list comes with a sentence on why it matched and links to where that was found, so you can check before you spend a credit.",
      },
      {
        title: "Custom signals",
        body: "Save a description as a standing signal. New matches are added to the play as they appear, with no need to rebuild the list each month.",
      },
      {
        title: "Contacts attached",
        body: "Matching companies are joined to the database to find the right people by role, with verified contact details.",
      },
      {
        title: "Fast to refine",
        body: "Tighten or loosen the description and the list is rebuilt in minutes, so testing a new segment is an afternoon's work.",
      },
    ],
    fit: [
      "Web search prospecting feeds the same pipeline as the database: matches go through lead qualification, then to the research agent, then into a sequence. The reason a company matched travels with it, so the first message can open with it.",
      "It is also how plays such as competitive takeout and lead reactivation find their openings: the trigger is a described event, and the agents watch for it.",
    ],
    visual: {
      kind: "brief",
      title: "Prospect search",
      note: "3 of 41 matches",
      heading: '"UK logistics firms that opened a new depot this year"',
      facts: [
        ["Fernhill Logistics", "Opened Doncaster depot in March"],
        ["Calder Freight", "Announced second site near Leeds"],
        ["Tidewater Haulage", "Hiring depot staff in Hull"],
      ],
      points: [
        "Source for each match: company news page or job advert, linked.",
        "Operations and transport leads found for 37 of 41 companies.",
      ],
      foot: "Sample search. All made up.",
    },
    controls: [
      {
        title: "Review before outreach",
        body: "Approve a sample, or the whole list, before any contact is sequenced. Reject a match and the agent learns the pattern.",
      },
      {
        title: "Public sources only",
        body: "Agents read what's publicly available. They don't log in to sites or get behind paywalls.",
      },
      {
        title: "It can be wrong",
        body: "A web match is evidence, not proof. That's why the reasoning is shown, and why outreach never states a guess as fact.",
      },
    ],
    related: [
      "company-and-lead-database",
      "deep-research",
      "review-site-intent",
    ],
    plays: ["outbound-lead-generation", "competitive-takeout"],
  },

  "lead-qualification": {
    tagline: "Every lead checked against your criteria before anyone writes.",
    intro:
      "A list is only as good as the worst lead on it. Before outreach begins, Dialvo checks each lead against the rules you set and reads up to confirm the fit, so your sending volume and your reps' attention go to accounts that could buy.",
    description:
      "Dialvo qualifies every lead before outreach: it checks each one against your criteria and researches fit and timing, whether the lead came from a CSV, your CRM or your website.",
    capabilities: [
      {
        title: "Your definition of a good lead",
        body: "Set the must-haves and the deal-breakers: size, industry, region, tools in use, role, and anything you can describe in a sentence.",
      },
      {
        title: "Any source, one standard",
        body: "CSV uploads, CRM lists, website visitors and web search matches all pass through the same check.",
      },
      {
        title: "Research, not just filters",
        body: 'Where a filter can\'t tell ("sells to consumers", "has an in-house team"), an agent reads the company\'s site and public information to decide.',
      },
      {
        title: "A score with a reason",
        body: "Each lead is marked as a strong fit, a possible fit or not a fit, with a one-line explanation you can read and overrule.",
      },
      {
        title: "Timing as well as fit",
        body: "A good-fit account with a live signal is put ahead of one with nothing happening, so the week's outreach goes where it's likeliest to land.",
      },
      {
        title: "Rejected leads are kept",
        body: "Leads that fail are stored with the reason, not deleted, and are re-checked if your criteria change.",
      },
    ],
    fit: [
      "Qualification sits between finding leads and contacting them. Only leads that pass move on to deep research and into sequences, which keeps credits and inbox reputation for the accounts worth having.",
      "It is separate from inbound qualification, where an agent asks the lead questions in conversation. This check happens before any contact, using what can be found out without asking.",
    ],
    visual: {
      kind: "list",
      title: "Qualification",
      note: "CSV upload · 250 leads",
      rows: [
        {
          name: "Northgate Leisure",
          detail: "5 sites, books by phone, hiring ops",
          tag: "Strong fit",
          strong: true,
        },
        {
          name: "Harbor Fitness",
          detail: "2 sites, new opening last month",
          tag: "Strong fit",
          strong: true,
        },
        {
          name: "Peak Climbing",
          detail: "Already uses an online booking tool",
          tag: "Possible",
        },
        {
          name: "FitKit Supplies",
          detail: "Sells equipment, not memberships",
          tag: "Not a fit",
        },
      ],
      foot: "Sample results. All made up.",
    },
    controls: [
      {
        title: "Editable criteria",
        body: "Change the rules at any time. You can re-run the check on leads already scored.",
      },
      {
        title: "Manual override",
        body: "Move any lead in or out by hand. Your decision sticks and isn't overwritten on the next run.",
      },
      {
        title: "Thresholds per play",
        body: "A broad awareness play might accept possible fits; a play that ends in a rep's call might take strong fits only.",
      },
    ],
    related: [
      "company-and-lead-database",
      "inbound-lead-qualification",
      "deep-research",
    ],
    plays: ["outbound-lead-generation", "retargeting-website-visitors"],
  },

  "website-visitor-tracking": {
    tagline: "Know which companies are on your site, and what they came for.",
    intro:
      "Most visitors leave without telling you who they are. Dialvo matches visits to companies, shows which pages they read and lets your agents act the same day, while the question that brought them is still open.",
    description:
      "Dialvo's website visitor tracking matches visits to companies, shows which pages they read and triggers researched outreach or a rep alert the same day.",
    capabilities: [
      {
        title: "Company identification",
        body: "A small script matches visits to businesses. Traffic from home connections and mobile networks, which can't be tied to a company, is ignored.",
      },
      {
        title: "Known contacts recognised",
        body: "When someone arrives from a link in your email or has filled in a form before, the visit is added to that person's history.",
      },
      {
        title: "Pages weighted by intent",
        body: "Mark pricing, comparison and booking pages as high intent. A visit there counts for more than a read of the blog.",
      },
      {
        title: "Fit checked first",
        body: "Visiting companies go through lead qualification, so agents only act on accounts that match your ideal customer.",
      },
      {
        title: "Straight into a play",
        body: "A qualified visit can start the visitor follow-up play, raise the lead's score in nurture or alert the owner of an open deal.",
      },
      {
        title: "A live view",
        body: "See today's visiting accounts, what they read and what Dialvo did about each one.",
      },
    ],
    fit: [
      "Visitor data is one of the signals every agent shares. The research agent uses the pages read to choose an angle; and the chat agent greets a returning account differently.",
      "The outreach that follows is about the topic, not the tracking. Agents write about the problem the page covers and never quote the visit back at the prospect.",
    ],
    visual: {
      kind: "list",
      title: "Visiting now",
      note: "last 24 hours",
      rows: [
        {
          name: "Fernhill Logistics",
          detail: "Pricing, Integrations · 3rd visit this week",
          tag: "High intent",
          strong: true,
        },
        {
          name: "Juniper Payroll",
          detail: "Compare page · open deal",
          tag: "Owner alerted",
          strong: true,
        },
        {
          name: "Calder & Pine",
          detail: "Two blog posts",
          tag: "Watching",
        },
        {
          name: "Brightwell Foods",
          detail: "Careers page",
          tag: "Ignored",
        },
      ],
      foot: "Sample visitors. All made up.",
    },
    controls: [
      {
        title: "Consent first",
        body: "The script follows your cookie banner. Visitors who decline tracking are not recorded.",
      },
      {
        title: "Companies, not strangers",
        body: "Dialvo does not unmask anonymous individuals. A person is only named when they are already known to you.",
      },
      {
        title: "Local rules apply",
        body: "Tracking law differs by country. You decide where the script runs, and you can turn it off by region.",
      },
    ],
    related: [
      "lead-qualification",
      "review-site-intent",
      "multi-channel-sequences",
    ],
    plays: ["retargeting-website-visitors", "lead-nurture"],
  },

  "multi-channel-sequences": {
    tagline: "One conversation, carried across every channel.",
    intro:
      "Buyers don't live in one inbox. Dialvo runs email, LinkedIn, texts, WhatsApp, chat and calls as a single sequence in which every touch knows what happened on the others, so nobody is asked the same thing twice.",
    description:
      "Dialvo's multi-channel sequences coordinate email, LinkedIn, SMS, WhatsApp, chat and calls in one conversation, with shared context and automatic fallback between channels.",
    capabilities: [
      {
        title: "Every channel in one sequence",
        body: "Email from your inbox, LinkedIn from your rep's profile, and SMS and WhatsApp for people who opted in. Dialvo never makes outbound calls.",
      },
      {
        title: "Each touch builds on the last",
        body: "The follow-up email refers to the LinkedIn message; the text after a missed call says what the call was about. The thread stays intact.",
      },
      {
        title: "Automatic fallback",
        body: "If an email bounces, the sequence moves to LinkedIn. If a call isn't answered, a text follows. You set the order; the agent handles the switch.",
      },
      {
        title: "Stops when it should",
        body: "A reply on any channel pauses the rest. A booked meeting ends the sequence. An opt-out removes the person everywhere at once.",
      },
      {
        title: "The right channel for the motion",
        body: "Cold outbound uses email and LinkedIn, with calls made by reps. Inbound and customer sequences can add AI voice, SMS and WhatsApp, because those people asked or agreed.",
      },
      {
        title: "Follows the buyer's preference",
        body: "Once someone answers on a channel, the conversation continues there.",
      },
    ],
    fit: [
      "Sequences are how plays are delivered. A play supplies the audience and the research; the sequence decides what goes out, where and when. The same engine runs a three-step speed-to-lead follow-up and a six-week outbound campaign.",
      "Agents write each step when it's due, not in advance, so a message sent in week three reflects what has happened since week one.",
    ],
    visual: {
      kind: "timeline",
      title: "Sequence · Marcus Hale",
      note: "outbound",
      steps: [
        {
          when: "Day 1",
          channel: "Email",
          text: "Opening note about the second site. Opened.",
          done: true,
        },
        {
          when: "Day 3",
          channel: "LinkedIn",
          text: "Connection note approved by Priya and sent.",
          done: true,
        },
        {
          when: "Day 6",
          channel: "Email",
          text: "Short follow-up with a relevant example. Clicked.",
          done: true,
        },
        {
          when: "Day 8",
          channel: "LinkedIn",
          text: "Follow-up message drafted for Priya to send.",
        },
        {
          when: "Day 12",
          channel: "Email",
          text: "Last note, only if there's still no reply.",
        },
      ],
      foot: "Sample sequence. All made up.",
    },
    controls: [
      {
        title: "Consent rules per channel",
        body: "SMS, WhatsApp and AI voice steps are skipped for anyone who hasn't opted in. The sequence can't override that.",
      },
      {
        title: "Frequency caps",
        body: "Set the most touches per person per week across all channels combined.",
      },
      {
        title: "Send windows",
        body: "Each channel has its own hours, in the recipient's time zone.",
      },
      {
        title: "LinkedIn approval",
        body: "Messages from a rep's profile wait for that rep's approval unless they choose otherwise.",
      },
    ],
    related: ["sequence-builder", "smart-replies", "ai-personalisation"],
    plays: ["outbound-lead-generation", "lead-nurture", "speed-to-lead"],
  },

  "sequence-builder": {
    tagline: "Design the outreach once. The agents run every step.",
    intro:
      "The sequence builder is where you decide what happens and when: which channel, how long to wait, what to do if they open, click, reply or stay silent. The agents then carry it out without creating a task list for your team.",
    description:
      "Dialvo's sequence builder sets the steps, timing, channels and branches for outreach, with send limits and approvals. Agents write and send every step.",
    capabilities: [
      {
        title: "Steps and waits",
        body: "Add a step, pick the channel, set the gap. Timings can be fixed or relative to an event such as a webinar date or a renewal.",
      },
      {
        title: "Branches on behaviour",
        body: 'Opened but no reply, clicked a link, visited the pricing page, said "not now": each can lead to a different next step.',
      },
      {
        title: "Guidance, not templates",
        body: "For each step you write what the message should achieve and any points to include. The agent writes it for each person from their research.",
      },
      {
        title: "Preview with real leads",
        body: "Before launch, see the actual messages the sequence would send to a sample of your audience, and adjust.",
      },
      {
        title: "Start from a playbook",
        body: "Every playbook comes with a sequence you can use as it is or edit.",
      },
      {
        title: "Test two versions",
        body: "Split the audience between two openings or two timings and compare replies and meetings, not just opens.",
      },
    ],
    fit: [
      "The builder gives the outbound and follow-up agents their shape. It doesn't replace their judgement: within a step, the agent still decides the angle and the wording for each person from the research and the conversation so far.",
      "Rep steps appear as a task or an approval request. Everything else runs without anyone on your team touching it.",
    ],
    visual: {
      kind: "timeline",
      title: "Builder · Closed-lost revisit",
      note: "5 steps",
      steps: [
        {
          when: "Step 1",
          channel: "Email",
          text: "Pick up the thread: what's changed since the deal closed.",
          done: true,
        },
        {
          when: "+3 days",
          channel: "LinkedIn",
          text: "If opened, no reply: short note from the original owner.",
          done: true,
        },
        {
          when: "+4 days",
          channel: "Email",
          text: "If clicked pricing: send the two-year cost comparison.",
          done: true,
        },
        {
          when: "+5 days",
          channel: "LinkedIn",
          text: "If still engaged: a LinkedIn task for the owner.",
        },
        {
          when: "+7 days",
          channel: "Email",
          text: "Otherwise: a polite close, back to watching.",
        },
      ],
      foot: "Sample sequence design.",
    },
    controls: [
      {
        title: "Daily send limits",
        body: "Per inbox, per profile and per play, so no account sends more than is healthy.",
      },
      {
        title: "Approval per step",
        body: 'Mark any step as "needs approval" and it waits for a person before going out.',
      },
      {
        title: "Version history",
        body: "Changes are saved as versions. Leads already in a sequence finish on the version they started on unless you move them.",
      },
    ],
    related: ["multi-channel-sequences", "playbooks", "ai-personalisation"],
    plays: ["event-registration", "closed-lost", "lead-nurture"],
  },

  "smart-replies": {
    tagline: "Every reply read and answered while the interest is live.",
    intro:
      "A reply that sits for a day is a meeting half lost. Dialvo reads each one as it arrives, works out what the person means and takes the next step: an answer, a booking, a handoff or a clean opt-out.",
    description:
      "Dialvo's smart replies read every response as it arrives, classify the intent, answer questions and objections from your knowledge base, book meetings and honour opt-outs.",
    capabilities: [
      {
        title: "Sorted by intent",
        body: "Interested, has a question, raised an objection, not now, wrong person, out of office, unsubscribe. Each reply is labelled, with the reason.",
      },
      {
        title: "Questions answered",
        body: "Pricing, integrations, how it works: the agent answers from your knowledge base in your tone, and says so when it doesn't know.",
      },
      {
        title: "Common objections handled",
        body: '"We already use something", "no budget until next year", "send me more information": answered with your positioning, without pushing.',
      },
      {
        title: "Meetings booked in the thread",
        body: "When someone says yes, the agent offers times from the right rep's calendar and sends the invite.",
      },
      {
        title: "Referrals followed",
        body: '"Talk to my colleague" starts a new, properly introduced conversation with that person. Out-of-office replies reschedule the next touch.',
      },
      {
        title: "Opt-outs honoured at once",
        body: 'Any form of "stop" removes the person from every sequence and records it in Dialvo and your CRM.',
      },
    ],
    fit: [
      "Smart replies close the loop on every outbound and nurture play. The email and social agents start conversations; this is what keeps them moving at any hour, so a reply at 7pm gets its answer at 7pm.",
      "It also decides when to stop being an agent. Sensitive, angry or unusual replies go to a person with the thread and a suggested response.",
    ],
    visual: {
      kind: "list",
      title: "Replies",
      note: "this morning",
      rows: [
        {
          name: "Marcus Hale",
          detail: '"Thursday works. Can you send an invite?"',
          tag: "Booked",
          strong: true,
        },
        {
          name: "Dana Whitlock",
          detail: '"Does it connect to our routing software?"',
          tag: "Answered",
          strong: true,
        },
        {
          name: "Sam Okafor",
          detail: '"Not this quarter. Try me in January."',
          tag: "Snoozed",
        },
        {
          name: "Lena Ortiz",
          detail: '"Please take me off your list."',
          tag: "Opted out",
        },
        {
          name: "Ivo Marsh",
          detail: '"I have a complaint about an invoice."',
          tag: "Sent to a person",
        },
      ],
      foot: "Sample replies. All made up.",
    },
    controls: [
      {
        title: "Approve before send",
        body: "Have every reply wait for approval, only certain kinds, or none. Many teams approve pricing answers and let the rest go.",
      },
      {
        title: "Escalation rules",
        body: "Choose the topics that always go to a person: legal, complaints, discounts, named accounts.",
      },
      {
        title: "Grounded answers only",
        body: "The agent answers from your knowledge base. If the answer isn't there, it hands over; it doesn't improvise.",
      },
    ],
    related: [
      "knowledge-base",
      "multi-channel-sequences",
      "deliverability-and-mailbox-health",
    ],
    plays: ["outbound-lead-generation", "event-follow-up", "lead-nurture"],
  },

  "multilingual-outreach": {
    tagline: "Sell in your buyer's language without hiring in every market.",
    intro:
      "A message in a buyer's own language gets read; a translated template gets deleted. Dialvo's agents research, write and speak in the language of the person they're contacting, working from the knowledge you provide for each market.",
    description:
      "Dialvo's agents research, write and speak in your buyer's language, using market-specific knowledge you add, with reporting across regions in one place.",
    capabilities: [
      {
        title: "Written in the language, not translated into it",
        body: "Messages are composed directly in the target language, with its own conventions for greetings, formality and length.",
      },
      {
        title: "The same depth of research",
        body: "Agents read local-language news and company pages, so a prospect abroad gets the same quality of opening as one at home.",
      },
      {
        title: "Voice and text",
        body: "The phone agent answers calls in supported languages; email, chat, SMS and WhatsApp agents write in them.",
      },
      {
        title: "Knowledge per market",
        body: "Add pricing, product names, case examples and legal wording for each market. The agent uses the right version for the person's region.",
      },
      {
        title: "Language chosen automatically",
        body: "The language is set from the contact's location and profile, and switches if they reply in another one.",
      },
      {
        title: "One report across regions",
        body: "Replies, meetings and outcomes by language and country, side by side.",
      },
    ],
    fit: [
      "Language is a setting on a play, not a separate product. The same sequences, qualification questions and routing rules apply; the agents carry them out in the buyer's language and write the summary for your team in yours.",
      "Routing can send a lead to a rep who speaks the language, or to any rep with the translated transcript attached.",
    ],
    visual: {
      kind: "email",
      title: "New message",
      note: "German · from Priya's inbox",
      from: "Priya Shah <priya@northwind.example>",
      to: "Jonas Keller",
      subject: "Zweiter Standort in Leipzig",
      body: [
        "Guten Tag Herr Keller,",
        "herzlichen Glückwunsch zur Eröffnung in Leipzig. Mir ist aufgefallen, dass Termine an beiden Standorten noch telefonisch vergeben werden.",
        "Wir bauen Buchungsseiten für Praxen mit mehreren Standorten. Hätten Sie nächste Woche 15 Minuten Zeit?",
        "Priya Shah · Northwind Agency",
      ],
      foot: "Summary for your team is written in English. Unsubscribe link included.",
    },
    controls: [
      {
        title: "Choose your markets",
        body: "Turn on only the languages and countries you can serve. Leads elsewhere are held back.",
      },
      {
        title: "Review by a native speaker",
        body: "Require approval for the first messages in a new language until someone you trust has checked the tone.",
      },
      {
        title: "Local rules differ",
        body: "Consent, opt-out and calling rules vary by country. Send windows and channel rules can be set per region; what's lawful where you sell is yours to confirm.",
      },
    ],
    related: ["knowledge-base", "ai-personalisation", "analytics"],
    plays: ["outbound-lead-generation", "speed-to-lead"],
  },
} satisfies Partial<Record<FeatureSlug, FeatureContent>>;
