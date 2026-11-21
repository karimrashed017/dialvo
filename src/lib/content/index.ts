// Every content page's copy, by slug. The catalog (catalog.ts) says which
// pages exist; `satisfies` here makes a missing page a type error.

import type { FeatureSlug, PlaySlug } from "./catalog";
import { ANALYTICS_RESEARCH_FEATURES } from "./platform-analytics-research";
import { DATA_OUTREACH_FEATURES } from "./platform-data-outreach";
import { DATA_TABLE_FEATURES } from "./platform-data-tables";
import { INBOUND_INTEGRATION_FEATURES } from "./platform-inbound-integrations";
import { EXPANSION_PLAYS } from "./plays-expansion";
import { INBOUND_PLAYS } from "./plays-inbound";
import { OUTBOUND_PLAYS } from "./plays-outbound";
import type { FeatureContent, PlayContent } from "./types";

export const PLAY_PAGES = {
  ...INBOUND_PLAYS,
  ...OUTBOUND_PLAYS,
  ...EXPANSION_PLAYS,
} satisfies Record<PlaySlug, PlayContent>;

export const FEATURE_PAGES = {
  ...DATA_OUTREACH_FEATURES,
  ...ANALYTICS_RESEARCH_FEATURES,
  ...INBOUND_INTEGRATION_FEATURES,
  ...DATA_TABLE_FEATURES,
} satisfies Record<FeatureSlug, FeatureContent>;

export { MOTION_PAGES } from "./motions";
export * from "./catalog";
export type * from "./types";
export { PLATFORM_PAGE } from "./platform-overview";
