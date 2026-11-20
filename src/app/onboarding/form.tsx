"use client";

import { useEffect, useRef } from "react";
import { ActionForm, SubmitButton } from "../app/_ui/form";
import { acceptInvitation, createWorkspace } from "./actions";

const field =
  "mt-1.5 w-full rounded-xl border border-black/15 bg-white px-3.5 py-2.5 text-[15px] text-[#0B0B0C] outline-none placeholder:text-[#0B0B0C]/35 focus:border-[#1F3BFF] focus:ring-2 focus:ring-[#1F3BFF]/20";
const label = "block text-[13px] font-medium text-[#0B0B0C]/80";
const optional = (
  <span className="font-normal text-[#0B0B0C]/45">(optional)</span>
);

export function WorkspaceForm({ timezones }: { timezones: string[] }) {
  const zone = useRef<HTMLSelectElement>(null);
  // Start on the visitor's own time zone.
  useEffect(() => {
    const mine = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone.current && timezones.includes(mine)) zone.current.value = mine;
  }, [timezones]);

  return (
    <ActionForm action={createWorkspace}>
      <label className={label}>
        Workspace name
        <input
          name="name"
          required
          maxLength={120}
          autoComplete="organization"
          placeholder="Your business or team"
          className={field}
        />
      </label>
      <label className={`${label} mt-4`}>
        What do you sell, and to whom?
        <textarea
          name="sells"
          required
          rows={4}
          maxLength={5000}
          placeholder="e.g. Websites and local SEO for dental clinics. Plans from $900 a month."
          className={field}
        />
        <span className="mt-1.5 block text-[12.5px] font-normal text-[#0B0B0C]/50">
          Saved as the first item in your knowledge base. You can edit it later.
        </span>
      </label>
      <label className={`${label} mt-4`}>
        Website {optional}
        <input
          name="website"
          maxLength={300}
          placeholder="yourcompany.com"
          className={field}
        />
      </label>
      <label className={`${label} mt-4`}>
        Time zone
        <select ref={zone} name="timezone" defaultValue="UTC" className={field}>
          {timezones.map((tz) => (
            <option key={tz} value={tz}>
              {tz.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        <span className="mt-1.5 block text-[12.5px] font-normal text-[#0B0B0C]/50">
          Used for &quot;today&quot; and for the hours your agents may send in.
        </span>
      </label>
      <SubmitButton
        pendingText="Creating…"
        className="mt-6 h-12 w-full text-[15px]"
      >
        Create workspace
      </SubmitButton>
    </ActionForm>
  );
}

export function AcceptInvitation({
  id,
  workspace,
  role,
}: {
  id: string;
  workspace: string;
  role: string;
}) {
  return (
    <ActionForm
      action={acceptInvitation}
      className="rounded-2xl border border-black/10 bg-white p-4"
    >
      <input type="hidden" name="invitation" value={id} />
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 text-[14px] leading-[1.45]">
          You&apos;re invited to join{" "}
          <span className="font-medium">{workspace}</span> as{" "}
          {role === "admin" ? "an admin" : "a member"}.
        </p>
        <SubmitButton pendingText="Joining…">Join</SubmitButton>
      </div>
    </ActionForm>
  );
}
