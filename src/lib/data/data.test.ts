import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import type { Result } from "@/lib/prospects/findymail";
import { checkAnswer, readOptions, toCsv } from "./answers";
import { dataCell, researchCellFinish } from "./cells";
import { enrichLead } from "./enrich";
import {
  createDataFindymail,
  readProfile,
  type Company,
  type DataFindymail,
  type Priced,
  type Profile,
} from "./findymail";
import { lastJsonObject, seenUrls } from "./research";
import { sourceOne, type SourcingDeps } from "./sourcing";
import type {
  ClaimedCell,
  ClaimedLead,
  ClaimedSchedule,
  DataStore,
} from "./store";

// Lists, research cells, enrichment and sourcing with the model, Findymail
// and the database faked. Nothing here reaches the network.

const ok = <T>(value: T, credits = 0): Result<Priced<T>> => ({
  ok: true,
  value: { value, credits },
});

function fakeFindymail(over: Partial<DataFindymail> = {}) {
  const calls: string[] = [];
  const base: DataFindymail = {
    verify: async () => ok(true, 1),
    profile: async () => ok(null),
    workEmail: async () => ok(null),
    company: async () => ok(null),
    technologies: async () => ok([]),
    employees: async () => ok([]),
  };
  const f = { ...base, ...over };
  const spy = Object.fromEntries(
    Object.entries(f).map(([k, fn]) => [
      k,
      (...args: unknown[]) => {
        calls.push(k);
        return (fn as (...a: unknown[]) => unknown)(...args);
      },
    ]),
  ) as unknown as DataFindymail;
  return { f: spy, calls };
}

