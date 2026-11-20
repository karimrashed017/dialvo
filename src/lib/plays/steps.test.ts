import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import type { ModelClient } from "@/lib/prospects/model";
import { advancePlayDrafts } from "./drafts";
import { keepSignal, pullSignals, removeMonitor } from "./signals";
import { speedToLeadStep } from "./speed";
import type { PlayDraftClaim } from "./store";
import { checkTechnology } from "./takeout";
import { fakeFindymail, fakePlayStore } from "./testing";

function model(...bodies: (Record<string, string> | Error)[]) {
  const create = vi.fn(async () => {
    const next = bodies.shift();
    if (!next) throw new Error("unexpected model call");
    if (next instanceof Error) throw next;
    return {
      model: "claude-haiku-4-5",
      stop_reason: "end_turn",
      usage: { input_tokens: 100, output_tokens: 50 },
      content: [{ type: "text", text: JSON.stringify(next) }],
    } as unknown as Anthropic.Message;
  });
  return { client: { messages: { create } } as unknown as ModelClient, create };
}

const claim = (
  play: string,
  extra: Partial<PlayDraftClaim["drafts"][0]> = {},
): PlayDraftClaim => ({
  capped: false,
  remaining: 0,
  context: {
    workspace: { name: "Northside", website: "https://northside.example" },
    sender_name: "Sam",
    instructions: "",
    knowledge: [],
    booking_url: null,
  },
  drafts: [
    {
      draft_id: "d1",
      play,
      lead: {
        name: "Dana",
        company: "Clinic",
        website: "",
        why_now: "Attended Spring webinar",
        last_subject: "",
        their_message: "",
      },
      event: {
        name: "Spring webinar",
        link: "https://n.example/replay",
        date: "",
      },
      ...extra,
    },
  ],
});

describe("writing a play's emails", () => {
  it("writes each reserved draft and saves it for approval", async () => {
    const store = fakePlayStore({
      claimDrafts: vi.fn(async () => claim("event_followup")),
    });
    const { client, create } = model({
      subject: "The replay",
      body: "Hi Dana,\n\nThanks for coming. The replay: https://n.example/replay\n\nSam\nNorthside",
    });
    const r = await advancePlayDrafts(
      { workspaceId: "w", userId: "u" },
      { store, client },
    );
    expect(r).toMatchObject({ status: "ok", written: 1, failed: 0 });
    expect(store.saveDraft).toHaveBeenCalledWith(
      "w",
      "d1",
      expect.objectContaining({ subject: "The replay" }),
      expect.any(Number),
    );
    const params = (create.mock.calls[0] as unknown[])[0] as {
      messages: { content: string }[];
    };
    expect(params.messages[0].content).toContain("Attended Spring webinar");
  });

  it("throws away a draft with a link it wasn't given, or a claim about results", async () => {
    for (const body of [
      "Hi Dana, see https://evil.example/win. Sam",
      "Hi Dana, customers see 40% more bookings. Sam",
    ]) {
      const store = fakePlayStore({
        claimDrafts: vi.fn(async () => claim("event_followup")),
      });
      const { client } = model({ subject: "Hello", body });
      const r = await advancePlayDrafts(
        { workspaceId: "w", userId: "u" },
        { store, client },
      );
      expect(r.failed).toBe(1);
      expect(store.saveDraft).toHaveBeenCalledWith(
        "w",
        "d1",
        null,
        expect.any(Number),
      );
    }
  });

  it("says capped when today's drafts are used up", async () => {
    const store = fakePlayStore({
      claimDrafts: vi.fn(async () => ({
        ...claim("reactivation"),
        drafts: [],
        capped: true,
        remaining: 4,
      })),
    });
    const r = await advancePlayDrafts(
      { workspaceId: "w", userId: "u" },
      { store, client: model().client },
    );
    expect(r).toEqual({
      status: "capped",
      written: 0,
      failed: 0,
      remaining: 4,
    });
  });

  it("saves a model failure as failed, so it is tried again", async () => {
    const store = fakePlayStore({
      claimDrafts: vi.fn(async () => claim("reactivation")),
    });
    const r = await advancePlayDrafts(
      { workspaceId: "w", userId: "u" },
      { store, client: model(new Error("boom")).client },
    );
    expect(r.failed).toBe(1);
    expect(store.saveDraft).toHaveBeenCalledWith("w", "d1", null, 0);
  });
});

describe("speed to lead", () => {
  it("sweeps, writes and approves only for the workspaces that switched it on", async () => {
    const store = fakePlayStore({
      speedWorklist: vi.fn(async () => [{ workspace_id: "w", user_id: "u" }]),
      speedSweep: vi.fn(async () => 1),
      claimDrafts: vi.fn(async () => ({
        ...claim("speed_to_lead"),
        drafts: [{ ...claim("speed_to_lead").drafts[0], event: null }],
      })),
      autoApprove: vi.fn(async () => 1),
    });
    const { client } = model({
      subject: "Thanks for getting in touch",
      body: "Hi Dana,\n\nThanks. Sam\nNorthside",
    });
    expect(await speedToLeadStep({ store, client })).toEqual({
      workspaces: 1,
      added: 1,
      written: 1,
      approved: 1,
    });
    expect(store.speedSweep).toHaveBeenCalledWith("w");
    expect(store.autoApprove).toHaveBeenCalledWith("w");
  });

  it("does nothing without the database or the model", async () => {
    expect(await speedToLeadStep({ store: null, client: null })).toEqual({
      workspaces: 0,
      added: 0,
      written: 0,
      approved: 0,
    });
  });
});

