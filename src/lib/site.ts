// Dialvo's facts in one place, so every page says the same thing. Prices are
// the ones the founder set (19 Nov 2026); change them here and the whole site
// follows.

export const SITE_NAME = "Dialvo";
export const SITE_URL = "https://trydialvo.com";
export const CONTACT_EMAIL = "contact@trydialvo.com";

/** The one-liner, used in the footer and the share image. */
export const TAGLINE = "Inbound and outbound sales, run by AI agents.";

export const DESCRIPTION =
  "Dialvo runs inbound and outbound sales with AI agents. They answer every lead within a minute, go out to find new business, follow up on voice, email, chat, social, SMS and WhatsApp, book the meetings, close simple sales and hand your team the bigger deals.";

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
  // Founder, 19 Nov 2026: a larger third plan, for agencies and bigger teams.
  scale: {
    name: "Scale",
    price: 799,
    calls: 10000,
    leadCredits: 6000,
    inboxes: 10,
    dialerSeats: 10,
    workspaces: 5,
  },
} as const;

/** "1,000", for copy. */
export const fmt = (n: number) => n.toLocaleString("en-US");
