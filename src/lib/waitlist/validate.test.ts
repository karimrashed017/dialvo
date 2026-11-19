import { describe, expect, it } from "vitest";
import { parseSignup } from "./validate";

describe("waitlist sign-up", () => {
  it("accepts a name and an email, and tidies them", () => {
    const r = parseSignup({ name: "  Sam ", email: " Sam@Example.com " });
    expect(r).toEqual({
      ok: true,
      signup: expect.objectContaining({
        name: "Sam",
        email: "sam@example.com",
      }),
    });
  });
  it("needs a name and a real-looking email", () => {
    expect(parseSignup({ email: "a@b.co" })).toEqual({
      ok: false,
      field: "name",
    });
    expect(parseSignup({ name: "Sam", email: "nope" })).toEqual({
      ok: false,
      field: "email",
    });
    expect(parseSignup(null)).toEqual({ ok: false, field: "name" });
  });
  it("refuses overlong fields and ignores unknown ones", () => {
    expect(
      parseSignup({ name: "Sam", email: "a@b.co", sells: "x".repeat(501) }),
    ).toEqual({ ok: false, field: "sells" });
    const r = parseSignup({ name: "Sam", email: "a@b.co", admin: true });
    expect(r.ok && "admin" in r.signup).toBe(false);
  });
});
