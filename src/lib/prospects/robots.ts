// robots.txt, read the polite way: Dialvo's reader is "DialvoBot", and it
// follows the rules a site writes for it, or for every robot ("*") when it
// has none of its own (RFC 9309: the longest matching rule wins, Allow wins a
// tie, "*" and "$" work as wildcards). A site that has no robots.txt, or
// whose robots.txt can't be read, is read as usual. Pure functions, plus a
// small cache so one host's file is fetched once, not once per page.

export const ROBOT_NAME = "dialvobot";

type Rule = { allow: boolean; pattern: string };
export type RobotRules = Rule[];

/** The rules in a robots.txt that apply to DialvoBot. */
export function parseRobots(text: string): RobotRules {
  const groups: { agents: string[]; rules: Rule[] }[] = [];
  let current: { agents: string[]; rules: Rule[] } | null = null;
  let lastWasAgent = false;
  for (const raw of text.slice(0, 500_000).split(/\r\n|\r|\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === "allow" || key === "disallow") {
      // "Disallow:" with nothing after it allows everything.
      if (!value) continue;
      current.rules.push({ allow: key === "allow", pattern: value });
    }
  }
  const ours = groups.filter((g) =>
    g.agents.some((a) => a.split("/")[0].trim() === ROBOT_NAME),
  );
  const chosen = ours.length
    ? ours
    : groups.filter((g) => g.agents.includes("*"));
  return chosen.flatMap((g) => g.rules);
}

function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const regex = body
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${regex}${anchored ? "$" : ""}`).test(path);
}

/** Whether DialvoBot may read this path (with its query string). */
export function robotsAllow(rules: RobotRules, pathAndQuery: string): boolean {
  let best: Rule | null = null;
  for (const rule of rules) {
    if (!matches(rule.pattern, pathAndQuery)) continue;
    if (
      !best ||
      rule.pattern.length > best.pattern.length ||
      (rule.pattern.length === best.pattern.length && rule.allow)
    )
      best = rule;
  }
  return best ? best.allow : true;
}

/** Fetches a host's robots.txt text; throws or returns null if there isn't one. */
export type RobotsFetcher = (url: string) => Promise<string | null>;

const CACHE_MS = 60 * 60 * 1000;
const CACHE_MAX = 500;
const cache = new Map<string, { rules: RobotRules; at: number }>();

/** For tests. */
export function clearRobotsCache() {
  cache.clear();
}

/**
 * The rules for a host, from the cache or fetched. Anything that goes wrong
 * reading the file means "no rules".
 */
export async function robotsFor(
  host: string,
  fetchRobots: RobotsFetcher,
  now = Date.now(),
): Promise<RobotRules> {
  const key = host.toLowerCase();
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_MS) return hit.rules;
  let rules: RobotRules = [];
  try {
    const text = await fetchRobots(`https://${key}/robots.txt`);
    rules = text ? parseRobots(text) : [];
  } catch {
    rules = [];
  }
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, { rules, at: now });
  return rules;
}

/** Whether DialvoBot may read this address. */
export async function mayRead(
  url: string,
  fetchRobots: RobotsFetcher,
): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const rules = await robotsFor(parsed.hostname, fetchRobots);
  return robotsAllow(rules, `${parsed.pathname}${parsed.search}`);
}
