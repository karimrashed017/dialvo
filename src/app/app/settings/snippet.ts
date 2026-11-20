import { HONEYPOT } from "@/lib/leads/capture";

/** The address a form posts to. */
export const captureUrl = (origin: string, token: string) =>
  `${origin}/api/leads/capture/${token}`;

/**
 * A plain HTML form the customer can paste into their site. No script: the
 * browser posts it and the visitor lands on a thank-you page (ours, or the
 * address set on the form). Each consent box is its own question, unticked
 * by default; a box left unticked sends nothing, so no consent is recorded.
 */
export function formSnippet(origin: string, token: string): string {
  return `<form action="${captureUrl(origin, token)}" method="post">
  <label>Name <input name="name" autocomplete="name"></label>
  <label>Email <input name="email" type="email" autocomplete="email" required></label>
  <label>Phone <input name="phone" type="tel" autocomplete="tel"></label>
  <label>Company <input name="company" autocomplete="organization"></label>
  <label>How can we help? <textarea name="message"></textarea></label>

  <!-- Consent: one box per channel, never ticked for the visitor.
       Remove the ones you won't use. -->
  <label><input type="checkbox" name="consent_email" value="true"> You may email me about my enquiry</label>
  <label><input type="checkbox" name="consent_call" value="true"> You may call me about my enquiry</label>
  <label><input type="checkbox" name="consent_sms" value="true"> You may text me about my enquiry</label>

  <!-- Leave this hidden field as it is: it catches spam bots. -->
  <input name="${HONEYPOT}" tabindex="-1" autocomplete="off" style="display:none" aria-hidden="true">

  <button type="submit">Send</button>
</form>`;
}

/** The same thing from JavaScript, for sites with their own form. */
export function fetchSnippet(origin: string, token: string): string {
  return `await fetch("${captureUrl(origin, token)}", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    name, email, phone, company, message,
    // Only include a channel if you asked, and send what they answered.
    consent: { email: true, call: false },
  }),
});`;
}
