import type { Job } from "../types";

/** A claimed job as crm_jobs_claim returns it, with made-up values. */
export function jobOf(
  over: Omit<Partial<Job>, "lead"> & { lead?: Partial<Job["lead"]> } = {},
): Job {
  const { lead, connection, ...rest } = over;
  return {
    id: "job-1",
    workspace_id: "ws-1",
    kind: "contact",
    source_key: "contact:lead-1",
    attempts: 1,
    external_id: null,
    link: null,
    detail: {},
    ...rest,
    connection: {
      provider: "hubspot",
      can_opt_out: true,
      can_deals: true,
      deal_pipeline_id: "default",
      deal_stage_id: "appointmentscheduled",
      ...connection,
    },
    lead: {
      id: "lead-1",
      name: "Ada Lovelace",
      email: "ada@analytical.example",
      phone: null,
      company: "Analytical Engines",
      website: "https://www.analytical.example",
      status: "new",
      source: "website chat",
      do_not_contact: false,
      created_at: "2026-11-20T10:00:00.000Z",
      ...lead,
    },
  };
}
