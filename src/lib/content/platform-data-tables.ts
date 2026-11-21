import type { FeatureSlug } from "./catalog";
import type { FeatureContent } from "./types";

// Platform features: lists and research, recipes, scoring, enrichment,
// always-on sourcing, territories, target accounts and audiences. Every
// person and business in the sample panels is made up.

export const DATA_TABLE_FEATURES = {
  "lists-and-research": {
    tagline: "A list of companies, and a question answered for every row.",
    intro:
      "Some things no filter can tell you: whether a gym has a café, whether a firm sells to schools, how many sites a chain runs. Put the companies or people in a list, write the question once in plain words, and Dialvo researches the answer for each row, with the page it came from.",
    description:
      "Dialvo's lists hold companies or people from Find leads, a CSV, your leads or your CRM. Add a plain-language research column and get a typed answer per row with its source, or look up work emails, titles and company details.",
    capabilities: [
      {
        title: "Rows from anywhere",
        body: "Start a list from a Find leads search, a CSV, your own leads, a saved audience or the leads linked to your CRM. Duplicates are left out.",
      },
      {
        title: "A question per column",
        body: "Write what you want to know. The answer comes back as yes or no, a number, a score, one of your options or a short answer.",
      },
      {
        title: "The source and the reason",
        body: "Each answer carries the page it was found on and a sentence on why. When it can't be found, the cell says so instead of guessing.",
      },
      {
        title: "Lookups from the contact database",
        body: "Add columns for a verified work email, an email check, a job title, company size, industry or the technologies a site uses.",
      },
      {
        title: "Cost before you run",
        body: "Choose rows and columns and see the estimate first. Each workspace has a daily limit, checked before anything runs.",
      },
      {
        title: "On to Leads or a play",
        body: "Send the rows you like to Leads, start a playbook on them, or export the list with every answer and source as a CSV.",
      },
    ],
    fit: [
      "Lists are where research happens before outreach. The answers travel with the company, so a playbook or a routing rule can pick by them later.",
      "A question you ask often can be saved as a recipe and used on any list, in scoring and in playbooks.",
    ],
    visual: {
      kind: "list",
      title: "List · multi-site gyms",
      note: "Has a café?",
      rows: [
        {
          name: "Harbor Fitness",
          detail: "Yes · café listed on the facilities page",
          tag: "Source",
          strong: true,
        },
        {
          name: "Northgate Leisure",
          detail: "Yes · mentioned in a local news story",
          tag: "Source",
          strong: true,
        },
        {
          name: "Peak Climbing",
          detail: "No · vending machines only",
          tag: "Source",
        },
        {
          name: "Riverside Health Club",
          detail: "Not found",
          tag: "No source",
        },
      ],
      foot: "Sample list. All made up.",
    },
    controls: [
      {
        title: "Daily limits",
        body: "Research answers, research spend and contact database credits each have a daily limit per workspace.",
      },
      {
        title: "No guessed emails",
        body: "A work email is only ever one the contact database finds and checks.",
      },
      {
        title: "Instructions stay yours",
        body: "Web pages are read as information; text on them can't change what the research does.",
      },
    ],
    related: ["saved-recipes", "company-and-lead-database", "deep-research"],
    plays: ["outbound-lead-generation", "competitive-takeout"],
  },

  "saved-recipes": {
    tagline: "Write the question once. Use it everywhere.",
    intro:
      "The questions that tell you whether an account is worth a call rarely change. Save one as a recipe and it is ready on any list, answered for every company an always-on search finds, counted in lead scoring and usable in playbooks.",
    description:
      "Dialvo's saved recipes are reusable research questions and scores: add them to any list, answer them for new companies automatically, count them in lead scoring and pick leads by their answer.",
    capabilities: [
      {
        title: "From a column, in a click",
        body: "Any research column on a list can be saved as a recipe with its question and answer type.",
      },
      {
        title: "Scores as well as questions",
        body: "A recipe can return a score from 0 to 100, judged against the question you write.",
      },
      {
        title: "On every new company",
        body: "Give an always-on search a recipe and each company it finds is answered as it arrives.",
      },
      {
        title: "In scoring",
        body: "A score or a yes/no recipe can count toward a lead's fit, as much as one, two or three rules.",
      },
      {
        title: "In playbooks and audiences",
        body: "Pick leads by a recipe's answer: yes, no, a number or better, or one of the options.",
      },
    ],
    fit: [
      "Recipes turn one person's judgement into something the whole team uses the same way, list after list.",
      "Because the answer is stored with its source, anyone can check why a company was picked.",
    ],
    visual: {
      kind: "brief",
      title: "Recipe",
      note: "a score",
      heading:
        '"How well does this company fit a booking tool for multi-site gyms?"',
      facts: [
        ["Answer", "A score from 0 to 100"],
        ["Used on", "3 lists and an always-on search"],
        ["In scoring", "Counts as two rules"],
      ],
      points: [
        "Harbor Fitness: 85, runs five sites",
        "Peak Climbing: 40, one site",
      ],
      foot: "Sample recipe. All made up.",
    },
    controls: [
      {
        title: "The same limits",
        body: "A recipe's answers count against the same daily research limits as any column.",
      },
      {
        title: "Change safely",
        body: "Columns made from a recipe keep the question they were made with.",
      },
    ],
    related: ["lists-and-research", "lead-scoring", "playbooks"],
    plays: ["outbound-lead-generation"],
  },

  "lead-scoring": {
    tagline:
      "Fit and engagement in one score, and a tier everyone understands.",
    intro:
      "Every lead gets two numbers: how well they fit who you sell to, and how much they have engaged lately. Together they give a tier from 1 to 3, shown on Leads and usable in routing, audiences and playbooks.",
    description:
      "Dialvo scores every lead on fit (your description and firmographics) and engagement (replies, chats, visits, forms, product events and meetings) and puts them in tiers 1 to 3.",
    capabilities: [
      {
        title: "Fit from your own words",
        body: "Write the rules from your Find leads description in one click, then adjust: countries, company size, titles, the kind of company and where they came from.",
      },
      {
        title: "Engagement from what people do",
        body: "Replies, website chats, form fills, pages and pricing read, product events and meetings, from the last 90 days. Email opens aren't counted.",
      },
      {
        title: "Tiers you set",
        body: "Choose where tier 1 and tier 2 start and how much engagement counts against fit.",
      },
      {
        title: "The why on every lead",
        body: "Each lead shows which rules it met and what earned its engagement points.",
      },
      {
        title: "Always current",
        body: "New leads are scored as they arrive and everyone is refreshed through the day.",
      },
    ],
    fit: [
      "Tiers feed the rest of Dialvo: a routing rule can send tier 1 to your senior rep, and a playbook can pick only tier 1 and 2.",
      "A saved recipe can count toward fit, so research on a list shapes the score too.",
    ],
    visual: {
      kind: "metrics",
      title: "Leads by tier",
      note: "this week",
      tiles: [
        { label: "Tier 1", value: "18" },
        { label: "Tier 2", value: "64" },
        { label: "Tier 3", value: "231" },
      ],
      bars: [
        { label: "Fit rules met", value: 72, note: "average for tier 1" },
        { label: "Engagement", value: 55, note: "average for tier 1" },
      ],
      foot: "Sample numbers. All made up.",
    },
    controls: [
      {
        title: "No opens",
        body: "Opens aren't tracked, so they never inflate a score.",
      },
      {
        title: "Owners decide",
        body: "Only owners and admins change the rules; everyone sees the result.",
      },
    ],
    related: [
      "intelligent-lead-routing",
      "saved-audiences",
      "lead-qualification",
    ],
    plays: ["speed-to-lead", "lead-nurture"],
  },

  "crm-enrichment": {
    tagline: "Complete records that stay current, without anyone typing.",
    intro:
      "Leads arrive with half their details, and the rest go out of date. Dialvo fills in missing work emails, titles and company details from the contact database, checks emails again, spots job changes, and matches people who sign up with a personal address to the company they work at.",
    description:
      "Dialvo enriches your leads, including the ones synced with your CRM: verified work emails, titles, company size and industry, job-change checks and personal-email matching, refreshed monthly by default within a credit cap.",
    capabilities: [
      {
        title: "Missing details filled",
        body: "Work emails, job titles, company size and industry, only where the field is empty.",
      },
      {
        title: "Emails checked again",
        body: "Every refresh, and whenever an email bounces. One that stopped working is flagged on the lead.",
      },
      {
        title: "Job changes",
        body: "A new company or a new title is spotted on the next check, noted on the lead and the title updated.",
      },
      {
        title: "Personal-email sign-ups",
        body: "Someone who signs up with a personal address is matched to their company and work email, only when the contact database finds them.",
      },
      {
        title: "Written back to your CRM",
        body: "Each change goes to the contact in your CRM as a note. Its own fields are left as they are.",
      },
      {
        title: "A schedule and a cap",
        body: "Monthly by default, any period from a week to a year, with a monthly credit cap you set.",
      },
    ],
    fit: [
      "Better records make every other part sharper: scoring reads the titles and sizes, routing reads the countries, and sequences reach working inboxes.",
      "A job change is a reason to write: the person knows you, and their new company may need you too.",
    ],
    visual: {
      kind: "timeline",
      title: "Enrichment",
      note: "this month",
      steps: [
        {
          when: "2 Nov",
          channel: "Filled",
          text: "Title and company size for Dana Reyes",
          done: true,
        },
        {
          when: "9 Nov",
          channel: "Job change",
          text: "Sam Ray moved from SamCo to Northfield as COO",
          done: true,
        },
        {
          when: "14 Nov",
          channel: "Email",
          text: "An old address stopped accepting mail",
          done: true,
        },
        {
          when: "21 Nov",
          channel: "Work email",
          text: "A sign-up's work email found at their company",
        },
      ],
      foot: "Sample events. All made up.",
    },
    controls: [
      {
        title: "Never guessed",
        body: "Every email comes from the contact database's own lookup and check, never made up from a name.",
      },
      {
        title: "Only empty fields",
        body: "What your team typed is never overwritten; a job change is the one update, and it is recorded.",
      },
      {
        title: "Off until you switch it on",
        body: "Owners and admins choose what to fill, how often and the monthly cap.",
      },
    ],
    related: ["crm-integration", "company-and-lead-database", "lead-scoring"],
    plays: ["lead-reactivation", "closed-lost"],
  },

  "market-sourcing": {
    tagline: "A search that keeps finding new companies on its own.",
    intro:
      "New companies that fit appear every week. Schedule a saved Find leads search and it runs on its own, adds only the companies you don't have yet to a list, and can answer a recipe for each.",
    description:
      "Dialvo's always-on sourcing runs a saved Find leads search on a schedule, weekly by default, and adds new companies to a list, skipping what is already in your leads, CRM and never-contact list.",
    capabilities: [
      {
        title: "On a schedule",
        body: "Weekly by default, or any number of days from one to ninety.",
      },
      {
        title: "Only what's new",
        body: "Companies already in your leads, your CRM, your never-contact list or the list itself are left out.",
      },
      {
        title: "Researched as they arrive",
        body: "Give it a recipe and every new company is answered within the day's research limits.",
      },
      {
        title: "Into a list you can act on",
        body: "From the list, send the best to Leads or straight into a playbook.",
      },
    ],
    fit: [
      "Your market keeps growing without anyone remembering to search again.",
      "Each scheduled run is a normal Find leads run, with the same checks against your description and the same limits.",
    ],
    visual: {
      kind: "list",
      title: "Always on · UK multi-site gyms",
      note: "every 7 days",
      rows: [
        {
          name: "Calder Leisure",
          detail: "New this week · 3 sites",
          tag: "Added",
          strong: true,
        },
        {
          name: "Fernhill Fitness",
          detail: "New this week · opened a second site",
          tag: "Added",
          strong: true,
        },
        {
          name: "Harbor Fitness",
          detail: "Already in your leads",
          tag: "Skipped",
        },
      ],
      foot: "Sample run. All made up.",
    },
    controls: [
      {
        title: "Runs a month",
        body: "A monthly limit on scheduled runs per workspace, on top of Find leads' own daily limits.",
      },
      {
        title: "Owners decide",
        body: "Only owners and admins schedule searches, because they spend the daily allowance.",
      },
    ],
    related: [
      "live-web-search-prospecting",
      "lists-and-research",
      "saved-recipes",
    ],
    plays: ["outbound-lead-generation"],
  },

  "territory-planning": {
    tagline: "Fair territories, and leads that reach the right rep.",
    intro:
      "Split your market by country, state or region and company size, and give each part its reps. Dialvo shares the accounts out evenly, by number or by score, and every new lead in a territory goes to its rep straight away.",
    description:
      "Dialvo's territory planning defines territories by region, country, state and company size, assigns accounts to reps balanced by count or score, and feeds lead routing.",
    capabilities: [
      {
        title: "Territories as you draw them",
        body: "Countries, states or regions and company size bands, in the order you choose.",
      },
      {
        title: "Balanced assignment",
        body: "Best accounts first, each to the rep with the least so far, by number of accounts or total fit score.",
      },
      {
        title: "Into routing",
        body: "A new lead goes to its account's owner, then its territory's rep with the fewest open leads, then your routing rules.",
      },
      {
        title: "See the load",
        body: "Accounts and total fit per rep, side by side.",
      },
    ],
    fit: [
      "Territories decide who owns an account; routing makes sure every new conversation reaches them while it is still warm.",
    ],
    visual: {
      kind: "metrics",
      title: "Accounts per rep",
      note: "UK and Ireland",
      tiles: [
        { label: "Accounts", value: "120" },
        { label: "Reps", value: "3" },
      ],
      bars: [
        { label: "Alex", value: 40, note: "40 accounts" },
        { label: "Priya", value: 40, note: "40 accounts" },
        { label: "Tom", value: 40, note: "40 accounts" },
      ],
      foot: "Sample territory. All made up.",
    },
    controls: [
      {
        title: "Owners stay unless you say",
        body: "Accounts that have an owner keep them unless you choose to move them.",
      },
      {
        title: "Members only",
        body: "Only people in your workspace can be reps.",
      },
    ],
    related: [
      "intelligent-lead-routing",
      "account-based-lists",
      "lead-scoring",
    ],
    plays: ["speed-to-lead"],
  },

  "account-based-lists": {
    tagline: "Target the account, reach the whole buying group.",
    intro:
      "A deal is rarely one person. Make a list of target accounts, find the people who decide by job title, and see every lead, conversation and meeting at a company in one place. Then start a play for the whole account.",
    description:
      "Dialvo's account-based lists hold target accounts with their buying committee (found by title in the contact database), an account view of leads, conversations and meetings, and plays for a whole account.",
    capabilities: [
      {
        title: "Target account lists",
        body: "Turn any list of companies into target accounts with one click.",
      },
      {
        title: "The buying committee",
        body: "Give the titles that matter and Dialvo finds those people at the company, with their work emails where it can.",
      },
      {
        title: "One view per company",
        body: "Everyone you know there, their conversations and meetings, the owner and the territory.",
      },
      {
        title: "A play for the account",
        body: "Start a playbook for everyone at the account, each with their own first email.",
      },
    ],
    fit: [
      "Accounts connect the rest: leads at their domain are linked automatically, owners come from territories, and routing sends new people to the account's owner.",
    ],
    visual: {
      kind: "brief",
      title: "Account",
      note: "tier 1",
      heading: "Northgate Leisure",
      facts: [
        [
          "People",
          "4 (head of operations, finance director, two site managers)",
        ],
        ["Owner", "Priya"],
        ["Last conversation", "Replied on Tuesday"],
      ],
      points: [
        "Meeting booked for next week",
        "Playbook running for the other three",
      ],
      foot: "Sample account. All made up.",
    },
    controls: [
      {
        title: "Credits up front",
        body: "A committee search reserves its credits from the day's limit first and gives back what it didn't use.",
      },
      {
        title: "The usual rules",
        body: "A play on an account keeps every rule: never anyone on your never-contact list or already in a sequence.",
      },
    ],
    related: ["company-and-lead-database", "territory-planning", "playbooks"],
    plays: ["outbound-lead-generation", "customer-expansion"],
  },

  "saved-audiences": {
    tagline: "Segments that keep themselves up to date.",
    intro:
      "Save who you want to reach as filters, not a frozen list: stage, tier, scores, source, country, size, list membership and last activity. Whoever matches today is in it, and a playbook can pick from it every time it runs.",
    description:
      "Dialvo's saved audiences are dynamic segments over your leads that update themselves, usable as a playbook's source and for export.",
    capabilities: [
      {
        title: "Filters people understand",
        body: "Stage, tier, fit and engagement scores, source, country, company size, a list, activity and a recipe's answer.",
      },
      {
        title: "Always current",
        body: "Worked out again each time it is used, so new leads that match are in it.",
      },
      {
        title: "A source for plays",
        body: "Start a playbook on an audience, or choose it in a playbook's filters so every run picks from it.",
      },
      {
        title: "Out as a list or a file",
        body: "Make a list from an audience to research it, or export it as a CSV.",
      },
    ],
    fit: [
      "Audiences sit between scoring and outreach: tiers and scores decide who is in, playbooks decide what they hear.",
    ],
    visual: {
      kind: "list",
      title: "Audience · tier 1, quiet for 30 days",
      note: "today",
      rows: [
        {
          name: "Dana Reyes",
          detail: "Northgate Leisure · tier 1",
          tag: "In",
          strong: true,
        },
        {
          name: "Sam Ray",
          detail: "Northfield · tier 1",
          tag: "In",
          strong: true,
        },
        { name: "Lee Park", detail: "Replied yesterday", tag: "Left" },
      ],
      foot: "Sample audience. All made up.",
    },
    controls: [
      {
        title: "The usual rules",
        body: "A playbook started on an audience still leaves out anyone it may not write to.",
      },
    ],
    related: ["lead-scoring", "playbooks", "lists-and-research"],
    plays: ["lead-nurture", "lead-reactivation"],
  },
} satisfies Partial<Record<FeatureSlug, FeatureContent>>;
