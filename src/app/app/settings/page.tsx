import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { alertEmailStatus } from "@/lib/alerts/email";
import { getAppContext } from "@/lib/app/context";
import { dateOnly } from "@/lib/app/time";
import { requestOrigin } from "@/lib/auth/origin";
import { trialState } from "@/lib/billing/trial";
import { CONTACT_EMAIL, PLANS } from "@/lib/site";
import { cn } from "@/lib/utils";
import { ActionForm, SubmitButton } from "../_ui/form";
import {
  Badge,
  btn,
  hint,
  Initial,
  input,
  labelCls,
  PageHead,
  PageSkeleton,
  panel,
  panelHead,
} from "../_ui/kit";
import {
  changeRole,
  createLeadForm,
  deleteLeadForm,
  invite,
  removeMember,
  revokeInvitation,
  updateAlertEmails,
  updateLeadForm,
  updateProfile,
  updateWorkspace,
} from "./actions";
import { CopyButton } from "./copy";
import { captureUrl, fetchSnippet, formSnippet } from "./snippet";

export const metadata: Metadata = { title: "Settings" };

const ROLE_WORDS = { owner: "Owner", admin: "Admin", member: "Member" };

function timezones(current: string): string[] {
  const all = Intl.supportedValuesOf("timeZone");
  return [...new Set(["UTC", current, ...all])];
}