describe("the technology check", () => {
  const prospects = [
    { id: "p1", domain: "a.example.com", facts: [] },
    { id: "p2", domain: "b.example.com", facts: [] },
    {
      id: "p3",
      domain: "c.example.com",
      facts: [{ fact: "Uses X", kind: "technology" }],
    },
  ];

  it("adds a sourced fact only where the product is detected, and gives back unspent credits", async () => {
    const store = fakePlayStore();
    const findymail = fakeFindymail({
      technology: vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          value: { found: true, detected: "2026-03-15", label: "Rivalsoft" },
        })
        .mockResolvedValueOnce({
          ok: true,
          value: { found: false, detected: null, label: "Rivalsoft" },
        }),
    });
    const r = await checkTechnology(
      { workspaceId: "w", competitor: "Rivalsoft", prospects },
      { store, findymail },
    );
    expect(r).toEqual({
      checked: 2,
      confirmed: 1,
      notFound: 1,
      capped: false,
      failed: 0,
    });
    expect(findymail.technology).toHaveBeenCalledTimes(2);
    expect(store.addFact).toHaveBeenCalledTimes(1);
    expect(store.addFact).toHaveBeenCalledWith(
      "w",
      "p1",
      expect.objectContaining({
        fact: "Uses Rivalsoft (detected 2026-03-15)",
        kind: "technology",
      }),
    );
    expect(store.reserveCredits).toHaveBeenCalledWith("w", -1);
  });

  it("stops at the day's cap", async () => {
    const store = fakePlayStore({ reserveCredits: vi.fn(async () => false) });
    const findymail = fakeFindymail();
    const r = await checkTechnology(
      { workspaceId: "w", competitor: "X", prospects },
      { store, findymail },
    );
    expect(r.capped).toBe(true);
    expect(findymail.technology).not.toHaveBeenCalled();
  });
});

describe("signals", () => {
  it("pulls a due monitor's pages and stores them, or releases it to try later", async () => {
    const store = fakePlayStore({
      pullClaim: vi.fn(async () => [
        {
          monitor_id: "m1",
          workspace_id: "w",
          external_id: 9,
          since: "2026-11-19T00:00:00Z",
          room: 50,
        },
        {
          monitor_id: "m2",
          workspace_id: "w2",
          external_id: 10,
          since: "2026-11-19T00:00:00Z",
          room: 50,
        },
      ]),
      ingest: vi.fn(async () => ({ added: 1, skipped: 0, over: 0 })),
    });
    const row = { external_id: "1" } as never;
    const findymail = fakeFindymail({
      signals: vi
        .fn()
        .mockResolvedValueOnce({ ok: true, value: { rows: [row], last: true } })
        .mockResolvedValueOnce({ ok: false, problem: "unavailable" }),
    });
    expect(await pullSignals({ store, findymail })).toEqual({
      monitors: 2,
      added: 1,
      skipped: 0,
      over: 0,
      failed: 1,
    });
    expect(store.ingest).toHaveBeenCalledWith("w", "m1", [row], true);
    expect(store.pullRelease).toHaveBeenCalledWith("w2", "m2");
  });

  it("keeping one looks up one email; a failed lookup gives the credit back", async () => {
    const store = fakePlayStore({
      keepBegin: vi.fn(async () => ({
        status: "ok",
        contact_name: "Dana Lee",
        domain: "acme.com",
      })),
    });
    const ok = fakeFindymail({
      email: vi.fn(async () => ({ ok: true as const, value: "dana@acme.com" })),
    });
    expect(
      await keepSignal(
        { workspaceId: "w", userId: "u", signalId: "s" },
        { store, findymail: ok },
      ),
    ).toBe("kept");
    expect(store.keepFinish).toHaveBeenCalledWith(
      "w",
      "s",
      "dana@acme.com",
      true,
    );
    const down = fakeFindymail({
      email: vi.fn(async () => ({
        ok: false as const,
        problem: "unavailable" as const,
      })),
    });
    expect(
      await keepSignal(
        { workspaceId: "w", userId: "u", signalId: "s" },
        { store, findymail: down },
      ),
    ).toBe("failed");
    expect(store.reserveCredits).toHaveBeenCalledWith("w", -1);
  });

  it("removing a monitor deletes it in Findymail too, so it stops charging", async () => {
    const store = fakePlayStore();
    const findymail = fakeFindymail();
    expect(
      await removeMonitor(
        { workspaceId: "w", userId: "u", monitorId: "m1" },
        { store, findymail },
      ),
    ).toBe(true);
    expect(findymail.deleteMonitor).toHaveBeenCalledWith(9);
    expect(store.monitorRemoved).toHaveBeenCalledWith("w", "m1");
  });
});
