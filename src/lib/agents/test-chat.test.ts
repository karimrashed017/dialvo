import Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AGENT_MODEL, DAILY_REPLY_CAP } from "./config";
import { runChatAgent } from "./runtime";
import { defaultTestDeps, runTestChat } from "./test-chat";
import type {
  AgentResult,
  ChatAgentStore,
  ChatContext,
  TestChatStore,
} from "./types";

// "Try your agent" with the Anthropic client mocked and the database faked:
// that it is the real prompt and the real model call, that it works with the
// agent switched off, and every reason it doesn't answer. Also the trial
// switch on the real chat's runtime.

const input = {
  workspaceId: "ws-1",
  userId: "user-1",
  sessionId: "session-1",
  message: "How much is a website?",
};

function context(over: Partial<ChatContext> = {}): ChatContext {
  return {
    workspace: {
      name: "Northwind Web",
      website: "northwind.example",
      trial_ends_at: new Date(Date.now() + 86_400_000).toISOString(),
      billing_status: "trialing",
    },
    agent: {
      id: "agent-1",
      name: "Inbound agent",
      instructions: "Be brief.",
      qualifying_questions: "How many locations?",
      approval_mode: "approve_first",
    },
    paused: false,
    status: "open",
    outcome: null,
    replies_today: 0,
    latest_visitor_message_id: "t1",
    knowledge: [
      {
        title: "Pricing",
        content: "Sites start at $900 a month.",
        source_url: "https://northwind.example/pricing",
      },
    ],
    messages: [{ id: "t1", author: "lead", body: input.message }],
    ...over,
  };
}

const answer = (over: Partial<AgentResult> = {}): AgentResult => ({
  reply: "Sites start at $900 a month.",
  outcome: "none",
  summary: "",
  handoff: false,
  stop_contact: false,
  visitor_name: "",
  visitor_email: "",
  ...over,
});

function model(result: unknown) {
  const create = vi.fn(async () => ({
    model: AGENT_MODEL,
    stop_reason: "end_turn",
    content: [{ type: "text", text: JSON.stringify(result) }],
  }));
  return {
    create,
    client: { messages: { create } } as unknown as Pick<Anthropic, "messages">,
  };
}

function store(
  ctx: ChatContext | null | "limited",
  status: "sent" | "silent" | "stale" = "sent",
) {
  const begin = vi.fn<TestChatStore["begin"]>(async () => ctx);
  const commit = vi.fn<TestChatStore["commit"]>(async () => ({ status }));
  return { begin, commit, store: { begin, commit } as TestChatStore };
}

afterEach(() => vi.unstubAllEnvs());

