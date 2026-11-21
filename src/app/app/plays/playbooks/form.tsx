import { LANGUAGES } from "@/lib/mail/languages";
import {
  LEAD_STATUSES,
  type Playbook,
  type PlaybookStatus,
} from "@/lib/plays/playbooks";
import type { Sequence } from "@/lib/sequences/server";
import { stepDays } from "@/lib/sequences/steps";
import { cn } from "@/lib/utils";
import { ActionForm, SubmitButton } from "../../_ui/form";
import { hint, input, labelCls } from "../../_ui/kit";
import { savePlaybook } from "./actions";

// A playbook's settings: who it picks, what its first email is for, the
// sequence after it, the language and whether its emails wait for approval.

const STATUS_LABEL: Record<PlaybookStatus, string> = {
  new: "New",
  engaged: "Engaged",
  qualified: "Qualified",
  meeting_booked: "Meeting booked",
  won: "Won (customers)",
  lost: "Lost",
};

const optional = (
  <span className="font-normal text-[#0B0B0C]/45">(optional)</span>
);

export function PlaybookForm({
  playbook,
  sequences,
  sources,
  admin,
}: {
  playbook: Playbook | null;
  sequences: Sequence[];
  sources: string[];
  admin: boolean;
}) {
  const f = playbook?.filters ?? {};
  const fallback = sequences.find((q) => q.is_default);
  return (
    <ActionForm action={savePlaybook} className="space-y-4 p-4">
      {playbook && <input type="hidden" name="id" value={playbook.id} />}
      <fieldset disabled={!admin} className="space-y-4">
        <label className={labelCls}>
          Name
          <input
            name="name"
            required
            maxLength={80}
            defaultValue={playbook?.name ?? ""}
            placeholder="Webinar leads gone quiet"
            className={cn(input, "mt-1")}
          />
        </label>

        <fieldset className="space-y-2">
          <legend className={labelCls}>Who it picks</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[13px]">
            {LEAD_STATUSES.map((s) => (
              <label key={s} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  name="statuses"
                  value={s}
                  defaultChecked={f.statuses?.includes(s) ?? false}
                  className="size-4 accent-[#0B0B0C]"
                />
                {STATUS_LABEL[s]}
              </label>
            ))}
          </div>
          <p className={hint}>
            None ticked: any stage. Customers are only picked if they agreed to
            email or have written to you before.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={labelCls}>
              Nothing has happened for at least {optional}
              <span className="mt-1 flex items-center gap-2 font-normal">
                <input
                  name="inactive_days"
                  type="number"
                  min={1}
                  max={730}
                  defaultValue={f.inactive_days ?? ""}
                  className={cn(input, "max-w-[120px]")}
                />
                days
              </span>
            </label>
            <label className={labelCls}>
              Added in the last {optional}
              <span className="mt-1 flex items-center gap-2 font-normal">
                <input
                  name="added_within_days"
                  type="number"
                  min={1}
                  max={730}
                  defaultValue={f.added_within_days ?? ""}
                  className={cn(input, "max-w-[120px]")}
                />
                days
              </span>
            </label>
          </div>
          <label className={labelCls}>
            Where they came from {optional}
            <input
              name="sources"
              maxLength={800}
              defaultValue={(f.sources ?? []).join(", ")}
              placeholder={
                sources.slice(0, 4).join(", ") || "website chat, form"
              }
              className={cn(input, "mt-1")}
            />
            <span className={cn(hint, "mt-1 block font-normal")}>
              Separate with commas.
              {sources.length > 0 &&
                ` Your leads' sources: ${sources.slice(0, 8).join(", ")}.`}
            </span>
          </label>
        </fieldset>

        <label className={labelCls}>
          What the first email is for
          <textarea
            name="goal"
            required
            rows={3}
            maxLength={1500}
            defaultValue={playbook?.goal ?? ""}
            placeholder="Offer the recording of last month's webinar and ask whether the topic is still on their list."
            className={cn(input, "mt-1")}
          />
          <span className={cn(hint, "mt-1 block font-normal")}>
            Written from your Knowledge. The usual rules always apply: no
            invented facts, prices or results, and an easy way to say no.
          </span>
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className={labelCls}>
            The steps after it
            <select
              name="sequence"
              defaultValue={playbook?.sequence_id ?? ""}
              className={cn(input, "mt-1")}
            >
              <option value="">
                {fallback
                  ? `Your default (${fallback.name})`
                  : "The standard follow-ups"}
              </option>
              {sequences.map((q) => {
                const d = stepDays(q.steps);
                return (
                  <option key={q.id} value={q.id}>
                    {q.name}:{" "}
                    {d.length
                      ? `follow-ups on day ${d.join(", ")}`
                      : "first email only"}
                  </option>
                );
              })}
            </select>
          </label>
          <label className={labelCls}>
            Language
            <select
              name="language"
              defaultValue={playbook?.language ?? "auto"}
              className={cn(input, "mt-1")}
            >
              <option value="auto">Auto: the sequence&apos;s, or theirs</option>
              {Object.entries(LANGUAGES).map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className={labelCls}>
            First emails
            <select
              name="approval"
              defaultValue={playbook?.approval_mode ?? "approve_first"}
              className={cn(input, "mt-1")}
            >
              <option value="approve_first">Wait for my approval</option>
              <option value="auto">Send on their own</option>
            </select>
          </label>
          <label className={labelCls}>
            Not picked again for
            <span className="mt-1 flex items-center gap-2 font-normal">
              <input
                name="repeat_days"
                type="number"
                min={7}
                max={365}
                required
                defaultValue={playbook?.repeat_days ?? 90}
                className={cn(input, "max-w-[120px]")}
              />
              days
            </span>
          </label>
        </div>
        <p className={hint}>
          Follow-ups follow the sequence&apos;s own approval setting. Sent
          emails go out inside your sending hours and daily limits, with your
          unsubscribe link, and never to anyone marked do not contact or on your
          never-contact list.
        </p>
      </fieldset>
      {admin ? (
        <SubmitButton>{playbook ? "Save" : "Create playbook"}</SubmitButton>
      ) : (
        <p className={hint}>
          Only the workspace&apos;s owner or an admin can change a playbook.
          Anyone can run it.
        </p>
      )}
    </ActionForm>
  );
}
