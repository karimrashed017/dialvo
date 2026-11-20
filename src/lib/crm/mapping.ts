import type { Provider } from "./types";

// What Dialvo writes where, for the read-only preview in Settings. It
// describes what hubspot.ts and pipedrive.ts do; change both together.

export type MappingRow = { dialvo: string; crm: string; note?: string };

export const MAPPING: Record<Provider, MappingRow[]> = {
  hubspot: [
    {
      dialvo: "Lead's email",
      crm: "Contact: Email",
      note: "How the contact is matched. An existing contact is never changed.",
    },
    {
      dialvo: "Lead's name",
      crm: "Contact: First name, Last name",
      note: "New contacts only",
    },
    {
      dialvo: "Phone, company, website",
      crm: "Contact: Phone number, Company name, Website URL",
      note: "New contacts only",
    },
    {
      dialvo: "New lead",
      crm: "Contact: Lifecycle stage = Lead",
      note: "New contacts only",
    },
    {
      dialvo: "Company website, or the domain of a work email",
      crm: "Company: Company domain name",
      note: "How the company is matched; associated with the contact",
    },
    {
      dialvo: "Website chat qualified, not a fit, needs a person, or ended",
      crm: "Note on the contact and company",
      note: "The agent's summary and the latest messages",
    },
    {
      dialvo: "Email sent, reply received",
      crm: "Note on the contact and company",
      note: "Subject and text; out-of-office replies are left out",
    },
    {
      dialvo: "Meeting",
      crm: "Meeting on the contact and company",
      note: "Title, start, end, outcome; updated when it changes",
    },
    {
      dialvo: "Qualified or meeting booked (if you switch it on)",
      crm: "Deal in the pipeline and stage you choose",
      note: "One per lead",
    },
    {
      dialvo: "Do not contact, unsubscribed",
      crm: "Unsubscribed from all email",
      note: "If the key may change subscriptions; otherwise a note",
    },
  ],
  pipedrive: [
    {
      dialvo: "Lead's email",
      crm: "Person: Email",
      note: "How the person is matched. An existing person is never changed.",
    },
    {
      dialvo: "Lead's name and phone",
      crm: "Person: Name, Phone",
      note: "New people only",
    },
    {
      dialvo: "Company name and website",
      crm: "Organization: Name, Website",
      note: "Matched on the exact name; set as the person's organization if they have none",
    },
    {
      dialvo: "Website chat qualified, not a fit, needs a person, or ended",
      crm: "Note on the person and organization",
      note: "The agent's summary and the latest messages",
    },
    {
      dialvo: "Email sent, reply received",
      crm: "Note on the person and organization",
      note: "Subject and text; out-of-office replies are left out",
    },
    {
      dialvo: "Meeting",
      crm: "Activity of type Meeting",
      note: "Subject, date, time, duration; marked done when it has happened",
    },
    {
      dialvo: "Qualified or meeting booked (if you switch it on)",
      crm: "Deal in the pipeline and stage you choose",
      note: "One per lead",
    },
    {
      dialvo: "Do not contact, unsubscribed",
      crm: "Person: Marketing status = Unsubscribed",
      note: "Marketing status needs Pipedrive's Campaigns; without it, a note",
    },
  ],
};

export const IMPORT_MAPPING: Record<Provider, string> = {
  hubspot:
    "Every contact's email and every company's domain, with whether its lifecycle stage is Opportunity, Customer or Evangelist.",
  pipedrive:
    "Every person's email addresses (and the domain of a work address) and every organization's website, with whether they have an open or won deal.",
};
