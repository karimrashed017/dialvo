"use server";

import { refresh } from "next/cache";
import {
  ActionProblem,
  inWorkspace,
  mustSucceed,
  type ActionResult,
} from "@/lib/app/action";
import { isUuid } from "@/lib/leads/fields";
import { createLimiter } from "@/lib/leads/rate-limit";
import { DNS_CHECKS_PER_HOUR } from "@/lib/mail/config";
import { checkDomain } from "@/lib/mail/dns";

// "Check DNS": looks up the mailbox domain's public records from this server
// (node:dns) and stores the result on the mailbox for everyone in the
// workspace to see. Any member may run it; it reads nothing private.

const dnsLimit = createLimiter({
  windowMs: 3_600_000,
  max: DNS_CHECKS_PER_HOUR,
});

export async function checkMailboxDns(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace, user }) => {
    const id = form.get("mailbox");
    if (!isUuid(id)) throw new ActionProblem("That mailbox doesn't exist.");
    if (dnsLimit.take(user.id) > 0)
      throw new ActionProblem("That's a lot of checks. Try again in a while.");
    const { data: box, error } = await supabase
      .from("mailboxes")
      .select("id, email, provider")
      .eq("workspace_id", workspace.id)
      .eq("id", id)
      .neq("status", "disconnected")
      .maybeSingle();
    mustSucceed({ error }, "read mailbox for dns");
    if (!box) throw new ActionProblem("That mailbox doesn't exist.");
    const check = await checkDomain(
      box.email as string,
      box.provider as string,
    );
    const saved = await supabase.rpc("mailbox_dns_save", {
      p_mailbox_id: id,
      p_result: check,
    });
    mustSucceed(saved, "save dns check");
    refresh();
    const problems = [check.spf, check.dkim, check.dmarc, check.mx].filter(
      (i) => i.verdict !== "ok",
    ).length;
    return {
      ok: true,
      message: check.managed
        ? `${check.domain} is a free mail domain: its records are the provider's, and they are in order.`
        : problems === 0
          ? `${check.domain}: SPF, DKIM, DMARC and MX all look right.`
          : `${check.domain}: ${problems} ${problems === 1 ? "thing" : "things"} to fix, listed below.`,
    };
  });
}
