import { describe, expect, it } from "vitest";
import {
  FEATURE_DETAILS,
  FEATURE_PAGES,
  FEATURE_SLUGS,
  FEATURES,
  GROUPS,
} from "./index";

describe("the platform catalog", () => {
  it("lists every feature once, in the group its entry names", () => {
    const listed = GROUPS.flatMap((g) =>
      g.items.flatMap((i) => (i.type === "feature" ? [i.slug] : [])),
    );
    expect([...listed].sort()).toEqual([...FEATURE_SLUGS].sort());
    expect(new Set(listed).size).toBe(listed.length);
    for (const g of GROUPS)
      for (const i of g.items)
        if (i.type === "feature") expect(FEATURES[i.slug].group).toBe(g.id);
  });

  it("gives every feature page steps, needs, questions and real links", () => {
    for (const slug of FEATURE_SLUGS) {
      const d = FEATURE_DETAILS[slug];
      expect(d.steps.length).toBeGreaterThanOrEqual(3);
      expect(d.needs.length).toBeGreaterThan(0);
      expect(d.faqs.length).toBeGreaterThanOrEqual(2);
      for (const r of FEATURE_PAGES[slug].related) {
        expect(FEATURE_SLUGS).toContain(r);
        expect(r).not.toBe(slug);
      }
    }
  });

  it("never offers outbound calling", () => {
    const text = JSON.stringify([FEATURE_PAGES, FEATURE_DETAILS, FEATURES]);
    // Saying Dialvo never calls is fine; offering to call people is not.
    expect(text).not.toMatch(/\b(dialer|power dial|auto-?dial)/i);
  });
});
