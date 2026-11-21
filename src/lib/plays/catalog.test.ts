import { describe, expect, it } from "vitest";
import { FEATURE_SLUGS, GROUPS, PLAY_SLUGS } from "@/lib/content/catalog";
import {
  APP_FEATURES,
  APP_PLAYS,
  appFeature,
  featureGroups,
  PLAY_GROUPS,
} from "./catalog";

describe("the app's catalog", () => {
  it("has every play the site lists, once, in Inbound, Outbound or Expansion", () => {
    const listed = PLAY_GROUPS.flatMap((g) => g.plays);
    expect([...listed].sort()).toEqual([...PLAY_SLUGS].sort());
    expect(new Set(listed).size).toBe(listed.length);
    expect(PLAY_GROUPS.map((g) => g.title)).toEqual([
      "Inbound",
      "Outbound",
      "Expansion",
    ]);
  });

  it("only describes features the site lists, grouped as the site's menu", () => {
    // A feature can be on the site before the app has an entry for it (its
    // page is written ahead of the merge); the app's list leaves it out.
    for (const slug of Object.keys(APP_FEATURES))
      expect(FEATURE_SLUGS).toContain(slug);
    const groups = featureGroups();
    expect(groups.map((g) => g.title)).toEqual(GROUPS.map((g) => g.title));
    expect(groups.map((g) => g.items.length)).toEqual(
      GROUPS.map(
        (g) =>
          g.items.filter((i) => i.type === "play" || appFeature(i.slug)).length,
      ),
    );
  });

  it("gives every item a place in the app, and says what a partly-live one lacks", () => {
    for (const f of Object.values(APP_FEATURES)) {
      if (!f) continue;
      expect(f.href).toMatch(/^\/app\//);
      if (f.status === "building")
        expect(f.needs?.length ?? 0).toBeGreaterThan(0);
    }
    for (const p of Object.values(APP_PLAYS)) {
      if (p.status === "partly") expect(p.note).toBeTruthy();
      expect(p.needs.length).toBeGreaterThan(0);
    }
    expect(APP_PLAYS["retargeting-website-visitors"].status).toBe("live");
  });
});
