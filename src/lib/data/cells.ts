import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { prospectRuntimeStatus } from "@/lib/prospects/config";
import type { ModelClient } from "@/lib/prospects/model";
import type { FindymailProblem, Result } from "@/lib/prospects/findymail";
import { CELLS_IN_PARALLEL, CELLS_PER_STEP } from "./config";
import {
  createDataFindymail,
  type Company,
  type DataFindymail,
  type Priced,
  type Profile,
} from "./findymail";
import { researchCell } from "./research";
import {
  createDataStore,
  type CellFinish,
  type ClaimedCell,
  type DataStore,
} from "./store";

// The scheduler's step for list cells (POST /api/data/step?job=cells): claim
// a few queued cells under a lease, answer each, write the answer back. A
// step that dies leaves its cells to be claimed again when the lease runs
// out; a cell tried twice is marked failed and its reservation given back.

export type CellDeps = {
  store: DataStore;
  client: ModelClient | null;
  findymail: DataFindymail | null;
};

const FINDYMAIL_REASON: Partial<Record<FindymailProblem, string>> = {
  no_credits: "The contact database is out of credits.",
  paused: "The contact database account is paused.",
  unauthenticated: "The contact database refused Dialvo's key.",
  invalid: "The contact database couldn't look this up.",
  unreadable: "The contact database's answer couldn't be read.",
};

/** A Findymail failure as a cell's outcome: try again, or give the reason. */
function failed(problem: FindymailProblem): CellFinish {
  if (problem === "rate_limited" || problem === "unavailable")
    return { status: "retry" };
  return {
    status: "failed",
    reason: FINDYMAIL_REASON[problem] ?? "The lookup failed.",
  };
}

const skipped = (reason: string): CellFinish => ({ status: "skipped", reason });

const cached = <T>(fields: Record<string, unknown>, key: string): T | null => {
  const v = fields[key];
  return v && typeof v === "object" ? (v as T) : null;
};

/** One data cell, from the row or the contact database. */
export async function dataCell(
  cell: ClaimedCell,
  findymail: DataFindymail | null,
): Promise<CellFinish> {
  const { row } = cell;
  const field = cell.column.data_field;
  if (!findymail) return skipped("The contact database isn't switched on yet.");
  const notFound = (reason: string, credits = 0): CellFinish => ({
    status: "done",
    value: null,
    text: "",
    reason,
    credits,
  });

  const company = async (): Promise<Result<Priced<Company | null>>> => {
    const c = cached<Company>(row.fields, "_company");
    if (c) return { ok: true, value: { value: c, credits: 0 } };
    return findymail.company(row.domain!);
  };
  const profile = async (): Promise<Result<Priced<Profile | null>>> => {
    const p = cached<Profile>(row.fields, "_profile");
    if (p) return { ok: true, value: { value: p, credits: 0 } };
    return findymail.profile(row.email!);
  };

  switch (field) {
    case "work_email": {
      if (row.email && row.domain && row.email.endsWith(`@${row.domain}`))
        return {
          status: "done",
          value: row.email,
          text: row.email,
          reason: "Already on the row.",
        };
      if (!row.name || !row.domain)
        return skipped("Needs a person's name and the company's website.");
      const r = await findymail.workEmail(row.name, row.domain);
      if (!r.ok) return failed(r.problem);
      if (!r.value.value)
        return notFound("No work email found in the contact database.");
      return {
        status: "done",
        value: r.value.value,
        text: r.value.value,
        reason: "Found and checked by the contact database.",
        credits: r.value.credits,
        rowPatch: { email: r.value.value },
      };
    }
    case "verify_email": {
      if (!row.email) return skipped("Needs an email address.");
      const r = await findymail.verify(row.email);
      if (!r.ok) return failed(r.problem);
      const v = r.value.value;
      if (v === null)
        return notFound("The check gave no answer.", r.value.credits);
      return {
        status: "done",
        value: v,
        text: v ? "Works" : "Doesn't work",
        reason: v
          ? "The mailbox accepts mail."
          : "The mailbox doesn't accept mail: don't send to it.",
        credits: r.value.credits,
      };
    }
    case "title": {
      if (!row.email) return skipped("Needs an email address.");
      const r = await profile();
      if (!r.ok) return failed(r.problem);
      const p = r.value.value;
      if (!p?.title)
        return notFound("No profile found for this email.", r.value.credits);
      return {
        status: "done",
        value: p.title,
        text: p.title,
        sourceUrl: p.linkedin_url,
        reason: p.company ? `At ${p.company}.` : "From their profile.",
        credits: r.value.credits,
        rowPatch: { fields: { _profile: p }, title: p.title },
      };
    }
    case "company_size":
    case "industry": {
      if (!row.domain) return skipped("Needs the company's website.");
      const r = await company();
      if (!r.ok) return failed(r.problem);
      const c = r.value.value;
      const v = c ? (field === "industry" ? c.industry : c.size_range) : "";
      if (!c || !v)
        return notFound("Not found in the contact database.", r.value.credits);
      return {
        status: "done",
        value: v,
        text: v,
        reason: c.name
          ? `From the contact database's record for ${c.name}.`
          : "From the contact database.",
        credits: r.value.credits,
        rowPatch: {
          fields: { _company: c },
          ...(field === "company_size" ? { size_range: v } : {}),
        },
      };
    }
    case "technologies": {
      if (!row.domain) return skipped("Needs the company's website.");
      const r = await findymail.technologies(row.domain);
      if (!r.ok) return failed(r.problem);
      if (r.value.value.length === 0)
        return notFound("No technologies detected.");
      const text = r.value.value.join(", ").slice(0, 600);
      return {
        status: "done",
        value: text,
        text,
        reason: "Detected on the company's website.",
        credits: r.value.credits,
      };
    }
    default:
      return { status: "failed", reason: "Unknown column." };
  }
}

