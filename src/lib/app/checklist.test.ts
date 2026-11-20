import { describe, expect, it } from "vitest";
import { checklistState, SITE_READ_STALE_MS } from "./checklist";
import type { ChatWidget, WorkspaceSetup } from "./types";

const NOW = Date.parse("2026-11-20T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const setup = (over: Partial<WorkspaceSetup> = {}): WorkspaceSetup => ({
  site_status: "none",
  site_url: null,
  site_started_at: null,
  site_finished_at: null,
  site_pages: 0,
  tried_agent_at: null,
  dismissed_at: null,
  ...over,
});

const widget = (over: Partial<ChatWidget> = {}): ChatWidget => ({
  id: "w1",
  name: "Website chat",
  token: "ab".repeat(32),
  enabled: true,
  title: "Chat with us",
  welcome: "Hi",
  created_at: ago(1000),
  first_seen_at: null,
  first_seen_origin: null,
  last_seen_at: null,
  last_seen_origin: null,
  ...over,
});

const agent = (enabled: boolean) => ({
  id: "a1",
  role: "inbound" as const,
  channel: "chat" as const,
  enabled,
  approval_mode: "approve_first" as const,
});

const state = (over: Partial<Parameters<typeof checklistState>[0]> = {}) =>
  checklistState(
    {
      setup: setup(),
      knowledge: [{ id: "k1" }],
      widgets: [widget()],
      agents: [agent(false)],
      ...over,
    },
    NOW,
  );

describe("the Get started checklist", () => {
  it("starts a new workspace with its first note counted and four steps to do", () => {
    const s = state();
    expect(s.done).toEqual({
      teach: true,
      try: false,
      install: false,
      on: false,
      find: false,
    });
    expect(s.count).toBe(1);
    expect(s.chatDone).toBe(false);
    expect(s.hidden).toBe(false);
  });

  it("each step is done only when the thing really happened", () => {
    expect(state({ knowledge: [] }).done.teach).toBe(false);
    expect(
      state({ setup: setup({ tried_agent_at: ago(1000) }) }).done.try,
    ).toBe(true);
    expect(
      state({
        widgets: [
          widget({
            last_seen_at: ago(1000),
            last_seen_origin: "https://example.com",
          }),
        ],
      }).done.install,
    ).toBe(true);
    expect(state({ agents: [agent(true)] }).done.on).toBe(true);
    expect(state({ foundLeads: true }).done.find).toBe(true);
    // Another agent being on isn't the inbound chat agent being on.
    expect(
      state({
        agents: [
          agent(false),
          { ...agent(true), id: "a2", role: "outbound", channel: "email" },
        ],
      }).done.on,
    ).toBe(false);
  });

  it("shows the site being read, and doesn't call the step done until it is", () => {
    const s = state({
      setup: setup({ site_status: "reading", site_started_at: ago(5000) }),
    });
    expect(s.reading).toBe(true);
    expect(s.done.teach).toBe(false);
    expect(s.siteFailed).toBe(false);
  });

  it("treats a read that never reported back as failed, not as endless", () => {
    const s = state({
      setup: setup({
        site_status: "reading",
        site_started_at: ago(SITE_READ_STALE_MS + 1000),
      }),
    });
    expect(s.reading).toBe(false);
    expect(s.siteFailed).toBe(true);
    // The note they typed in onboarding still counts as knowledge.
    expect(s.done.teach).toBe(true);
  });

  it("says a failed read failed", () => {
    expect(state({ setup: setup({ site_status: "failed" }) }).siteFailed).toBe(
      true,
    );
    expect(state({ setup: setup({ site_status: "done" }) }).siteFailed).toBe(
      false,
    );
  });

  it("goes away when dismissed, and when everything is done", () => {
    expect(state({ setup: setup({ dismissed_at: ago(1000) }) }).hidden).toBe(
      true,
    );
    const all = state({
      setup: setup({ tried_agent_at: ago(1000) }),
      widgets: [
        widget({
          last_seen_at: ago(1000),
          last_seen_origin: "https://example.com",
        }),
      ],
      agents: [agent(true)],
    });
    // The website chat is answering, but no leads have been found yet.
    expect(all.count).toBe(4);
    expect(all.chatDone).toBe(true);
    expect(all.hidden).toBe(false);
    const withLeads = state({
      setup: setup({ tried_agent_at: ago(1000) }),
      widgets: [
        widget({
          last_seen_at: ago(1000),
          last_seen_origin: "https://example.com",
        }),
      ],
      agents: [agent(true)],
      foundLeads: true,
    });
    expect(withLeads.count).toBe(5);
    expect(withLeads.hidden).toBe(true);
  });

  it("offers to create a chat when an older workspace has none", () => {
    const s = state({ widgets: [] });
    expect(s.widget).toBeNull();
    expect(s.done.install).toBe(false);
  });

  it("prefers the widget that has been seen, and copes with no setup row", () => {
    const seen = widget({
      id: "w2",
      last_seen_at: ago(1000),
      last_seen_origin: "https://example.com",
    });
    expect(state({ widgets: [widget(), seen] }).widget?.id).toBe("w2");
    expect(state({ setup: null }).hidden).toBe(false);
  });
});
