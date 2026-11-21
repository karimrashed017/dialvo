"use server";

import { randomUUID } from "node:crypto";
import { refresh } from "next/cache";
import {
  ActionProblem,
  inWorkspace,
  mustSucceed,
  type ActionResult,
} from "@/lib/app/action";
import { isUuid } from "@/lib/leads/fields";
import { WEBHOOK_ENDPOINTS_MAX } from "@/lib/integrations/config";
import { readEndpoint } from "@/lib/integrations/endpoints";
import { postJson } from "@/lib/integrations/post";
import { createIntegrationStore } from "@/lib/integrations/store";
import {
  makeWebhookSecret,
  webhookBody,
  webhookHeaders,
} from "@/lib/integrations/webhooks";

// Webhook endpoints, from Settings, API. Owners and admins only; the
// database checks the role again. A signing secret is shown once, when it is
// made, and kept in Vault.

const admin = { admin: true } as const;

function store() {
  const s = createIntegrationStore();
  if (!s)
    throw new ActionProblem(
      "Webhooks aren't switched on yet on Dialvo's side. Nothing was saved.",
    );
  return s;
}

export async function createWebhook(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ user, workspace }) => {
    const endpoint = readEndpoint({
      url: form.get("url"),
      events: form.getAll("events").map(String),
      description: form.get("description"),
    });
    if (!endpoint.ok) throw new ActionProblem(endpoint.error, endpoint.field);
    const secret = makeWebhookSecret();
    const made = await store().webhookCreate({
      workspaceId: workspace.id,
      userId: user.id,
      url: endpoint.url,
      events: endpoint.events,
      description: endpoint.description,
      secret,
      max: WEBHOOK_ENDPOINTS_MAX,
    });
    if (made.status === "capped")
      throw new ActionProblem(
        `A workspace has at most ${WEBHOOK_ENDPOINTS_MAX} endpoints. Delete one first.`,
      );
    if (made.status !== "created")
      throw new ActionProblem("That endpoint couldn't be saved.");
    refresh();
    // Shown once, here.
    return { ok: true, message: secret, field: "key" };
  }, admin);
}

export async function rollWebhookSecret(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ user, workspace }) => {
    const id = form.get("endpoint");
    if (!isUuid(id)) throw new ActionProblem("That endpoint doesn't exist.");
    const secret = makeWebhookSecret();
    const ok = await store().webhookRoll(workspace.id, user.id, id, secret);
    if (!ok) throw new ActionProblem("That endpoint doesn't exist.");
    refresh();
    return { ok: true, message: secret, field: "key" };
  }, admin);
}

export async function setWebhookActive(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ user, workspace }) => {
    const id = form.get("endpoint");
    if (!isUuid(id)) throw new ActionProblem("That endpoint doesn't exist.");
    const active = form.get("active") === "on";
    const ok = await store().webhookUpdate(
      workspace.id,
      user.id,
      id,
      null,
      active,
    );
    if (!ok) throw new ActionProblem("That endpoint doesn't exist.");
    refresh();
    return { ok: true, message: active ? "Switched on." : "Paused." };
  }, admin);
}

export async function deleteWebhook(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ user, workspace }) => {
    const id = form.get("endpoint");
    if (!isUuid(id)) throw new ActionProblem("That endpoint doesn't exist.");
    const ok = await store().webhookDelete(workspace.id, user.id, id);
    if (!ok) throw new ActionProblem("That endpoint doesn't exist.");
    refresh();
    return { ok: true, message: "Deleted, with its secret." };
  }, admin);
}

/** A signed "ping" to one endpoint, now. Nothing is stored. */
export async function testWebhook(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ workspace }) => {
    const id = form.get("endpoint");
    if (!isUuid(id)) throw new ActionProblem("That endpoint doesn't exist.");
    const creds = await store().webhookCredentials(workspace.id, id);
    if (!creds) throw new ActionProblem("That endpoint doesn't exist.");
    const deliveryId = randomUUID();
    const body = webhookBody({
      id: deliveryId,
      type: "ping",
      createdAt: new Date().toISOString(),
      data: { workspace_id: workspace.id, message: "A test from Dialvo." },
    });
    const r = await postJson(
      creds.url,
      body,
      webhookHeaders({ secret: creds.secret, body, event: "ping", deliveryId }),
    );
    return r.ok
      ? { ok: true, message: `Delivered: your endpoint answered ${r.status}.` }
      : { ok: false, message: `Not delivered: ${r.error}` };
  }, admin);
}

export async function retryDelivery(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace }) => {
    const id = form.get("delivery");
    if (!isUuid(id)) throw new ActionProblem("That delivery doesn't exist.");
    const { data, error } = await supabase.rpc("integration_delivery_retry", {
      p_workspace_id: workspace.id,
      p_delivery_id: id,
    });
    mustSucceed({ error }, "retry delivery");
    if (!data)
      throw new ActionProblem("Only failed deliveries can be retried.");
    refresh();
    return { ok: true, message: "Back in the queue: it goes within a minute." };
  }, admin);
}
