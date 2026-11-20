import { ActionForm, SubmitButton } from "../_ui/form";
import { hint, input, labelCls, panel, panelHead } from "../_ui/kit";
import { markMeetingBooked } from "./meeting-actions";

/** "Mark meeting booked" on a lead: a teammate records it by hand. */
export function MarkMeetingBooked({
  leadId,
  timezone,
}: {
  leadId: string;
  timezone: string;
}) {
  return (
    <section id="meeting" className={`${panel} scroll-mt-28`}>
      <h2 className={panelHead}>Mark meeting booked</h2>
      <ActionForm
        action={markMeetingBooked}
        resetOnSuccess
        className="space-y-3 p-4"
      >
        <input type="hidden" name="lead" value={leadId} />
        <label className={labelCls}>
          When
          <input
            name="starts_at"
            type="datetime-local"
            required
            className={`${input} mt-1`}
          />
        </label>
        <div className="grid grid-cols-[minmax(0,1fr)_110px] gap-2">
          <label className={labelCls}>
            What it is{" "}
            <span className="font-normal text-[#0B0B0C]/45">(optional)</span>
            <input
              name="title"
              maxLength={200}
              placeholder="Intro call"
              className={`${input} mt-1`}
            />
          </label>
          <label className={labelCls}>
            Length
            <select
              name="minutes"
              defaultValue="30"
              className={`${input} mt-1`}
            >
              {[15, 30, 45, 60, 90].map((n) => (
                <option key={n} value={n}>
                  {n} min
                </option>
              ))}
            </select>
          </label>
        </div>
        <SubmitButton variant="secondary" pendingText="Recording…">
          Mark meeting booked
        </SubmitButton>
        <p className={hint}>
          Times are in {timezone.replace(/_/g, " ")}. This records the meeting
          here and sets the lead to &ldquo;Meeting booked&rdquo;. It
          doesn&apos;t add anything to a calendar or email anyone.
        </p>
      </ActionForm>
    </section>
  );
}
