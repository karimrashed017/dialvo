import { CONTACT_EMAIL, fmt, PLANS, TRIAL } from "@/lib/site";
import type { Faq } from "./faq";

// Plain answers. Claims about the law stay general: Dialvo holds no
// certifications, and the rules differ by country and state.

export const FAQS: Record<string, Faq[]> = {
  Product: [
    {
      q: "What is Dialvo?",
      a: "AI agents that run inbound and outbound sales. They answer every lead within a minute, go out to find new business, answer your phone, follow up by email, chat, social, SMS and WhatsApp, book the meetings and close simple sales. Bigger deals go to your team.",
    },
    {
      q: "Is everything available today?",
      a: "Not all of it yet. You can create an account today and put the website chat agent to work: it answers visitors from your knowledge base, qualifies them and hands the good ones to you. The other channels are being switched on in stages. Write to us and we'll tell you plainly what's ready for your use case and what isn't yet.",
    },
    {
      q: "Does it replace my sales reps?",
      a: "No. Agents do the first contact, the research, the qualifying, the follow-up and the booking, and can finish simple sales with a clear price. People do the meetings and close the bigger deals, and can take over any conversation at any point.",
    },
    {
      q: "Can it really close a sale?",
      a: "Yes, for simple offers with a clear price. The agent confirms the offer and sends a payment link, booking or agreement. Complex or high-value deals go to your team with everything already covered.",
    },
    {
      q: "Does it take card details?",
      a: "No. Payments always go through a secure link. The agent never asks for or reads out card numbers.",
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
      q: "Does Dialvo make phone calls?",
      a: "No. Dialvo never makes outbound calls. Its phone agent answers the calls people make to your number, straight away, day and night: it answers from your knowledge base, qualifies the caller, books the meeting or transfers to a person. Outbound to new accounts runs on email and social.",
    },
    {
      q: "Can I see what it says?",
      a: "All of it. Every call is transcribed with a short summary, and every email, chat, text and direct message is in one inbox. You can also require your approval before anything is sent.",
    },
    {
      q: "How are opt-outs handled?",
      a: "Automatically. Every email has an unsubscribe link, every text thread can be stopped with a reply, and anyone who asks not to be contacted is removed straight away, on every channel. Dialvo never makes outbound calls.",
    },
    {
      q: "Is it legal where I sell?",
      a: "The rules for calls, texts and email differ by country and state, and you're responsible for who you ask Dialvo to contact. Dialvo's defaults are built around consent, recording notice and opt-outs, but they aren't legal advice. If you're unsure, check with a lawyer where you sell.",
    },
  ],
  "Plans and trial": [
    {
      q: "How does the free trial work?",
      a: `You get Dialvo free for ${TRIAL.days} days. Cancel before the trial ends and you pay nothing.`,
    },
    {
      q: "What happens after the trial?",
      a: `You pick a plan: Starter at $${PLANS.starter.price} a month (the phone agent that answers your calls, the email agent and SMS follow-up, with ${fmt(PLANS.starter.calls)} answered calls), Pro at $${PLANS.pro.price} a month (every channel, outbound, the AI closer for simple sales, CRM sync and premium voices, with ${fmt(PLANS.pro.calls)} answered calls) or Scale at $${PLANS.scale.price} a month (${PLANS.scale.workspaces} workspaces for separate clients or brands, with ${fmt(PLANS.scale.calls)} answered calls). If you'd rather not, you can stop there and pay nothing.`,
    },
    {
      q: "Can I cancel?",
      a: "Yes, anytime. Plans are monthly, with no contract and no prepaid credits.",
    },
    {
      q: "What if I need more than a plan includes?",
      a: "Add extra answered calls, lead credits or sending inboxes to any plan. For larger teams, email us and we'll work it out together.",
    },
  ],
};
