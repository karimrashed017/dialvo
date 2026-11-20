import { describe, expect, it } from "vitest";
import { parseCapture } from "./capture";

const ok = (input: unknown) => {
  const result = parseCapture(input);
  if (!result.ok) throw new Error(`${result.field}: ${result.problem}`);
  return result;
};
const bad = (input: unknown) => {
  const result = parseCapture(input);
  if (result.ok) throw new Error("expected a problem");
  return result.field;
};

describe("parseCapture", () => {
  it("cleans a full submission", () => {
    expect(
      ok({
        name: "  Nora   Field ",
        email: " Nora@Field.Example ",
        phone: "+44 1632 960123",
        company: "Field & Co",
        website: "field.example",
        message: "Hello.\r\n\r\n\r\n\r\nCall me?  ",
        utm_source: "ignored",
      }).lead,
    ).toEqual({
      name: "Nora Field",
      email: "nora@field.example",
      phone: "+441632960123",
      company: "Field & Co",
      website: "field.example",
      message: "Hello.\n\nCall me?",
      consent: {},
    });
  });

  it("accepts an email or a phone on its own, and first/last names", () => {
    expect(ok({ email: "a@b.example" }).lead).toMatchObject({
      email: "a@b.example",
      phone: null,
      name: "",
    });
    expect(
      ok({ phone: "555 010 1234", first_name: "Ada", last_name: "Lovelace" })
        .lead,
    ).toMatchObject({
      email: null,
      phone: "5550101234",
      name: "Ada Lovelace",
    });
  });

  it("refuses a submission nobody could be contacted from", () => {
    expect(bad({})).toBe("email");
    expect(bad({ name: "No contact" })).toBe("email");
    expect(bad({ email: "nope" })).toBe("email");
    expect(bad({ email: "nope", phone: "5550101234" })).toBe("email");
    expect(bad({ email: "a@b.example", phone: "call me" })).toBe("phone");
    expect(bad(null)).toBe("body");
    expect(bad("email=a@b.example")).toBe("body");
    expect(bad([{ email: "a@b.example" }])).toBe("body");
  });

  it("refuses the wrong kind of value and anything oversized", () => {
    expect(bad({ email: "a@b.example", name: { $ne: "" } })).toBe("name");
    expect(bad({ email: "a@b.example", message: ["x"] })).toBe("message");
    expect(bad({ email: "a@b.example", message: "x".repeat(5001) })).toBe(
      "message",
    );
    expect(bad({ email: "a@b.example", name: "x".repeat(201) })).toBe("name");
  });

  describe("consent", () => {
    it("is absent unless the payload includes it", () => {
      expect(ok({ email: "a@b.example" }).lead.consent).toEqual({});
    });

    it("is read from form-style fields", () => {
      expect(
        ok({
          email: "a@b.example",
          consent_call: "on",
          consent_sms: "true",
          consent_email: "yes",
        }).lead.consent,
      ).toEqual({ call: true, sms: true, email: true });
    });

    it("is read from a JSON object, and keeps an explicit no as a no", () => {
      expect(
        ok({ email: "a@b.example", consent: { whatsapp: true, call: false } })
          .lead.consent,
      ).toEqual({
        whatsapp: true,
        call: false,
      });
      expect(
        ok({ email: "a@b.example", consent_sms: "" }).lead.consent,
      ).toEqual({ sms: false });
    });

    it("is never guessed from an unclear value", () => {
      expect(bad({ email: "a@b.example", consent_call: "maybe" })).toBe(
        "consent_call",
      );
      expect(bad({ email: "a@b.example", consent: { sms: "sure" } })).toBe(
        "consent_sms",
      );
      expect(bad({ email: "a@b.example", consent_email: 7 })).toBe(
        "consent_email",
      );
      // A blanket "consent: true" says nothing about which channel.
      expect(ok({ email: "a@b.example", consent: true }).lead.consent).toEqual(
        {},
      );
    });
  });

  it("flags the honeypot", () => {
    expect(ok({ email: "a@b.example" }).bot).toBe(false);
    expect(ok({ email: "a@b.example", _hp: "" }).bot).toBe(false);
    expect(ok({ email: "a@b.example", _hp: "http://spam.example" }).bot).toBe(
      true,
    );
  });
});
