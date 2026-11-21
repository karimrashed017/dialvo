import { cleanText, isUuid } from "@/lib/leads/fields";
import { LEAD_STATUSES, STATUS_LABEL, type LeadStatus } from "@/lib/app/types";

// Filters over the workspace's leads: what a saved audience is, and what a
// playbook may add to its own. The database checks them again
// (private.lead_filters_ok) and does the matching (private.lead_matches).

export type LeadFilters = {
  statuses?: LeadStatus[];
  tiers?: number[];
  min_fit?: number | null;
  min_engagement?: number | null;
  sources?: string[];
  countries?: string[];
  size_min?: number | null;
  size_max?: number | null;
  list_id?: string | null;
  audience_id?: string | null;
  inactive_days?: number | null;
  active_within_days?: number | null;
  added_within_days?: number | null;
  recipe?: { id: string; answer: string } | null;
};

export const TIER_LABEL: Record<number, string> = {
  1: "Tier 1",
  2: "Tier 2",
  3: "Tier 3",
};

const list = (value: FormDataEntryValue | null, max: number) =>
  String(value ?? "")
    .split(/[,\n]/)
    .map((v) => cleanText(v, 80))
    .filter(Boolean)
    .slice(0, max);

function num(
  value: FormDataEntryValue | null,
  min: number,
  max: number,
): number | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

/** The filters from a form's fields (any missing field means "any"). */
export function readFilters(
  form: FormData,
  options: { statuses?: readonly string[] } = {},
): LeadFilters {
  const allowed = options.statuses ?? LEAD_STATUSES;
  const f: LeadFilters = {};
  const statuses = form
    .getAll("statuses")
    .map(String)
    .filter((s): s is LeadStatus => allowed.includes(s));
  if (statuses.length) f.statuses = [...new Set(statuses)];
  const tiers = form
    .getAll("tiers")
    .map(Number)
    .filter((t) => t === 1 || t === 2 || t === 3);
  if (tiers.length) f.tiers = [...new Set(tiers)];
  const minFit = num(form.get("min_fit"), 0, 100);
  if (minFit !== null) f.min_fit = minFit;
  const minEng = num(form.get("min_engagement"), 0, 100);
  if (minEng !== null) f.min_engagement = minEng;
  const sources = list(form.get("sources"), 10);
  if (sources.length) f.sources = sources;
  const countries = list(form.get("countries"), 30);
  if (countries.length) f.countries = countries;
  const sizeMin = num(form.get("size_min"), 1, 10_000_000);
  const sizeMax = num(form.get("size_max"), 1, 10_000_000);
  if (sizeMin !== null) f.size_min = sizeMin;
  if (sizeMax !== null) f.size_max = sizeMax;
  const listId = form.get("list_id");
  if (isUuid(listId)) f.list_id = listId;
  const audienceId = form.get("audience_id");
  if (isUuid(audienceId)) f.audience_id = audienceId;
  for (const key of [
    "inactive_days",
    "active_within_days",
    "added_within_days",
  ] as const) {
    const n = num(form.get(key), 1, 730);
    if (n !== null) f[key] = n;
  }
  const recipeId = form.get("recipe_id");
  const answer = cleanText(form.get("recipe_answer"), 80);
  if (isUuid(recipeId) && answer) f.recipe = { id: recipeId, answer };
  return f;
}

/** In words, for a list of audiences or a playbook. */
export function describeFilters(
  f: LeadFilters,
  names: {
    lists?: Map<string, string>;
    audiences?: Map<string, string>;
    recipes?: Map<string, string>;
  } = {},
): string {
  const parts: string[] = [];
  if (f.statuses?.length)
    parts.push(f.statuses.map((s) => STATUS_LABEL[s] ?? s).join(" or "));
  if (f.tiers?.length)
    parts.push(f.tiers.map((t) => TIER_LABEL[t]).join(" or "));
  if (f.min_fit != null) parts.push(`fit ${f.min_fit}+`);
  if (f.min_engagement != null) parts.push(`engagement ${f.min_engagement}+`);
  if (f.sources?.length) parts.push(`from ${f.sources.join(" or ")}`);
  if (f.countries?.length) parts.push(`in ${f.countries.join(" or ")}`);
  if (f.size_min != null && f.size_max != null)
    parts.push(`${f.size_min} to ${f.size_max} people`);
  else if (f.size_min != null) parts.push(`${f.size_min}+ people`);
  else if (f.size_max != null) parts.push(`up to ${f.size_max} people`);
  if (f.list_id)
    parts.push(`on the list "${names.lists?.get(f.list_id) ?? "a list"}"`);
  if (f.audience_id)
    parts.push(
      `in the audience "${names.audiences?.get(f.audience_id) ?? "an audience"}"`,
    );
  if (f.recipe)
    parts.push(
      `"${names.recipes?.get(f.recipe.id) ?? "a recipe"}" answered ${f.recipe.answer}`,
    );
  if (f.added_within_days != null)
    parts.push(`added in the last ${f.added_within_days} days`);
  if (f.active_within_days != null)
    parts.push(`active in the last ${f.active_within_days} days`);
  if (f.inactive_days != null) parts.push(`quiet for ${f.inactive_days}+ days`);
  return parts.length ? parts.join(", ") : "Every lead";
}