async function Settings() {
  const { repo, workspace, user } = await getAppContext();
  const [members, invitations, forms, origin, alertsOn] = await Promise.all([
    repo.members(),
    repo.invitations(),
    repo.leadForms(),
    requestOrigin(),
    repo.alertEmails(),
  ]);
  const trial = trialState(workspace);
  const alertsLive = alertEmailStatus().on;
  const admin = workspace.role !== "member";
  const adminOnly = !admin && (
    <p className={`${hint} mt-3`}>
      Only the workspace&apos;s owner and admins can change this.
    </p>
  );

  return (
    <>
      <PageHead title="Settings" />
      <div className="grid items-start gap-3 lg:grid-cols-2">
        <section id="workspace" className={cn(panel, "scroll-mt-28")}>
          <h2 className={panelHead}>
            Workspace
            {/* A trial isn't a plan: the line below says where it stands. */}
            {trial.phase === "paid" && (
              <Badge>{PLANS[workspace.plan].name} plan</Badge>
            )}
          </h2>
          <p
            data-trial-line
            className="border-b border-black/[0.06] px-4 py-2.5 text-[12.5px] leading-[1.45] text-[#0B0B0C]/70"
          >
            {trial.phase === "paid" ? (
              <>Your plan is active.</>
            ) : trial.phase === "trial" ? (
              <>
                Free trial: {trial.daysLeft}{" "}
                {trial.daysLeft === 1 ? "day" : "days"} left. It ends on{" "}
                {dateOnly(workspace.trial_ends_at, workspace.timezone)}.
              </>
            ) : trial.locked ? (
              <>
                Your free trial ended on{" "}
                {dateOnly(workspace.trial_ends_at, workspace.timezone)}. Your
                agent has stopped replying until you{" "}
                <a href="/pricing" className="underline">
                  pick a plan
                </a>
                .
              </>
            ) : (
              <>
                Your free trial ended on{" "}
                {dateOnly(workspace.trial_ends_at, workspace.timezone)}. Paid
                plans are coming and nothing has been switched off. To stay on,
                email{" "}
                <a href={`mailto:${CONTACT_EMAIL}`} className="underline">
                  {CONTACT_EMAIL}
                </a>
                .
              </>
            )}
          </p>
          <ActionForm action={updateWorkspace} className="p-4">
            <fieldset disabled={!admin} className="space-y-3">
              <label className={labelCls}>
                Name
                <input
                  name="name"
                  required
                  maxLength={120}
                  defaultValue={workspace.name}
                  className={`${input} mt-1`}
                />
              </label>
              <label className={labelCls}>
                Website
                <input
                  name="website"
                  maxLength={300}
                  defaultValue={workspace.website ?? ""}
                  placeholder="yourcompany.com"
                  className={`${input} mt-1`}
                />
              </label>
              <label className={labelCls}>
                Time zone
                <select
                  name="timezone"
                  defaultValue={workspace.timezone}
                  className={`${input} mt-1`}
                >
                  {timezones(workspace.timezone).map((tz) => (
                    <option key={tz} value={tz}>
                      {tz.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </label>
            </fieldset>
            {admin ? (
              <div className="mt-4 flex justify-end">
                <SubmitButton>Save workspace</SubmitButton>
              </div>
            ) : (
              adminOnly
            )}
          </ActionForm>
        </section>

        <section id="profile" className={cn(panel, "scroll-mt-28")}>
          <h2 className={panelHead}>Your profile</h2>
          <ActionForm action={updateProfile} className="space-y-3 p-4">
            <label className={labelCls}>
              Name
              <input
                name="name"
                required
                maxLength={120}
                autoComplete="name"
                defaultValue={user.name}
                className={`${input} mt-1`}
              />
            </label>
            <label className={labelCls}>
              Email
              <input
                disabled
                value={user.email}
                readOnly
                className={`${input} mt-1`}
              />
              <span className={`${hint} mt-1.5 block`}>
                Your log-in address. Changing it isn&apos;t available here yet.
              </span>
            </label>
            <div className="flex justify-end">
              <SubmitButton>Save profile</SubmitButton>
            </div>
          </ActionForm>
        </section>

        <section
          id="alerts"
          className={cn(panel, "scroll-mt-28 lg:col-span-2")}
        >
          <h2 className={panelHead}>
            Email alerts
            <Badge tone={alertsOn ? "ink" : "outline"}>
              {alertsOn ? "On for you" : "Off for you"}
            </Badge>
          </h2>
          <div className="p-4">
            <p className="max-w-[640px] text-[13px] leading-[1.5] text-[#0B0B0C]/70">
              Dialvo emails you at {user.email} when a website chat is
              qualified, needs a person, or has a draft reply waiting for your
              approval: a short summary and a link to the conversation. This
              switch is yours alone; each teammate has their own.
            </p>
            {!alertsLive && (
              <p
                data-alerts="not-live"
                className="mt-2 max-w-[640px] rounded-xl bg-black/[0.04] px-3 py-2 text-[12.5px] leading-[1.45] text-[#0B0B0C]/75"
              >
                Email alerts aren&apos;t switched on yet on Dialvo&apos;s side,
                so nothing is sent for now. Your choice here is saved and
                applies as soon as they are.
              </p>
            )}
            <ActionForm action={updateAlertEmails} className="mt-3">
              <input
                type="hidden"
                name="alert_emails"
                value={alertsOn ? "false" : "true"}
              />
              <SubmitButton variant="secondary" small>
                {alertsOn ? "Turn my alerts off" : "Turn my alerts on"}
              </SubmitButton>
            </ActionForm>
            <p className={`${hint} mt-2`}>
              At most 20 alerts an hour go to a workspace. Dialvo never emails
              your leads or visitors from here.
            </p>
          </div>
        </section>

        <section
          id="members"
          className={cn(panel, "scroll-mt-28 lg:col-span-2")}
        >
          <h2 className={panelHead}>
            Members
            <span className="text-[11.5px] font-normal text-[#0B0B0C]/50 tabular-nums">
              {members.length}
            </span>
          </h2>
          <ul>
            {members.map((m) => {
              const me = m.user_id === user.id;
              const editable = admin && !me && m.role !== "owner";
              return (
                <li
                  key={m.user_id}
                  className="flex flex-wrap items-center gap-3 border-b border-black/[0.05] px-4 py-2.5 last:border-0"
                >
                  <Initial name={m.name || m.email} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">
                      {m.name || m.email}
                      {me && (
                        <span className="font-normal text-[#0B0B0C]/45">
                          {" "}
                          (you)
                        </span>
                      )}
                    </p>
                    <p className="truncate text-[12px] text-[#0B0B0C]/50">
                      {m.email}
                    </p>
                  </div>
                  {editable ? (
                    <>
                      <ActionForm
                        action={changeRole}
                        quiet
                        className="flex items-center gap-1.5"
                      >
                        <input type="hidden" name="member" value={m.user_id} />
                        <label>
                          <span className="sr-only">
                            Role for {m.name || m.email}
                          </span>
                          <select
                            key={m.role}
                            name="role"
                            defaultValue={m.role}
                            className={cn(
                              input,
                              "h-8 w-[110px] py-0 text-[12.5px]",
                            )}
                          >
                            <option value="member">Member</option>
                            <option value="admin">Admin</option>
                          </select>
                        </label>
                        <SubmitButton variant="secondary" small>
                          Change
                        </SubmitButton>
                      </ActionForm>
                      <ActionForm
                        action={removeMember}
                        quiet
                        confirm={`Remove ${m.name || m.email} from ${workspace.name}? Their leads and conversations stay, unassigned.`}
                      >
                        <input type="hidden" name="member" value={m.user_id} />
                        <SubmitButton
                          variant="ghost"
                          small
                          pendingText="Removing…"
                          className="text-[#B42318]"
                        >
                          Remove
                        </SubmitButton>
                      </ActionForm>
                    </>
                  ) : (
                    <Badge tone={m.role === "owner" ? "ink" : "plain"}>
                      {ROLE_WORDS[m.role]}
                    </Badge>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="border-t border-black/[0.06] p-4">
            <h3 className="text-[13px] font-medium">Invite someone</h3>
            {admin ? (
              <>
                <ActionForm action={invite} resetOnSuccess className="mt-2">
                  <div className="flex flex-wrap items-end gap-2">
                    <label className={cn(labelCls, "min-w-[220px] flex-1")}>
                      Email
                      <input
                        name="email"
                        type="email"
                        required
                        maxLength={254}
                        placeholder="teammate@yourcompany.com"
                        className={`${input} mt-1`}
                      />
                    </label>
                    <label className={labelCls}>
                      Role
                      <select name="role" className={`${input} mt-1 w-[120px]`}>
                        <option value="member">Member</option>
                        <option value="admin">Admin</option>
                      </select>
                    </label>
                    <SubmitButton pendingText="Inviting…">Invite</SubmitButton>
                  </div>
                </ActionForm>
                <p className={`${hint} mt-2`}>
                  Dialvo doesn&apos;t send invitation emails yet. The invitation
                  is saved: when they sign up with this exact address and
                  confirm it, they&apos;re offered this workspace. Admins can
                  change settings, agents and members; members work leads and
                  the inbox.
                </p>
              </>
            ) : (
              adminOnly
            )}
            {invitations.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {invitations.map((i) => (
                  <li
                    key={i.id}
                    className="flex flex-wrap items-center gap-2 rounded-xl bg-black/[0.03] px-3 py-2"
                  >
                    <span className="min-w-0 flex-1 truncate text-[13px]">
                      {i.email}
                    </span>
                    <Badge tone="outline">
                      Invited as {ROLE_WORDS[i.role].toLowerCase()} · not
                      emailed
                    </Badge>
                    <span className="text-[11.5px] text-[#0B0B0C]/45">
                      expires {dateOnly(i.expires_at, workspace.timezone)}
                    </span>
                    <ActionForm action={revokeInvitation} quiet>
                      <input type="hidden" name="invitation" value={i.id} />
                      <SubmitButton variant="ghost" small pendingText="…">
                        Withdraw
                      </SubmitButton>
                    </ActionForm>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section id="chat" className={cn(panel, "scroll-mt-28 lg:col-span-2")}>
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <p className="min-w-0 flex-1 text-[13px] leading-[1.5] text-[#0B0B0C]/70">
              <span className="font-medium text-[#0B0B0C]">Website chat</span>{" "}
              has its own page now: the code for your site, the install check
              and your agent&apos;s settings are all there.
            </p>
            <Link href="/app/chat" className={cn(btn.secondary, btn.small)}>
              Open Website chat
            </Link>
          </div>
        </section>

        <section id="crm" className={cn(panel, "scroll-mt-28 lg:col-span-2")}>
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <p className="min-w-0 flex-1 text-[13px] leading-[1.5] text-[#0B0B0C]/70">
              <span className="font-medium text-[#0B0B0C]">CRM</span>: connect
              HubSpot or Pipedrive to send leads, conversations and meetings
              there, and skip anyone already in it.
            </p>
            <Link
              href="/app/settings/crm"
              className={cn(btn.secondary, btn.small)}
            >
              Open CRM
            </Link>
          </div>
        </section>

        <section id="forms" className={cn(panel, "scroll-mt-28 lg:col-span-2")}>
          <h2 className={panelHead}>
            Lead-capture forms
            <span className="text-[11.5px] font-normal text-[#0B0B0C]/50">
              Put one on your site: every enquiry becomes a lead and a
              conversation waiting for you
            </span>
          </h2>
          {forms.length === 0 && (
            <p className="px-4 pt-4 text-[13px] text-[#0B0B0C]/55">
              No forms yet.
            </p>
          )}
          <ul>
            {forms.map((f) => {
              const html = formSnippet(origin, f.token);
              return (
                <li
                  key={f.id}
                  className="border-b border-black/[0.06] p-4 last:border-0"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-[14px] font-medium">{f.name}</h3>
                    <Badge tone={f.enabled ? "ink" : "outline"}>
                      {f.enabled ? "Accepting leads" : "Switched off"}
                    </Badge>
                    {admin && (
                      <ActionForm
                        action={updateLeadForm}
                        quiet
                        className="ml-auto"
                      >
                        <input type="hidden" name="form" value={f.id} />
                        <input
                          type="hidden"
                          name="enabled"
                          value={f.enabled ? "false" : "true"}
                        />
                        <SubmitButton variant="secondary" small pendingText="…">
                          {f.enabled ? "Switch off" : "Switch on"}
                        </SubmitButton>
                      </ActionForm>
                    )}
                  </div>

                  <p className="mt-3 text-[12px] font-medium text-[#0B0B0C]/75">
                    Posts to
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded-lg bg-black/[0.045] px-2.5 py-1.5 font-mono text-[12px]">
                      {captureUrl(origin, f.token)}
                    </code>
                    <CopyButton
                      text={captureUrl(origin, f.token)}
                      label="Copy address"
                    />
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-2">
                    <p className="text-[12px] font-medium text-[#0B0B0C]/75">
                      HTML to paste into your page
                    </p>
                    <CopyButton text={html} label="Copy HTML" />
                  </div>
                  <pre
                    tabIndex={0}
                    className="mt-1 max-h-[260px] overflow-auto rounded-xl bg-[#0B0B0C] p-3.5 font-mono text-[11.5px] leading-[1.6] text-white/90"
                  >
                    {html}
                  </pre>
                  <details className="mt-2 text-[12.5px]">
                    <summary className="cursor-pointer text-[#0B0B0C]/65">
                      Already have a form? Post JSON instead
                    </summary>
                    <pre
                      tabIndex={0}
                      className="mt-2 overflow-auto rounded-xl bg-[#0B0B0C] p-3.5 font-mono text-[11.5px] leading-[1.6] text-white/90"
                    >
                      {fetchSnippet(origin, f.token)}
                    </pre>
                    <p className={`${hint} mt-2`}>
                      Works from any website. Fields: name, email, phone,
                      company, website, message. An email or a phone number is
                      required.
                    </p>
                  </details>
                  <p className={`${hint} mt-3`}>
                    Consent is recorded only for the boxes a visitor ticks, with
                    the time and this form&apos;s name. Style the form however
                    you like; keep the field names.
                  </p>

                  {admin && (
                    <details className="mt-3 text-[12.5px]">
                      <summary className="cursor-pointer text-[#0B0B0C]/65">
                        Rename, set a thank-you page, or delete
                      </summary>
                      <ActionForm
                        action={updateLeadForm}
                        className="mt-3 grid gap-3 sm:grid-cols-2"
                      >
                        <input type="hidden" name="form" value={f.id} />
                        <label className={labelCls}>
                          Form name
                          <input
                            name="name"
                            required
                            maxLength={120}
                            defaultValue={f.name}
                            className={`${input} mt-1`}
                          />
                        </label>
                        <label className={labelCls}>
                          Thank-you page{" "}
                          <span className="font-normal text-[#0B0B0C]/45">
                            (optional)
                          </span>
                          <input
                            name="redirect_url"
                            maxLength={500}
                            inputMode="url"
                            defaultValue={f.redirect_url ?? ""}
                            placeholder="https://yourcompany.com/thanks"
                            className={`${input} mt-1`}
                          />
                        </label>
                        <div className="sm:col-span-2">
                          <SubmitButton variant="secondary">
                            Save form
                          </SubmitButton>
                        </div>
                      </ActionForm>
                      <ActionForm
                        action={deleteLeadForm}
                        quiet
                        confirm={`Delete "${f.name}"? Pages that still post to it will stop adding leads. Leads it already captured stay.`}
                        className="mt-2"
                      >
                        <input type="hidden" name="form" value={f.id} />
                        <SubmitButton
                          variant="ghost"
                          small
                          pendingText="Deleting…"
                          className="text-[#B42318]"
                        >
                          Delete form
                        </SubmitButton>
                      </ActionForm>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
          {admin && (
            <ActionForm
              action={createLeadForm}
              resetOnSuccess
              quiet
              className="border-t border-black/[0.06] p-4"
            >
              <div className="flex flex-wrap items-end gap-2">
                <label className={cn(labelCls, "min-w-[220px] flex-1")}>
                  New form
                  <input
                    name="name"
                    required
                    maxLength={120}
                    placeholder="e.g. Pricing page form"
                    className={`${input} mt-1`}
                  />
                </label>
                <SubmitButton variant="secondary" pendingText="Creating…">
                  Create form
                </SubmitButton>
              </div>
              <p className={`${hint} mt-2`}>
                One form per page or campaign tells you where each lead came
                from.
              </p>
            </ActionForm>
          )}
        </section>
      </div>
    </>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Settings />
    </Suspense>
  );
}
