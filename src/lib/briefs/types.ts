// What an account brief and a closed-lost note hold, as the database keeps
// them (account_briefs.content) and the app shows them. Every point that
// came from somewhere carries the numbers of its sources.

export type Cited = { text: string; sources: number[] };

export type Person = {
  name: string;
  role: string;
  note: string;
  sources: number[];
};

export type BriefContent = {
  kind: "brief";
  /** What the company is and does, from its site and the web. */
  company: Cited[];
  /** The people: the lead, colleagues Dialvo knows, others named in sources. */
  people: Person[];
  /** What was said with them before, on every channel. */
  history: Cited[];
  open_questions: string[];
  talking_points: Cited[];
};

export type ClosedLostContent = {
  kind: "closed_lost";
  /** Why it was most likely lost, from the conversation. */
  reasons: Cited[];
  /** What might change their mind, or when to try again. */
  what_might_change: string[];
  next_step: string;
};

export type AnyBrief = BriefContent | ClosedLostContent;

/** One numbered source: a page, a search result, or the conversation. */
export type Source = { n: number; title: string; url: string };

/** What the model is given as citable material, by id ("S1"). */
export type Provided = { id: string; title: string; url: string };

/** What brief_context returns (the account_briefs migration). */
export type BriefContext = {
  brief: { id: string; kind: "brief" | "closed_lost"; reason: string };
  workspace: { name: string; website: string | null; timezone: string };
  knowledge: string;
  lead: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    company: string | null;
    website: string | null;
    source: string;
    status: string;
    created_at: string;
    custom_fields: Record<string, unknown>;
    owner: { id: string; name: string } | null;
  };
  research: {
    summary: string;
    contact_role: string;
    facts: { fact: string; quote?: string; source_url?: string }[];
    website: string;
    country: string | null;
    size_range: string | null;
  } | null;
  meeting: {
    id: string;
    title: string;
    starts_at: string;
    ends_at: string;
    attendees: { email: string; name: string }[];
    host: { id: string; name: string } | null;
  } | null;
  people: {
    name: string;
    email: string | null;
    company: string | null;
    status: string;
  }[];
  messages: { at: string; channel: string; from: string; body: string }[];
  calls: {
    at: string | null;
    direction: string;
    status: string;
    summary: string;
  }[];
  meetings: { title: string; starts_at: string; status: string }[];
  notes: { at: string; kind: string; text: string }[];
};
