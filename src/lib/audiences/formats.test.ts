import { describe, expect, it } from "vitest";
import {
  companyFile,
  contactFile,
  countryCode,
  csvCell,
  e164,
  normalEmail,
  normalName,
  sha256,
} from "./formats";

const row = {
  email: " Pat.Lead@Gmail.com ",
  phone: "+44 7700 900123",
  name: "Dr. Pat O'Lead",
  company: "=Acme",
  title: "Head of Sales",
  country: "London, United Kingdom",
  domain: "acme.example",
};

describe("ad audience files", () => {
  it("normalise the way the platforms ask", () => {
    expect(normalEmail(row.email)).toBe("pat.lead@gmail.com");
    expect(normalEmail(row.email, true)).toBe("patlead@gmail.com");
    expect(normalEmail("not an email")).toBe("");
    expect(e164("+44 7700 900123")).toBe("+447700900123");
    expect(e164("0044 7700 900123")).toBe("+447700900123");
    // No country code: can't be matched safely, so left out.
    expect(e164("07700 900123")).toBe("");
    expect(countryCode("London, United Kingdom")).toBe("gb");
    expect(countryCode("DE")).toBe("de");
    expect(normalName("O'Lead")).toBe("olead");
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
  });

  it("LinkedIn contact list: its template's header, the email hashed, the rest plain", () => {
    const f = contactFile("linkedin_contacts", [row], true, "UK leads");
    const [header, line] = f.body.trim().split("\r\n");
    expect(header).toBe(
      "email,firstname,lastname,jobtitle,employeecompany,country,googleaid",
    );
    expect(line).toBe(
      `${sha256("pat.lead@gmail.com")},Pat,O'Lead,Head of Sales,Acme,GB,`,
    );
    expect(f.filename).toBe("uk-leads-linkedin-contacts-sha256.csv");
  });

  it("Meta and Google: every identifier hashed after normalising, Google's country left plain", () => {
    const meta = contactFile("meta", [row], true, "a")
      .body.trim()
      .split("\r\n");
    expect(meta[0]).toBe("email,phone,fn,ln,country");
    expect(meta[1].split(",")).toEqual([
      sha256("pat.lead@gmail.com"),
      sha256("447700900123"),
      sha256("pat"),
      sha256("olead"),
      sha256("gb"),
    ]);
    const google = contactFile("google", [row], true, "a")
      .body.trim()
      .split("\r\n");
    expect(google[0]).toBe("Email,Phone,First Name,Last Name,Country,Zip");
    expect(google[1].split(",")).toEqual([
      sha256("patlead@gmail.com"),
      sha256("+447700900123"),
      sha256("pat"),
      sha256("olead"),
      "GB",
      "",
    ]);
  });

  it("company lists use LinkedIn's columns and skip rows without a domain", () => {
    const f = companyFile(
      "linkedin_companies",
      [
        {
          company: "Acme",
          domain: "acme.example",
          country: "Germany",
          linkedin: "https://www.linkedin.com/company/acme",
        },
        { company: "No site", domain: "", country: "", linkedin: "" },
      ],
      "Accounts",
    );
    const lines = f.body.trim().split("\r\n");
    expect(lines[0]).toBe(
      "companyname,companywebsite,companyemaildomain,linkedincompanypageurl,stocksymbol,industry,city,state,companycountry,zipcode",
    );
    expect(lines[1]).toBe(
      "Acme,https://acme.example,acme.example,https://www.linkedin.com/company/acme,,,,,DE,",
    );
    expect(f.rows).toBe(1);
  });

  it("plain files can't start a spreadsheet formula", () => {
    const f = contactFile("plain", [row], false, "x");
    expect(f.body).toContain(",Acme,");
    expect(f.body).not.toContain("=Acme");
  });
});
