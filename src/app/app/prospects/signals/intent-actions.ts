"use server";

import { createHash, randomBytes } from "node:crypto";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import {
  ActionProblem,
  inWorkspace,
  mustSucceed,
  type ActionResult,
} from "@/lib/app/action";
import { requestOrigin } from "@/lib/auth/origin";
import { cleanText, isUuid } from "@/lib/leads/fields";
import {
  INTENT_CSV_MAX_BYTES,
  INTENT_ROWS_PER_CALL,
  RETARGET_COMPANIES_MAX,
} from "@/lib/integrations/config";
import { checkG2Token, G2Problem } from "@/lib/intent/g2";
import { readIntentCsv } from "@/lib/intent/rows";
import { createIntentStore, type IngestResult } from "@/lib/intent/store";
import { DEFAULT_TITLES } from "@/lib/plays/campaign-run";
import { createPlayStore } from "@/lib/plays/store";
import {
  contactDatabaseStatus,
  prospectRuntimeStatus,
} from "@/lib/prospects/config";

// Review-site intent on Find leads, Signals: importing (CSV, the webhook,
// G2), and keeping a signal (its company goes into a target-accounts
// campaign whose run finds a contact and drafts an email for approval).

const NOT_ON =
  "Review-site intent isn't switched on yet on Dialvo's side. Nothing was saved.";

function store() {
  const s = createIntentStore();
  if (!s) throw new ActionProblem(NOT_ON);
  return s;
}

function summary(r: IngestResult, unread = 0): ActionResult {
  if (r.status === "capped")
    return {
      ok: false,
      message: "Today's import allowance is used up. Try again tomorrow.",
    };
  if (r.status !== "ok")
    return { ok: false, message: "That file couldn't be imported." };
  const bad = r.invalid + unread;
  return {
    ok: true,
    message: `${r.added} new ${r.added === 1 ? "signal" : "signals"}${r.duplicates ? `, ${r.duplicates} already here` : ""}${r.skipped ? `, ${r.skipped} for companies you already have or never contact` : ""}${bad ? `, ${bad} without a usable website` : ""}.`,
  };
}

export async function importIntentCsv(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ workspace }) => {
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0)
      throw new ActionProblem("Choose a CSV file.", "file");
    if (file.size > INTENT_CSV_MAX_BYTES)
      throw new ActionProblem("That file is too large (1 MB at most).", "file");
    const read = readIntentCsv(await file.text(), INTENT_ROWS_PER_CALL);
    if (!read.ok) throw new ActionProblem(read.error, "file");
    const provider = cleanText(form.get("provider"), 40);
    const rows = provider
      ? read.rows.map((r) => (r.provider === "other" ? { ...r, provider } : r))
      : read.rows;
    const r = await store().ingest(workspace.id, "csv", null, rows);
    refresh();
    return summary(r, read.skipped);
  });
}

export async function makeIntentWebhook(): Promise<ActionResult> {
  return inWorkspace(
    async ({ user, workspace }) => {
      const token = `dvi_${randomBytes(30).toString("base64url")}`;
      const ok = await store().webhookSet(
        workspace.id,
        user.id,
        createHash("sha256").update(token).digest("hex"),
        token.slice(0, 12),
      );
      if (!ok) throw new ActionProblem("That couldn't be saved.");
      refresh();
      // Shown once, here: only its hash is kept.
      return {
        ok: true,
        message: `${await requestOrigin()}/api/intent/${token}`,
        field: "key",
      };
    },
    { admin: true },
  );
}

export async function connectG2(form: FormData): Promise<ActionResult> {
  return inWorkspace(
    async ({ user, workspace }) => {
      const s = store();
      const token = String(form.get("token") ?? "").trim();
      if (token.length < 10 || token.length > 500)
        throw new ActionProblem("Paste your G2 API token.", "token");
      try {
        await checkG2Token(token, (...a) => fetch(...a));
      } catch (error) {
        throw new ActionProblem(
          error instanceof G2Problem
            ? error.message
            : "G2 didn't answer. Try again in a minute.",
          "token",
        );
      }
      const status = await s.g2Connect(workspace.id, user.id, token);
      if (status !== "connected")
        throw new ActionProblem("That couldn't be saved.");
      refresh();
      return {
        ok: true,
        message:
          "Connected. G2's intent arrives within the hour, then once a day.",
      };
    },
    { admin: true },
  );
}

export async function disconnectIntent(form: FormData): Promise<ActionResult> {
  return inWorkspace(
    async ({ supabase, workspace }) => {
      const kind = form.get("kind") === "g2" ? "g2" : "webhook";
      const { data, error } = await supabase.rpc("intent_source_disconnect", {
        p_workspace_id: workspace.id,
        p_kind: kind,
      });
      mustSucceed({ error }, "intent disconnect");
      if (!data) throw new ActionProblem("Nothing to switch off.");
      refresh();
      return {
        ok: true,
        message:
          kind === "g2"
            ? "Disconnected. The G2 token has been deleted."
            : "Switched off. That address no longer accepts signals.",
      };
    },
    { admin: true },
  );
}

export async function dismissIntent(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase }) => {
    const id = form.get("signal");
    if (!isUuid(id)) throw new ActionProblem("That signal doesn't exist.");
    const { error } = await supabase.rpc("intent_signal_dismiss", {
      p_signal_id: id,
    });
    mustSucceed({ error }, "dismiss intent");
    refresh();
    return { ok: true };
  });
}

export async function keepIntent(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ user, workspace }) => {
    if (!prospectRuntimeStatus().on || !contactDatabaseStatus().on)
      throw new ActionProblem(
        "Finding a contact needs the contact database, which isn't switched on yet on Dialvo's side.",
      );
    const ids = form.getAll("signal").map(String).filter(isUuid);
    if (ids.length === 0) throw new ActionProblem("Tick at least one signal.");
    const plays = createPlayStore();
    if (!plays) throw new ActionProblem(NOT_ON);
    const date = new Date().toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
    });
    const made = await store().keep(
      workspace.id,
      user.id,
      ids.slice(0, RETARGET_COMPANIES_MAX),
      `Review-site intent, ${date}`,
      DEFAULT_TITLES,
      RETARGET_COMPANIES_MAX,
    );
    if (made.status !== "created" || !made.campaign_id)
      throw new ActionProblem("Those signals couldn't be kept.");
    const started = await plays.startCampaignRun(
      workspace.id,
      made.campaign_id,
      user.id,
      2,
    );
    if (started.status === "capped")
      throw new ActionProblem(
        "Kept, but today's allowance for contact lookups is used up. Open Target accounts tomorrow to continue.",
      );
    redirect(`/app/prospects/accounts?campaign=${made.campaign_id}`);
  });
}
