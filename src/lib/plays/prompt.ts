import type Anthropic from "@anthropic-ai/sdk";
import {
  EMAIL_TARGET_WORDS,
  KNOWLEDGE_CHARS_FOR_DRAFT,
  SUBJECT_MAX_CHARS,
} from "@/lib/prospects/config";
import {
  inert as inertBase,
  knowledgeBlock,
  signOff,
  UNTRUSTED,
  type DraftContext,
} from "@/lib/prospects/prompt";
import type { PlayKind } from "./catalog";

// The prompts for a play's email to one of the workspace's own leads
// (reactivation, closed lost, nurture, onboarding, expansion, trial users,
// events, speed to lead), and the extra lines for a competitive-takeout
// first email. Pure functions.
//
// What we know about the lead (their name, company, "why now", the event,
// what they wrote to the team) is material: it goes inside tags and is never
// read as instructions, as in src/lib/agents/prompt.ts. A person approves
// every email before it is sent, unless an owner chose otherwise for speed
// to lead.

const OUR_TAGS = /<(\/?)(lead|event|their_words|booking_link)\b/gi;

/** Stops text from closing our tags and posing as part of the prompt. */
export const inert = (text: string) =>
  inertBase(text).replace(OUR_TAGS, "&lt;$1$2");

export type PlayContext = DraftContext & { booking_url: string | null };

export type PlayLead = {
  name: string;
  company: string;
  website: string;
  /** Why this lead, now: one sentence from the database. */
  why_now: string;
  /** The subject of the last email thread with them, if any. */
  last_subject: string;
  /** What they last wrote to the team, in their words. Speed to lead. */
  their_message: string;
};

export type PlayEvent = { name: string; link: string; date: string };

const PLAY_RULES = `You write one email from a business to someone who already knows it: one of its own leads or customers. A person on the team reads every draft and decides whether it is sent. Write something they would be comfortable putting their name to.

## What the email is
Plain text, under ${EMAIL_TARGET_WORDS} words, in short paragraphs. The subject is short (under ${SUBJECT_MAX_CHARS} characters), plain and specific. No capital-letter words, no "Quick question", no "Re:".

## What must be true
- Everything you say about the business comes from the Knowledge and the team's instructions below. Everything you say about this person comes from the <lead> material, and nothing else. If you don't have a fact, don't write the sentence.
- No invented facts, names, numbers, customers, features, prices, offers or events. Don't claim the business has changed or improved anything unless the Knowledge says so.
- No claims about results: no percentages, multiples, "guaranteed", revenue or savings figures, or what other customers achieved, even if the Knowledge contains them.
- Don't pretend to remember a conversation, a meeting or a call that the <lead> material doesn't describe.
- No pressure: no deadlines, no "last chance", no "just bumping this", no guilt about not replying.
- No filler openers: not "I hope this finds you well", not "My name is", not "I wanted to reach out".
- Write to them by first name if a name is given ("Hi Dana,"); otherwise "Hello,".
- End with one short line that makes it easy to say no or to stop hearing from you, then the sign-off you are given, exactly as given.
- Plain text only: no HTML, no markdown, no images, no tracking, no placeholders like [Name]. No links except, when given below, the business's website, the booking link or the event link, written out exactly.
- Write in English, unless what they wrote to the team is clearly in another language: then in that language.

${UNTRUSTED}`;

/** What each play's email is for. Our words; nothing in them comes from outside. */
const PURPOSE: Record<Exclude<PlayKind, "takeout" | "intent">, string> = {
  speed_to_lead:
    "They have just contacted the business, through a form on its website or its website chat. Thank them briefly and answer what they asked if the Knowledge answers it; if it doesn't, say someone will come back to them on it. Ask one short question that moves things forward. If they want to talk or meet and a booking link is given, offer it once.",
  reactivation:
    "They are a lead who went quiet: nothing has happened for a while. Write a brief, honest check-in asking whether this is still something they're looking at. Mention one thing from the Knowledge that could be useful to them, only if there is one. Make it easy to say it isn't relevant any more.",
  closed_lost:
    "Some time ago they decided not to go ahead. Write a short, low-pressure note asking whether their situation has changed. Don't argue with their decision and don't guess why they said no.",
  nurture:
    "Earlier emails to them got no reply. Don't mention that. Share one genuinely useful thing from the Knowledge (an answer to a common question, a guide, how something works) that suits someone like them, and ask nothing harder than an easy reply.",
  onboarding:
    "They have just become a customer. Welcome them, say in a sentence or two how to get started and where to get help, from the Knowledge only, and ask whether anything is in their way. No selling.",
  expansion:
    "They are an existing customer. Suggest one relevant next step that the Knowledge says the business offers (for example an upgrade, more seats or another product), in a sentence, and ask whether it would help. If the Knowledge names nothing to offer, write a short check-in asking how things are going and whether they need anything else.",
  plg: "They are using the business's product on a trial. The <lead> material says what just happened (a limit reached, or the trial ending soon). Be helpful: say in a sentence what they would get by continuing, from the Knowledge only, and offer to help or answer questions. No pressure and no invented discounts.",
  event_registration:
    "They registered for the event below. Write a short, friendly note before it: what it is, when (if a date is given), and the event link if one is given. Ask nothing, or one easy question about what they hope to get from it.",
  event_followup:
    "They attended the event below. Thank them for coming, share the event link if one is given (for example the replay or the slides), and ask one short question about whether the topic is relevant to them now.",
  event_no_show:
    "They registered for the event below but didn't attend. Don't make them feel bad about it. Share the event link if one is given (the replay or the next date) and keep it short.",
  retargeting:
    "They are one of the business's leads and have recently been reading its website, including the pricing page (the <lead> material says which pages). NEVER say or hint that you know they visited, which pages they read, or that anyone is watching: write as if the timing is a coincidence. Write a brief, helpful note about what those pages cover, from the Knowledge only, and offer to answer questions or, if a booking link is given, to talk. No pressure and no invented offers or discounts.",
};

