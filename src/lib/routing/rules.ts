// Lead routing rules, as the settings page shows them and the database keeps
// them (routing_rules.match). The matching itself happens in the database
// (private.route_lead), when a lead is added and again when its first email
// thread starts; describeMatch says in words what a rule matches.

export type RoutingMatch = {
  countries?: string[];
  size_min?: number | null;
  size_max?: number | null;
  sources?: string[];
  plays?: string[];
  /** Lead tiers (1 to 3), from lead scoring. */
  tiers?: number[];
};

/** The plays a rule can match, by the name the database gives them. */
export const ROUTING_PLAYS: Record<string, string> = {
  speed_to_lead: "Speed to lead",
  reactivation: "Lead reactivation",
  closed_lost: "Closed lost",
  nurture: "Lead nurture",
  onboarding: "Customer onboarding",
  expansion: "Customer expansion",
  plg: "Trial users ready to buy",
  takeout: "Competitive takeout",
  accounts: "Target accounts",
  lookalike: "Lookalike",
  signal: "Buying signals",
  event_registration: "Event registration",
  event_followup: "Event follow-up",
  event_no_show: "Event no-show",
  playbook: "Your playbooks",
};

export function describeMatch(m: RoutingMatch): string {
  const parts: string[] = [];
  if (m.countries?.length) parts.push(`in ${m.countries.join(" or ")}`);
  if (m.size_min != null && m.size_max != null)
    parts.push(`at companies of ${m.size_min} to ${m.size_max} people`);
  else if (m.size_min != null)
    parts.push(`at companies of at least ${m.size_min} people`);
  else if (m.size_max != null)
    parts.push(`at companies of up to ${m.size_max} people`);
  if (m.sources?.length) parts.push(`from ${m.sources.join(" or ")}`);
  if (m.tiers?.length) parts.push(`in tier ${m.tiers.join(" or ")}`);
  if (m.plays?.length)
    parts.push(
      `written to by ${m.plays.map((p) => ROUTING_PLAYS[p] ?? p).join(" or ")}`,
    );
  return parts.length ? `Leads ${parts.join(", ")}` : "Every lead";
}
