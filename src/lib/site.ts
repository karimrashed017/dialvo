// Dialvo's facts in one place, so every page says the same thing. Prices are
// the ones the founder set (19 Nov 2026); change them here and the whole site
// follows.

export const SITE_NAME = "Dialvo";
export const SITE_URL = "https://trydialvo.com";
export const CONTACT_EMAIL = "contact@trydialvo.com";

/** The one-liner, used in the footer and the share image. */
export const TAGLINE =
  "AI sales agents for every channel, across inbound, outbound and expansion.";

export const DESCRIPTION =
  "Dialvo is your AI sales team: agents that work voice, email, chat, social, SMS and WhatsApp to find, engage, qualify and book, across inbound, outbound and expansion, with a human dialer for your reps.";

/** Where every "Join the waitlist" button leads: the waitlist form. */
export const START_HREF = "/waitlist";

/** The free trial: it ends at the first booked meeting. */
export const TRIAL = { calls: 300 } as const;

export const PLANS = {
  starter: {
    name: "Starter",
    price: 99,
    calls: 1000,
    leadCredits: 500,
    inboxes: 1,
  },
  pro: {
    name: "Pro",
    price: 299,
    calls: 3000,
    leadCredits: 1500,
    inboxes: 3,
    dialerSeats: 3,
  },
} as const;

/** "1,000", for copy. */
export const fmt = (n: number) => n.toLocaleString("en-US");
