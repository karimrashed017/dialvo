import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Building2, Eye } from "lucide-react";
import { getAppContext } from "@/lib/app/context";
import { agoWords } from "@/lib/app/time";
import { requestOrigin } from "@/lib/auth/origin";
import {
  IP_LOOKUPS_PER_DAY,
  RETARGET_COMPANIES_MAX,
  RETARGET_LEAD_DAYS,
} from "@/lib/integrations/config";
import { integrationReads } from "@/lib/integrations/read";
import {
  contactDatabaseStatus,
  prospectRuntimeStatus,
} from "@/lib/prospects/config";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { cn } from "@/lib/utils";
import { visitorIdStatus } from "@/lib/visitors/identify";
import { ActionForm, SubmitButton } from "../_ui/form";
import {
  Badge,
  btn,
  Empty,
  hint,
  input,
  labelCls,
  PageHead,
  PageSkeleton,
  panel,
  panelHead,
} from "../_ui/kit";
import { CopyButton } from "../settings/copy";
import { widgetUrl } from "../settings/snippet";
import {
  dismissCompany,
  forgetVisitor,
  retargetCompanies,
  retargetLeads,
  saveTracking,
} from "./actions";

export const metadata: Metadata = { title: "Website visitors" };

const HOW: Record<string, string> = {
  chat: "from the website chat",
  form: "from a form on your site",
  email_link: "from a link in your email",
};

