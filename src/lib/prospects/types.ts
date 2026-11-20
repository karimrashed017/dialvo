// The shapes the lead finder passes around. The migration
// (20261120150000_find_leads_and_first_emails.sql) is the source of truth
// for what the database stores.

export type Brief = {
  description: string;
  location: string;
  company_size: string;
  exclusions: string;
};

export type ProspectSearch = Brief & {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  /** The contact database's query and job titles ("Search details"). */
  contact_query: string;
  contact_titles: string[][];
  contact_query_for: string;
  contact_query_edited: boolean;
};

export type RunStatus =
  "searching" | "researching" | "done" | "stopped" | "failed";

export type ProspectRun = {
  id: string;
  search_id: string;
  status: RunStatus;
  stop_reason: string | null;
  target_count: number;
  search_rounds: number;
  searches_used: number;
  cost_micros: number;
  created_at: string;
  finished_at: string | null;
  source: ProspectSourceName;
  contact_phase: "start" | "wait" | "read" | null;
};

export type Fact = { fact: string; quote: string; source_url: string };

export type Prospect = {
  id: string;
  run_id: string;
  search_id: string;
  domain: string;
  company_name: string;
  website: string;
  research_status: "candidate" | "researching" | "found" | "skipped" | "failed";
  skip_reason: string | null;
  summary: string;
  location: string;
  contact_name: string;
  contact_role: string;
  contact_source_url: string | null;
  email: string | null;
  email_source_url: string | null;
  email_kind: "business" | "free_mail" | "person" | null;
  phone: string | null;
  phone_source_url: string | null;
  facts: Fact[];
  pages: string[];
  decision: "undecided" | "kept" | "removed";
  lead_id: string | null;
  created_at: string;
} & ContactDetails;

/** What the contact database adds to a prospect (all empty for web ones). */
export type ContactDetails = {
  source: ProspectSourceName;
  size_range: string;
  industries: string[];
  country: string;
  match_score: number | null;
  contact_linkedin_url: string | null;
  email_verified: boolean;
};

/** Where a run finds its companies. */
export type ProspectSourceName = "web" | "findymail";

export type DraftStatus =
  "drafting" | "draft" | "approved" | "discarded" | "failed";

export type OutboundDraft = {
  id: string;
  prospect_id: string;
  to_email: string;
  subject: string;
  body: string;
  status: DraftStatus;
  discard_reason: string | null;
  edited: boolean;
  created_at: string;
  decided_at: string | null;
};

export type Suppression = {
  id: string;
  kind: "email" | "domain";
  value: string;
  note: string;
  created_at: string;
};

export type Usage = {
  runs: number;
  searches: number;
  suggestions: number;
  drafts: number;
  cost_micros: number;
};

/** A company the search turned up, before its site has been read. */
export type Candidate = {
  domain: string;
  website: string;
  company_name: string;
};

/** One page of a company's own site, as the reader keeps it. */
export type SitePage = {
  url: string;
  title: string;
  text: string;
  /** Addresses published on this page, best first. */
  emails: FoundEmail[];
  /** Numbers from the page's tel: links. */
  phones: string[];
};

export type FoundEmail = {
  email: string;
  kind: "business" | "free_mail";
  /** True when the page links it as mailto:. */
  linked: boolean;
};

/** What is stored about a company once its site has been read. */
export type ResearchResult =
  | {
      status: "found";
      company_name: string;
      website: string;
      summary: string;
      location: string;
      contact_name: string;
      contact_role: string;
      contact_source_url: string;
      email: string;
      email_source_url: string;
      email_kind: "business" | "free_mail" | "";
      phone: string;
      phone_source_url: string;
      facts: Fact[];
      pages: string[];
    }
  | { status: "skipped"; reason: SkipReason; company_name?: string }
  | { status: "retry" };

export type SkipReason =
  | "not_a_business"
  | "not_a_match"
  | "no_website"
  /** The site's robots.txt asks DialvoBot (or every robot) not to read it. */
  | "robots_disallowed"
  | "unreadable"
  | "suppressed"
  | "already_a_lead";

/** Tokens and searches one model call used, and what that roughly cost. */
export type Spend = {
  input_tokens: number;
  output_tokens: number;
  searches: number;
  cost_micros: number;
};

export const NO_SPEND: Spend = {
  input_tokens: 0,
  output_tokens: 0,
  searches: 0,
  cost_micros: 0,
};
