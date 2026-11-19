import { CONTACT_EMAIL, fmt, PLANS, TRIAL } from "@/lib/site";
import type { Faq } from "./faq";

// Plain answers. Claims about the law stay general: Dialvo holds no
// certifications, and the rules differ by country and state.

export const FAQS: Record<string, Faq[]> = {
  Calling: [
    {
      q: "Is it legal?",
      a: "Calling businesses to offer them something is allowed in most places, with rules. Dialvo follows the main ones on every call: it calls business lines, and people who asked to hear from you; it calls mobile numbers only when the person agreed; it says it's an AI and that the call is recorded; it checks Do Not Call lists before dialling; it calls only in business hours; and it stops calling anyone who says no. The rules differ by country and state, and you're responsible for who you ask it to call, so if you're unsure, check with a lawyer where you sell.",
    },
    {
      q: "Does it sound human?",
      a: "It sounds natural: a clear, warm voice that listens, answers questions and handles objections. Pro has a premium, ultra-realistic voice. But it never pretends to be a person: every call starts by saying it's an AI assistant calling for you.",
    },
    {
      q: "What if someone asks if it's a robot?",
      a: "It says yes, it's an AI assistant calling on your behalf, and carries on if they're happy to. If they'd rather speak to a person, it can put the call through to you or book a time for you to call them.",
    },
    {
      q: "Which countries can it call?",
      a: "The US first. The UK too, for people who opted in to hear from you. More countries later.",
    },
    {
      q: "Do I need my own phone number?",
      a: "No. Dialvo provides the numbers it calls and texts from, so there's nothing to set up with your phone company.",
    },
    {
      q: "Can I listen to the calls?",
      a: "Yes, every one. Each call is recorded and transcribed, with a short summary, and you can read every text and message it sends. You can also step into a live call when a prospect wants a person.",
    },
  ],
  "Plans and trial": [
    {
      q: "How does the free trial work?",
      a: `It's free until your first interested prospect: someone who books a meeting or asks you to get in touch. The trial covers up to ${TRIAL.dials} dials and needs a card to start, which isn't charged during the trial.`,
    },
    {
      q: "What happens after the free trial?",
      a: `Once someone's interested, you pick a plan: Starter at $${PLANS.starter.price} a month (${fmt(PLANS.starter.dials)} dials) or Pro at $${PLANS.pro.price} a month (${fmt(PLANS.pro.dials)} dials, the premium voice, WhatsApp follow-up and team seats). If you'd rather not, you can stop there and pay nothing.`,
    },
    {
      q: "Can I cancel?",
      a: "Yes, anytime. Plans are monthly, with no contract and no prepaid credits.",
    },
    {
      q: "What do I need to set it up?",
      a: `A few sentences about what you sell and who to, your calendar, and your best answers to the questions prospects ask. Point your website form at Dialvo if you want new leads called within a minute. Questions? Email ${CONTACT_EMAIL}.`,
    },
  ],
};
