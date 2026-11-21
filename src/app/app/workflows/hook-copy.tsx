"use client";

import type { ActionResult } from "@/lib/app/action";
import { SecretOnce } from "../settings/mcp/secret-once";

/** Makes a workflow's secret webhook address and shows it once. */
export function CopyOnce({
  action,
  id,
  label,
}: {
  action: (form: FormData) => Promise<ActionResult>;
  id: string;
  label: string;
}) {
  return (
    <SecretOnce
      action={action}
      submit={label}
      note="Anyone with this address can start the workflow: keep it in your own system, never in a web page."
    >
      <input type="hidden" name="id" value={id} />
    </SecretOnce>
  );
}
