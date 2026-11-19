// Dialvo's facts in one place, so every page says the same thing. Prices and
// allowances here are the ones the founder set (19 Nov 2026); change them here
// and the whole site follows.

export const SITE_NAME = "Dialvo";
export const SITE_URL = "https://trydialvo.com";
export const CONTACT_EMAIL = "contact@trydialvo.com";

/**
 * Where every "Get early access" and "Start free" button leads: an email to
 * us, until signups open.
 */
export const START_HREF =
  "mailto:contact@trydialvo.com?subject=Dialvo%20early%20access";

/** The free trial: it ends at the first interested prospect. */
export const TRIAL = { dials: 300 } as const;

export const PLANS = {
  starter: {
    name: "Starter",
    price: 99,
    dials: 1000,
    leadCredits: 500,
  },
  pro: {
    name: "Pro",
    price: 299,
    dials: 3000,
    leadCredits: 1500,
  },
} as const;

/** "1,000", for copy. */
export const fmt = (n: number) => n.toLocaleString("en-US");