describe("answers", () => {
  const seen = new Set(["harbor.example/cafe"]);
  it("turns a reply into a typed value, and drops a source the search didn't return", () => {
    expect(
      checkAnswer(
        {
          found: true,
          answer: true,
          source_url: "https://www.harbor.example/cafe/",
          reason: "Menu page.",
        },
        "yes_no",
        [],
        seen,
      ),
    ).toEqual({
      value: true,
      text: "Yes",
      source_url: "https://www.harbor.example/cafe/",
      reason: "Menu page.",
    });
    expect(
      checkAnswer(
        {
          found: true,
          answer: "42",
          source_url: "https://made.up/x",
          reason: "",
        },
        "number",
        [],
        seen,
      ),
    ).toMatchObject({ value: 42, source_url: null });
    expect(
      checkAnswer(
        { found: true, answer: 140, source_url: "", reason: "" },
        "score",
        [],
        seen,
      )?.value,
    ).toBe(100);
    expect(
      checkAnswer(
        { found: true, answer: "Gold", source_url: "", reason: "" },
        "pick_one",
        ["Bronze", "gold"],
        seen,
      )?.value,
    ).toBe("gold");
    expect(
      checkAnswer(
        { found: true, answer: "Platinum", source_url: "", reason: "" },
        "pick_one",
        ["gold"],
        seen,
      ),
    ).toMatchObject({ value: null, reason: "None of the options fit." });
    expect(
      checkAnswer(
        { found: false, answer: "", source_url: "", reason: "No site." },
        "text",
        [],
        seen,
      ),
    ).toMatchObject({ value: null, reason: "No site." });
    expect(checkAnswer("nope", "text", [], seen)).toBeNull();
  });

  it("reads the last JSON object of a reply with citations around it", () => {
    expect(
      lastJsonObject(
        'They do. {"x": 1} Then {"found": true, "answer": {"n": 2}} done',
      ),
    ).toEqual({ found: true, answer: { n: 2 } });
    expect(lastJsonObject('```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(lastJsonObject("no json")).toBeNull();
  });

  it("collects the search's links", () => {
    const message = {
      content: [
        {
          type: "web_search_tool_result",
          content: [
            { type: "web_search_result", url: "https://www.a.example/p/" },
          ],
        },
        {
          type: "text",
          text: "x",
          citations: [
            { type: "web_search_result_location", url: "https://b.example/q" },
          ],
        },
      ],
    } as unknown as Anthropic.Message;
    expect([...seenUrls(message)].sort()).toEqual([
      "a.example/p",
      "b.example/q",
    ]);
  });

  it("exports CSV safely and reads options", () => {
    expect(toCsv(["a", "b"], [["=SUM(1)", 'say "hi", ok']])).toBe(
      'a,b\r\n\'=SUM(1),"say ""hi"", ok"',
    );
    expect(readOptions("Gold, Silver\nGold, , Bronze")).toEqual([
      "Gold",
      "Silver",
      "Bronze",
    ]);
  });
});

const baseCell = (over: Partial<ClaimedCell> = {}): ClaimedCell => ({
  workspace_id: "w",
  list_id: "l",
  row_id: "r",
  column_id: "c",
  attempts: 1,
  est_micros: 0,
  est_credits: 1,
  list_kind: "people",
  workspace: { name: "Ws", website: null },
  row: {
    name: "Pat Lee",
    title: "",
    company: "Harbor",
    domain: "harbor.example",
    email: null,
    linkedin_url: null,
    country: "",
    size_range: "",
    fields: {},
  },
  column: {
    name: "Work email",
    kind: "data",
    question: null,
    answer_type: null,
    options: [],
    data_field: "work_email",
  },
  ...over,
});

describe("data cells", () => {
  it("finds a work email only through the lookup, never by guessing", async () => {
    const none = fakeFindymail();
    expect(await dataCell(baseCell(), none.f)).toMatchObject({
      status: "done",
      value: null,
      credits: 0,
    });
    const found = fakeFindymail({
      workEmail: async () => ok("pat@harbor.example", 1),
    });
    expect(await dataCell(baseCell(), found.f)).toMatchObject({
      status: "done",
      value: "pat@harbor.example",
      credits: 1,
      rowPatch: { email: "pat@harbor.example" },
    });
    const noName = baseCell();
    noName.row.name = "";
    expect(await dataCell(noName, found.f)).toMatchObject({
      status: "skipped",
    });
    expect(await dataCell(baseCell(), null)).toMatchObject({
      status: "skipped",
    });
  });

  it("reuses what the database said about the company for a second column", async () => {
    const company: Company = {
      name: "Harbor",
      domain: "harbor.example",
      size_range: "11-50",
      industry: "Fitness",
      description: "",
    };
    const f = fakeFindymail({ company: async () => ok(company, 1) });
    const cell = baseCell({
      column: { ...baseCell().column, data_field: "company_size" },
    });
    const first = await dataCell(cell, f.f);
    expect(first).toMatchObject({ value: "11-50", credits: 1 });
    cell.row.fields = first.rowPatch!.fields!;
    cell.column.data_field = "industry";
    expect(await dataCell(cell, f.f)).toMatchObject({
      value: "Fitness",
      credits: 0,
    });
    expect(f.calls).toEqual(["company"]);
  });

  it("retries when the database is busy and explains when it's out of credits", async () => {
    const busy = fakeFindymail({
      technologies: async () => ({ ok: false, problem: "rate_limited" }),
    });
    const cell = baseCell({
      column: { ...baseCell().column, data_field: "technologies" },
    });
    expect(await dataCell(cell, busy.f)).toEqual({ status: "retry" });
    const broke = fakeFindymail({
      technologies: async () => ({ ok: false, problem: "no_credits" }),
    });
    expect(await dataCell(cell, broke.f)).toMatchObject({
      status: "failed",
      reason: "The contact database is out of credits.",
    });
  });

  it("answers a research cell from the model's reply", async () => {
    const client = {
      messages: {
        create: async () => ({
          stop_reason: "end_turn",
          usage: {
            input_tokens: 1000,
            output_tokens: 100,
            server_tool_use: { web_search_requests: 1 },
          },
          content: [
            {
              type: "web_search_tool_result",
              content: [
                {
                  type: "web_search_result",
                  url: "https://harbor.example/cafe",
                },
              ],
            },
            {
              type: "text",
              text: 'Yes. {"found": true, "answer": true, "source_url": "https://harbor.example/cafe", "reason": "Their café page."}',
            },
          ],
        }),
      },
    };
    const cell = baseCell({
      list_kind: "companies",
      column: {
        name: "Café",
        kind: "research",
        question: "Does it have a café?",
        answer_type: "yes_no",
        options: [],
        data_field: null,
      },
    });
    const r = await researchCellFinish(cell, client as never);
    expect(r).toMatchObject({
      status: "done",
      value: true,
      sourceUrl: "https://harbor.example/cafe",
      costMicros: 1000 + 500 + 10_000,
    });
    expect(await researchCellFinish(cell, null)).toMatchObject({
      status: "skipped",
    });
  });
});

const baseLead = (over: Partial<ClaimedLead> = {}): ClaimedLead => ({
  workspace_id: "w",
  lead_id: "l",
  reserved: 3,
  lead: {
    name: "Sam Ray",
    email: "sam@gmail.com",
    company: null,
    website: null,
    title: "",
    company_size: "",
    industry: "",
    domain: null,
  },
  state: {
    email_status: null,
    work_email: null,
    profile_title: "",
    profile_company: "",
    profile_domain: null,
    linkedin_url: null,
    last_checked_at: null,
  },
  bounced: false,
  settings: {
    fill_emails: true,
    fill_titles: true,
    fill_company: true,
    job_changes: true,
    personal_emails: true,
  },
  ...over,
});

const samProfile: Profile = {
  name: "Sam Ray",
  title: "Head of Ops",
  company: "SamCo",
  domain: "samco.example",
  country: "",
  linkedin_url: "https://www.linkedin.com/in/samray",
};

describe("enrichment", () => {
  it("maps a personal-email sign-up to their company and work email, from lookups only", async () => {
    const { f, calls } = fakeFindymail({
      profile: async () => ok(samProfile, 2),
      workEmail: async (_n, d) =>
        ok(d === "samco.example" ? "sam@samco.example" : null, 1),
    });
    const r = await enrichLead(baseLead(), f);
    expect(calls).toEqual(["verify", "profile", "workEmail"]);
    expect(r).toMatchObject({
      outcome: "done",
      credits: 4,
      fill: {
        title: "Head of Ops",
        company: "SamCo",
        website: "https://samco.example",
        work_email: "sam@samco.example",
      },
    });
    expect(r.events?.map((e) => e.kind)).toEqual(["work_email", "filled"]);
  });

  it("spots a job change on a later check and never spends more than the cap", async () => {
    const lead = baseLead({
      lead: {
        ...baseLead().lead,
        email: "sam@samco.example",
        domain: "samco.example",
        title: "Head of Ops",
        company: "SamCo",
        company_size: "11-50",
        industry: "x",
      },
      state: {
        ...baseLead().state,
        email_status: "valid",
        profile_title: "Head of Ops",
        profile_company: "SamCo",
        profile_domain: "samco.example",
        last_checked_at: "2026-10-01T00:00:00Z",
      },
    });
    const { f } = fakeFindymail({
      verify: async () => ok(false, 1),
      profile: async () =>
        ok(
          {
            ...samProfile,
            title: "COO",
            company: "NewCo",
            domain: "newco.example",
          },
          2,
        ),
      workEmail: async () => ok("sam@newco.example", 1),
      company: async () => ok(null, 1),
    });
    const r = await enrichLead(lead, f);
    expect(r.credits).toBe(4);
    expect(r.fill).toMatchObject({
      title_now: "COO",
      email_status: "invalid",
      work_email: "sam@newco.example",
    });
    expect(r.events?.map((e) => e.kind)).toEqual([
      "email_invalid",
      "job_change",
      "work_email",
    ]);
    expect(r.events?.[1].summary).toBe(
      "Sam Ray moved from SamCo to NewCo as COO.",
    );
  });

  it("waits when the database is busy, and stops when it's out of credits", async () => {
    const busy = fakeFindymail({
      verify: async () => ({ ok: false, problem: "unavailable" }),
    });
    expect((await enrichLead(baseLead(), busy.f)).outcome).toBe("retry");
    const broke = fakeFindymail({
      verify: async () => ({ ok: false, problem: "no_credits" }),
    });
    expect(await enrichLead(baseLead(), broke.f)).toMatchObject({
      outcome: "failed",
      error: "The contact database is out of credits.",
    });
  });
});

describe("the Findymail adapter", () => {
  it("sends the key only to Findymail, and reads a profile carefully", async () => {
    const seen: { url: string; auth: string | null }[] = [];
    const fm = createDataFindymail("test-key", async (url, init) => {
      seen.push({ url, auth: new Headers(init.headers).get("authorization") });
      return new Response(
        JSON.stringify({
          fullName: "Sam <b>Ray</b>",
          jobTitle: "COO",
          companyName: "NewCo",
          companyWebsite: "https://newco.example",
        }),
        { status: 200 },
      );
    })!;
    const r = await fm.profile("Sam@Gmail.com");
    expect(r).toEqual({
      ok: true,
      value: {
        value: {
          name: "Sam b Ray /b",
          title: "COO",
          company: "NewCo",
          domain: "newco.example",
          country: "",
          linkedin_url: null,
        },
        credits: 2,
      },
    });
    expect(seen[0].url).toBe(
      "https://app.findymail.com/api/search/reverse-email",
    );
    expect(seen[0].auth).toBe("Bearer test-key");
    expect(createDataFindymail(undefined)).toBeNull();
    expect(
      readProfile({ companyWebsite: "gmail.com", fullName: "X" })?.domain,
    ).toBeNull();
  });

  it("counts a 404 as nothing found, for free", async () => {
    const fm = createDataFindymail(
      "k",
      async () => new Response("{}", { status: 404 }),
    )!;
    expect(await fm.workEmail("Pat", "harbor.example")).toEqual(ok(null, 0));
  });
});

describe("sourcing", () => {
  const schedule: ClaimedSchedule = {
    id: "s",
    workspace_id: "w",
    search_id: "q",
    list_id: "l",
    recipe_id: "rec",
    every_days: 7,
    status: "idle",
    run_id: null,
    run_status: null,
    user_id: "u",
    month_runs: 0,
  };
  function deps(steps: string[], start = "started") {
    const events: string[] = [];
    const queued: string[][] = [];
    const store = {
      scheduleEvent: async (_s: unknown, e: string) => {
        events.push(e);
        return e === "finished" ? { added: 3 } : {};
      },
      queue: async (i: { columnIds: string[] }) => {
        queued.push(i.columnIds);
        return { status: "queued" };
      },
    } as unknown as DataStore;
    const d: SourcingDeps = {
      store,
      startRun: async () =>
        (start === "started"
          ? { status: "started", run_id: "run" }
          : { status: start }) as never,
      advance: async () => ({
        status: (steps.shift() ?? "researching") as never,
      }),
      recipeColumn: async () => "col",
    };
    return { d, events, queued };
  }

  it("starts a run, moves it on, files its companies and answers the recipe", async () => {
    const { d, events, queued } = deps(["searching", "researching", "done"]);
    expect(await sourceOne(schedule, d)).toBe("finished");
    expect(events).toEqual(["started", "finished"]);
    expect(queued).toEqual([["col"]]);
  });

  it("keeps a long run going on the next call", async () => {
    const { d, events } = deps([]);
    expect(await sourceOne(schedule, d)).toBe("running");
    expect(events).toEqual(["started", "waiting"]);
  });

  it("waits when Find leads is busy or capped, and at the month's cap", async () => {
    expect(await sourceOne(schedule, deps([], "busy").d)).toBe("waiting");
    expect(await sourceOne(schedule, deps([], "capped").d)).toBe("waiting");
    const capped = deps([]);
    expect(await sourceOne({ ...schedule, month_runs: 99 }, capped.d)).toBe(
      "waiting",
    );
    expect(capped.events).toEqual(["waiting"]);
  });
});
