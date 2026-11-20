"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { ActionForm, SubmitButton } from "../../_ui/form";
import { hint, input, labelCls } from "../../_ui/kit";
import { connectAction } from "./actions";

// Connect HubSpot or Pipedrive by pasting a token. The token field is a
// password field, is never filled in again, and the token is not shown
// after it is saved.

type Scope = { scope: string; why: string; needed: boolean };

const link =
  "underline decoration-black/25 underline-offset-2 hover:decoration-black/60";

function Steps({ children }: { children: React.ReactNode }) {
  return (
    <ol className="list-decimal space-y-1.5 pl-5 text-[13px] leading-[1.5] text-[#0B0B0C]/75">
      {children}
    </ol>
  );
}

export function ConnectForm({
  hubspotScopes,
  disabled,
}: {
  hubspotScopes: Scope[];
  disabled: boolean;
}) {
  const [provider, setProvider] = useState<"hubspot" | "pipedrive">("hubspot");
  const tab = (p: typeof provider, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={provider === p}
      onClick={() => setProvider(p)}
      className={cn(
        "h-8 rounded-full px-3.5 text-[13px] font-medium transition-colors",
        provider === p
          ? "bg-[#0B0B0C] text-white"
          : "text-[#0B0B0C]/65 hover:bg-black/[0.05]",
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="p-4">
      <div role="tablist" className="mb-4 flex gap-1">
        {tab("hubspot", "HubSpot")}
        {tab("pipedrive", "Pipedrive")}
      </div>

      {provider === "hubspot" ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 text-[13.5px] font-medium">
              Make a key for Dialvo in HubSpot
            </h3>
            <Steps>
              <li>
                In HubSpot, open <strong>Development</strong>, then{" "}
                <strong>Keys</strong>, then <strong>Service keys</strong>. You
                need to be a Super Admin, or have Developer tools access.
              </li>
              <li>
                Click <strong>Create service key</strong> and call it Dialvo.
              </li>
              <li>
                Click <strong>Add new scope</strong> and tick these:
                <ul className="mt-1.5 space-y-1">
                  {hubspotScopes.map((s) => (
                    <li key={s.scope}>
                      <code className="rounded bg-black/[0.05] px-1 py-0.5 text-[12px]">
                        {s.scope}
                      </code>{" "}
                      <span className="text-[#0B0B0C]/55">
                        {s.needed ? "" : "(optional) "}to {s.why}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
              <li>
                Click <strong>Update</strong>, then <strong>Create</strong>,
                confirm, and copy the key.
              </li>
              <li>Paste it here.</li>
            </Steps>
            <p className={`${hint} mt-3`}>
              Already have a private app with these scopes? Its access token
              works too: Development, Legacy apps, the app, Auth, Show token.
            </p>
          </div>
          <ActionForm action={connectAction} className="space-y-3">
            <input type="hidden" name="provider" value="hubspot" />
            <label className={labelCls}>
              HubSpot key
              <input
                name="token"
                type="password"
                required
                autoComplete="off"
                spellCheck={false}
                maxLength={500}
                placeholder="pat-…"
                disabled={disabled}
                className={`${input} mt-1 font-mono`}
              />
            </label>
            <p className={hint}>
              Dialvo checks the key with HubSpot before saving it, then keeps it
              encrypted. It is never shown again.
            </p>
            <SubmitButton
              disabled={disabled}
              pendingText="Checking with HubSpot…"
            >
              Connect HubSpot
            </SubmitButton>
          </ActionForm>
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 text-[13.5px] font-medium">
              Find your API token in Pipedrive
            </h3>
            <Steps>
              <li>
                In Pipedrive, click your name at the top right, then{" "}
                <strong>Personal preferences</strong>, then <strong>API</strong>
                . Or open{" "}
                <a
                  href="https://app.pipedrive.com/settings/api"
                  target="_blank"
                  rel="noreferrer"
                  className={link}
                >
                  app.pipedrive.com/settings/api
                </a>
                .
              </li>
              <li>Copy your personal API token and paste it here.</li>
            </Steps>
            <p className={`${hint} mt-3`}>
              The token acts as you, with your permissions in Pipedrive. If
              there is no API page, an admin has to give your account API
              access. Pipedrive allows one token per person: making a new one
              stops the old one, and Dialvo with it.
            </p>
          </div>
          <ActionForm action={connectAction} className="space-y-3">
            <input type="hidden" name="provider" value="pipedrive" />
            <label className={labelCls}>
              Pipedrive API token
              <input
                name="token"
                type="password"
                required
                autoComplete="off"
                spellCheck={false}
                maxLength={500}
                disabled={disabled}
                className={`${input} mt-1 font-mono`}
              />
            </label>
            <label className={labelCls}>
              Company domain <span className="font-normal">(optional)</span>
              <span className="mt-1 flex items-center gap-1.5">
                <input
                  name="domain"
                  maxLength={100}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="yourcompany"
                  disabled={disabled}
                  className={input}
                />
                <span className="shrink-0 text-[13px] text-[#0B0B0C]/55">
                  .pipedrive.com
                </span>
              </span>
            </label>
            <p className={hint}>
              Leave it empty and Dialvo asks Pipedrive. The token is checked
              before it is saved, then kept encrypted and never shown again.
            </p>
            <SubmitButton
              disabled={disabled}
              pendingText="Checking with Pipedrive…"
            >
              Connect Pipedrive
            </SubmitButton>
          </ActionForm>
        </div>
      )}
    </div>
  );
}
