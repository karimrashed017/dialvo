import type {
  BriefContent,
  Cited,
  ClosedLostContent,
  Person,
  Provided,
  Source,
} from "./types";

// Reading the model's answer for a brief or a closed-lost note. Pure.
//
// The answer is untrusted text: everything is cut to length and stripped
// of markup, and a source is kept only if it is one we gave the model (an
// "S" id) or a link its own web searches returned. A link the model made up
// is dropped, and so is a point that then has no source when it needed one.

const line = (v: unknown, max: number) =>
  typeof v === "string"
    ? v
        .replace(/<[^>]*>/g, " ")
        .replace(/[\u0000-\u001f\u007f]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max)
    : "";

const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** The first JSON object in a text (inside a ``` block or not). */
export function jsonIn(text: string): Record<string, unknown> | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const value: unknown = JSON.parse(body.slice(start, end + 1));
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

const normalUrl = (u: string) => {
  try {
    const url = new URL(u);
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
};

/** Numbers sources in the order they are first used. */
export class SourceBook {
  private byKey = new Map<string, Source>();
  private provided: Map<string, Provided>;
  private searched: Map<string, { url: string; title: string }>;

  constructor(
    provided: Provided[],
    searched: { url: string; title: string }[],
  ) {
    this.provided = new Map(provided.map((p) => [p.id.toUpperCase(), p]));
    this.searched = new Map(
      searched
        .filter((s) => /^https?:\/\//i.test(s.url))
        .map((s) => [normalUrl(s.url), s]),
    );
    // Pages we read are citable by their address too.
    for (const p of provided)
      if (/^https?:\/\//i.test(p.url) && !this.searched.has(normalUrl(p.url)))
        this.searched.set(normalUrl(p.url), { url: p.url, title: p.title });
  }

  /** The numbers of the sources an item names that we can stand behind. */
  cite(refs: unknown): number[] {
    const out: number[] = [];
    for (const raw of list(refs).slice(0, 6)) {
      if (typeof raw !== "string") continue;
      const ref = raw.trim();
      let source: { url: string; title: string } | undefined;
      let key: string;
      const id = /^\[?(S\d{1,3})\]?$/i.exec(ref)?.[1]?.toUpperCase();
      if (id) {
        source = this.provided.get(id);
        key = source ? `id:${id}` : "";
      } else {
        key = normalUrl(ref);
        source = key ? this.searched.get(key) : undefined;
        key = `url:${key}`;
      }
      if (!source) continue;
      let entry = this.byKey.get(key);
      if (!entry) {
        if (this.byKey.size >= 40) continue;
        entry = {
          n: this.byKey.size + 1,
          title: line(source.title, 200) || line(source.url, 200),
          url: source.url.slice(0, 600),
        };
        this.byKey.set(key, entry);
      }
      if (!out.includes(entry.n)) out.push(entry.n);
    }
    return out;
  }

  sources(): Source[] {
    return [...this.byKey.values()].sort((a, b) => a.n - b.n);
  }
}

function cited(
  v: unknown,
  book: SourceBook,
  max: number,
  needsSource: boolean,
): Cited[] {
  const out: Cited[] = [];
  for (const item of list(v)) {
    const o =
      item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const text = line(typeof item === "string" ? item : o.text, 400);
    if (!text) continue;
    const sources = book.cite(o.sources);
    if (needsSource && sources.length === 0) continue;
    out.push({ text, sources });
    if (out.length >= max) break;
  }
  return out;
}

const strings = (v: unknown, max: number, len = 300) =>
  list(v)
    .map((x) => line(x, len))
    .filter(Boolean)
    .slice(0, max);

export type ReadBrief = {
  content: BriefContent;
  summary: string;
  sources: Source[];
};

/**
 * A brief from the model's answer, or null when there's nothing usable.
 * Company facts and people from outside need a source; what was said in the
 * conversation cites the conversation; questions and points may stand alone.
 */
export function readBrief(
  text: string,
  provided: Provided[],
  searched: { url: string; title: string }[],
): ReadBrief | null {
  const o = jsonIn(text);
  if (!o) return null;
  const book = new SourceBook(provided, searched);
  // In the order the brief shows them, so sources number from the top.
  const company = cited(o.company, book, 8, true);
  const people: Person[] = [];
  for (const item of list(o.people)) {
    const p =
      item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const name = line(p.name, 120);
    if (!name) continue;
    people.push({
      name,
      role: line(p.role, 160),
      note: line(p.note, 300),
      sources: book.cite(p.sources),
    });
    if (people.length >= 8) break;
  }
  const content: BriefContent = {
    kind: "brief",
    company,
    people,
    history: cited(o.history, book, 8, false),
    open_questions: strings(o.open_questions, 6),
    talking_points: cited(o.talking_points, book, 6, false),
  };
  const summary = line(o.summary, 600);
  const empty =
    content.company.length +
      content.history.length +
      content.talking_points.length +
      content.open_questions.length ===
    0;
  if (empty && !summary) return null;
  return { content, summary, sources: book.sources() };
}

export type ReadClosedLost = {
  content: ClosedLostContent;
  summary: string;
  sources: Source[];
};

export function readClosedLost(
  text: string,
  provided: Provided[],
): ReadClosedLost | null {
  const o = jsonIn(text);
  if (!o) return null;
  const book = new SourceBook(provided, []);
  const content: ClosedLostContent = {
    kind: "closed_lost",
    reasons: cited(o.reasons, book, 5, false),
    what_might_change: strings(o.what_might_change, 5),
    next_step: line(o.next_step, 300),
  };
  if (content.reasons.length === 0) return null;
  return {
    content,
    summary: line(o.summary, 600) || content.reasons[0].text,
    sources: book.sources(),
  };
}

/** The links a web-search answer's own result blocks returned. */
export function searchedLinks(
  blocks: unknown[],
): { url: string; title: string }[] {
  const out: { url: string; title: string }[] = [];
  for (const b of blocks) {
    const block = b as { type?: string; content?: unknown };
    if (
      block?.type !== "web_search_tool_result" ||
      !Array.isArray(block.content)
    )
      continue;
    for (const r of block.content as {
      type?: string;
      url?: unknown;
      title?: unknown;
    }[])
      if (r?.type === "web_search_result" && typeof r.url === "string")
        out.push({
          url: r.url,
          title: typeof r.title === "string" ? r.title : "",
        });
  }
  return out;
}
