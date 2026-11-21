import type { PlaySlug } from "./catalog";
import type { PlayContent } from "./types";

// The inbound plays. People and businesses in the sample panels are made up.

export const INBOUND_PLAYS = {
  "speed-to-lead": {
    promise: "Reach every new lead while they're still on your website.",
    intro:
      "Someone fills in your form because they want to talk now. Dialvo replies by email or opens a chat within seconds, qualifies them and puts a meeting on your calendar before they open a second tab.",
    description:
      "Dialvo's speed-to-lead play replies to every new form lead by email or chat within seconds, day or night, qualifies them and books the meeting with the right rep.",
    situation: {
      title: "The lead is ready now. Your team is in a meeting.",
      body: [
        "Interest is at its highest in the minutes after someone asks to be contacted. Then they go back to their inbox, or to the next supplier on their list. The business that answers first usually gets the conversation.",
        "Your reps can't sit waiting for forms. They're on calls, in demos, at lunch or asleep. A lead that arrives at 9pm on a Friday hears from you on Monday, when it has already spoken to somebody else.",
        "You paid for that lead with ad spend, content or referrals. Every one that waits a day is money you've already spent and may never see back.",
      ],
    },
    steps: [
      {
        title: "The form lands in Dialvo",
        body: "Point your website form, ad lead form or CRM at Dialvo. A new submission starts the play at once, with everything the person typed attached.",
      },
      {
        title: "An agent replies within seconds",
        body: "The email agent writes back about their request straight away. If they're still on the site, the chat agent can open the conversation instead. Dialvo never calls them.",
      },
      {
        title: "It qualifies in the same conversation",
        body: "The agent asks your questions (need, timing, budget, who decides), answers product questions from your knowledge base and scores the lead against your ideal customer.",
      },
      {
        title: "A meeting is booked",
        body: "Good fits pick a time on the right rep's calendar there and then, from the link in the reply or in the chat.",
      },
      {
        title: "No answer? It keeps trying, politely",
        body: "Follow-up emails go out inside your send window, plus a text or WhatsApp with a link to book for people who agreed to them. The lead only stops hearing from you when they book, decline or opt out.",
      },
      {
        title: "Everything is written to the CRM",
        body: "The conversation, answers and outcome land on the lead's record, and your team gets a Slack note for every booked meeting.",
      },
    ],
    visual: {
      kind: "timeline",
      title: "New lead · Lena Ortiz",
      note: "Bright Smile Dental",
      steps: [
        {
          when: "21:14:02",
          channel: "Form",
          text: "Asked for a quote on a new booking site",
          done: true,
        },
        {
          when: "21:14:31",
          channel: "Email",
          text: "Agent replied, with two times to talk",
          done: true,
        },
        {
          when: "21:17",
          channel: "Email",
          text: "Qualified: two clinics, wants to go live this quarter",
          done: true,
        },
        {
          when: "21:19",
          channel: "Calendar",
          text: "Booked with Priya, Tuesday 10:30",
          done: true,
        },
        {
          when: "21:19",
          channel: "CRM",
          text: "Conversation, answers and score saved to the lead",
        },
      ],
      foot: "Sample timeline. Times are for illustration.",
    },
    channels: ["email", "chat", "messages"],
    features: [
      "inbound-lead-qualification",
      "intelligent-lead-routing",
      "crm-integration",
    ],
    setup: [
      "Connect your form, or send new CRM leads to Dialvo.",
      "Add your qualifying questions and what counts as a good fit.",
      "Connect your reps' calendars and set who gets which leads.",
      "Add consent wording to the form if you want texts sent as well.",
    ],
    faqs: [
      {
        q: "Does Dialvo call the lead?",
        a: "No. Dialvo never makes outbound calls. It replies by email and chat, and texts only people who agreed to them. If the lead rings your number, the phone agent answers.",
      },
      {
        q: "What if the lead would rather talk to a person?",
        a: "They can say so at any point. The agent passes the conversation to a rep, or books the first open slot with a person.",
      },
      {
        q: "What happens outside office hours?",
        a: "The agent replies at any hour and books into your reps' working calendars. You can also set quiet hours so nobody gets a text late at night.",
      },
      {
        q: "Does it work with the forms I already have?",
        a: "Yes. Anything that can post to a webhook or create a lead in Salesforce, HubSpot, Pipedrive or Zoho can start the play. There's an API for everything else.",
      },
    ],
    related: [
      "automated-meeting-scheduling",
      "lead-nurture",
      "retargeting-website-visitors",
    ],
  },

  "automated-meeting-scheduling": {
    promise: "Your booking link, offered the moment someone wants to talk.",
    intro:
      "Add your booking link once. When someone replies to an email wanting to meet, asks for a meeting in your website chat or on a call, Dialvo offers that link straight away and tells your team. Bookings made from the chat are recorded on the lead.",
    description:
      "Dialvo offers your booking link the moment a lead wants to meet, in email replies, the website chat and on calls to your phone agent, tells your team, and records bookings on the lead when your scheduling page sends people back.",
    situation: {
      title: "Scheduling quietly eats deals",
      body: [
        "Between a lead saying yes and the meeting happening, there is a gap. A reply that waits until tomorrow. Three emails to find a time. Each step loses a few people who were ready to talk.",
        "The fix isn't another tool. It's making sure that whenever someone says they want to talk, the way to book is in front of them in the same minute.",
      ],
    },
    steps: [
      {
        title: "Add your booking link",
        body: "Any scheduling page works. Set its redirect after booking to Dialvo's link, so bookings come back.",
      },
      {
        title: "In the chat, it's offered in the conversation",
        body: "When a visitor wants to meet, the website chat offers your link right there.",
      },
      {
        title: "In email, the answer carries it",
        body: "When a reply is sorted as interested, the drafted answer offers your link and your team is told.",
      },
      {
        title: "On a call, it's sent by text",
        body: "When a caller asks for a meeting, the phone agent texts them your link.",
      },
      {
        title: "The booking lands on the lead",
        body: "When your scheduling page sends the person back, the lead is marked meeting booked, with the time when the page passes it on.",
      },
    ],
    visual: {
      kind: "thread",
      title: "Website chat",
      note: "booking in the conversation",
      messages: [
        {
          text: "We're about 40 people and want to switch payroll before April.",
        },
        {
          agent: true,
          text: "That timing works. The quickest next step is a short call with our team. You can pick a time here: book.northwind.example",
        },
        { text: "Done, Thursday at 9:30." },
        {
          agent: true,
          text: "Thanks, I can see it. Tom will be on the call and has the notes from this chat.",
        },
      ],
      foot: "Sample conversation with a made-up business.",
    },
    channels: ["chat", "email", "voice"],
    features: [
      "inbound-lead-qualification",
      "smart-replies",
      "ai-phone-agent",
      "intelligent-lead-routing",
      "crm-integration",
    ],
    setup: [
      "Add your booking link under Settings, Mailboxes, follow-ups.",
      "Set your scheduling page's redirect after booking to Dialvo's link.",
      "Connect a mailbox, for answers to email replies.",
      "Put the website chat on your site, for bookings from the chat.",
    ],
    faqs: [
      {
        q: "Does Dialvo read our calendars?",
        a: "No. People pick a time on your own scheduling page, which already knows when you're free.",
      },
      {
        q: "Which scheduling tools work?",
        a: "Any page with a booking link. To record bookings automatically, it needs to redirect people to a link after they book.",
      },
      {
        q: "What does the team see?",
        a: "An alert that someone wants to meet, and the lead marked meeting booked once they do, with the conversation that led to it.",
      },
      {
        q: "Does it handle reminders and reschedules?",
        a: "Your scheduling page does. Dialvo records the booking; reminders and changes stay with the tool you already use.",
      },
    ],
    related: [
      "speed-to-lead",
      "event-follow-up",
      "customer-onboarding-operations",
    ],
  },

  "customer-onboarding-operations": {
    promise:
      "Give every new customer the onboarding only your biggest ones get.",
    intro:
      "Dialvo's agents answer new customers' calls, walk them through setup and check in, with their permission, until they've reached the first thing your product is for. Your team steps in for the accounts and questions that need a person.",
    description:
      "Dialvo gives every new customer a live onboarding conversation: an agent answers their calls, guides setup, checks in with permission and brings in your team when needed.",
    situation: {
      title: "Most customers are onboarded by a welcome email",
      body: [
        "Your largest accounts get a kickoff call and a named contact. Everyone else gets a link to the help centre. Many of them set up half the product, hit a snag and go quiet.",
        "Customers who never reach first value don't renew, don't upgrade and don't refer anyone. You've paid to win them and they leave before they've seen what they bought.",
        "Hiring enough people to call every new account isn't realistic. So the smaller accounts, which together are often most of your revenue, are left to work it out alone.",
      ],
    },
    steps: [
      {
        title: "New customers get a number to call",
        body: "The welcome email gives a direct onboarding line. The AI phone agent answers at any hour and picks up from the plan and setup stage on the customer's record.",
      },
      {
        title: "It walks them through setup",
        body: "The agent takes the customer through the steps that matter for their use case, answering from your knowledge base. It adapts to their questions; there's no fixed checklist to sit through.",
      },
      {
        title: "It checks in, with permission",
        body: "Customers get an email, or a text if they opted in, timed to where they are in setup, and a nudge if they stall before the first key action.",
      },
      {
        title: "It hands over when it should",
        body: "Complex questions, unhappy customers and high-value accounts go to the right person on your team, by live transfer or a booked call, with a summary of what's been covered.",
      },
      {
        title: "Your team sees where everyone is",
        body: "Each account's progress, open questions and next step are written to the CRM, so nobody has to ask the customer to repeat themselves.",
      },
    ],
    visual: {
      kind: "list",
      title: "Onboarding",
      note: "new customers this week",
      rows: [
        {
          name: "Harbor Fitness",
          detail: "Setup done · imported members",
          tag: "First value",
          strong: true,
        },
        {
          name: "Oakline Studio",
          detail: "Stalled at payment setup · check-in sent",
          tag: "Nudged",
        },
        {
          name: "Fernhill Logistics",
          detail: "Asked about SSO · passed to Dana",
          tag: "With team",
        },
        {
          name: "Juniper Payroll",
          detail: "Called the onboarding line, 12 min",
          tag: "In setup",
        },
      ],
      foot: "Sample accounts. All made up.",
    },
    channels: ["voice", "messages", "email", "chat"],
    features: [
      "ai-phone-agent",
      "knowledge-base",
      "intelligent-lead-routing",
      "crm-integration",
    ],
    setup: [
      "Add your setup guides and help articles to the knowledge base.",
      "Define the first key action that counts as onboarded.",
      "Add an opt-in for check-in texts to your signup flow.",
      "Choose which accounts and topics always go to a person.",
    ],
    faqs: [
      {
        q: "Does the agent call customers?",
        a: "No. Dialvo never makes outbound calls. Check-in texts go only to customers who agreed to them, and anyone can ring the onboarding line themselves at any time.",
      },
      {
        q: "Can it see how far a customer has got?",
        a: 'It works from what\'s on the CRM record and from events your product sends through the API, such as "imported data" or "invited a teammate".',
      },
      {
        q: "What if it doesn't know the answer?",
        a: "It says so, and passes the question to your team with the context. It doesn't guess. You can review flagged calls and add the missing answer to the knowledge base.",
      },
    ],
    related: ["customer-expansion", "plg-conversion", "speed-to-lead"],
  },
} satisfies Partial<Record<PlaySlug, PlayContent>>;
