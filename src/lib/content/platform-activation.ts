import type { FeatureSlug } from "./catalog";
import type { FeatureContent } from "./types";

// Platform features: company news, account briefs, workflows, ad audiences
// and the MCP server. Every person and business in the sample panels is
// made up.

export const ACTIVATION_FEATURES = {
  "company-news": {
    tagline: "Know when something changes at the companies you care about.",
    intro:
      "A funding round, a product launch or a new head of sales is a reason to get in touch. Dialvo checks the news for the companies you track once a week and shows what it finds, with the link to where it was reported.",
    description:
      "Dialvo's company news signals check your target accounts and your leads' companies weekly for funding, launches, leadership hires and expansions, each with its source, and turn the ones you keep into a note, a fresh brief or a drafted email.",
    capabilities: [
      {
        title: "The companies you already track",
        body: "Your target accounts and the companies your leads work at, up to 100 per workspace.",
      },
      {
        title: "Once a week, every week",
        body: "Each company gets a web search for recent news, looking back about six weeks.",
      },
      {
        title: "The kinds of news that matter",
        body: "Funding, product launches, leadership hires and expansions such as a new office or market.",
      },
      {
        title: "A source on every item",
        body: "Each item links to where it was reported. The same story found twice is shown once.",
      },
      {
        title: "Keep it, and it goes to work",
        body: "On a lead, keeping an item adds a note and makes a fresh brief. For a target account, it starts a campaign that finds a contact and drafts an email.",
      },
    ],
    fit: [
      "News sits on Signals beside review-site intent, so everything that might be a reason to write is in one place.",
      "Nothing is sent because of a news item on its own. Every email a kept item leads to is a draft that waits for your approval.",
    ],
    visual: {
      kind: "list",
      title: "Signals · company news",
      note: "this week",
      rows: [
        {
          name: "Calder Leisure",
          detail: "Raised a growth round · local business news",
          tag: "Funding",
          strong: true,
        },
        {
          name: "Fernhill Fitness",
          detail: "Hired a new head of operations",
          tag: "Leadership",
          strong: true,
        },
        {
          name: "Northgate Leisure",
          detail: "Opening a site in Leeds",
          tag: "Expansion",
        },
        {
          name: "Peak Climbing",
          detail: "Launched a members' app",
          tag: "Launch",
        },
      ],
      foot: "Sample signals. All made up.",
    },
    controls: [
      {
        title: "Off until switched on",
        body: "An admin switches news checks on for the workspace.",
      },
      {
        title: "A hundred companies",
        body: "At most 100 tracked companies per workspace, each checked once a week, within the day's research spending limit.",
      },
      {
        title: "Public news only",
        body: "It reads what's published on the open web. It doesn't log in anywhere, and it can miss news that was never reported.",
      },
    ],
    related: ["review-site-intent", "account-briefs", "account-based-lists"],
    plays: ["lead-reactivation", "closed-lost", "outbound-lead-generation"],
  },

  "account-briefs": {
    tagline: "Walk into every meeting already knowing the account.",
    intro:
      "Before a meeting, Dialvo writes a short brief on the company and the person: what they do, who's involved, what's been said so far and what's worth asking. Every fact carries its source. When a deal is lost, it writes a short note on why.",
    description:
      "Dialvo's account briefs are cited summaries of a lead's company, people, past conversations and open questions, made on demand or before each meeting (from Dialvo or your calendar's iCal address), plus a short closed-lost note for lost deals.",
    capabilities: [
      {
        title: "From what's actually known",
        body: "The company's own website, a short web search, and every message, call and note you've had with them.",
      },
      {
        title: "Facts, people, questions, talking points",
        body: "Four short parts, each fact linked to the page or the conversation it came from.",
      },
      {
        title: "Before each meeting",
        body: "Made ahead of meetings booked in Dialvo, added on a lead, or read from each person's secret iCal calendar address. No calendar sign-in needed.",
      },
      {
        title: "Where you'll see it",
        body: "In the app, by email to the meeting's owner, and in your Slack channel if Slack is connected.",
      },
      {
        title: "On demand",
        body: "Ask for a brief on any lead at any time, or choose a morning brief for the day's meetings.",
      },
      {
        title: "Closed-lost notes",
        body: "When a lead is marked lost, a short note on why, from the conversation, for whoever picks it up later.",
      },
    ],
    fit: [
      "Briefs reuse the research Dialvo already does for outreach, so the rep reads what the agents knew before they wrote.",
      "The closed-lost note is what the closed-lost play reads months later, when it's time to try again.",
    ],
    visual: {
      kind: "brief",
      title: "Brief · meeting at 11:00",
      note: "with Priya",
      heading: "Harbor Fitness · Marcus Hale, head of operations",
      facts: [
        ["Company", "Five gyms, opening a sixth (their site)"],
        ["So far", "Asked about pricing for multi-site teams (email, Tuesday)"],
        ["Open question", "Whether bookings sync with their member app"],
      ],
      points: [
        "Start from the sixth site: it's why they replied",
        "Have the multi-site pricing ready",
      ],
      foot: "Sample brief. All made up.",
    },
    controls: [
      {
        title: "A daily limit",
        body: "Each workspace has a daily number of briefs and notes, inside the day's research spending limit.",
      },
      {
        title: "Your calendar stays read-only",
        body: "Dialvo reads the iCal address you paste and never writes to your calendar. Repeating meetings count once.",
      },
      {
        title: "Sources, not guesses",
        body: "Where something can't be found, the brief says so instead of filling the gap.",
      },
    ],
    related: ["deep-research", "company-news", "slack-integration"],
    plays: ["closed-lost", "automated-meeting-scheduling"],
  },

  workflows: {
    tagline: "When something happens, the next step happens too.",
    intro:
      'Most sales admin is the same small reaction, repeated: a lead replies, so someone changes the stage, tells the owner and adds a task. Workflows let you write that once as "when this happens, do these steps", and Dialvo runs it every time.',
    description:
      "Dialvo's workflows are when-this-then-that automations for leads: triggers such as a new lead, a stage change, a sorted reply, a booked meeting, a kept signal, your own webhook or a schedule; steps such as research, add to a play, route, change stage, post to Slack, call a webhook, add a task or a note.",
    capabilities: [
      {
        title: "Triggers from your pipeline",
        body: "A lead is added or changes stage, replies (by how the reply was sorted), a chat needs a person, a meeting is booked or a signal is kept.",
      },
      {
        title: "From outside, or on a schedule",
        body: "Start a workflow from your own systems with its webhook address, or run it on a schedule.",
      },
      {
        title: "Conditions",
        body: "Only run when the lead's stage, source, country, company size, company, email or owner match what you set.",
      },
      {
        title: "Steps that do the work",
        body: "Research the company, add the lead to a running play, assign or route it, change its stage, post to Slack, call your webhook, make a task or add a note.",
      },
      {
        title: "Every run logged",
        body: "See each run, which steps ran and what they did, so a surprise is easy to trace.",
      },
    ],
    fit: [
      "Workflows join the parts of Dialvo together: a kept news item can start research, a booked meeting can post to Slack, a reply marked not now can move the stage.",
      "They never send email on their own. Adding a lead to a play writes a draft under that play's rules, which waits for approval if the play does.",
    ],
    visual: {
      kind: "timeline",
      title: "Workflow · interested reply",
      note: "when a reply is sorted as interested",
      steps: [
        {
          when: "When",
          channel: "Trigger",
          text: "A lead replies and the reply is sorted as interested",
          done: true,
        },
        {
          when: "If",
          channel: "Condition",
          text: "Company size is 50 or more",
          done: true,
        },
        {
          when: "Then",
          channel: "Stage",
          text: "Move the lead to engaged",
          done: true,
        },
        {
          when: "Then",
          channel: "Slack",
          text: "Post to #sales with the reply",
          done: true,
        },
        {
          when: "Then",
          channel: "Task",
          text: "A task for the owner: reply today",
        },
      ],
      foot: "Sample workflow. All made up.",
    },
    controls: [
      {
        title: "Daily limits",
        body: "Up to 500 runs a day per workspace, with a cap on steps per workflow and conditions per workflow.",
      },
      {
        title: "No email by itself",
        body: "No workflow step sends an email. Messages only come from plays and sequences, under their own approval rules.",
      },
      {
        title: "A scheduled run is gentle",
        body: "A scheduled workflow picks a small batch of leads each run and doesn't pick the same lead again within a week.",
      },
    ],
    related: ["playbooks", "slack-integration", "api"],
    plays: ["speed-to-lead", "lead-nurture"],
  },

  "ad-audiences": {
    tagline: "Show your ads to the right accounts, and not to your customers.",
    intro:
      "Ads work better when they reach the people your team is already talking to, and worse when they're shown to customers or people who asked you to stop. Dialvo turns your leads into upload files for LinkedIn, Meta and Google ads, and makes suppression lists to keep the wrong people out.",
    description:
      "Dialvo's ad audiences build lists of people or companies from your leads, filtered by stage, source, country, owner, play and date added, and export them as LinkedIn, Meta and Google Ads upload files, plus suppression lists of customers and opted-out people.",
    capabilities: [
      {
        title: "People or companies",
        body: "An audience of contacts, or of the companies they work at, from your leads.",
      },
      {
        title: "Filters you already use",
        body: "Stage, source, country, owner, the play they're in and when they were added.",
      },
      {
        title: "In each platform's format",
        body: "LinkedIn contact and company lists, Meta customer lists and Google Ads Customer Match files.",
      },
      {
        title: "Hashed where the platform takes it",
        body: "Emails are hashed with SHA-256 in the files for platforms that accept hashed data.",
      },
      {
        title: "Suppression lists",
        body: "A list of your customers, or of people who opted out, to exclude from your campaigns.",
      },
    ],
    fit: [
      "Ad audiences use the same leads, stages and plays as everything else, so the people seeing your ads are the people your agents are already writing to.",
      "Suppression lists carry the opt-outs Dialvo records, so someone who asked you to stop isn't followed around by your ads either.",
    ],
    visual: {
      kind: "list",
      title: "Ad audiences",
      note: "ready to download",
      rows: [
        {
          name: "Engaged, UK",
          detail: "412 people · LinkedIn contact list",
          tag: "CSV",
          strong: true,
        },
        {
          name: "Target companies",
          detail: "86 companies · LinkedIn company list",
          tag: "CSV",
          strong: true,
        },
        {
          name: "Trial users",
          detail: "1,240 people · Google Customer Match, hashed",
          tag: "CSV",
        },
        {
          name: "Customers and opt-outs",
          detail: "Suppression list · Meta customer list",
          tag: "CSV",
        },
      ],
      foot: "Sample audiences. All made up.",
    },
    controls: [
      {
        title: "You upload the file",
        body: "Dialvo makes the file and you upload it to the ad platform. It doesn't sync with ad accounts directly: that needs each platform's partner approval, which Dialvo doesn't have.",
      },
      {
        title: "Size limits",
        body: "Up to 50 saved audiences, and up to 20,000 rows in one file. A bigger audience is cut, and the page says so.",
      },
      {
        title: "Consent is yours to confirm",
        body: "Using customer lists for ads has its own rules in each platform and country. Check you may use the data before you upload it.",
      },
    ],
    related: ["saved-audiences", "lead-scoring", "website-visitor-tracking"],
    plays: ["retargeting-website-visitors", "plg-conversion"],
  },

  "mcp-server": {
    tagline: "Ask about your pipeline from the AI tool you already use.",
    intro:
      "Your reps already work in AI assistants. Dialvo's MCP server lets them look up a lead and its history, find contacts at a company, add a lead to a play or get a brief for their next meeting, from Claude, Cursor, VS Code and other tools that support MCP.",
    description:
      "Dialvo's remote MCP server lets reps use Dialvo from Claude Code, Claude Desktop, Cursor, VS Code and other MCP apps: search leads, read a lead's history, look up contacts at a company, add a lead, add it to a play, list meetings and get a brief, with personal or workspace keys, read-only or with write access.",
    capabilities: [
      {
        title: "Search and read leads",
        body: "Find leads, and read one with its conversations, meetings and notes.",
      },
      {
        title: "Contacts at a company",
        body: "Look up people at a company by its website, with work emails where found, within the day's contact credits.",
      },
      {
        title: "Add and enrol",
        body: "Add a lead, or add one to a running play. The play's own rules and approvals still apply.",
      },
      {
        title: "Meetings and briefs",
        body: "List upcoming meetings and get the brief for one.",
      },
      {
        title: "Keys you control",
        body: "Personal or workspace keys, read-only or with write access, each revocable at any time.",
      },
    ],
    fit: [
      "The MCP server is the same Dialvo your team sees in the app: the same leads, the same limits, the same never-contact list. It's another door, not another copy.",
      "Reps who live in an AI assistant can prepare for a call or add a prospect without switching windows.",
    ],
    visual: {
      kind: "thread",
      title: "In your AI assistant",
      note: "connected to Dialvo",
      messages: [
        { text: "What do we know about Harbor Fitness before my 11:00?" },
        {
          agent: true,
          text: "Marcus Hale, head of operations, replied on Tuesday asking about multi-site pricing. They run five gyms and are opening a sixth. The brief for today's meeting suggests starting with the new site.",
        },
        { text: "Who else there should we know?" },
        {
          agent: true,
          text: "The contact database has a finance director and two site managers, each with a work email. Shall I add them as leads?",
        },
      ],
      foot: "Sample exchange. All made up.",
    },
    controls: [
      {
        title: "Read-only by default",
        body: "Give a key write access only when someone needs to add leads or enrol them in plays.",
      },
      {
        title: "Same limits as the app",
        body: "Contact lookups spend the same daily credits; plays keep their caps and approvals.",
      },
      {
        title: "Not every tool yet",
        body: "Tools that connect with a key work today. Browser connectors that need an OAuth sign-in aren't supported yet.",
      },
    ],
    related: ["api", "account-briefs", "company-and-lead-database"],
    plays: ["outbound-lead-generation"],
  },
} satisfies Partial<Record<FeatureSlug, FeatureContent>>;
