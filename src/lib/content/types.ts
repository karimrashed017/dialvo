// The shapes every content page is written in. The play, platform and motion
// pages are all rendered from these by the templates in src/app/_site/pages,
// so a new page is a new entry here, not a new layout.

import type { ChannelId, FeatureSlug, MotionId, PlaySlug } from "./catalog";

export type Faq = { q: string; a: string };

/** A titled point: a step, a capability, a control. */
export type Point = { title: string; body: string };

/** One row in a sample list: who or what, a detail, and a status. */
export type Row = {
  name: string;
  detail: string;
  tag: string;
  strong?: boolean;
};

/**
 * The sample product panel on a page. Everything in one is made up and the
 * panel is marked "Example".
 */
export type Visual = { title: string; note?: string; foot?: string } & (
  | { kind: "thread"; messages: { agent?: boolean; text: string }[] }
  | {
      kind: "email";
      from: string;
      to: string;
      subject: string;
      body: string[];
    }
  | { kind: "list"; rows: Row[] }
  | {
      kind: "timeline";
      steps: { when: string; channel: string; text: string; done?: boolean }[];
    }
  | {
      kind: "brief";
      heading: string;
      facts: [string, string][];
      points: string[];
    }
  | {
      kind: "metrics";
      tiles: { label: string; value: string }[];
      bars: { label: string; value: number; note: string }[];
    }
  | { kind: "code"; lines: string[] }
);

export type PlayContent = {
  /** The headline: one line on what the play gets you. */
  promise: string;
  intro: string;
  /** For search results and link previews. */
  description: string;
  /** The revenue being lost today. */
  situation: { title: string; body: string[] };
  /** How Dialvo runs it: four to six steps. */
  steps: Point[];
  visual: Visual;
  channels: ChannelId[];
  features: FeatureSlug[];
  /** What the customer sets up. */
  setup: string[];
  faqs: Faq[];
  related: PlaySlug[];
};

export type FeatureContent = {
  tagline: string;
  intro: string;
  description: string;
  /** What it does: five to eight specific capabilities. */
  capabilities: Point[];
  /** How it fits with the agents: two or three short paragraphs. */
  fit: string[];
  visual: Visual;
  /** Controls and limits. */
  controls: Point[];
  related: FeatureSlug[];
  plays: PlaySlug[];
};

export type MotionContent = {
  id: MotionId;
  headline: string;
  intro: string;
  title: string;
  description: string;
  problem: { title: string; lead: string; points: Point[] };
  steps: { title: string; lead: string; items: Point[] };
  playsLead: string;
  /** What the motion will and won't take on, where that needs spelling out. */
  scope?: {
    title: string;
    lead: string;
    yes: { title: string; items: string[] };
    no: { title: string; items: string[] };
  };
  channels: { lead: string; items: { id: ChannelId; body: string }[] };
  /** The dashboard-style panel. */
  board: {
    title: string;
    tiles: { label: string; value: string }[];
    feed: Row[];
    stages: { label: string; value: number; note: string }[];
  };
  controls: { title: string; lead: string; items: Point[] };
  features: FeatureSlug[];
  faqs: Faq[];
};

/**
 * The rest of a feature page: how it works, what it needs and its questions.
 * Kept apart from FeatureContent (in platform-details.ts) so every feature
 * page has the same sections, whichever file holds its main copy.
 */
export type FeatureDetails = {
  /** How it works: three to five steps, in order. */
  steps: Point[];
  /** What it needs before it works. */
  needs: string[];
  faqs: Faq[];
};
