// The languages a sequence, a play or a playbook can be set to write in.
// "auto" writes the first email in the language of the company's own website
// (or of what the lead wrote to the team), and each follow-up in the
// language of the emails before it. The database keeps the two-letter code
// (sequences.language, outbound_drafts.language, mail_threads.language).

export const LANGUAGES = {
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  nl: "Dutch",
  sv: "Swedish",
  da: "Danish",
  nb: "Norwegian",
  fi: "Finnish",
  pl: "Polish",
  cs: "Czech",
  ro: "Romanian",
  hu: "Hungarian",
  el: "Greek",
  tr: "Turkish",
  uk: "Ukrainian",
  ar: "Arabic",
  he: "Hebrew",
  hi: "Hindi",
  id: "Indonesian",
  vi: "Vietnamese",
  th: "Thai",
  ja: "Japanese",
  ko: "Korean",
  zh: "Chinese",
} as const;

export type LanguageCode = keyof typeof LANGUAGES;
export type Language = "auto" | LanguageCode;

export const isLanguage = (value: unknown): value is Language =>
  value === "auto" ||
  (typeof value === "string" && Object.hasOwn(LANGUAGES, value));

export const languageName = (code: string): string | null =>
  Object.hasOwn(LANGUAGES, code) ? LANGUAGES[code as LanguageCode] : null;

export const languageLabel = (code: string): string =>
  languageName(code) ?? "The company's own language";

/**
 * The line a writer is given for a fixed language. Null for "auto": the
 * writer's own rules (the website's language) apply.
 */
export function languageLine(code: string | null | undefined): string | null {
  const name = code ? languageName(code) : null;
  if (!name) return null;
  return `Write this email in ${name}, whatever language the material above is in. Keep names, product names and the sign-off exactly as given.`;
}
