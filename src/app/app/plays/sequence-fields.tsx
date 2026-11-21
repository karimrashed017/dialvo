import { LANGUAGES } from "@/lib/mail/languages";
import type { Sequence } from "@/lib/sequences/server";
import { stepDays } from "@/lib/sequences/steps";
import { cn } from "@/lib/utils";
import { input, labelCls } from "../_ui/kit";

// The two choices every play start form offers: which sequence follows the
// first email, and the language its emails are written in. The action reads
// "sequence" and "language" (see applySequence in ./actions.ts).

const steps = (q: Sequence) => {
  const days = stepDays(q.steps);
  return days.length
    ? `follow-ups on day ${days.join(", ")}`
    : "first email only";
};

export function SequenceFields({
  sequences,
  purpose,
  single,
}: {
  sequences: Sequence[];
  /** The play's own ready-made sequence, offered first. */
  purpose?: { key: string; label: string } | null;
  /** A play that is one email unless a sequence is chosen. */
  single?: boolean;
}) {
  const fallback = sequences.find((q) => q.is_default);
  const own = sequences.filter((q) => q.purpose !== purpose?.key);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className={labelCls}>
        Sequence
        <select
          name="sequence"
          defaultValue={purpose ? "purpose" : ""}
          className={cn(input, "mt-1")}
        >
          {purpose && <option value="purpose">{purpose.label}</option>}
          <option value="">
            {single
              ? "One email, no follow-ups"
              : fallback
                ? `Your default (${fallback.name})`
                : "The standard follow-ups"}
          </option>
          {own.map((q) => (
            <option key={q.id} value={q.id}>
              {q.name}: {steps(q)}
            </option>
          ))}
        </select>
      </label>
      <label className={labelCls}>
        Language
        <select
          name="language"
          defaultValue="auto"
          className={cn(input, "mt-1")}
        >
          <option value="auto">
            {single
              ? "Auto: English, or the language they wrote to you in"
              : "Auto: the sequence's, or the lead's own language"}
          </option>
          {Object.entries(LANGUAGES).map(([code, name]) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
