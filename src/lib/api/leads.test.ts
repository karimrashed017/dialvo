import { describe, expect, it } from "vitest";
import { leadOut, readLeadWrite } from "./leads";

const now = new Date("2026-11-21T10:00:00Z");

describe("a lead from an API body", () => {
  it("cleans what it takes and marks a new lead as from the API", () => {
    expect(
      readLeadWrite(
        {
          email: " Dana@Example.COM ",
          name: "  Dana   Reyes ",
          phone: "(020) 7946-0000",
          consent: { email: true },
        },
        true,
        now,
      ),
    ).toEqual({
      ok: true,
      values: {
        email: "dana@example.com",
        name: "Dana Reyes",
        phone: "02079460000",
        consent_email: true,
        consent_email_at: now.toISOString(),
        consent_email_source: "api",
        source: "api",
      },
    });
  });

  it("refuses what the API may not do", () => {
    expect(readLeadWrite({ name: "No way to reach" }, true).ok).toBe(false);
    expect(readLeadWrite({ email: "nope" }, true).ok).toBe(false);
    expect(readLeadWrite({ status: "vip" }, false).ok).toBe(false);
    expect(readLeadWrite({ consent: { email: false } }, false).ok).toBe(false);
    expect(readLeadWrite({ consent: { fax: true } }, false).ok).toBe(false);
    expect(readLeadWrite({ do_not_contact: false }, false).ok).toBe(false);
    expect(readLeadWrite({ workspace_id: "x" }, false).ok).toBe(false);
    expect(
      readLeadWrite({ custom_fields: { a: { nested: 1 } } }, false).ok,
    ).toBe(false);
  });

  it("can switch do not contact on, and change a status", () => {
    expect(
      readLeadWrite({ do_not_contact: true, status: "qualified" }, false, now),
    ).toEqual({
      ok: true,
      values: {
        do_not_contact: true,
        do_not_contact_at: now.toISOString(),
        status: "qualified",
      },
    });
  });

  it("shows consent as one object", () => {
    expect(
      leadOut({
        id: "1",
        consent_email: true,
        consent_call: false,
        consent_sms: null as unknown as boolean,
        consent_whatsapp: false,
      }),
    ).toEqual({
      id: "1",
      consent: { email: true, call: false, sms: false, whatsapp: false },
    });
  });
});