async function Content() {
  const { workspace, preview, repo } = await getAppContext();
  const admin = workspace.role !== "member";
  const head = (
    <PageHead
      title="Website visitors"
      note="Which companies and leads are reading your site, especially your pricing page, and the play that follows up with them while it's on their mind."
    >
      <Link
        href="/app/plays/retargeting-website-visitors"
        className={cn(btn.secondary, btn.small)}
      >
        The retargeting play
      </Link>
    </PageHead>
  );
  if (preview)
    return (
      <>
        {head}
        <section className={panel}>
          <Empty icon={Eye} title="Not part of the design preview" />
        </section>
      </>
    );

  const serverOn = Boolean(createServiceClient());
  const ident = visitorIdStatus();
  const playsOn = prospectRuntimeStatus().on;
  const contactOn = contactDatabaseStatus().on;
  const supabase = await createClient();
  const reads = integrationReads(supabase, workspace.id);
  const [tracking, companies, known, views, weekViews, widgets, origin] =
    await Promise.all([
      reads.tracking(),
      reads.companies(),
      reads.knownVisitors(),
      reads.recentViews(30),
      reads.viewsInLastDays(7),
      repo.chatWidgets(),
      requestOrigin(),
    ]);
  const fresh = companies.filter((c) => c.status === "new");
  const widget = widgets[0];
  const snippet = widget
    ? `<script src="${widgetUrl(origin, widget.token)}" async></script>`
    : "";
  const pricingLeads = known.filter(
    (k) => k.pricing_views > 0 && k.lead?.email,
  );

  return (
    <>
      {head}
      <div className="mb-3 space-y-2">
        {!serverOn && (
          <p
            role="status"
            className="rounded-xl border border-black/15 bg-white px-4 py-2.5 text-[13px] leading-[1.5]"
          >
            Website visitors aren&apos;t switched on yet on Dialvo&apos;s side
            (the server needs its database key), so nothing is recorded yet.
          </p>
        )}
        <p
          role="status"
          className="rounded-xl border border-black/15 bg-white px-4 py-2.5 text-[13px] leading-[1.5]"
        >
          {ident.on ? (
            <>
              <span className="font-medium">Companies are identified</span> from
              each visit&apos;s network through {ident.provider}, up to{" "}
              {IP_LOOKUPS_PER_DAY} new addresses a day. Visitors on a home or
              mobile connection can&apos;t be identified this way and are shown
              only once they are a known lead.
            </>
          ) : (
            <>
              <span className="font-medium">Only known leads are shown.</span>{" "}
              Visitors become known when they chat, submit a form with their
              email, or click a link in your email. Identifying anonymous
              companies needs <code>{ident.envName}</code> (a key for{" "}
              {ident.provider}) on Dialvo&apos;s side, which isn&apos;t set.
            </>
          )}
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-3">
          <section aria-label="Numbers" className="grid grid-cols-3 gap-3">
            {[
              ["Page views, 7 days", weekViews],
              ["Companies seen", companies.length],
              ["Known leads seen", known.length],
            ].map(([label, n]) => (
              <div key={label} className={cn(panel, "px-4 py-3")}>
                <p className="text-[11.5px] text-[#0B0B0C]/55">{label}</p>
                <p className="mt-0.5 text-[20px] font-medium tabular-nums">
                  {n}
                </p>
              </div>
            ))}
          </section>

          <section className={panel}>
            <h2 className={panelHead}>
              Companies reading your site
              <span className="text-[11.5px] font-normal text-[#0B0B0C]/50">
                {fresh.length} new
              </span>
            </h2>
            {companies.length === 0 ? (
              <Empty icon={Building2} title="No company identified yet">
                {ident.on
                  ? tracking.enabled
                    ? "When someone from a company network reads your site, it shows here."
                    : "Switch tracking on (right) and companies appear here as they visit."
                  : `Needs ${ident.envName} on Dialvo's side. Known leads are below.`}
              </Empty>
            ) : (
              <>
                <ul className="divide-y divide-black/[0.06]">
                  {companies.map((c) => (
                    <li
                      key={c.id}
                      className="flex items-start gap-3 px-4 py-2.5 text-[13px]"
                    >
                      {c.status === "new" ? (
                        <input
                          type="checkbox"
                          name="company"
                          value={c.id}
                          form="retarget-companies"
                          aria-label={`Choose ${c.name || c.domain}`}
                          className="mt-1 size-3.5 accent-[#0B0B0C]"
                        />
                      ) : (
                        <span className="w-3.5" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">
                          {c.name || c.domain}
                        </span>{" "}
                        <span className="text-[12px] text-[#0B0B0C]/55">
                          {c.domain}
                        </span>
                        <span className="block text-[11.5px] text-[#0B0B0C]/50">
                          {c.page_views} {c.page_views === 1 ? "page" : "pages"}
                          {c.pricing_views > 0 &&
                            `, pricing ${c.pricing_views}×`}
                          {` · ${c.visitors} ${c.visitors === 1 ? "person" : "people"}`}
                          {` · last ${agoWords(c.last_seen_at)}`}
                          {c.country && ` · ${c.country}`}
                        </span>
                      </span>
                      {c.pricing_views > 0 && (
                        <Badge tone="blue">Pricing</Badge>
                      )}
                      {c.status === "retargeted" ? (
                        <Link
                          href={`/app/prospects/accounts?campaign=${c.campaign_id}`}
                          className="text-[12px] underline underline-offset-2"
                        >
                          In a play
                        </Link>
                      ) : c.status === "dismissed" ? (
                        <Badge tone="outline">Dismissed</Badge>
                      ) : (
                        <ActionForm action={dismissCompany} quiet>
                          <input type="hidden" name="company" value={c.id} />
                          <SubmitButton variant="ghost" small pendingText="…">
                            Dismiss
                          </SubmitButton>
                        </ActionForm>
                      )}
                    </li>
                  ))}
                </ul>
                <ActionForm
                  id="retarget-companies"
                  action={retargetCompanies}
                  className="space-y-2 border-t border-black/[0.06] p-4"
                >
                  <label className={labelCls}>
                    Who to write to{" "}
                    <span className="font-normal text-[#0B0B0C]/45">
                      (job titles, optional)
                    </span>
                    <input
                      name="titles"
                      maxLength={300}
                      placeholder="Head of Sales, Founder"
                      className={cn(input, "mt-1")}
                    />
                  </label>
                  <SubmitButton
                    disabled={!playsOn || !contactOn || fresh.length === 0}
                    pendingText="Starting…"
                  >
                    Find a contact and draft emails
                  </SubmitButton>
                  <p className={hint}>
                    {playsOn && contactOn
                      ? `For the companies you tick (up to ${RETARGET_COMPANIES_MAX}): Dialvo finds a named person at each in the contact database (about 2 credits a company), reads their site, and drafts a first email that waits for your approval. The email never says they visited.`
                      : "Needs the contact database and email writing, which aren't switched on yet on Dialvo's side."}
                  </p>
                </ActionForm>
              </>
            )}
          </section>

          <section className={panel}>
            <h2 className={panelHead}>Known leads on your site</h2>
            {known.length === 0 ? (
              <Empty icon={Eye} title="No known lead seen yet">
                A visitor becomes a known lead when they chat with you, submit a
                form with their email, or click a link in one of your emails.
              </Empty>
            ) : (
              <ul className="divide-y divide-black/[0.06]">
                {known.map((k) => (
                  <li
                    key={k.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-[13px]"
                  >
                    <span className="min-w-0 flex-1">
                      {k.lead ? (
                        <Link
                          href={`/app/leads/${k.lead.id}`}
                          className="font-medium underline-offset-2 hover:underline"
                        >
                          {k.lead.name && k.lead.name !== "Website visitor"
                            ? k.lead.name
                            : k.lead.email || "Website visitor"}
                        </Link>
                      ) : (
                        "A lead"
                      )}
                      <span className="block text-[11.5px] text-[#0B0B0C]/50">
                        {k.page_views} {k.page_views === 1 ? "page" : "pages"}
                        {k.pricing_views > 0 && `, pricing ${k.pricing_views}×`}
                        {` · last ${agoWords(k.last_seen_at)}`}
                        {k.identified_by &&
                          ` · known ${HOW[k.identified_by] ?? ""}`}
                      </span>
                    </span>
                    {k.pricing_views > 0 && <Badge tone="blue">Pricing</Badge>}
                    {admin && (
                      <ActionForm
                        action={forgetVisitor}
                        quiet
                        confirm="Delete this visitor and every page they read? Their lead stays."
                      >
                        <input type="hidden" name="visitor" value={k.id} />
                        <SubmitButton variant="ghost" small pendingText="…">
                          Forget
                        </SubmitButton>
                      </ActionForm>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <ActionForm
              action={retargetLeads}
              className="space-y-2 border-t border-black/[0.06] p-4"
            >
              <SubmitButton
                disabled={!playsOn || pricingLeads.length === 0}
                pendingText="Starting…"
              >
                Draft check-ins for those who read pricing
              </SubmitButton>
              <p className={hint}>
                {`Leads with an email who read your pricing page in the last ${RETARGET_LEAD_DAYS} days, not customers, never do not contact or unsubscribed. One short, helpful note each that never mentions the visit; each waits for your approval.`}
              </p>
            </ActionForm>
          </section>

          <section className={panel}>
            <h2 className={panelHead}>Latest page views</h2>
            {views.length === 0 ? (
              <p className="px-4 py-6 text-center text-[13px] text-[#0B0B0C]/50">
                {tracking.enabled
                  ? "No page view has arrived yet."
                  : "Tracking is off."}
              </p>
            ) : (
              <ul className="divide-y divide-black/[0.06]">
                {views.map((v) => (
                  <li
                    key={v.id}
                    className="flex flex-wrap gap-x-3 px-4 py-2 text-[12.5px]"
                  >
                    <code className="min-w-0 truncate">{v.path}</code>
                    {v.is_pricing && <Badge tone="blue">Pricing</Badge>}
                    <span className="min-w-0 flex-1 truncate text-[#0B0B0C]/60">
                      {v.visitor?.lead?.name &&
                      v.visitor.lead.name !== "Website visitor"
                        ? v.visitor.lead.name
                        : v.visitor?.lead?.email ||
                          v.visitor?.company?.name ||
                          v.visitor?.company?.domain ||
                          "Anonymous"}
                      {v.referrer_host && ` · from ${v.referrer_host}`}
                    </span>
                    <span className="text-[#0B0B0C]/50">
                      {agoWords(v.viewed_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="min-w-0 space-y-3">
          <section className={panel}>
            <h2 className={panelHead}>
              Tracking
              <Badge tone={tracking.enabled ? "ink" : "outline"}>
                {tracking.enabled ? "On" : "Off"}
              </Badge>
            </h2>
            <ActionForm
              action={saveTracking}
              className="space-y-3 p-4 text-[13px]"
            >
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="enabled"
                  defaultChecked={tracking.enabled}
                  disabled={!admin}
                  className="size-3.5 accent-[#0B0B0C]"
                />
                Count page views on my site
              </label>
              <fieldset className="space-y-1.5">
                <legend className={labelCls}>Consent</legend>
                <label className="flex items-start gap-2">
                  <input
                    type="radio"
                    name="consent_mode"
                    value="wait"
                    defaultChecked={tracking.consent_mode === "wait"}
                    disabled={!admin}
                    className="mt-1 accent-[#0B0B0C]"
                  />
                  <span>
                    Wait until my site says the visitor agreed{" "}
                    <span className="text-[#0B0B0C]/50">
                      (recommended, required in the UK and EU)
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2">
                  <input
                    type="radio"
                    name="consent_mode"
                    value="notice"
                    defaultChecked={tracking.consent_mode === "notice"}
                    disabled={!admin}
                    className="mt-1 accent-[#0B0B0C]"
                  />
                  <span>Count without asking: my site shows a notice</span>
                </label>
              </fieldset>
              <label className={labelCls}>
                Pricing page
                <input
                  name="pricing_paths"
                  defaultValue={tracking.pricing_paths.join(", ")}
                  maxLength={600}
                  disabled={!admin}
                  className={cn(input, "mt-1")}
                />
                <span className={cn(hint, "mt-1 block font-normal")}>
                  Paths, separated by commas. Pages under them count too.
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  name="tag_email_links"
                  defaultChecked={tracking.tag_email_links}
                  disabled={!admin}
                  className="mt-1 size-3.5 accent-[#0B0B0C]"
                />
                <span>
                  Tag links to my website in first emails, so a click makes the
                  visit a known lead{" "}
                  <span className="text-[#0B0B0C]/50">
                    (adds ?dvl=… to the link; you see it before you approve)
                  </span>
                </span>
              </label>
              {admin ? (
                <SubmitButton disabled={!serverOn}>Save</SubmitButton>
              ) : (
                <p className={hint}>Only an owner or admin can change this.</p>
              )}
            </ActionForm>
          </section>

          <section className={panel}>
            <h2 className={panelHead}>On your site</h2>
            <div className="space-y-2 p-4 text-[13px] leading-[1.5] text-[#0B0B0C]/75">
              <p>
                Tracking runs in the same code as your website chat. If the chat
                is already on your site, there is nothing else to install.
              </p>
              {snippet && (
                <>
                  <pre className="overflow-x-auto rounded-xl bg-black/[0.04] p-2.5 text-[11.5px]">
                    {snippet}
                  </pre>
                  <CopyButton text={snippet} label="Copy" />
                </>
              )}
              {tracking.consent_mode === "wait" && (
                <>
                  <p>
                    With &quot;wait&quot;, nothing is sent until your site says
                    yes. Either have your consent tool add the tag only after
                    the visitor accepts, with{" "}
                    <code>data-consent=&quot;granted&quot;</code> added to it,
                    or call this on every page once they have:
                  </p>
                  <pre className="overflow-x-auto rounded-xl bg-black/[0.04] p-2.5 text-[11.5px]">{`window.dialvo = window.dialvo || function () {
  (window.dialvo.q = window.dialvo.q || []).push(arguments); };
dialvo("consent", true);`}</pre>
                </>
              )}
              <p className={hint}>
                For your cookie notice: Dialvo keeps a random visitor id and a
                session id in the browser&apos;s local storage, and records the
                pages read (no query strings), the referring site and the email
                typed into your forms, to show you who is interested and follow
                up. It never runs when the browser sends Do Not Track or Global
                Privacy Control. Page views are kept 180 days; you can delete a
                visitor here. List Dialvo in your privacy policy as a processor.
              </p>
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}

export default function VisitorsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content />
    </Suspense>
  );
}
