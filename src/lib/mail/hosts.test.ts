import { describe, expect, it } from "vitest";
import { mailHostProblem } from "./hosts";

const to =
  (...addresses: string[]) =>
  async () =>
    addresses.map((address) => ({ address }));

describe("a mailbox's server", () => {
  it("must be a public host name", async () => {
    expect(
      await mailHostProblem("smtp.gmail.com", "SMTP", to("142.250.1.108")),
    ).toBeNull();
    for (const host of [
      "127.0.0.1",
      "localhost",
      "10.0.0.5",
      "smtp",
      "[::1]",
      "a b.com",
      "169.254.169.254",
    ])
      expect(await mailHostProblem(host, "SMTP", to("8.8.8.8")), host).toMatch(
        /host name/,
      );
  });

  it("is refused when its name points at a private or local address", async () => {
    for (const address of [
      "127.0.0.1",
      "10.1.2.3",
      "192.168.1.1",
      "169.254.169.254",
      "::1",
    ])
      expect(
        await mailHostProblem("mail.sneaky.example", "IMAP", to(address)),
        address,
      ).toMatch(/isn't a public mail server/);
    // One private address among public ones is enough.
    expect(
      await mailHostProblem(
        "mail.sneaky.example",
        "IMAP",
        to("8.8.8.8", "10.0.0.1"),
      ),
    ).toMatch(/isn't a public mail server/);
  });

  it("says so when the name doesn't exist", async () => {
    const missing = async () => {
      throw new Error("ENOTFOUND");
    };
    expect(await mailHostProblem("imap.nowhere.example", "IMAP", missing)).toBe(
      "No mail server was found at imap.nowhere.example. Check the IMAP server name.",
    );
  });
});
