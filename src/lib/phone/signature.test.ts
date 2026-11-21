import { describe, expect, it } from "vitest";
import { twilioSignature, validTwilioSignature } from "./signature";

// The example from Twilio's own security documentation, then tampering.

const URL = "https://mycompany.com/myapp.php?foo=1&bar=2";
const PARAMS = {
  CallSid: "CA1234567890ABCDE",
  Caller: "+12349013030",
  Digits: "1234",
  From: "+12349013030",
  To: "+18005551212",
};

describe("Twilio's webhook signature", () => {
  it("matches Twilio's documented example", () => {
    expect(twilioSignature("12345", URL, PARAMS)).toBe(
      "0/KCTR6DLpKmkAf8muzZqo1nDgQ=",
    );
    expect(
      validTwilioSignature(
        "12345",
        URL,
        PARAMS,
        "0/KCTR6DLpKmkAf8muzZqo1nDgQ=",
      ),
    ).toBe(true);
  });

  it("refuses a changed parameter, address, token or a missing header", () => {
    const sig = twilioSignature("12345", URL, PARAMS);
    expect(
      validTwilioSignature("12345", URL, { ...PARAMS, Digits: "9" }, sig),
    ).toBe(false);
    expect(validTwilioSignature("12345", URL + "&x=1", PARAMS, sig)).toBe(
      false,
    );
    expect(validTwilioSignature("54321", URL, PARAMS, sig)).toBe(false);
    expect(validTwilioSignature("12345", URL, PARAMS, null)).toBe(false);
    expect(validTwilioSignature("", URL, PARAMS, sig)).toBe(false);
    expect(validTwilioSignature("12345", URL, PARAMS, "short")).toBe(false);
  });
});
