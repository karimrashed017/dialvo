// What a research column asks for and what it gets back: the answer's type,
// how the model's reply is checked and turned into a typed value, and how a
// value is shown and exported. Pure, so it runs in tests and in the browser.

export const ANSWER_TYPES = [
  "yes_no",
  "number",
  "score",
  "pick_one",
  "text",
] as const;
export type AnswerType = (typeof ANSWER_TYPES)[number];

export const ANSWER_LABEL: Record<AnswerType, string> = {
  yes_no: "Yes or no",
  number: "A number",
  score: "A score from 0 to 100",
  pick_one: "One of a few options",
  text: "A short answer",
};

export const DATA_FIELDS = [
  "work_email",
  "verify_email",
  "title",
  "company_size",
  "industry",
  "technologies",
] as const;
export type DataField = (typeof DATA_FIELDS)[number];

export const DATA_FIELD_LABEL: Record<DataField, string> = {
  work_email: "Work email",
  verify_email: "Email check",
  title: "Job title",
  company_size: "Company size",
  industry: "Industry",
  technologies: "Technologies",
};

/** What each data column needs on the row, in words for the page. */
export const DATA_FIELD_NEEDS: Record<DataField, string> = {
  work_email: "a person's name and the company's website",
  verify_email: "an email address",
  title: "an email address",
  company_size: "the company's website",
  industry: "the company's website",
  technologies: "the company's website",
};

export type AnswerValue = boolean | number | string | null;

export type CheckedAnswer = {
  value: AnswerValue;
  text: string;
  source_url: string | null;
  reason: string;
};

const oneLine = (value: unknown, max: number) =>
  typeof value === "string"
    ? value
        .replace(/[\u0000-\u001f\u007f<>]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max)
    : "";

/** A source link: http(s) only, no credentials, at most 2,000 characters. */
export function sourceUrl(value: unknown): string | null {
  const raw = oneLine(value, 2000);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password)
      return null;
    return url.toString().slice(0, 2000);
  } catch {
    return null;
  }
}

/**
 * The model's reply ({ answer, found, source_url, reason }) checked against
 * the column's type. A source must be one the model was shown by the
 * search (`seen`), so a made-up link is dropped. "Not found" is an answer
 * too: a null value with its reason.
 */
export function checkAnswer(
  reply: unknown,
  type: AnswerType,
  options: string[],
  seen: Set<string>,
): CheckedAnswer | null {
  if (!reply || typeof reply !== "object" || Array.isArray(reply)) return null;
  const r = reply as Record<string, unknown>;
  const reason = oneLine(r.reason, 400);
  let url = sourceUrl(r.source_url);
  if (url && seen.size > 0 && !seen.has(normalise(url))) url = null;
  const notFound = r.found === false;
  const raw = r.answer;
  const none = (why: string): CheckedAnswer => ({
    value: null,
    text: "",
    source_url: url,
    reason: reason || why,
  });
  if (notFound) return none("Not found.");
  switch (type) {
    case "yes_no": {
      const v =
        typeof raw === "boolean"
          ? raw
          : /^(yes|true)$/i.test(oneLine(raw, 10))
            ? true
            : /^(no|false)$/i.test(oneLine(raw, 10))
              ? false
              : null;
      if (v === null) return none("No clear answer.");
      return { value: v, text: v ? "Yes" : "No", source_url: url, reason };
    }
    case "number":
    case "score": {
      const n =
        typeof raw === "number"
          ? raw
          : Number(oneLine(raw, 40).replace(/[, ]/g, ""));
      if (!Number.isFinite(n)) return none("No number found.");
      if (type === "score") {
        const s = Math.round(Math.min(Math.max(n, 0), 100));
        return { value: s, text: String(s), source_url: url, reason };
      }
      const v = Math.round(n * 100) / 100;
      if (Math.abs(v) > 1e12) return none("No number found.");
      return { value: v, text: String(v), source_url: url, reason };
    }
    case "pick_one": {
      const text = oneLine(raw, 40).toLowerCase();
      const hit = options.find((o) => o.toLowerCase() === text);
      if (!hit) return none("None of the options fit.");
      return { value: hit, text: hit, source_url: url, reason };
    }
    case "text": {
      const t = oneLine(raw, 300);
      if (!t) return none("Not found.");
      return { value: t, text: t, source_url: url, reason };
    }
  }
}

/** For comparing a cited link with the ones the search returned. */
export function normalise(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}${u.search}`;
  } catch {
    return url;
  }
}

/** The JSON shape the model is asked to answer in, for one type. */
export function answerSchema(type: AnswerType, options: string[]) {
  const answer =
    type === "yes_no"
      ? { type: "boolean" }
      : type === "number" || type === "score"
        ? { type: "number" }
        : type === "pick_one"
          ? { type: "string", enum: options }
          : { type: "string" };
  return {
    type: "object",
    properties: {
      found: { type: "boolean" },
      answer,
      source_url: { type: "string" },
      reason: { type: "string" },
    },
    required: ["found", "answer", "source_url", "reason"],
    additionalProperties: false,
  };
}

/** Options typed as "a, b, c" or one per line. */
export function readOptions(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[,\n]/)
        .map((o) => oneLine(o, 40))
        .filter(Boolean),
    ),
  ].slice(0, 8);
}

// --- CSV out ---------------------------------------------------------------------

const cell = (v: string) => {
  // A leading = + - @ would make a spreadsheet run it as a formula.
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function toCsv(headers: string[], rows: string[][]): string {
  return [headers, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
}
