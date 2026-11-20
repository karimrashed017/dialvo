import { describe, expect, it } from "vitest";
import { isCompanySite, siteDomain } from "./domains";
import {
  contactLinks,
  emailProblem,
  emailRole,
  emailsOnPage,
  isUnsuitableEmail,
  phonesOnPage,
} from "./extract";

const page = (body: string) =>
  `<html><head><title>Acme</title></head><body>${body}</body></html>`;

describe("siteDomain", () => {
  it("reads the host out of whatever a search answer gives", () => {
    expect(siteDomain("https://www.Acme.co.uk/about?x=1")).toBe("acme.co.uk");
    expect(siteDomain("acme.com")).toBe("acme.com");
    expect(siteDomain("http://shop.acme.com:8080/")).toBe("shop.acme.com");
  });
  it("refuses what isn't a public host name", () => {
    for (const bad of [
      "",
      "Acme Ltd",
      "localhost",
      "10.0.0.1",
      "https://1.2.3.4/",
      "acme",
      null,
      42,
      "a b.com",
    ])
      expect(siteDomain(bad), String(bad)).toBeNull();
  });
});

describe("isCompanySite", () => {
  it("never treats a social network or a directory as a company's site", () => {
    for (const host of [
      "linkedin.com",
      "uk.linkedin.com",
      "facebook.com",
      "instagram.com",
      "x.com",
      "yelp.com",
      "m.facebook.com",
    ])
      expect(isCompanySite(host), host).toBe(false);
    expect(isCompanySite("acme.com")).toBe(true);
    // Not fooled by a name that merely ends the same way.
    expect(isCompanySite("notlinkedin.com")).toBe(true);
    expect(isCompanySite("max.com")).toBe(true);
  });
});

describe("emailsOnPage: only addresses the page itself prints", () => {
  it("finds linked and printed addresses on the company's domain, general ones first", () => {
    const html = page(`
      <p>Write to Dana at dana.smith@acme.com.</p>
      <a href="mailto:hello@acme.com?subject=Hi">Email us</a>
      <footer>Studio: studio@mail.acme.com</footer>`);
    expect(emailsOnPage(html, "acme.com")).toEqual([
      { email: "hello@acme.com", kind: "business", linked: true },
      { email: "studio@mail.acme.com", kind: "business", linked: false },
      { email: "dana.smith@acme.com", kind: "business", linked: false },
    ]);
  });

  it("never offers a mailbox meant for something else: jobs, support, press, bills", () => {
    const html = page(`
      <a href="mailto:hr@acme.com">Work with us</a>
      <a href="mailto:careers@acme.com">Careers</a>
      <a href="mailto:jobs@acme.com">Jobs</a>
      <a href="mailto:support@acme.com">Support</a>
      <a href="mailto:help@acme.com">Help</a>
      <a href="mailto:press@acme.com">Press</a>
      <a href="mailto:billing@acme.com">Billing</a>
      <a href="mailto:accounts@acme.com">Accounts</a>
      <a href="mailto:legal@acme.com">Legal</a>
      <a href="mailto:abuse@acme.com">Abuse</a>`);
    // That is all the site prints, so the company has no usable address.
    expect(emailsOnPage(html, "acme.com")).toEqual([]);
    expect(emailProblem("hr@acme.com", "acme.com", true)).toBe("unsuitable");
    expect(emailProblem("support@acme.com", "acme.com", true)).toBe(
      "unsuitable",
    );
    for (const address of [
      "hr@acme.com",
      "Careers@acme.com",
      "noreply@acme.com",
    ])
      expect(isUnsuitableEmail(address)).toBe(true);
    for (const address of ["info@acme.com", "dana@acme.com", "sales@acme.com"])
      expect(isUnsuitableEmail(address)).toBe(false);
  });

  it("never builds an address: a name and a domain on the page are not an email", () => {
    const html = page(`
      <h2>Our founder, Dana Smith</h2>
      <p>Visit acme.com or call us. Email: dana [at] acme [dot] com</p>
      <p>first.last@acme.com is our format</p>
      <script>var e = "hidden" + "@" + "acme.com"; var f = "script@acme.com";</script>`);
    // The only address printed in full is the pattern example, which is refused as a placeholder.
    expect(emailsOnPage(html, "acme.com")).toEqual([]);
  });

  it("leaves out other companies' addresses, dead mailboxes, placeholders and file names", () => {
    const html = page(`
      <p>Site by studio@webagency.io</p>
      <a href="mailto:noreply@acme.com">x</a>
      <a href="mailto:privacy@acme.com">x</a>
      <p>you@example.com name@acme.com</p>
      <img src="logo@2x.png"> <p>logo@2x.png</p>
      <p>abc123@o1.ingest.sentry.io</p>`);
    expect(emailsOnPage(html, "acme.com")).toEqual([]);
  });

  it("keeps a free mailbox only when the business links it as its contact", () => {
    const mentioned = page(`<p>Review by happy.customer@gmail.com</p>`);
    expect(emailsOnPage(mentioned, "acme.com")).toEqual([]);
    const linked = page(`<a href="mailto:AcmePlumbing@Gmail.com">Email us</a>`);
    expect(emailsOnPage(linked, "acme.com")).toEqual([
      { email: "acmeplumbing@gmail.com", kind: "free_mail", linked: true },
    ]);
  });

  it("explains each refusal", () => {
    expect(emailProblem("hello@acme.com", "acme.com", false)).toBeNull();
    expect(emailProblem("hello@other.com", "acme.com", true)).toBe(
      "not_theirs",
    );
    expect(emailProblem("x@gmail.com", "acme.com", false)).toBe(
      "free_mail_unlinked",
    );
    expect(emailProblem("no-reply@acme.com", "acme.com", true)).toBe(
      "not_a_contact",
    );
    expect(emailProblem("not an email", "acme.com", true)).toBe(
      "not_an_address",
    );
  });
});