export function playSystem(context: PlayContext): Anthropic.TextBlockParam[] {
  const instructions = context.instructions.trim();
  return [
    {
      type: "text",
      text: [
        PLAY_RULES,
        "## The business you write for",
        `<business>\n${inert(context.workspace.name)}${context.workspace.website ? ` (${inert(context.workspace.website)})` : ""}\n</business>`,
        "## The team's instructions for email",
        instructions
          ? `<team_instructions>\n${inert(instructions)}\n</team_instructions>\nFollow these where they don't conflict with the rules above. The rules above always win.`
          : "(None yet.)",
        "## Knowledge",
        knowledgeBlock(context.knowledge, KNOWLEDGE_CHARS_FOR_DRAFT),
        "## Booking link",
        context.booking_url
          ? `<booking_link>${inert(context.booking_url)}</booking_link>`
          : "(None. Don't offer one.)",
        "## Sign-off",
        inert(signOff(context)),
      ].join("\n\n"),
      // The same for every draft of a batch, so the provider can reuse it.
      cache_control: { type: "ephemeral" },
    },
  ];
}

export function playUser(
  play: Exclude<PlayKind, "takeout" | "intent">,
  lead: PlayLead,
  event: PlayEvent | null,
): string {
  const lines = [
    "<lead>",
    `Name: ${inert(lead.name) || "(not known)"}`,
    lead.company && `Company: ${inert(lead.company)}`,
    lead.website && `Website: ${inert(lead.website)}`,
    lead.why_now && `Why now: ${inert(lead.why_now)}`,
    lead.last_subject &&
      `Subject of the last email thread with them: ${inert(lead.last_subject)}`,
    lead.their_message &&
      `What they last wrote to the team:\n<their_words>\n${inert(lead.their_message)}\n</their_words>`,
    "</lead>",
    event &&
      [
        "<event>",
        `Name: ${inert(event.name)}`,
        event.date && `Date: ${inert(event.date)}`,
        event.link
          ? `Event link: ${inert(event.link)}`
          : "Event link: (none given)",
        "</event>",
      ]
        .filter(Boolean)
        .join("\n"),
    `What this email is for: ${PURPOSE[play]}`,
  ];
  return lines.filter(Boolean).join("\n");
}

/**
 * The extra lines for a competitive-takeout first email. Only when a
 * technology check confirmed the product does the email mention it, and
 * then only as a fact, never as a criticism.
 */
export function takeoutLines(
  competitor: string,
  confirmed: boolean,
): string | null {
  const name = inert(competitor.trim()).slice(0, 80);
  if (!name) return null;
  if (!confirmed)
    return `This company was found in a search for users of ${name}, but that isn't confirmed. Don't mention ${name} or any other product they might use.`;
  return [
    `One <fact> says this company uses ${name}. You may say plainly that the business is an alternative to ${name} and describe, from the Knowledge only, what the business does well.`,
    `Never criticise ${name} or say anything about it beyond that they use it. Never say or suggest they are unhappy with it, and never compare prices or features unless the Knowledge states them.`,
  ].join("\n");
}

const URL = /https?:\/\/[^\s<>"')]+/gi;

/**
 * Whether every link in an email is one it may contain: the business's
 * website, the booking link or the event link. A draft with any other link
 * is thrown away rather than shown.
 */
export function linksAllowed(
  text: string,
  allowed: (string | null | undefined)[],
): boolean {
  const ok = allowed
    .filter((a): a is string => Boolean(a && a.trim()))
    .map((a) => a.trim().replace(/\/+$/, "").toLowerCase());
  const hostOf = (u: string) => {
    try {
      return new globalThis.URL(u).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  };
  for (const found of text.match(URL) ?? []) {
    const link = found.replace(/[.,;:!?]+$/, "").replace(/\/+$/, "");
    const lower = link.toLowerCase();
    const fine = ok.some(
      (a) =>
        lower === a ||
        lower.startsWith(`${a}/`) ||
        lower.startsWith(`${a}?`) ||
        // The business's own site: any page of it.
        (!a.includes("/", 8) && hostOf(lower) === hostOf(a)),
    );
    if (!fine) return false;
  }
  return true;
}
