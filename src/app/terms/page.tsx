import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { CONTACT_EMAIL, PLANS, TRIAL } from "@/lib/site";
import { LegalPage } from "../_legal/legal-page";

export { viewport } from "../_legal/legal-page";

export const metadata: Metadata = pageMetadata({
  title: "Terms · Dialvo",
  description:
    "The terms for using Dialvo, the AI sales team that calls, follows up and books meetings. A draft while Dialvo is in early access.",
  path: "/terms",
});

export default function Terms() {
  return (
    <LegalPage title="Terms" updated="19 November 2026">
      <h2>Early access</h2>
      <p>
        Dialvo is in early access. Some features on this site are marked “coming
        soon” and aren&apos;t available yet. Things may change, break or be
        removed while we build.
      </p>
      <h2>Free trial and plans</h2>
      <p>
        The free trial lasts until your first interested prospect, for up to{" "}
        {TRIAL.dials} dials, and needs a card to start. After that, plans are $
        {PLANS.starter.price} (Starter) or ${PLANS.pro.price} (Pro) a month,
        billed monthly, with no contract. You can cancel anytime.
      </p>
      <h2>Using Dialvo responsibly</h2>
      <p>
        You decide who Dialvo contacts and what it offers them, and you&apos;re
        responsible for that. In particular, you agree:
      </p>
      <ul>
        <li>
          to give Dialvo only numbers it may call: business lines, and people
          who agreed to hear from you (for mobile numbers, always with consent);
        </li>
        <li>to follow the calling, texting and email laws where you sell;</li>
        <li>not to use Dialvo to mislead, harass or spam anyone.</li>
      </ul>
      <p>
        Dialvo checks Do Not Call lists, says it&apos;s an AI on every call,
        calls only in business hours and honours opt-outs, but these checks help
        you follow the rules; they don&apos;t replace your own responsibility.
      </p>
      <h2>Contact</h2>
      <p>
        Questions about these terms:{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </LegalPage>
  );
}
