import { describe, expect, it } from "vitest";
import { safeNextPath } from "./next-path";

describe("safeNextPath", () => {
  it("keeps paths inside the app, with their query", () => {
    expect(safeNextPath("/app")).toBe("/app");
    expect(safeNextPath("/app/leads?status=new&q=acme")).toBe(
      "/app/leads?status=new&q=acme",
    );
    expect(safeNextPath("/onboarding")).toBe("/onboarding");
    expect(safeNextPath("/reset-password")).toBe("/reset-password");
  });

  it("falls back when there is nothing to follow", () => {
    expect(safeNextPath(null)).toBe("/app");
    expect(safeNextPath(undefined)).toBe("/app");
    expect(safeNextPath("")).toBe("/app");
    expect(safeNextPath("", "/onboarding")).toBe("/onboarding");
  });

  it("never leaves the site", () => {
    for (const bad of [
      "https://evil.example",
      "http://evil.example/app",
      "//evil.example",
      "//evil.example/app",
      "/\\evil.example",
      "/\\/evil.example",
      "\\\\evil.example",
      "javascript:alert(1)",
      "data:text/html,hi",
      "app",
      "evil.example/app",
      " /app",
      "/app\n//evil.example",
      "/\t/evil.example",
      "/%2F/evil.example",
      "/app".padEnd(600, "a"),
    ])
      expect(safeNextPath(bad), bad).toBe("/app");
  });

  it("only leads to the app, not to any page on the site", () => {
    expect(safeNextPath("/")).toBe("/app");
    expect(safeNextPath("/pricing")).toBe("/app");
    expect(safeNextPath("/logout")).toBe("/app");
    expect(safeNextPath("/api/leads/capture/x")).toBe("/app");
    expect(safeNextPath("/application")).toBe("/app");
    // Dot segments are resolved before the check.
    expect(safeNextPath("/app/../pricing")).toBe("/app");
    expect(safeNextPath("/app/../app/leads")).toBe("/app/leads");
  });

  it("drops the fragment", () => {
    expect(safeNextPath("/app/inbox?c=1#x")).toBe("/app/inbox?c=1");
  });
});
