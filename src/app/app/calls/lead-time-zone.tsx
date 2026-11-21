import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { ActionForm, SubmitButton } from "../_ui/form";
import { hint, input, panel, panelHead } from "../_ui/kit";
import { setLeadTimeZone } from "./actions";

// The lead's own time zone, on the lead's page: calls and texts reach them
// only inside the call window in this zone. Without one, the zones their
// number's country spans are all used.

const ZONES = Intl.supportedValuesOf("timeZone");

export async function LeadTimeZone({
  leadId,
  workspaceId,
}: {
  leadId: string;
  workspaceId: string;
}) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("leads")
    .select("time_zone")
    .eq("workspace_id", workspaceId)
    .eq("id", leadId)
    .maybeSingle();
  const zone = (data as { time_zone: string | null } | null)?.time_zone ?? "";
  return (
    <section className={panel}>
      <h2 className={panelHead}>Time zone</h2>
      <div className="p-4">
        <p className={hint}>
          Calls and texts reach this person only inside your call window in
          their time. Without a zone, the window has to be open everywhere their
          number&apos;s country spans.
        </p>
        <ActionForm action={setLeadTimeZone} quiet className="mt-3 flex gap-2">
          <input type="hidden" name="lead" value={leadId} />
          <label className="min-w-0 flex-1">
            <span className="sr-only">Time zone</span>
            <select
              name="time_zone"
              defaultValue={zone}
              className={cn(input, "h-8 py-0 text-[12.5px]")}
            >
              <option value="">From their phone number</option>
              {ZONES.map((z) => (
                <option key={z} value={z}>
                  {z.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </label>
          <SubmitButton variant="secondary" small>
            Save
          </SubmitButton>
        </ActionForm>
      </div>
    </section>
  );
}