describe("runTestChat", () => {
  it("answers with the real prompt and model, and stores the turn as a test", async () => {
    const s = store(context());
    const m = model(answer());
    expect(
      await runTestChat(input, { store: s.store, client: m.client }),
    ).toEqual({ status: "replied", result: answer() });

    expect(s.begin).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      userId: "user-1",
      sessionId: "session-1",
      body: input.message,
    });
    const request = m.create.mock.calls[0] as unknown as [
      Anthropic.MessageCreateParamsNonStreaming,
    ];
    expect(request[0].model).toBe(AGENT_MODEL);
    const system = (request[0].system as Anthropic.TextBlockParam[])[0].text;
    // The workspace's own knowledge and the same rules a visitor's chat gets.
    expect(system).toContain("Sites start at $900 a month.");
    expect(system).toContain("Never invent prices");
    expect(request[0].messages).toEqual([
      { role: "user", content: input.message },
    ]);
    expect(s.commit).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      userId: "user-1",
      sessionId: "session-1",
      inReplyTo: "t1",
      result: { ...answer(), model: AGENT_MODEL },
    });
  });

  it("shows the answer at once even when the agent asks first, and passes on what it concluded", async () => {
    const result = answer({ outcome: "qualified", summary: "Three clinics." });
    const s = store(context());
    const turn = await runTestChat(input, {
      store: s.store,
      client: model(result).client,
    });
    expect(turn).toEqual({ status: "replied", result });
  });

  it("says when the agent would hand over without a reply", async () => {
    const result = answer({ reply: "", handoff: true });
    const s = store(context(), "silent");
    expect(
      await runTestChat(input, {
        store: s.store,
        client: model(result).client,
      }),
    ).toEqual({ status: "silent", result });
  });

  it("does nothing without the keys, and says so", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    expect(defaultTestDeps()).toEqual({ store: null, client: null });
    expect(await runTestChat(input)).toEqual({ status: "not_configured" });
    const s = store(context());
    expect(await runTestChat(input, { store: s.store, client: null })).toEqual({
      status: "not_configured",
    });
    expect(s.begin).not.toHaveBeenCalled();
  });

  it("doesn't call the model when it may not answer", async () => {
    const cases: [ChatContext | null | "limited", string][] = [
      ["limited", "limited"],
      [null, "unavailable"],
      [context({ agent: null }), "unavailable"],
      [context({ replies_today: DAILY_REPLY_CAP }), "capped"],
    ];
    for (const [ctx, status] of cases) {
      const m = model(answer());
      const s = store(ctx);
      expect(
        await runTestChat(input, { store: s.store, client: m.client }),
        status,
      ).toEqual({ status });
      expect(m.create).not.toHaveBeenCalled();
      expect(s.commit).not.toHaveBeenCalled();
    }
  });

  it("counts against the same daily cap as real replies", async () => {
    const m = model(answer());
    const under = store(context({ replies_today: DAILY_REPLY_CAP - 1 }));
    expect(
      (await runTestChat(input, { store: under.store, client: m.client }))
        .status,
    ).toBe("replied");
  });

  it("stores nothing when the model fails, and survives the database failing", async () => {
    const s = store(context());
    const refused = vi.fn(async () => ({
      model: AGENT_MODEL,
      stop_reason: "refusal",
      content: [],
    }));
    expect(
      await runTestChat(input, {
        store: s.store,
        client: { messages: { create: refused } } as never,
      }),
    ).toEqual({ status: "failed", reason: "refused" });
    expect(s.commit).not.toHaveBeenCalled();

    const broken = {
      begin: vi.fn(async () => {
        throw new Error("connection reset");
      }),
      commit: vi.fn(),
    } as unknown as TestChatStore;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(
      await runTestChat(input, {
        store: broken,
        client: model(answer()).client,
      }),
    ).toEqual({ status: "failed", reason: "error" });
    log.mockRestore();
  });

  it("drops an answer the teammate has already typed past", async () => {
    const s = store(context(), "stale");
    expect(
      await runTestChat(input, {
        store: s.store,
        client: model(answer()).client,
      }),
    ).toEqual({ status: "stale" });
  });
});

describe("when the trial has ended", () => {
  const ended = context({
    workspace: {
      name: "Northwind Web",
      website: null,
      trial_ends_at: new Date(Date.now() - 86_400_000).toISOString(),
      billing_status: "trialing",
    },
    status: "waiting_for_you",
  });
  const where = { token: "t".repeat(64), conversationId: "c1" };
  const chatStore = () => {
    const commit = vi.fn<ChatAgentStore["commit"]>(async () => ({
      status: "sent" as const,
    }));
    return {
      commit,
      store: { context: async () => ended, commit } as ChatAgentStore,
    };
  };

  it("blocks nothing while billing isn't enforced: the agent still answers", async () => {
    vi.stubEnv("BILLING_ENFORCED", "");
    const m = model(answer());
    const s = chatStore();
    expect(
      await runChatAgent(where, { store: s.store, client: m.client }),
    ).toEqual({ status: "sent" });
    expect(s.commit).toHaveBeenCalled();

    const t = store(ended);
    expect(
      (await runTestChat(input, { store: t.store, client: m.client })).status,
    ).toBe("replied");
  });

  it("with BILLING_ENFORCED=1 the agent stops replying, without calling the model", async () => {
    vi.stubEnv("BILLING_ENFORCED", "1");
    const m = model(answer());
    const s = chatStore();
    expect(
      await runChatAgent(where, { store: s.store, client: m.client }),
    ).toEqual({ status: "trial_ended" });
    const t = store(ended);
    expect(
      await runTestChat(input, { store: t.store, client: m.client }),
    ).toEqual({ status: "trial_ended" });
    expect(m.create).not.toHaveBeenCalled();
    expect(s.commit).not.toHaveBeenCalled();
    expect(t.commit).not.toHaveBeenCalled();
  });

  it("with BILLING_ENFORCED=1 a paid workspace and a running trial are untouched", async () => {
    vi.stubEnv("BILLING_ENFORCED", "1");
    for (const workspace of [
      { ...ended.workspace, billing_status: "active" },
      {
        ...ended.workspace,
        trial_ends_at: new Date(Date.now() + 3_600_000).toISOString(),
      },
    ]) {
      const commit = vi.fn<ChatAgentStore["commit"]>(async () => ({
        status: "sent" as const,
      }));
      const s = {
        context: async () => ({ ...ended, workspace }),
        commit,
      } as ChatAgentStore;
      expect(
        await runChatAgent(where, {
          store: s,
          client: model(answer()).client,
        }),
      ).toEqual({ status: "sent" });
    }
  });
});
