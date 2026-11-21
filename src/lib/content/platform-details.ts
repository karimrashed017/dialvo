import type { FeatureSlug } from "./catalog";
import type { FeatureDetails } from "./types";

// The second half of every platform page: how the feature works, what it
// needs, and the questions people ask. Written from what the app does (its
// own notes are in src/lib/plays/catalog.ts); keep the two in step. A new
// feature in the catalog is a type error here until it has its entry.

export const FEATURE_DETAILS = {
  // --- Data & lead generation ---------------------------------------------------

  "company-and-lead-database": {
    steps: [
      {
        title: "Describe who you sell to",
        body: "In Find leads, write the kind of company and the people you want to reach.",
      },
      {
        title: "Dialvo searches the contact database",
        body: "Matching companies come back with named contacts and work emails, checked against your description.",
      },
      {
        title: "What you already have is left out",
        body: "Companies in your leads, your CRM or your never-contact list are skipped.",
      },
      {
        title: "Keep the ones you like",
        body: "Kept companies become leads, with a first email drafted for your approval.",
      },
    ],
    needs: [
      "A description of who you sell to",
      "The contact database switched on for your workspace",
      "A connected mailbox, to send the first emails",
    ],
    faqs: [
      {
        q: "Can I search by a company I already know?",
        a: "Yes. Besides a description, you can start from target accounts you name or ask for companies like one of your best customers.",
      },
      {
        q: "Are the emails guessed?",
        a: "No. Emails come from the contact database's own lookup. Where it finds none, the contact has no email rather than a made-up one.",
      },
    ],
  },

  "live-web-search-prospecting": {
    steps: [
      {
        title: "Write the audience in a sentence",
        body: "The way you'd brief a researcher: the kind of company, where, and what makes it a fit.",
      },
      {
        title: "Dialvo searches the web",
        body: "It finds candidate companies and reads each one's own website.",
      },
      {
        title: "Each match comes with its reason",
        body: "A sentence on why it fits, and the page it was found on.",
      },
      {
        title: "You choose what to keep",
        body: "Kept companies move on to a contact and a first email; the rest are left with the reason.",
      },
    ],
    needs: [
      "A description of who you sell to",
      "Nothing else: it works without the contact database",
    ],
    faqs: [
      {
        q: "How is this different from the database?",
        a: "The database is best for named contacts with emails. Web search is best for audiences no filter can describe, read from the companies' own sites.",
      },
      {
        q: "Can it be wrong?",
        a: "Yes. A web match is evidence, not proof, which is why the reason and the source are shown and you approve before anything is sent.",
      },
    ],
  },

  "lists-and-research": {
    steps: [
      {
        title: "Start a list",
        body: "From a Find leads search, a CSV, your leads or the leads linked to your CRM.",
      },
      {
        title: "Add a research column",
        body: "Write a plain question and choose the answer type: yes or no, a number, a score, one of your options or a short answer.",
      },
      {
        title: "See the cost, then run it",
        body: "Pick the rows and columns, check the estimate, and Dialvo researches each row with web search.",
      },
      {
        title: "Act on the answers",
        body: "Send the rows you want to Leads or a playbook, or export the list with every answer and source.",
      },
    ],
    needs: [
      "Some companies or people to start from",
      "The contact database switched on, for email and title lookups",
    ],
    faqs: [
      {
        q: "What kind of question works best?",
        a: "Something a person could check on a company's website or in the news in a minute or two, such as whether they have more than one site.",
      },
      {
        q: "What happens when the answer can't be found?",
        a: "The cell says it wasn't found. It isn't filled with a guess.",
      },
      {
        q: "Is there a limit?",
        a: "Yes. Each workspace has daily limits on research answers, research spend and contact lookups, checked before anything runs.",
      },
    ],
  },

  "market-sourcing": {
    steps: [
      {
        title: "Save a Find leads search",
        body: "Any search you've run can become an always-on one.",
      },
      {
        title: "Choose how often",
        body: "Weekly to start, or any number of days from one to ninety.",
      },
      {
        title: "New companies land in a list",
        body: "Each run adds only companies you don't have yet, and can answer a saved recipe for each.",
      },
      {
        title: "Work the list",
        body: "Send the best to Leads or straight into a playbook.",
      },
    ],
    needs: ["A saved Find leads search", "An owner or admin to schedule it"],
    faqs: [
      {
        q: "Will it bring back companies I've already contacted?",
        a: "No. Companies in your leads, your CRM, your never-contact list or the list itself are skipped.",
      },
      {
        q: "Does it send anything by itself?",
        a: "No. It fills a list. Outreach starts only when you send rows to a playbook, and drafts follow that playbook's approval rules.",
      },
    ],
  },

  "crm-enrichment": {
    steps: [
      {
        title: "Switch it on and choose what to fill",
        body: "Work emails, titles, company size and industry; and whether to check emails and job changes.",
      },
      {
        title: "Set the schedule and the cap",
        body: "Monthly to start, with a monthly credit cap you choose.",
      },
      {
        title: "Dialvo fills the gaps",
        body: "Only empty fields are filled, from the contact database's own lookups.",
      },
      {
        title: "Changes are noted",
        body: "A job change or a dead email is noted on the lead, and written to your CRM as a note.",
      },
    ],
    needs: [
      "The contact database switched on",
      "An owner or admin to switch enrichment on",
      "A connected CRM, if you want changes noted there",
    ],
    faqs: [
      {
        q: "Will it overwrite what my team typed?",
        a: "No. It fills empty fields only. A job change updates the title, and that update is recorded.",
      },
      {
        q: "Does it change my CRM's fields?",
        a: "No. Changes go to the contact in your CRM as a note; its own fields are left alone.",
      },
    ],
  },

  "website-visitor-tracking": {
    steps: [
      {
        title: "Add the website chat's code to your site",
        body: "One snippet does both: the chat and the page-view tracking.",
      },
      {
        title: "Visits are recorded with consent",
        body: "Page views are kept for visitors who allow it, never for browsers that send Do Not Track.",
      },
      {
        title: "Known leads and companies are recognised",
        body: "A lead is recognised once they chat, fill in a form or click a link in your email. Companies are recognised by their network once company lookup is on.",
      },
      {
        title: "Act on what they read",
        body: "See who read your pricing page on Website visitors, and let the retargeting play draft a note for your approval.",
      },
    ],
    needs: [
      "The website chat's code on your site",
      "Visitor tracking switched on in the app",
      "Company lookup set up on Dialvo's side, to name anonymous companies",
    ],
    faqs: [
      {
        q: "Does it name the person reading?",
        a: "Only when they're already one of your leads. Anonymous visitors are shown as their company at most, never as a person.",
      },
      {
        q: "Do your emails mention the visit?",
        a: "No. A note that follows a visit never says the person was on your site.",
      },
      {
        q: "What's stored about a visitor?",
        a: "The pages they viewed. The IP address itself isn't kept, nor the query string of a page.",
      },
    ],
  },

  "company-news": {
    steps: [
      {
        title: "An admin switches it on",
        body: "News checks are off until someone chooses to use them.",
      },
      {
        title: "Your companies are checked weekly",
        body: "Target accounts and leads' companies, up to 100, each get a web search for recent news.",
      },
      {
        title: "Items appear on Signals",
        body: "Funding, launches, leadership hires and expansions, each with the link to its source.",
      },
      {
        title: "Keep the ones worth acting on",
        body: "On a lead, a note and a fresh brief. For an account, a contact found and an email drafted for approval.",
      },
    ],
    needs: [
      "Target accounts or leads with a company website",
      "An admin to switch news checks on",
    ],
    faqs: [
      {
        q: "Does a news item send an email?",
        a: "No. You choose which items to keep, and any email that follows is a draft waiting for your approval.",
      },
      {
        q: "Where does the news come from?",
        a: "A web search of public news. Each item links to where it was reported, so you can read it yourself.",
      },
    ],
  },

  // --- Scoring & accounts ---------------------------------------------------------

  "lead-qualification": {
    steps: [
      {
        title: "Describe a good fit",
        body: "Who you sell to, in your own words, in Find leads.",
      },
      {
        title: "Each company is checked",
        body: "Its website is read and compared with your description.",
      },
      {
        title: "Misfits are left out, with the reason",
        body: "Companies that don't fit, competitors and very large companies are set aside and the reason shown.",
      },
      {
        title: "Only fits get an email",
        body: "First emails are drafted for the companies that pass, and wait for your approval.",
      },
    ],
    needs: ["A description of who you sell to"],
    faqs: [
      {
        q: "Can I overrule it?",
        a: "Yes. You decide what's kept. The reason is shown so you can judge it quickly.",
      },
      {
        q: "Does it score inbound leads too?",
        a: "Inbound leads are qualified in conversation by the chat and the phone agent. Lead scoring then gives every lead a fit score and a tier.",
      },
    ],
  },

  "lead-scoring": {
    steps: [
      {
        title: "Write the fit rules",
        body: "Start from your Find leads description in one click, then adjust countries, sizes, titles and sources.",
      },
      {
        title: "Engagement is counted for you",
        body: "Replies, chats, forms, page visits, product events and meetings add points. Opens don't.",
      },
      {
        title: "Set where the tiers start",
        body: "Choose the scores for tier 1 and tier 2, and how much engagement counts against fit.",
      },
      {
        title: "Use the tiers",
        body: "Tiers show on Leads and can be used in routing rules, saved audiences and playbooks.",
      },
    ],
    needs: ["Leads in Dialvo", "An owner or admin to set the rules"],
    faqs: [
      {
        q: "Why don't email opens count?",
        a: "Dialvo doesn't track opens. They're unreliable, and they'd make a score look better than it is.",
      },
      {
        q: "Can I see why a lead is tier 1?",
        a: "Yes. Each lead shows which fit rules it met and what earned its engagement points.",
      },
    ],
  },

  "account-based-lists": {
    steps: [
      {
        title: "Make target accounts",
        body: "From a list of companies in one click, or one company at a time.",
      },
      {
        title: "Find the buying committee",
        body: "Give the job titles that matter and Dialvo looks those people up in the contact database.",
      },
      {
        title: "See the account in one place",
        body: "Everyone you know there, their conversations and meetings, the owner and the territory.",
      },
      {
        title: "Run a play for the whole account",
        body: "Start a playbook for everyone at the company, each with their own first email.",
      },
    ],
    needs: [
      "Companies to target",
      "The contact database switched on, to find the committee",
    ],
    faqs: [
      {
        q: "Will several people at one company get the same email?",
        a: "No. Each person's first email is written for them, and the usual rules still apply: nobody on your never-contact list, nobody already in a sequence.",
      },
      {
        q: "Are existing leads linked automatically?",
        a: "Yes. Leads whose email is at the account's domain appear on its page.",
      },
    ],
  },

  "territory-planning": {
    steps: [
      {
        title: "Draw the territories",
        body: "By country, state or region and company size, in the order you choose.",
      },
      {
        title: "Add the reps",
        body: "Any member of your workspace can be a territory's rep.",
      },
      {
        title: "Share out the accounts",
        body: "Balanced by number of accounts or by total fit score. Accounts that have an owner keep them unless you say.",
      },
      {
        title: "New leads follow",
        body: "A new lead goes to its account's owner, then the territory's rep, then your routing rules.",
      },
    ],
    needs: [
      "Teammates in your workspace",
      "Target accounts, or leads with a country and company size",
    ],
    faqs: [
      {
        q: "Does it replace routing rules?",
        a: "No. Territories are checked first; leads outside every territory fall through to your routing rules.",
      },
      {
        q: "Can I rebalance later?",
        a: "Yes. Run the share-out again whenever the team changes.",
      },
    ],
  },

  "saved-audiences": {
    steps: [
      {
        title: "Choose the filters",
        body: "Stage, tier, scores, source, country, size, a list, last activity or a recipe's answer.",
      },
      {
        title: "Save it by name",
        body: "The audience is the filters, not a frozen copy of today's leads.",
      },
      {
        title: "Use it",
        body: "Start a playbook on it, choose it in a playbook's filters, make a list from it, or export it.",
      },
    ],
    needs: ["Leads in Dialvo"],
    faqs: [
      {
        q: "Does it update by itself?",
        a: "Yes. It's worked out again each time it's used, so leads that match today are in it.",
      },
      {
        q: "Can it bypass opt-outs?",
        a: "No. A playbook started on an audience still leaves out anyone it may not write to.",
      },
    ],
  },

  "ad-audiences": {
    steps: [
      {
        title: "Build an audience",
        body: "People or companies from your leads, filtered by stage, source, country, owner, play or date added.",
      },
      {
        title: "Pick the platform",
        body: "LinkedIn contact or company list, Meta customer list or Google Ads Customer Match.",
      },
      {
        title: "Download the file",
        body: "In the platform's own format, with emails hashed where the platform accepts it.",
      },
      {
        title: "Upload it yourself",
        body: "Add the file in your ad account, as an audience or as an exclusion.",
      },
    ],
    needs: [
      "Leads in Dialvo",
      "An ad account on the platform you're uploading to",
      "Your own check that you may use the data for ads",
    ],
    faqs: [
      {
        q: "Does it sync with my ad accounts?",
        a: "Not yet. Direct sync needs each platform's partner approval, which Dialvo doesn't have, so you download the file and upload it.",
      },
      {
        q: "What's a suppression list for?",
        a: "Excluding customers, or people who opted out, from a campaign so they don't see ads meant for new buyers.",
      },
    ],
  },

  // --- Outreach & workflows ----------------------------------------------------------

  "multi-channel-sequences": {
    steps: [
      {
        title: "Start with email",
        body: "Every sequence has a first email and its follow-ups, sent from your own mailbox.",
      },
      {
        title: "Add text and LinkedIn steps",
        body: "Under Sequences, channels: a text on a given day, or a LinkedIn message.",
      },
      {
        title: "Texts go only to people who agreed",
        body: "A text step is skipped for anyone without a recorded opt-in, and every text ends with how to stop.",
      },
      {
        title: "LinkedIn becomes a task",
        body: "Dialvo writes the message; the person sends it from their own profile and marks it done.",
      },
      {
        title: "A reply stops everything",
        body: "A reply on any channel ends every remaining step for that lead.",
      },
    ],
    needs: [
      "A connected mailbox",
      "A Twilio number for text steps, and leads who agreed to texts",
      "Someone to send LinkedIn tasks from their own profile",
    ],
    faqs: [
      {
        q: "Does Dialvo call people as part of a sequence?",
        a: "No. There are no call steps. Dialvo never makes outbound calls; its phone agent only answers.",
      },
      {
        q: "Does Dialvo log in to LinkedIn for me?",
        a: "No. LinkedIn steps are tasks: the message is written for you and you send it from your own profile. A small number are handed out each day.",
      },
      {
        q: "What about WhatsApp?",
        a: "Sequence steps are email, text and LinkedIn today.",
      },
    ],
  },

  "sequence-builder": {
    steps: [
      {
        title: "Name the sequence",
        body: "Start from a ready-made one or a blank sequence.",
      },
      {
        title: "Add up to five follow-ups",
        body: "After the first email, add, remove and reorder follow-ups. Each has its own wait and its own instructions.",
      },
      {
        title: "Choose the language and approval",
        body: "Pick a language or leave it on auto, and decide whether each email waits for you.",
      },
      {
        title: "Use it in a play",
        body: "Plays and playbooks run on the sequence you choose.",
      },
    ],
    needs: ["A connected mailbox", "Something useful in Knowledge"],
    faqs: [
      {
        q: "Are follow-ups written in advance?",
        a: "No. Each is written when it's due, from your instructions and what's happened so far, and kept short.",
      },
      {
        q: "Can it branch on opens or clicks?",
        a: "No. Dialvo doesn't track opens. A sequence runs its steps in order and stops when the person replies.",
      },
      {
        q: "How long can a step wait?",
        a: "Up to 60 days after the email before it.",
      },
    ],
  },

  "smart-replies": {
    steps: [
      {
        title: "Replies are read as they arrive",
        body: "Your connected inbox is checked every few minutes.",
      },
      {
        title: "Each one is sorted",
        body: "Interested, question, not now, not interested or unsubscribe, with the sequence stopped for that person.",
      },
      {
        title: "An answer is drafted",
        body: "From your Knowledge, waiting in the Inbox for you to send or edit.",
      },
      {
        title: "Opt-outs take effect at once",
        body: "A request to stop ends every step for that person, and they aren't written to again.",
      },
    ],
    needs: [
      "A connected mailbox with reading switched on",
      "Knowledge to answer from",
    ],
    faqs: [
      {
        q: "Does it send answers by itself?",
        a: "Answers are drafted in the Inbox for you to send. Nothing in a reply thread goes out without you.",
      },
      {
        q: "Can it book a meeting?",
        a: "When someone wants to talk, the answer offers your booking link and your team is told.",
      },
    ],
  },

  "multilingual-outreach": {
    steps: [
      {
        title: "Pick a language, or leave it on auto",
        body: "Per sequence, play or playbook. Auto uses the language of the company's own website.",
      },
      {
        title: "Emails are written in it",
        body: "First emails and follow-ups are written in that language, not translated afterwards.",
      },
      {
        title: "The chat follows the visitor",
        body: "The website chat answers in the language the visitor writes in.",
      },
    ],
    needs: ["Knowledge that covers the markets you sell to"],
    faqs: [
      {
        q: "Should someone check the first emails?",
        a: "Yes, for a new language. Keep approval on until someone who speaks it is happy with the tone.",
      },
      {
        q: "Is my team's view translated?",
        a: "Summaries and notes for your team stay in your own language.",
      },
    ],
  },

  workflows: {
    steps: [
      {
        title: "Choose the trigger",
        body: "A lead added, a stage change, a sorted reply, a chat needing a person, a meeting booked, a kept signal, your webhook, or a schedule.",
      },
      {
        title: "Add conditions",
        body: "Only when the lead's stage, source, country, size, company, email or owner match.",
      },
      {
        title: "Add the steps",
        body: "Research the company, add to a play, assign or route, change stage, post to Slack, call a webhook, make a task or add a note.",
      },
      {
        title: "Switch it on and watch the log",
        body: "Every run is logged with what each step did.",
      },
    ],
    needs: [
      "Leads in Dialvo",
      "Slack connected, for Slack steps",
      "Your own endpoint, for webhook steps",
    ],
    faqs: [
      {
        q: "Can a workflow email someone?",
        a: "Not directly. It can add a lead to a play, and the play writes a draft under its own rules.",
      },
      {
        q: "How many can run?",
        a: "Up to 500 runs a day per workspace. Past that, new events wait for the next day.",
      },
    ],
  },

  // --- Research & messaging -------------------------------------------------------------

  "deep-research": {
    steps: [
      {
        title: "A company is found or added",
        body: "From Find leads, a list, a signal or your own leads.",
      },
      {
        title: "Its website is read",
        body: "Dialvo reads the company's own pages and picks out the facts worth knowing.",
      },
      {
        title: "Facts are kept with their source",
        body: "Each useful fact keeps the page it came from.",
      },
      {
        title: "The first email starts from it",
        body: "The opening line uses a fact from that company's research.",
      },
    ],
    needs: ["Companies with a website"],
    faqs: [
      {
        q: "Does it read paywalled or private pages?",
        a: "No. It reads public pages only and never logs in anywhere.",
      },
      {
        q: "Can I see what it found?",
        a: "Yes. The facts and their pages are on the company, next to the email they shaped.",
      },
    ],
  },

  "account-briefs": {
    steps: [
      {
        title: "Connect your meetings",
        body: "Meetings booked in Dialvo count already. Add one on a lead, or paste each person's secret iCal address.",
      },
      {
        title: "A brief is made before each meeting",
        body: "From the company's website, a short web search and every past message, call and note.",
      },
      {
        title: "It reaches the right person",
        body: "In the app, by email to the meeting's owner, and in Slack if connected.",
      },
      {
        title: "Lost deals get a note",
        body: "When a lead is marked lost, a short note on why, for whoever picks it up later.",
      },
    ],
    needs: [
      "Meetings in Dialvo, or an iCal address for each person's calendar",
      "Slack connected, if you want briefs posted there",
    ],
    faqs: [
      {
        q: "Do I have to sign in with my calendar?",
        a: "No. Dialvo reads the secret iCal address you paste, and never writes to your calendar.",
      },
      {
        q: "Can I ask for one without a meeting?",
        a: "Yes. Ask for a brief on any lead at any time, within the day's limit.",
      },
    ],
  },

  "saved-recipes": {
    steps: [
      {
        title: "Write the question once",
        body: "Save any research column on a list as a recipe, or write a new one.",
      },
      {
        title: "Choose the answer",
        body: "A yes or no, a number, one of your options, a short answer, or a score from 0 to 100.",
      },
      {
        title: "Use it anywhere",
        body: "On any list, on always-on searches, in lead scoring, and in audience and playbook filters.",
      },
    ],
    needs: ["A question worth asking about many companies"],
    faqs: [
      {
        q: "If I change a recipe, do old columns change?",
        a: "No. Columns made from a recipe keep the question they were made with.",
      },
      {
        q: "Do recipes cost extra?",
        a: "They count against the same daily research limits as any research column.",
      },
    ],
  },

  "ai-personalisation": {
    steps: [
      {
        title: "Research comes first",
        body: "Each company's website is read before anything is written.",
      },
      {
        title: "One email for one person",
        body: "The first email opens with a fact from that company's research, not a merge field.",
      },
      {
        title: "You approve it",
        body: "Every first email waits for your approval before it's sent.",
      },
    ],
    needs: ["Knowledge about what you offer", "A connected mailbox"],
    faqs: [
      {
        q: "Will it make claims about my product I can't back?",
        a: "It writes only from your Knowledge. If something isn't there, it isn't claimed.",
      },
      {
        q: "Can I edit a draft?",
        a: "Yes. Edit, approve or discard each one.",
      },
    ],
  },

  playbooks: {
    steps: [
      {
        title: "Pick a ready-made play or write your own",
        body: "Ready-made plays cover the common situations; your own playbooks cover the rest.",
      },
      {
        title: "Choose who it picks",
        body: "Leads by stage, how long they've been quiet and where they came from.",
      },
      {
        title: "Set the goal and the sequence",
        body: "What the first email should achieve, which sequence follows, and its language.",
      },
      {
        title: "Decide on approval",
        body: "Have every draft wait for you, or let it send under your limits.",
      },
    ],
    needs: [
      "Leads in Dialvo",
      "A connected mailbox",
      "Knowledge for the agents to write from",
    ],
    faqs: [
      {
        q: "Will the same lead be picked every time?",
        a: "No. A playbook doesn't pick a lead again within the number of days you set.",
      },
      {
        q: "Who can a playbook never write to?",
        a: "Anyone on your never-contact list, anyone who unsubscribed and anyone who asked not to be contacted.",
      },
    ],
  },

  "knowledge-base": {
    steps: [
      {
        title: "Add your pages",
        body: "Point Dialvo at your website's pages, or paste notes and answers.",
      },
      {
        title: "Agents read it",
        body: "Every email, chat answer and phone answer is written from it.",
      },
      {
        title: "Keep it current",
        body: "Change a page or an answer and the next message uses it.",
      },
    ],
    needs: ["Your website, or notes on what you sell and how"],
    faqs: [
      {
        q: "What if a question isn't covered?",
        a: "Agents only state facts that are in your Knowledge. If something isn't there, they don't make it up.",
      },
      {
        q: "Can it read my website?",
        a: "Yes. Add a page by its address, and refresh it when the page changes.",
      },
    ],
  },

  // --- Inbound handling -----------------------------------------------------------------

  "ai-phone-agent": {
    steps: [
      {
        title: "Get a number",
        body: "Buy a local Twilio number in the app, or forward your existing line to it.",
      },
      {
        title: "Callers are answered at once",
        body: "The agent greets them, says the call is transcribed and answers from your Knowledge.",
      },
      {
        title: "It qualifies, and helps them book",
        body: "It asks your questions and, when the caller wants a meeting, texts them your booking link.",
      },
      {
        title: "A person when needed",
        body: "It transfers the call to your team when the caller asks or the situation needs it.",
      },
      {
        title: "Everything is on the lead",
        body: "The transcript and a summary are saved on the lead when the call ends.",
      },
    ],
    needs: [
      "A phone number from the app, or your line forwarded to one",
      "Knowledge to answer from",
      "A number to transfer calls to",
      "A booking link, if callers should be able to book",
    ],
    faqs: [
      {
        q: "Does it ever make calls?",
        a: "No. It only answers calls people make to your number. Dialvo never makes outbound calls.",
      },
      {
        q: "Does it book on our calendar?",
        a: "It texts the caller your booking link, and they pick a time on your own scheduling page.",
      },
      {
        q: "Is there a limit?",
        a: "Each workspace has a daily number of answered calls, and your plan sets the monthly allowance.",
      },
    ],
  },

  "inbound-lead-qualification": {
    steps: [
      {
        title: "Write your questions",
        body: "What you need to know before a lead is worth a rep's time.",
      },
      {
        title: "The chat asks them",
        body: "In the conversation, naturally, while answering the visitor's own questions from your Knowledge.",
      },
      {
        title: "Good fits go to your team",
        body: "With the answers attached, and the booking link offered when they want to talk.",
      },
    ],
    needs: [
      "The website chat on your site",
      "Your qualifying questions",
      "Knowledge to answer from",
    ],
    faqs: [
      {
        q: "Does the phone agent ask the same questions?",
        a: "Yes. It works from the same questions and Knowledge on calls to your number.",
      },
      {
        q: "What happens to leads that don't fit?",
        a: "They're answered politely and recorded, and don't take a rep's time.",
      },
    ],
  },

  "intelligent-lead-routing": {
    steps: [
      {
        title: "Write the rules",
        body: "Match leads by country, company size, source or the play they came from.",
      },
      {
        title: "Choose who gets them",
        body: "One teammate, or several taking turns.",
      },
      {
        title: "New leads are assigned at once",
        body: "When a lead is added, and again when its first email thread starts.",
      },
      {
        title: "The owner is told",
        body: "The person a lead goes to gets an alert, and owns its conversations.",
      },
    ],
    needs: [
      "Teammates in your workspace",
      "An owner or admin to write the rules",
    ],
    faqs: [
      {
        q: "Which rule wins?",
        a: "Rules are checked in the order you set them; the first one that matches decides.",
      },
      {
        q: "Does it check calendars?",
        a: "No. Routing decides the owner; booking happens on your own scheduling page.",
      },
    ],
  },

  // --- Analytics & deliverability ------------------------------------------------------------

  analytics: {
    steps: [
      {
        title: "Everything is counted as it happens",
        body: "Leads found, emails sent, replies, meetings and chats.",
      },
      {
        title: "Choose the period",
        body: "The last 7, 30 or 90 days.",
      },
      {
        title: "Break it down",
        body: "By play, by search and by mailbox, to see what's working.",
      },
    ],
    needs: ["Some activity: the numbers fill in as Dialvo works"],
    faqs: [
      {
        q: "Are opens counted?",
        a: "No. Dialvo doesn't track opens; replies and meetings are the numbers that matter.",
      },
      {
        q: "Can I get the numbers out?",
        a: "Through the API you can read leads, conversations and meetings for your own reports.",
      },
    ],
  },

  "deliverability-and-mailbox-health": {
    steps: [
      {
        title: "Connect a mailbox",
        body: "Your own address on your own domain, so email goes out as you.",
      },
      {
        title: "Check the DNS",
        body: "SPF, DKIM, DMARC and MX are checked, with a plain fix for anything missing.",
      },
      {
        title: "It ramps up slowly",
        body: "A new mailbox starts at 10 emails a day and adds 5 a day up to its limit.",
      },
      {
        title: "It pauses itself if needed",
        body: "If bounces or unsubscribes run high over two weeks, the mailbox stops sending and your team is told.",
      },
    ],
    needs: [
      "A mailbox you can connect (address, password or app password, mail server)",
      "Access to your domain's DNS, to fix anything the check finds",
    ],
    faqs: [
      {
        q: "How many emails a day?",
        a: "30 per mailbox once ramped up, unless you set it lower; never more than 50. A workspace has its own daily total across mailboxes.",
      },
      {
        q: "Do you test inbox placement?",
        a: "No. Dialvo follows good sending practice and shows you the signals, but nobody can promise where a provider puts a message.",
      },
    ],
  },

  "call-deliverability-and-number-management": {
    steps: [
      {
        title: "Choose a number",
        body: "A local number in the US or Canada, with its monthly price shown first.",
      },
      {
        title: "The owner confirms",
        body: "Only the workspace owner can buy or release a number.",
      },
      {
        title: "The phone agent answers it",
        body: "Calls to the number go straight to the agent, day and night.",
      },
      {
        title: "See the calls",
        body: "Calls received per number, with each transcript on its lead.",
      },
    ],
    needs: [
      "Twilio set up for your workspace",
      "The workspace owner, to buy or release numbers",
    ],
    faqs: [
      {
        q: "Can I keep my own number?",
        a: "Yes. Forward your existing line to a Dialvo number with your phone provider.",
      },
      {
        q: "Are the numbers used to call out?",
        a: "Never. Dialvo never makes outbound calls, from these numbers or any other.",
      },
      {
        q: "How many numbers can I have?",
        a: "A few per workspace, each within a monthly price cap, so a mistake can't run up a bill.",
      },
    ],
  },

  // --- Integrations ---------------------------------------------------------------------

  "crm-integration": {
    steps: [
      {
        title: "Connect HubSpot or Pipedrive",
        body: "With a private app token or API token from your CRM.",
      },
      {
        title: "Your contacts are kept out of cold email",
        body: "Dialvo imports emails and domains, and never cold-emails people your CRM already knows.",
      },
      {
        title: "New leads are written in",
        body: "As contacts or people, matched by email. An existing record is never changed.",
      },
      {
        title: "Conversations and meetings follow",
        body: "Chats, emails and replies as notes; meetings as meetings; and a deal when a lead qualifies, if you choose.",
      },
    ],
    needs: [
      "A HubSpot or Pipedrive account",
      "A token from it with the permissions the setup page lists",
    ],
    faqs: [
      {
        q: "Do you support Salesforce?",
        a: "Not yet. HubSpot and Pipedrive work today.",
      },
      {
        q: "Will it overwrite our records?",
        a: "No. It creates new contacts and adds notes and meetings. Existing contacts' fields are left alone.",
      },
      {
        q: "Are opt-outs shared?",
        a: "Yes. Someone marked do not contact or unsubscribed in Dialvo is marked in your CRM too, where your token allows it.",
      },
    ],
  },

  "slack-integration": {
    steps: [
      {
        title: "Make a Slack webhook",
        body: "In Slack, create an incoming webhook for the channel you want.",
      },
      {
        title: "Paste it into Dialvo",
        body: "Under Settings, Slack, and send a test post.",
      },
      {
        title: "Choose the events",
        body: "Hot replies, chats that need a person, meetings booked, a daily approvals digest and finished plays.",
      },
    ],
    needs: ["A Slack workspace where you can add an incoming webhook"],
    faqs: [
      {
        q: "Can I approve emails from Slack?",
        a: "No. Slack tells you something is waiting; approving stays in the app.",
      },
      {
        q: "Can different events go to different channels?",
        a: "Posts go to the one channel of the webhook you paste.",
      },
    ],
  },

  api: {
    steps: [
      {
        title: "Create a key",
        body: "Under Settings, API, for your workspace.",
      },
      {
        title: "Send leads and events in",
        body: "Create leads, add them to plays, and send product events such as trial_started or limit_reached.",
      },
      {
        title: "Read results out",
        body: "Fetch leads, conversations, plays and meetings.",
      },
      {
        title: "Get told as it happens",
        body: "Register a webhook for new leads, replies and booked meetings. Each delivery is signed.",
      },
    ],
    needs: [
      "Someone who can make HTTP requests from your systems",
      "An owner or admin to create the key",
    ],
    faqs: [
      {
        q: "Which webhook events are there?",
        a: "lead.created, reply.received and meeting.booked.",
      },
      {
        q: "Does the API skip the rules?",
        a: "No. A lead added through the API is treated like any other: opt-outs, limits and approvals still apply.",
      },
    ],
  },

  "mcp-server": {
    steps: [
      {
        title: "Create a key",
        body: "Under Settings, a personal or workspace key, read-only or with write access.",
      },
      {
        title: "Add Dialvo to your AI tool",
        body: "Point Claude Code, Claude Desktop, Cursor, VS Code or another MCP app at Dialvo's server address with the key.",
      },
      {
        title: "Ask in plain words",
        body: "Look up a lead, find contacts at a company, add a lead to a play, or get a brief for a meeting.",
      },
    ],
    needs: [
      "An AI tool that supports remote MCP servers with a key",
      "A Dialvo key from Settings",
    ],
    faqs: [
      {
        q: "Can it send emails?",
        a: "No. With write access it can add a lead or add one to a play; the play's own approvals decide what's sent.",
      },
      {
        q: "Does it work with browser connectors that ask me to sign in?",
        a: "Not yet. Connectors that need an OAuth sign-in aren't supported; tools that connect with a key are.",
      },
    ],
  },

  "review-site-intent": {
    steps: [
      {
        title: "Bring in your intent data",
        body: "Upload your review site's export (CSV), send it to Dialvo's webhook, or connect a G2 Buyer Intent token.",
      },
      {
        title: "Companies appear on Signals",
        body: "Each with what they were researching and when.",
      },
      {
        title: "Keep the ones worth acting on",
        body: "Dialvo finds a contact at the company and drafts an email for your approval.",
      },
    ],
    needs: [
      "Buyer-intent data from your own review-site account",
      "The contact database switched on, to find a contact",
      "A connected mailbox",
    ],
    faqs: [
      {
        q: "Does Dialvo sell intent data?",
        a: "No. It uses the data your own review-site subscription gives you.",
      },
      {
        q: "Does the email mention the review site?",
        a: "No. It speaks to the problem they're likely researching, not to how you know.",
      },
    ],
  },
} satisfies Record<FeatureSlug, FeatureDetails>;
