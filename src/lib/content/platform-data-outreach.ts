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
      "Most visitors leave without telling you who they are. Dialvo records which pages are read, recognises your own leads when they come back, names the companies behind business networks, and lets the retargeting play write to them while the question that brought them is still open.",
    description:
      "Dialvo's website visitor tracking records page views with consent, recognises known leads from chats, forms and email links, identifies companies by their network, and feeds the retargeting play, which drafts a note for your approval without mentioning the visit.",
    capabilities: [
      {
        title: "One snippet",
        body: "The website chat's code does the tracking too. There's nothing else to install.",
      },
      {
        title: "Known leads recognised",
        body: "Once someone chats, fills in a form or clicks a link in your email, their later visits are added to their lead.",
      },
      {
        title: "Companies by network",
        body: "Visits from business networks are matched to the company. Home and mobile connections, which can't be, are left anonymous.",
      },
      {
        title: "Pricing visits stand out",
        body: "Website visitors shows who read your pricing page in the last two weeks, at the top.",
      },
      {
        title: "Into the retargeting play",
        body: "For a company, Dialvo finds a named person and drafts a first email; for a known lead, a short check-in. Each waits for you.",
      },
    ],
    fit: [
      "Visits are one more signal next to replies, chats and news. Lead scoring counts them toward engagement, and the retargeting play acts on them.",
      "The outreach that follows is about the topic, not the tracking: no email ever says the person was on your site.",
    ],
    visual: {
      kind: "list",
      title: "Website visitors",
      note: "last 14 days",
      rows: [
        {
          name: "Fernhill Logistics",
          detail: "Pricing, then two case pages",
          tag: "Company",
          strong: true,
        },
        {
          name: "Dana Reyes · Northgate",
          detail: "Known lead · read pricing twice",
          tag: "Lead",
          strong: true,
        },
        {
          name: "Tidewater Clinics",
          detail: "Home page and blog",
          tag: "Company",
        },
        {
          name: "12 anonymous visits",
          detail: "Home or mobile networks",
          tag: "Not named",
        },
      ],
      foot: "Sample visitors. All made up.",
    },
    controls: [
      {
        title: "Consent first",
        body: "Visits are recorded only with consent, and never from browsers that send Do Not Track.",
      },
      {
        title: "Companies, not strangers",
        body: "Dialvo doesn't unmask anonymous people. A person is named only when they're already one of your leads.",
      },
      {
        title: "Little is kept",
        body: "Not the IP address, not the page's query string, not the full referrer: only what's needed to show the visit.",
      },
      {
        title: "Company lookup is a separate step",
        body: "Naming companies needs Dialvo's company-lookup service switched on; without it you still see your known leads.",
      },
    ],
    related: ["lead-scoring", "review-site-intent", "ad-audiences"],
    plays: ["retargeting-website-visitors", "lead-nurture"],
  },

  "multi-channel-sequences": {
    tagline: "Email, texts and LinkedIn as one conversation.",
    intro:
      "Some people answer email; some answer a text; some only notice a message on LinkedIn. Dialvo adds text and LinkedIn steps to an email sequence, and a reply on any of them stops the rest, so nobody hears from you three ways about the same thing.",
    description:
      "Dialvo's multi-channel sequences add text messages (to people who agreed to them) and LinkedIn messages (sent by your team from their own profiles) to email sequences, and stop every step when the person replies on any channel. Dialvo never makes outbound calls.",
    capabilities: [
      {
        title: "Email at the centre",
        body: "Every sequence has a first email and its follow-ups, sent from your own mailbox.",
      },
      {
        title: "Text steps, with consent",
        body: "A text on the day you choose, only to people with a recorded opt-in, ending with how to stop.",
      },
      {
        title: "LinkedIn, sent by a person",
        body: "Dialvo writes the LinkedIn message and gives it to the right person as a task. They send it from their own profile.",
      },
      {
        title: "One reply stops it all",
        body: "A reply by email, text or LinkedIn ends every remaining step for that person.",
      },
      {
        title: "Opt-outs everywhere at once",
        body: "Someone who replies STOP to a text, or unsubscribes from an email, hears nothing more on any channel.",
      },
      {
        title: "No call steps",
        body: "Sequences never include calls. Dialvo never makes outbound calls; its phone agent only answers.",
      },
    ],
    fit: [
      "Plays decide who hears from you and why; the sequence decides when and where. The same steps can follow a speed-to-lead reply, a nurture email or an outbound first touch.",
      "Each step is written when it's due, from what's happened so far, so a text sent on day six doesn't repeat what the email said on day one.",
    ],
    visual: {
      kind: "timeline",
      title: "Sequence · Marcus Hale",
      note: "email, LinkedIn and text",
      steps: [
        {
          when: "Day 1",
          channel: "Email",
          text: "First email about the second site, approved and sent.",
          done: true,
        },
        {
          when: "Day 3",
          channel: "LinkedIn",
          text: "Connection note written; Priya sent it from her profile.",
          done: true,
        },
        {
          when: "Day 5",
          channel: "Email",
          text: "Short follow-up with one useful example.",
          done: true,
        },
        {
          when: "Day 7",
          channel: "Text",
          text: "A two-line text. Marcus agreed to texts on your form.",
        },
        {
          when: "Day 10",
          channel: "Email",
          text: "Last note, only if there's still no reply.",
        },
      ],
      foot: "Sample sequence. All made up.",
    },
    controls: [
      {
        title: "Consent on every text",
        body: "A text step is skipped for anyone without a recorded opt-in. The sequence can't override it.",
      },
      {
        title: "A few LinkedIn tasks a day",
        body: "LinkedIn tasks are handed out in small numbers each day, because each one is sent by hand and LinkedIn limits invitations.",
      },
      {
        title: "Short by design",
        body: "Texts and LinkedIn notes have length limits, so a step reads like a person wrote it.",
      },
      {
        title: "Email, text and LinkedIn only",
        body: "WhatsApp and social messages other than LinkedIn aren't sequence steps.",
      },
    ],
    related: ["sequence-builder", "smart-replies", "ai-personalisation"],
    plays: ["outbound-lead-generation", "lead-nurture", "speed-to-lead"],
  },

  "sequence-builder": {
    tagline: "A first email and up to five follow-ups, set up your way.",
    intro:
      "A sequence is the first email and what follows when there's no reply. In the builder you decide how many follow-ups, how long each waits, what each should say, which language they're in and whether they wait for your approval. Dialvo writes each one when it's due.",
    description:
      "Dialvo's sequence builder sets a first email and up to five follow-ups: add, remove and reorder steps, each with its own wait, instructions, language and approval setting. Every sequence stops when the person replies.",
    capabilities: [
      {
        title: "Up to five follow-ups",
        body: "After the first email, add, remove and reorder follow-ups. Each is shorter than the one before.",
      },
      {
        title: "A wait per step",
        body: "Each follow-up waits the number of days you choose after the email before it, up to 60.",
      },
      {
        title: "Instructions, not templates",
        body: "For each step, say what it should do: add an example, ask a question, close politely. The agent writes it for each person.",
      },
      {
        title: "A language per sequence",
        body: "Choose the language, or leave it on auto to use the language of the company's own website.",
      },
      {
        title: "Approval per sequence",
        body: "Have each email wait for you, or let it send within your mailbox limits.",
      },
      {
        title: "Ready-made to start",
        body: "Plays come with a sequence you can use as it is or change.",
      },
    ],
    fit: [
      "Every play and playbook runs on a sequence. Change it once and every lead that starts it afterwards gets the new version.",
      "Text and LinkedIn steps sit alongside the emails, under Sequences, channels. A reply on any channel ends the sequence.",
    ],
    visual: {
      kind: "timeline",
      title: "Builder · Closed-lost revisit",
      note: "first email and 3 follow-ups",
      steps: [
        {
          when: "Email",
          channel: "First",
          text: "Pick up the thread: what's changed since the deal closed.",
          done: true,
        },
        {
          when: "+4 days",
          channel: "Follow-up 1",
          text: "One new example that fits their business.",
          done: true,
        },
        {
          when: "+7 days",
          channel: "Follow-up 2",
          text: "A single question about timing.",
          done: true,
        },
        {
          when: "+14 days",
          channel: "Follow-up 3",
          text: "A polite close. Waits for approval.",
        },
      ],
      foot: "Sample sequence design.",
    },
    controls: [
      {
        title: "Stops on a reply",
        body: "Any reply ends the sequence for that person. Steps don't branch on opens or clicks, which Dialvo doesn't track.",
      },
      {
        title: "Mailbox limits apply",
        body: "However many leads start a sequence, each mailbox sends only its daily limit.",
      },
      {
        title: "Kept short",
        body: "Follow-ups have word limits, and one that runs too long is thrown away rather than sent.",
      },
    ],
    related: ["multi-channel-sequences", "playbooks", "multilingual-outreach"],
    plays: ["closed-lost", "lead-nurture", "customer-onboarding-operations"],
  },

  "smart-replies": {
    tagline: "Every reply read and answered while the interest is live.",
    intro:
      "A reply that sits for a day is a meeting half lost. Dialvo reads each one as it arrives, works out what the person means and takes the next step: an answer, a booking, a handoff or a clean opt-out.",
    description:
      "Dialvo's smart replies read every response as it arrives, sort it (interested, question, not now, not interested, unsubscribe), draft an answer from your knowledge base for you to send, offer your booking link and honour opt-outs.",
    capabilities: [
      {
        title: "Sorted by intent",
        body: "Interested, has a question, not now, not interested or unsubscribe. Each reply is labelled and the sequence stops for that person.",
      },
      {
        title: "Answers drafted for you",
        body: "Pricing, integrations, how it works: an answer is drafted from your knowledge base in your tone, waiting in the Inbox for you to send.",
      },
      {
        title: "Common objections handled",
        body: '"We already use something", "no budget until next year", "send me more information": answered with your positioning, without pushing.',
      },
      {
        title: "Your booking link offered",
        body: "When someone wants to talk, the answer offers your booking link and your team is told.",
      },
      {
        title: "Out-of-office left alone",
        body: "Automatic out-of-office replies aren't treated as answers and aren't written to your CRM.",
      },
      {
        title: "Opt-outs honoured at once",
        body: 'Any form of "stop" ends every sequence for that person and is recorded in Dialvo and, where connected, your CRM.',
      },
    ],
    fit: [
      "Smart replies close the loop on every outbound and nurture play. The inbox is read every few minutes, so a reply at 7pm is sorted and has a drafted answer waiting by 7:05.",
      "It also decides when to stop being an agent. Sensitive, angry or unusual replies go to a person with the thread and a suggested response.",
    ],
    visual: {
      kind: "list",
      title: "Replies",
      note: "this morning",
      rows: [
        {
          name: "Marcus Hale",
          detail: '"Thursday works. How do I book?"',
          tag: "Link sent",
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
        title: "You send the answers",
        body: "Answers to replies are drafts. You read, edit and send them from the Inbox.",
      },
      {
        title: "Grounded answers only",
        body: "Drafts state only facts from your knowledge base: no invented prices, discounts or promises.",
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
      "A message in a buyer's own language gets read; a translated template gets deleted. Choose a language for each sequence, play or playbook, or leave it on auto, and Dialvo writes in the language of the company's own website.",
    description:
      "Dialvo writes first emails and follow-ups in the language you choose per sequence, play or playbook, or automatically in the language of the company's own website; the website chat replies in the visitor's language.",
    capabilities: [
      {
        title: "Written in the language, not translated into it",
        body: "Messages are composed directly in the target language, with its own conventions for greetings, formality and length.",
      },
      {
        title: "The same depth of research",
        body: "The company's own website is read in its own language, so a prospect abroad gets the same quality of opening as one at home.",
      },
      {
        title: "Chat in the visitor's language",
        body: "The website chat answers in the language the visitor writes in.",
      },
      {
        title: "A setting, not a product",
        body: "Language is chosen per sequence, play or playbook, so one market can run in German while another runs in English.",
      },
      {
        title: "Auto, from the company's site",
        body: "Left on auto, emails use the language of the company's own website.",
      },
    ],
    fit: [
      "Language is a setting on a play, not a separate product. The same sequences, qualification questions and routing rules apply; the agents carry them out in the buyer's language and write the summary for your team in yours.",
      "Routing rules can match leads by country, so leads from one market go to the teammate who covers it.",
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
        title: "Review by a native speaker",
        body: "Require approval for the first messages in a new language until someone you trust has checked the tone.",
      },
      {
        title: "Local rules differ",
        body: "Consent and opt-out rules vary by country. What's lawful where you sell is yours to confirm.",
      },
    ],
    related: ["knowledge-base", "ai-personalisation", "analytics"],
    plays: ["outbound-lead-generation", "speed-to-lead"],
  },
} satisfies Partial<Record<FeatureSlug, FeatureContent>>;
