import type { Agent, ChatWidget, KnowledgeItem, WorkspaceSetup } from "./types";

// What Home's setup steps show, worked out from the workspace's real state.
// A pure function, so the rules can be tested on their own. Four steps get
// the website chat answering; the fifth is the first search for leads.

/** How long "reading" may last before the checklist stops believing it. */
export const SITE_READ_STALE_MS = 90_000;

export type ChecklistInput = {
  setup: WorkspaceSetup | null;
  knowledge: Pick<KnowledgeItem, "id">[];
  widgets: ChatWidget[];
  agents: Pick<
    Agent,
    "id" | "role" | "channel" | "enabled" | "approval_mode"
  >[];
  /** "Find leads" has found at least one company for this workspace. */
  foundLeads?: boolean;
};

/** How many steps there are, for "2 of 5 done". */
export const CHECKLIST_STEPS = 5;

const EMPTY: WorkspaceSetup = {
  site_status: "none",
  site_url: null,
  site_started_at: null,
  site_finished_at: null,
  site_pages: 0,
  tried_agent_at: null,
  dismissed_at: null,
};

/** What each step shows, from the workspace's real state. */
export function checklistState(
  props: ChecklistInput,
  now: number = Date.now(),
) {
  const setup = props.setup ?? EMPTY;
  const started = setup.site_started_at
    ? new Date(setup.site_started_at).getTime()
    : 0;
  // A read that never reported back is treated as failed, not as endless.
  const reading =
    setup.site_status === "reading" && now - started < SITE_READ_STALE_MS;
  const siteFailed =
    setup.site_status === "failed" ||
    (setup.site_status === "reading" && !reading);
  const widget =
    props.widgets.find((w) => w.enabled && w.last_seen_at) ??
    props.widgets.find((w) => w.enabled) ??
    props.widgets[0] ??
    null;
  const inbound =
    props.agents.find((a) => a.role === "inbound" && a.channel === "chat") ??
    null;
  const done = {
    teach: props.knowledge.length > 0 && !reading,
    try: Boolean(setup.tried_agent_at),
    install: props.widgets.some((w) => w.last_seen_at),
    on: Boolean(inbound?.enabled),
    find: Boolean(props.foundLeads),
  };
  const count = Object.values(done).filter(Boolean).length;
  const dismissed = Boolean(setup.dismissed_at);
  return {
    setup,
    reading,
    siteFailed,
    widget,
    inbound,
    done,
    count,
    /** The four website-chat steps are all done. */
    chatDone: done.teach && done.try && done.install && done.on,
    dismissed,
    hidden: dismissed || count === CHECKLIST_STEPS,
  };
}
