"use client";

import { useState } from "react";
import {
  MAILBOX_DAILY_LIMIT_DEFAULT,
  MAILBOX_DAILY_LIMIT_MAX,
  RAMP_START,
  RAMP_STEP,
} from "@/lib/mail/config";
import { OTHER_STEPS, PRESETS, type Provider } from "@/lib/mail/presets";
import { cn } from "@/lib/utils";
import { ActionForm, SubmitButton } from "../../_ui/form";
import { hint, input, labelCls } from "../../_ui/kit";
import { connectMailbox } from "./actions";

const PROVIDERS: { id: Provider; label: string }[] = [
  { id: "google", label: PRESETS.google.label },
  { id: "microsoft", label: PRESETS.microsoft.label },
  { id: "other", label: "Another provider" },
];

/** The form that connects a mailbox, with the steps for the chosen provider. */
export function ConnectForm({
  defaultName,
  defaultEmail,
}: {
  defaultName: string;
  defaultEmail: string;
}) {
  const [provider, setProvider] = useState<Provider>("google");
  const steps = provider === "other" ? OTHER_STEPS : PRESETS[provider].steps;
  const note = provider === "other" ? null : PRESETS[provider].note;
  return (
    <ActionForm action={connectMailbox} className="p-4" resetOnSuccess>
      <fieldset>
        <legend className={labelCls}>Where is this mailbox?</legend>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {PROVIDERS.map((p) => (
            <label
              key={p.id}
              className={cn(
                "flex h-9 cursor-pointer items-center rounded-full border px-3.5 text-[13px] font-medium",
                provider === p.id
                  ? "border-[#0B0B0C] bg-[#0B0B0C] text-white"
                  : "border-black/15 bg-white text-[#0B0B0C]/75 hover:bg-black/[0.04]",
              )}
            >
              <input
                type="radio"
                name="provider"
                value={p.id}
                checked={provider === p.id}
                onChange={() => setProvider(p.id)}
                className="sr-only"
              />
              {p.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div
        data-app-password-help={provider}
        className="mt-3 rounded-xl bg-black/[0.035] px-3.5 py-3 text-[12.5px] leading-[1.5] text-[#0B0B0C]/80"
      >
        <p className="font-medium text-[#0B0B0C]">
          {provider === "other"
            ? "What you need"
            : "How to create an app password"}
        </p>
        <ol className="mt-1.5 list-decimal space-y-1 pl-4">
          {steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        {note && <p className="mt-2 text-[#0B0B0C]/65">{note}</p>}
        <p className="mt-2 text-[#0B0B0C]/65">
          An app password lets Dialvo send and read mail without knowing your
          real password, and you can revoke it at any time from your mail
          account.
        </p>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className={labelCls}>
          Email address
          <input
            name="email"
            type="email"
            required
            maxLength={254}
            autoComplete="off"
            defaultValue={defaultEmail}
            placeholder="you@yourcompany.com"
            className={`${input} mt-1`}
          />
        </label>
        <label className={labelCls}>
          Your real name
          <input
            name="sender_name"
            required
            maxLength={120}
            defaultValue={defaultName}
            placeholder="First and last name"
            className={`${input} mt-1`}
          />
          <span className={`${hint} mt-1.5 block`}>
            The person who is actually sending. It shows as the sender and under
            every email.
          </span>
        </label>
        <label className={labelCls}>
          App password
          <input
            name="password"
            type="password"
            required
            maxLength={500}
            autoComplete="new-password"
            className={`${input} mt-1`}
          />
          <span className={`${hint} mt-1.5 block`}>
            Stored encrypted and never shown again, to you or anyone else.
          </span>
        </label>
        <label className={labelCls}>
          Most emails a day
          <input
            name="daily_limit"
            type="number"
            required
            min={1}
            max={MAILBOX_DAILY_LIMIT_MAX}
            defaultValue={MAILBOX_DAILY_LIMIT_DEFAULT}
            className={`${input} mt-1`}
          />
          <span className={`${hint} mt-1.5 block`}>
            Up to {MAILBOX_DAILY_LIMIT_MAX}. A new mailbox starts at{" "}
            {RAMP_START} a day and adds {RAMP_STEP} a day until it reaches this.
          </span>
        </label>
      </div>

      {provider === "other" && (
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <label className={cn(labelCls, "sm:col-span-3")}>
            SMTP server (sending)
            <input
              name="smtp_host"
              required
              maxLength={253}
              placeholder="smtp.yourprovider.com"
              className={`${input} mt-1`}
            />
          </label>
          <label className={labelCls}>
            Port
            <select
              name="smtp_port"
              defaultValue="587"
              className={`${input} mt-1`}
            >
              <option value="587">587 (STARTTLS)</option>
              <option value="465">465 (TLS)</option>
              <option value="2525">2525 (STARTTLS)</option>
            </select>
          </label>
          <label className={cn(labelCls, "sm:col-span-3")}>
            IMAP server (reading replies)
            <input
              name="imap_host"
              required
              maxLength={253}
              placeholder="imap.yourprovider.com"
              className={`${input} mt-1`}
            />
          </label>
          <label className={labelCls}>
            Port
            <select
              name="imap_port"
              defaultValue="993"
              className={`${input} mt-1`}
            >
              <option value="993">993 (TLS)</option>
            </select>
          </label>
          <label className={cn(labelCls, "sm:col-span-4")}>
            Username{" "}
            <span className="font-normal text-[#0B0B0C]/45">
              (only if it isn&apos;t the email address)
            </span>
            <input
              name="username"
              maxLength={254}
              autoComplete="off"
              className={`${input} mt-1`}
            />
          </label>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <SubmitButton pendingText="Logging in to check…">
          Check and connect
        </SubmitButton>
        <p className={cn(hint, "max-w-[420px]")}>
          Dialvo logs in to send and to read replies before saving. If either
          fails, you&apos;re told exactly what the mail server said and nothing
          is saved.
        </p>
      </div>
    </ActionForm>
  );
}