/** One research cell, from the model with web search. */
export async function researchCellFinish(
  cell: ClaimedCell,
  client: ModelClient | null,
): Promise<CellFinish> {
  if (!client)
    return skipped("Research isn't switched on yet on Dialvo's side.");
  const { column, row } = cell;
  if (!column.question || !column.answer_type)
    return { status: "failed", reason: "The column has no question." };
  if (!row.name && !row.company && !row.domain)
    return skipped("Needs a name, a company or a website.");
  const r = await researchCell(client, {
    question: column.question,
    type: column.answer_type,
    options: column.options ?? [],
    row,
    kind: cell.list_kind,
  });
  if (!r.ok) {
    if (r.reason === "rate_limited" || r.reason === "unavailable")
      return { status: "retry", costMicros: r.spend.cost_micros };
    return {
      status: "failed",
      costMicros: r.spend.cost_micros,
      reason:
        r.reason === "not_authorised"
          ? "The research model refused Dialvo's key."
          : "No answer could be read.",
    };
  }
  return {
    status: "done",
    value: r.answer.value,
    text: r.answer.text,
    sourceUrl: r.answer.source_url,
    reason: r.answer.reason,
    costMicros: r.spend.cost_micros,
  };
}

export type CellsResult = {
  claimed: number;
  done: number;
  retried: number;
  failed: number;
};

export async function cellsStep(
  deps: CellDeps,
  limit = CELLS_PER_STEP,
): Promise<CellsResult> {
  const cells = await deps.store.claimCells(limit);
  const result: CellsResult = {
    claimed: cells.length,
    done: 0,
    retried: 0,
    failed: 0,
  };
  const queue = [...cells];
  async function worker() {
    for (let cell = queue.shift(); cell; cell = queue.shift()) {
      let finish: CellFinish;
      try {
        finish =
          cell.column.kind === "research"
            ? await researchCellFinish(cell, deps.client)
            : await dataCell(cell, deps.findymail);
      } catch (error) {
        console.error("[data] cell failed:", (error as Error).message);
        finish = { status: "retry" };
      }
      try {
        await deps.store.finishCell(cell, finish);
      } catch (error) {
        // Left running: the lease runs out and it is claimed again.
        console.error("[data] cell finish failed:", (error as Error).message);
        continue;
      }
      if (finish.status === "retry") result.retried++;
      else if (finish.status === "failed") result.failed++;
      else result.done++;
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CELLS_IN_PARALLEL, cells.length) }, worker),
  );
  return result;
}

/** The real store, model and contact database, or null without the secret key. */
export function defaultCellDeps(): CellDeps | null {
  const store = createDataStore();
  if (!store) return null;
  return {
    store,
    // Reads ANTHROPIC_API_KEY from the environment.
    client: prospectRuntimeStatus().on ? new Anthropic() : null,
    findymail: createDataFindymail(),
  };
}
