// TwiML, the XML a webhook answers Twilio with. Everything spoken comes
// from a model or a workspace's settings, so every value is escaped here.

const escapeXml = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    // Control characters aren't allowed in XML.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ");

const attrs = (a: Record<string, string | number | boolean | undefined>) =>
  Object.entries(a)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ` ${k}="${escapeXml(String(v))}"`)
    .join("");

export type Verb =
  | { say: string; voice: string; language: string }
  | {
      gather: {
        action: string;
        language: string;
        say?: { text: string; voice: string };
      };
    }
  | { dial: { number: string; callerId: string; action: string } }
  | { redirect: string }
  | { pause: number }
  | { hangup: true };

export function twiml(verbs: Verb[]): string {
  const body = verbs
    .map((v) => {
      if ("say" in v)
        return v.say
          ? `<Say${attrs({ voice: v.voice, language: v.language })}>${escapeXml(v.say)}</Say>`
          : "";
      if ("gather" in v) {
        const g = v.gather;
        const inner = g.say?.text
          ? `<Say${attrs({ voice: g.say.voice, language: g.language })}>${escapeXml(g.say.text)}</Say>`
          : "";
        return `<Gather${attrs({
          input: "speech",
          action: g.action,
          method: "POST",
          language: g.language,
          speechTimeout: "auto",
          actionOnEmptyResult: true,
        })}>${inner}</Gather>`;
      }
      if ("dial" in v)
        return `<Dial${attrs({
          callerId: v.dial.callerId,
          action: v.dial.action,
          method: "POST",
          timeout: 20,
        })}><Number>${escapeXml(v.dial.number)}</Number></Dial>`;
      if ("redirect" in v)
        return `<Redirect method="POST">${escapeXml(v.redirect)}</Redirect>`;
      if ("pause" in v) return `<Pause length="${Math.round(v.pause)}"/>`;
      return "<Hangup/>";
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`;
}

/** A TwiML answer for a route handler. */
export const twimlResponse = (xml: string, status = 200) =>
  new Response(xml, {
    status,
    headers: { "Content-Type": "text/xml", "Cache-Control": "no-store" },
  });
