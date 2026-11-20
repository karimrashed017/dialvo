import { createHash, randomBytes } from "node:crypto";

// A workspace's API key for POST /api/v1/events. The key is made here, shown
// to the person once, and never stored: the database keeps only its SHA-256
// hash (and its first characters, so keys can be told apart). Pure but for
// the random bytes.

const PREFIX = "dv_live_";

export function makeApiKey(random: (n: number) => Buffer = randomBytes): {
  key: string;
  prefix: string;
  hash: string;
} {
  const key = `${PREFIX}${random(24).toString("base64url")}`;
  return { key, prefix: key.slice(0, 12), hash: hashApiKey(key) };
}

export const hashApiKey = (key: string) =>
  createHash("sha256").update(key, "utf8").digest("hex");

/** The key from "Authorization: Bearer <key>", if it looks like one. */
export function keyFromHeader(header: string | null): string | null {
  const match = /^Bearer\s+(\S+)$/.exec((header ?? "").trim());
  const key = match?.[1] ?? "";
  return /^dv_live_[A-Za-z0-9_-]{20,64}$/.test(key) ? key : null;
}
