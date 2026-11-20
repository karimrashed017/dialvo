import { describe, expect, it } from "vitest";
import {
  asksToStop,
  CARD_REMOVED,
  containsCardNumber,
  redactCardNumbers,
} from "./guard";

describe("redactCardNumbers", () => {
  it("removes card numbers, however they are grouped", () => {
    for (const card of [
      "4242424242424242",
      "4242 4242 4242 4242",
      "4242-4242-4242-4242",
      "378282246310005",
      "5555555555554444",
      "30569309025904",
    ]) {
      expect(redactCardNumbers(`my card is ${card} exp 12/29`)).toBe(
        `my card is ${CARD_REMOVED} exp 12/29`,
      );
      expect(containsCardNumber(card)).toBe(true);
    }
  });

  it("leaves other numbers alone", () => {
    for (const text of [
      "Call me on +44 20 7946 0958",
      "Order 1234567890123456",
      "We have 12 clinics and 4000 patients",
      "My budget is 15000 to 20000",
      // The right length, but not a card: a timestamp, a phone number with
      // its country code, and a number that fails the check digit.
      "Ref 1763643000001",
      "+86 138 0013 8000",
      "4242 4242 4242 4241",
      // Passes the check digit, but cards don't start with 9.
      "9111111111111117",
    ])
      expect(redactCardNumbers(text)).toBe(text);
  });
});

describe("asksToStop", () => {
  it("notices plain opt-outs", () => {
    for (const text of [
      "Please unsubscribe me",
      "STOP CONTACTING ME",
      "do not contact me again",
      "Don't email me",
      "I want to opt out",
      "remove me from your list",
    ])
      expect(asksToStop(text), text).toBe(true);
  });

  it("doesn't fire on ordinary questions", () => {
    for (const text of [
      "Can I stop my plan at any time?",
      "How do you contact new leads?",
      "Do you call me or do I call you?",
    ])
      expect(asksToStop(text), text).toBe(false);
  });
});
