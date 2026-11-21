import { describe, expect, it } from "vitest";
import { FEATURE_SLUGS, GROUPS, PLAY_SLUGS } from "@/lib/content/catalog";
import { APP_FEATURES, APP_PLAYS, featureGroups, PLAY_GROUPS } from "./catalog";

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

  it("has every platform feature, grouped as the site's menu", () => {
    expect(Object.keys(APP_FEATURES).sort()).toEqual([...FEATURE_SLUGS].sort());
    const groups = featureGroups();
    expect(groups.map((g) => g.title)).toEqual(GROUPS.map((g) => g.title));
    expect(groups.map((g) => g.items.length)).toEqual(
      GROUPS.map((g) => g.items.length),
    );
  });

  it("gives every item a place in the app, and says what a partly-live one lacks", () => {
    for (const f of Object.values(APP_FEATURES)) {
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
