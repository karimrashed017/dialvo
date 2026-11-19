import { CONTACT_EMAIL, fmt, PLANS, TRIAL } from "@/lib/site";
import type { Faq } from "./faq";

// Plain answers. Claims about the law stay general: Dialvo holds no
// certifications, and the rules differ by country and state.

export const FAQS: Record<string, Faq[]> = {
  Product: [
    {
      q: "What is Dialvo?",
      a: "An AI sales team. Its agents work voice, email, chat, social, SMS and WhatsApp to find, engage, qualify and book, for three jobs: answering inbound leads, starting outbound conversations and growing existing customers. Your reps get a dialer with the research on screen for the calls they make themselves.",
    },
    {
      q: "Is everything available today?",
      a: "Dialvo is in early access. We're bringing teams on in small groups, starting with the channels each one needs first, and switching on the rest as we go. When you write to us we'll tell you plainly what's ready for your use case and what isn't yet.",
    },
    {
      q: "Does it replace my sales reps?",
      a: "No. Agents do the first contact, the research, the qualifying, the follow-up and the booking. People do the meetings and close the deals, and can take over any conversation at any point.",
    },
    {
      q: "What does it need from me to start?",
      a: `A few sentences about what you sell and who to, your qualifying questions, your calendar, and your best answers to what buyers usually ask. Connect your inbox and CRM if you use them, and point your website form at Dialvo so new leads get an instant reply. Questions? Email ${CONTACT_EMAIL}.`,
    },
    {
      q: "Which tools does it work with?",
      a: "Salesforce, HubSpot, Pipedrive and Zoho for the CRM; Gmail and Outlook for email; Google Calendar for bookings; Slack for alerts; and an API for everything else.",
    },
  ],
  "Calls and messages": [
    {
      q: "Who do the voice agents call?",
      a: "People who asked to hear from you or opted in: someone who filled in your form, rang your number, or an existing customer who agreed to calls. Dialvo's AI doesn't cold call strangers. Outbound to new accounts runs on email and social, and when a call is the right next step, your rep makes it with the dialer.",
    },
    {
      q: "Does it say it's an AI?",
      a: "Always. Calls and chats open by saying it's an AI assistant working for you, and that the call is recorded. If someone would rather speak to a person, it puts them through or books a time.",
    },
    {
      q: "Can I see what it says?",
      a: "All of it. Every call is recorded and transcribed with a short summary, and every email, chat, text and direct message is in one inbox. You can also require your approval before anything is sent.",
    },
    {
      q: "How are opt-outs handled?",
      a: "Automatically. Every email has an unsubscribe link, every text thread can be stopped with a reply, and anyone who asks not to be contacted is removed straight away, on every channel. Do Not Call lists are checked before a number is dialled.",
    },
    {
      q: "Is it legal where I sell?",
      a: "The rules for calls, texts and email differ by country and state, and you're responsible for who you ask Dialvo to contact. Dialvo's defaults are built around consent, disclosure and opt-outs, but it holds no certifications and isn't legal advice. If you're unsure, check with a lawyer where you sell.",
    },
  ],
  "Plans and trial": [
    {
      q: "How does the free trial work?",
      a: `It's free until an agent books your first meeting. The trial covers up to ${TRIAL.calls} AI calls and needs a card to start, which isn't charged during the trial.`,
    },
    {
      q: "What happens after the first booked meeting?",
      a: `You pick a plan: Starter at $${PLANS.starter.price} a month (the voice agent for inbound leads, the email agent and SMS follow-up, with ${fmt(PLANS.starter.calls)} AI calls) or Pro at $${PLANS.pro.price} a month (every channel, human dialer seats, CRM sync and premium voices, with ${fmt(PLANS.pro.calls)} AI calls). If you'd rather not, you can stop there and pay nothing.`,
    },
    {
      q: "Can I cancel?",
      a: "Yes, anytime. Plans are monthly, with no contract and no prepaid credits.",
    },
    {
      q: "What if I need more than a plan includes?",
      a: "Add extra AI calls, lead credits, sending inboxes or dialer seats to either plan. For larger teams, email us and we'll work it out together.",
    },
  ],
};
