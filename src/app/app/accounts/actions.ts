"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import {
  ActionProblem,
  inWorkspace,
  mustSucceed,
  type ActionResult,
} from "@/lib/app/action";
import {
  ACCOUNTS_MAX,
  COMMITTEE_CREDITS,
  COMMITTEE_PEOPLE,
  COMMITTEE_TITLES_MAX,
  SEND_TO_PLAY_MAX,
} from "@/lib/data/config";
import { createDataFindymail } from "@/lib/data/findymail";
import { createDataStore } from "@/lib/data/store";
import { cleanText, isUuid } from "@/lib/leads/fields";

// Target accounts: adding one, giving it an owner, finding its buying
// committee in the contact database, and starting a playbook on everyone
// at the account.

export async function addAccount(form: FormData): Promise<ActionResult> {
  let id: string | null = null;
  const result = await inWorkspace(async ({ supabase, workspace }) => {
    const domain = cleanText(form.get("domain"), 300);
    if (!domain)
      throw new ActionProblem("Give the company's website.", "domain");
    const { data, error } = await supabase.rpc("account_add", {
      p_workspace_id: workspace.id,
      p_domain: domain,
      p_name: cleanText(form.get("name"), 200),
      p_max: ACCOUNTS_MAX,
    });
    if (error?.code === "22023")
      throw new ActionProblem(
        "That doesn't look like a company website.",
        "domain",
      );
    if (error?.code === "P0001")
      throw new ActionProblem(`A workspace can have ${ACCOUNTS_MAX} accounts.`);
    mustSucceed({ error }, "add account");
    id = data as string;
  });
  if (id) redirect(`/app/accounts/${id}`);
  return result;
}

export async function setAccountOwner(form: FormData): Promise<ActionResult> {
  return inWorkspace(
    async ({ supabase, workspace }) => {
      const id = form.get("account");
      const owner = form.get("owner");
      if (!isUuid(id)) throw new ActionProblem("That account doesn't exist.");
      const { data, error } = await supabase.rpc("account_set_owner", {
        p_workspace_id: workspace.id,
        p_account_id: id,
        p_owner: isUuid(owner) ? owner : null,
      });
      mustSucceed({ error }, "account owner");
      refresh();
      const n = data as number;
      return {
        ok: true,
        message: isUuid(owner)
          ? `Saved. New leads at this company go to them${n ? `, and ${n} without an owner did now` : ""}.`
          : "Saved. Nobody owns it now.",
      };
    },
    { admin: true },
  );
}

export async function findCommittee(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace, user }) => {
    const id = form.get("account");
    if (!isUuid(id)) throw new ActionProblem("That account doesn't exist.");
    const titles = String(form.get("titles") ?? "")
      .split(/[,\n]/)
      .map((t) => cleanText(t, 80))
      .filter(Boolean)
      .slice(0, COMMITTEE_TITLES_MAX);
    if (titles.length === 0)
      throw new ActionProblem(
        "Give the job titles to look for, separated by commas.",
        "titles",
      );
    const { data: account } = await supabase
      .from("accounts")
      .select("id, domain")
      .eq("workspace_id", workspace.id)
      .eq("id", id)
      .maybeSingle();
    if (!account) throw new ActionProblem("That account doesn't exist.");
    const store = createDataStore();
    const findymail = createDataFindymail();
    if (!store || !findymail)
      throw new ActionProblem(
        "The contact database isn't switched on yet on Dialvo's side.",
      );
    // Reserved first, from the day's data credits; what isn't used goes back.
    if (!(await store.takeCredits(workspace.id, user.id, COMMITTEE_CREDITS)))
      throw new ActionProblem(
        "That would go over today's contact database credits. Try again tomorrow.",
      );
    let used = 0;
    try {
      const found = await findymail.employees(
        account.domain,
        titles,
        COMMITTEE_PEOPLE,
      );
      if (!found.ok)
        throw new ActionProblem(
          found.problem === "no_credits"
            ? "The contact database is out of credits."
            : "The contact database couldn't look this company up just now. Try again in a moment.",
        );
      used += found.value.credits;
      const people = [];
      for (const p of found.value.value.slice(0, COMMITTEE_PEOPLE)) {
        const email = await findymail.workEmail(p.name, account.domain);
        if (email.ok) used += email.value.credits;
        people.push({
          name: p.name,
          title: p.title,
          email: email.ok ? email.value.value : null,
          linkedin_url: p.linkedin,
        });
      }
      const r = await store.addCommittee({
        workspaceId: workspace.id,
        userId: user.id,
        accountId: id,
        titles,
        people,
      });
      refresh();
      if (!r) throw new ActionProblem("That account doesn't exist.");
      const withEmail = people.filter((p) => p.email).length;
      return {
        ok: true,
        message:
          people.length === 0
            ? "Nobody with those titles was found at this company."
            : `${people.length} found (${withEmail} with a work email): ${r.added} added as leads, ${r.existing} already there.`,
      };
    } finally {
      await store.giveBackCredits(
        workspace.id,
        Math.max(COMMITTEE_CREDITS - used, 0),
      );
    }
  });
}

export async function accountToPlaybook(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace, user }) => {
    const id = form.get("account");
    const playbook = form.get("playbook");
    if (!isUuid(id)) throw new ActionProblem("That account doesn't exist.");
    if (!isUuid(playbook))
      throw new ActionProblem("Choose a playbook.", "playbook");
    const { data } = await supabase
      .from("leads")
      .select("id")
      .eq("workspace_id", workspace.id)
      .eq("account_id", id)
      .limit(500);
    const ids = ((data ?? []) as { id: string }[]).map((l) => l.id);
    if (ids.length === 0)
      throw new ActionProblem(
        "Nobody at this account is a lead yet. Find the buying committee first.",
      );
    const store = createDataStore();
    if (!store)
      throw new ActionProblem("This isn't switched on yet on Dialvo's side.");
    const started = await store.startPlaybookFor({
      workspaceId: workspace.id,
      userId: user.id,
      playbookId: playbook,
      leadIds: ids,
      limit: SEND_TO_PLAY_MAX,
      label: cleanText(form.get("name"), 40) || "an account",
    });
    refresh();
    if (started.status === "not_found")
      throw new ActionProblem("That playbook doesn't exist.");
    if (started.status === "empty")
      return {
        ok: false,
        message:
          "The playbook's rules leave out everyone at this account right now (no email, already in a sequence, on your never-contact list, or outside its own filters).",
      };
    return {
      ok: true,
      message: `Started for ${started.selected} ${started.selected === 1 ? "person" : "people"} at this account${started.left_out ? `; ${started.left_out} left out by the playbook's rules` : ""}. Each gets their own first email, under Plays, Your playbooks.`,
    };
  });
}
