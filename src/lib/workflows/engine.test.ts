import { describe, expect, it, vi } from "vitest";
import {
  conditionHolds,
  fillText,
  runOne,
  triggerHolds,
  type ClaimedRun,
  type LeadFacts,
  type WorkflowStore,
} from "./engine";
import { checkWorkflow } from "./types";

const lead: LeadFacts = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Pat",
  email: "pat@acme.example",
  company: "Acme Ltd",
  website: "https://acme.example",
  status: "qualified",
  source: "form",
  owner_id: null,
  do_not_contact: false,
  country: "London, United Kingdom",
  size: "11-50",
  size_lo: 11,
  size_hi: 50,
};

const fakeStore = (): WorkflowStore & { acts: unknown[] } => {
  const acts: unknown[] = [];
  return {
    acts,
    claim: vi.fn(async () => []),
    act: vi.fn(async (_w, _r, _i, step, text) => {
      acts.push({ step, text });
      return { outcome: "done" as const, why: "ok" };
    }),
    finish: vi.fn(async () => true),
    scheduleLeads: vi.fn(async () => [
      lead,
      { ...lead, id: "22222222-2222-4222-8222-222222222222", source: "chat" },
    ]),
    spawn: vi.fn(async (_w, _f, ids: string[]) => ids.length),
  };
};

const run = (over: Partial<ClaimedRun> = {}): ClaimedRun => ({
  id: "r1",
  workspace_id: "w1",
  trigger: "lead_created",
  event: { summary: "A lead was added from form." },
  created_at: new Date().toISOString(),
  lead,
  workflow: {
    id: "f1",
    name: "Test",
    enabled: true,
    trigger_config: {},
    conditions: [],
    steps: [
      {
        action: "note",
        text: "Hello {{lead.name}} at {{lead.company}}: {{event.summary}}",
      },
    ],
  },
  ...over,
});

describe("workflows", () => {
  it("check what the builder sends", () => {
    expect(
      checkWorkflow({
        name: "",
        trigger: "lead_created",
        trigger_config: {},
        conditions: [],
        steps: [],
      }),
    ).toEqual({
      ok: false,
      error: "Give the workflow a name.",
    });
    expect(
      checkWorkflow({
        name: "x",
        trigger: "nonsense",
        trigger_config: {},
        conditions: [],
        steps: [{ action: "note", text: "x" }],
      }).ok,
    ).toBe(false);
    const ok = checkWorkflow({
      name: "Hot replies",
      trigger: "reply_received",
      trigger_config: { classifications: ["interested", "made-up"] },
      conditions: [
        { field: "country", op: "is", value: "UK, DE" },
        { field: "nope", op: "is" },
      ],
      steps: [
        { action: "set_stage", stage: "qualified" },
        { action: "fly" },
        { action: "slack", text: "  Hot!  " },
      ],
    });
    expect(ok).toEqual({
      ok: true,
      workflow: {
        name: "Hot replies",
        trigger: "reply_received",
        trigger_config: { classifications: ["interested"] },
        conditions: [{ field: "country", op: "is", value: ["UK", "DE"] }],
        steps: [
          { action: "set_stage", stage: "qualified" },
          { action: "slack", text: "Hot!" },
        ],
      },
    });
  });

  it("filter by the trigger's own settings, and say why", () => {
    expect(
      triggerHolds(
        "lead_stage_changed",
        { stages: ["won"] },
        { stage: "lost" },
      ),
    ).toEqual({
      ok: false,
      why: "The stage changed to Lost; this workflow waits for Won.",
    });
    expect(
      triggerHolds(
        "reply_received",
        { classifications: ["interested"] },
        { classification: "interested" },
      ).ok,
    ).toBe(true);
    expect(
      triggerHolds(
        "lead_stage_changed",
        { stages: ["won"] },
        { stage: "lost", manual: true },
      ).ok,
    ).toBe(true);
  });

  it("check conditions on the lead's fields", () => {
    expect(
      conditionHolds(
        { field: "country", op: "is", value: ["united kingdom"] },
        lead,
      ).ok,
    ).toBe(true);
    expect(
      conditionHolds(
        { field: "country", op: "is", value: ["UK"] },
        { ...lead, country: "UK" },
      ).ok,
    ).toBe(true);
    expect(
      conditionHolds(
        { field: "company_size", op: "at_least", value: 51 },
        lead,
      ),
    ).toEqual({
      ok: false,
      why: '"Company size is at least 51" doesn\'t hold (it is 11-50).',
    });
    expect(
      conditionHolds({ field: "source", op: "is_not", value: ["chat"] }, lead)
        .ok,
    ).toBe(true);
    expect(conditionHolds({ field: "owner", op: "is_empty" }, lead).ok).toBe(
      true,
    );
    expect(
      conditionHolds({ field: "company", op: "contains", value: "acme" }, lead)
        .ok,
    ).toBe(true);
    expect(conditionHolds({ field: "email", op: "is_set" }, null).ok).toBe(
      false,
    );
  });

  it("fill in the lead and the event", () => {
    expect(
      fillText(
        "Hi {{ lead.name }} ({{lead.email}}) {{event.summary}} {{lead.secret}}",
        lead,
        { summary: "S" },
      ),
    ).toBe("Hi Pat (pat@acme.example) S {{lead.secret}}");
  });

  it("run the steps in order, logging each, and stop at the first condition that fails", async () => {
    const store = fakeStore();
    const done = await runOne(store, run());
    expect(done.status).toBe("done");
    expect(store.acts).toEqual([
      {
        step: {
          action: "note",
          text: "Hello {{lead.name}} at {{lead.company}}: {{event.summary}}",
        },
        text: "Hello Pat at Acme Ltd: A lead was added from form.",
      },
    ]);
    const skipped = await runOne(
      store,
      run({
        workflow: {
          ...run().workflow!,
          conditions: [{ field: "status", op: "is", value: ["won"] }],
        },
      }),
    );
    expect(skipped.status).toBe("skipped");
    expect(skipped.log[0].why).toBe(
      '"Stage is Won" doesn\'t hold (it is Qualified).',
    );
    expect(store.acts).toHaveLength(1);
  });

  it("skip steps that need a lead when the event has none, but still post to Slack", async () => {
    const store = fakeStore();
    const r = await runOne(
      store,
      run({
        lead: null,
        trigger: "signal_kept",
        workflow: {
          ...run().workflow!,
          steps: [
            { action: "research" },
            { action: "slack", text: "Kept: {{event.summary}}" },
          ],
        },
      }),
    );
    expect(r.log.map((l) => l.outcome)).toEqual(["skipped", "done"]);
    expect(r.status).toBe("done");
  });

  it("a schedule picks the leads that meet the conditions, each as a run of its own", async () => {
    const store = fakeStore();
    const r = await runOne(
      store,
      run({
        trigger: "schedule",
        lead: null,
        workflow: {
          ...run().workflow!,
          conditions: [{ field: "source", op: "is", value: ["chat"] }],
        },
      }),
    );
    expect(store.spawn).toHaveBeenCalledWith(
      "w1",
      "f1",
      ["22222222-2222-4222-8222-222222222222"],
      "r1",
    );
    expect(r.log[0].why).toMatch(/Picked 1 lead/);
  });

  it("a switched-off workflow runs nothing", async () => {
    const store = fakeStore();
    const r = await runOne(
      store,
      run({ workflow: { ...run().workflow!, enabled: false } }),
    );
    expect(r.status).toBe("skipped");
    expect(store.acts).toEqual([]);
  });
});