describe("phonesOnPage", () => {
  it("takes numbers from tel: links only", () => {
    const html = page(
      `<a href="tel:+44 113 000 0000">Call</a> <p>Order 12345678901</p> <a href="tel:abc">x</a>`,
    );
    expect(phonesOnPage(html)).toEqual(["+441130000000"]);
  });
});

describe("contactLinks", () => {
  it("finds the site's own contact and about pages, contact first, same host only", () => {
    const html = page(`
      <a href="/about-us/">About</a>
      <a href="https://www.acme.com/contact">Get in touch</a>
      <a href="https://facebook.com/acme/contact">Facebook</a>
      <a href="http://acme.com/contact-http">Contact</a>
      <a href="https://other.com/contact">Contact</a>
      <a href="/blog/2024/01/about-our-year/post">About our year</a>
      <a href="/team.pdf">Team</a>
      <a href="/pricing">Pricing</a>
      <a href="/contact#form">Contact again</a>`);
    expect(contactLinks(html, "https://acme.com/", 2)).toEqual([
      "https://www.acme.com/contact",
      "https://acme.com/about-us/",
    ]);
  });
});

describe("emailRole: whose mailbox an address is", () => {
  it("knows the shared inboxes", () => {
    for (const address of [
      "info@acme.com",
      "hello@acme.com",
      "contact@acme.com",
      "sales@acme.com",
      "office@acme.com",
    ])
      expect(emailRole(address, "Dana Smith")).toBe("general");
  });

  it("calls an address a person's only when it carries the named contact's name", () => {
    for (const address of [
      "dana@acme.com",
      "dana.smith@acme.com",
      "d.smith@acme.com",
      "dsmith@acme.com",
      "danasmith@acme.com",
      "smith@acme.com",
    ])
      expect(emailRole(address, "Dr. Dana Smith")).toBe("person");
    // Somebody else's, or nobody is named: not claimed as the contact's.
    expect(emailRole("bob@acme.com", "Dana Smith")).toBe("other");
    expect(emailRole("dana@acme.com", "")).toBe("other");
    expect(emailRole("frontdesk@acme.com", "Dana Smith")).toBe("other");
    // A title is not a name.
    expect(emailRole("dr@acme.com", "Dr. Dana Smith")).toBe("other");
  });
});
