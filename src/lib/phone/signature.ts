import { createHmac, timingSafeEqual } from "node:crypto";

// Twilio signs every webhook: an HMAC-SHA1, keyed with the account's auth
// token, of the full address it called followed by each POST parameter's
// name and value, sorted by name, in base64, sent as X-Twilio-Signature.
// A request without a valid signature is refused before anything is read
// or written.

export function twilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
): string {
  let data = url;
  for (const key of Object.keys(params).sort()) data += key + params[key];
  return createHmac("sha1", authToken).update(data, "utf8").digest("base64");
}

export function validTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
  header: string | null,
): boolean {
  if (!authToken || !header) return false;
  const expected = Buffer.from(twilioSignature(authToken, url, params));
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
