import { describe, expect, it } from "vitest";
import { describeMatch } from "./rules";

describe("a routing rule in words", () => {
  it("says what it matches", () => {
    expect(describeMatch({})).toBe("Every lead");
    expect(
      describeMatch({
        countries: ["GB", "Ireland"],
        size_min: 50,
        size_max: 500,
        sources: ["form"],
        plays: ["reactivation", "playbook"],
      }),
    ).toBe(
      "Leads in GB or Ireland, at companies of 50 to 500 people, from form, written to by Lead reactivation or Your playbooks",
    );
    expect(describeMatch({ size_min: 200 })).toBe(
      "Leads at companies of at least 200 people",
    );
  });
});
