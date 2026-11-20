// The shapes CRM sync passes around. The job shape is what
// crm_jobs_claim() returns (supabase/migrations/20261120230000_crm_sync.sql).

export const PROVIDERS = ["hubspot", "pipedrive"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const PROVIDER_NAME: Record<Provider, string> = {
  hubspot: "HubSpot",
  pipedrive: "Pipedrive",
};

export const isProvider = (value: unknown): value is Provider =>
  (PROVIDERS as readonly unknown[]).includes(value);

export type JobKind = "contact" | "note" | "meeting" | "deal" | "opt_out";

export type JobLead = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  website: string | null;
  status: string;
  source: string;
  do_not_contact: boolean;
  created_at: string;
};

export type JobLink = {
  contact_id: string | null;
  company_id: string | null;
  deal_id: string | null;
  contact_created: boolean;
  company_created: boolean;
};

export type ChatDetail = {
  type: "chat";
  outcome: string | null;
  outcome_summary: string | null;
  started_at: string;
  transcript: string | null;
};
export type EmailDetail = {
  type: "email";
  direction: "in" | "out";
  subject: string;
  body: string;
  sent_at: string;
};
export type MeetingDetail = {
  type: "meeting";
  title: string;
  starts_at: string;
  ends_at: string;
  status: "scheduled" | "completed" | "cancelled" | "no_show";
  booked_by: string;
};
export type JobDetail =
  ChatDetail | EmailDetail | MeetingDetail | Record<string, never>;

export type Job = {
  id: string;
  workspace_id: string;
  kind: JobKind;
  source_key: string;
  attempts: number;
  /** What an earlier try of this job wrote (a meeting to update). */
  external_id: string | null;
  connection: {
    provider: Provider;
    can_opt_out: boolean;
    can_deals: boolean;
    deal_pipeline_id: string | null;
    deal_stage_id: string | null;
  };
  lead: JobLead;
  link: JobLink | null;
  /** Null when the conversation, message or meeting is gone. */
  detail: JobDetail | null;
};

export type Credentials = {
  provider: Provider;
  token: string;
  api_domain: string | null;
};

/** One line of the "already in your CRM" list, before it is hashed. */
export type KnownEntry = { k: "email" | "domain"; v: string; f: boolean };

export type PullCursor = { phase?: string; after?: string };

export type PullPage = {
  entries: KnownEntry[];
  /** Contacts and companies read. */
  seen: number;
  next: PullCursor | null;
};

/** What the link on a lead should say after a job. */
export type LinkUpdate = {
  contact_id?: string;
  company_id?: string;
  deal_id?: string;
  contact_created?: boolean;
  company_created?: boolean;
  company_domain?: string;
};

export type Ref = { id: string };

export type MeetingInput = {
  title: string;
  startsAt: string;
  endsAt: string;
  status: MeetingDetail["status"];
  body: string;
};

export type Pipeline = {
  id: string;
  name: string;
  stages: { id: string; name: string }[];
};

/**
 * One CRM, as the sync needs it. Each method is a few requests; all of them
 * throw CrmError when the CRM says no.
 */
export interface CrmClient {
  readonly provider: Provider;
  findContact(email: string): Promise<(Ref & { companyId?: string }) | null>;
  createContact(lead: JobLead, companyId: string | null): Promise<Ref>;
  findCompany(domain: string, name: string): Promise<Ref | null>;
  createCompany(domain: string, name: string): Promise<Ref>;
  /** Idempotent. */
  linkContactToCompany(contactId: string, companyId: string): Promise<void>;
  /** A note Dialvo wrote earlier that carries this marker, if any. */
  findNote(contactId: string, marker: string): Promise<string | null>;
  createNote(
    contactId: string,
    companyId: string | null,
    html: string,
    at: string,
  ): Promise<string>;
  findMeeting(contactId: string, marker: string): Promise<string | null>;
  saveMeeting(
    existingId: string | null,
    contactId: string,
    companyId: string | null,
    meeting: MeetingInput,
  ): Promise<string>;
  findDeal(contactId: string, title: string): Promise<string | null>;
  createDeal(
    contactId: string,
    companyId: string | null,
    input: { title: string; pipelineId: string; stageId: string | null },
  ): Promise<string>;
  /** True when the CRM's own opt-out was set; false when it has none. */
  optOut(email: string, contactId: string): Promise<boolean>;
  pipelines(): Promise<Pipeline[]>;
  pullPage(cursor: PullCursor, pages: number): Promise<PullPage>;
}

export type CrmErrorKind =
  | "auth" // the token was refused
  | "forbidden" // the token lacks a permission (scope)
  | "rate" // too many requests: retryAfterSeconds says when
  | "server" // the CRM had a problem: try again later
  | "network" // couldn't reach it, or it timed out
  | "not_found"
  | "conflict"
  | "bad_request"; // the CRM refused the data

export class CrmError extends Error {
  constructor(
    readonly kind: CrmErrorKind,
    message: string,
    readonly status = 0,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
  }
}
