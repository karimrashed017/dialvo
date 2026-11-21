import { Star } from "lucide-react";
import { agoWords } from "@/lib/app/time";
import { integrationReads } from "@/lib/integrations/read";
import {
  contactDatabaseStatus,
  prospectRuntimeStatus,
} from "@/lib/prospects/config";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { cn } from "@/lib/utils";
import { ActionForm, SubmitButton } from "../../_ui/form";
import {
  Badge,
  Empty,
  hint,
  input,
  labelCls,
  panel,
  panelHead,
} from "../../_ui/kit";
import { SecretForm } from "../../settings/api/secret-form";
import {
  connectG2,
  disconnectIntent,
  dismissIntent,
  importIntentCsv,
  keepIntent,
  makeIntentWebhook,
} from "./intent-actions";

// Review-site intent on the Signals tab: where it comes from (CSV, webhook,
// G2), and the companies researching your category, to keep or dismiss.

const TYPE: Record<string, string> = {
  profile: "Read a product page",
  pricing: "Looked at pricing",
  compare: "Compared products",
  alternatives: "Looked at alternatives",
  category: "Browsed the category",
  reviews: "Read reviews",
  other: "Researched",
};

const PROVIDER: Record<string, string> = {
  g2: "G2",
  capterra: "Capterra",
  trustradius: "TrustRadius",
  getapp: "GetApp",
  software_advice: "Software Advice",
};

const STATUS: Record<string, string> = {
  queued: "Kept: finding a contact",
  dismissed: "Dismissed",
  skipped: "Already yours or never contact",
};

export async function IntentSection({
  workspaceId,
  admin,
}: {
  workspaceId: string;
  admin: boolean;
}) {
  const reads = integrationReads(await createClient(), workspaceId);
  const [sources, signals] = await Promise.all([
    reads.intentSources(),
    reads.intentSignals(),
  ]);
  const serverOn = Boolean(createServiceClient());
  const keepOn = prospectRuntimeStatus().on && contactDatabaseStatus().on;
  const hook = sources.find(
    (s) => s.kind === "webhook" && s.status === "active",
  );
  const g2 = sources.find(
    (s) => s.kind === "g2" && s.status !== "disconnected",
  );
  const fresh = signals.filter((s) => s.status === "new");
  const decided = signals.filter((s) => s.status !== "new").slice(0, 20);

  return (
    <div className="mt-3 grid gap-3 lg:grid-cols-[340px_1fr]">
      <div className="min-w-0 space-y-3">
        <section className={panel}>
          <h2 className={panelHead}>Bring in review-site intent</h2>
          <div className="space-y-4 p-4 text-[13px] leading-[1.5]">
            <p className="text-[#0B0B0C]/70">
              Companies researching your category on review sites. This data
              comes with your own review-site subscription: bring it in any of
              these three ways.
            </p>
            <ActionForm
              action={importIntentCsv}
              resetOnSuccess
              className="space-y-2"
            >
              <p className="font-medium">1. Upload an export (CSV)</p>
              <input
                type="file"
                name="file"
                accept=".csv,text/csv"
                required
                disabled={!serverOn}
                className="block w-full text-[12.5px]"
              />
              <label className={labelCls}>
                Which site it&apos;s from{" "}
                <span className="font-normal text-[#0B0B0C]/45">
                  (if the file doesn&apos;t say)
                </span>
                <select
                  name="provider"
                  className={cn(input, "mt-1")}
                  defaultValue=""
                >
                  <option value="">Not given</option>
                  <option value="g2">G2</option>
                  <option value="capterra">Capterra</option>
                  <option value="trustradius">TrustRadius</option>
                  <option value="getapp">GetApp</option>
                  <option value="software_advice">Software Advice</option>
                </select>
              </label>
              <SubmitButton small disabled={!serverOn} pendingText="Importing…">
                Import
              </SubmitButton>
              <p className={hint}>
                Columns are matched by name: company_domain (or domain or
                website, required), company_name, signal_type (or visit_type),
                topic (or product_name or category_name), seen_on (or day or
                visit_date), activity, company_country, company_industry,
                provider. Up to 500 rows a file.
              </p>
            </ActionForm>

            <div className="space-y-2 border-t border-black/[0.06] pt-3">
              <p className="font-medium">2. Send it to Dialvo (webhook)</p>
              {hook && (
                <p className={hint}>
                  On: {hook.token_prefix}…
                  {hook.last_import_at
                    ? `, last used ${agoWords(hook.last_import_at)}`
                    : ", not used yet"}
                  .
                </p>
              )}
              {admin ? (
                <SecretForm
                  action={makeIntentWebhook}
                  submit={hook ? "Make a new address" : "Make an address"}
                  pendingText="Making…"
                  disabled={!serverOn}
                  confirm={
                    hook
                      ? "Make a new address? The old one stops working now."
                      : undefined
                  }
                  reveal="Your intent address. Copy it now: it won't be shown again."
                  note={`POST { "signals": [ { "company_domain": "acme.com", "provider": "g2", "signal_type": "pricing", "topic": "CRM software", "seen_on": "2026-11-20" } ] } to it from your own tool, up to 500 a request.`}
                />
              ) : (
                <p className={hint}>An owner or admin can make the address.</p>
              )}
              {hook && admin && (
                <ActionForm
                  action={disconnectIntent}
                  confirm="Switch the address off? It stops accepting signals."
                >
                  <input type="hidden" name="kind" value="webhook" />
                  <SubmitButton variant="ghost" small>
                    Switch off
                  </SubmitButton>
                </ActionForm>
              )}
            </div>

            <div className="space-y-2 border-t border-black/[0.06] pt-3">
              <p className="font-medium">3. Connect G2</p>
              {g2 ? (
                <>
                  <p
                    className={g2.status === "error" ? "text-[#B42318]" : hint}
                  >
                    {g2.status === "error"
                      ? `G2 refused the token: ${g2.status_reason}`
                      : g2.last_import_at
                        ? `Connected. Last pulled ${agoWords(g2.last_import_at)}, ${g2.last_import_count} new.`
                        : "Connected. The first pull is within the hour."}
                    {g2.status === "active" &&
                      g2.last_error &&
                      ` Last problem: ${g2.last_error}`}
                  </p>
                  {admin && (
                    <ActionForm
                      action={disconnectIntent}
                      confirm="Disconnect G2? Dialvo deletes the token."
                    >
                      <input type="hidden" name="kind" value="g2" />
                      <SubmitButton variant="ghost" small>
                        Disconnect
                      </SubmitButton>
                    </ActionForm>
                  )}
                </>
              ) : admin ? (
                <ActionForm
                  action={connectG2}
                  resetOnSuccess
                  className="space-y-2"
                >
                  <input
                    name="token"
                    type="password"
                    autoComplete="off"
                    required
                    maxLength={500}
                    placeholder="Your G2 API token"
                    disabled={!serverOn}
                    className={input}
                  />
                  <SubmitButton
                    small
                    disabled={!serverOn}
                    pendingText="Checking…"
                  >
                    Connect
                  </SubmitButton>
                </ActionForm>
              ) : null}
              <p className={hint}>
                Make the token in my.G2, Integrations, API Tokens. G2 only gives
                Buyer Intent to plans that include it; Dialvo checks the token
                before saving it and pulls once a day.
              </p>
            </div>
          </div>
        </section>
      </div>

      <section className={cn(panel, "min-w-0")}>
        <h2 className={panelHead}>
          Researching your category
          <span className="text-[11.5px] font-normal text-[#0B0B0C]/50">
            {fresh.length} new
          </span>
        </h2>
        {fresh.length === 0 ? (
          <Empty icon={Star} title="No review-site intent yet">
            Import an export, send signals to your address, or connect G2.
            Companies you already have or never contact are set aside.
          </Empty>
        ) : (
          <>
            <ul className="divide-y divide-black/[0.06]">
              {fresh.map((s) => (
                <li
                  key={s.id}
                  className="flex items-start gap-3 px-4 py-2.5 text-[13px]"
                >
                  <input
                    type="checkbox"
                    name="signal"
                    value={s.id}
                    form="keep-intent"
                    aria-label={`Choose ${s.company_name || s.company_domain}`}
                    className="mt-1 size-3.5 accent-[#0B0B0C]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">
                      {s.company_name || s.company_domain}
                    </span>{" "}
                    <span className="text-[12px] text-[#0B0B0C]/55">
                      {s.company_domain}
                    </span>
                    <span className="block text-[12px] text-[#0B0B0C]/70">
                      {TYPE[s.signal_type] ?? "Researched"}
                      {s.topic && `: ${s.topic}`}
                      {` on ${PROVIDER[s.provider] ?? "a review site"}`}
                    </span>
                    <span className="block text-[11.5px] text-[#0B0B0C]/50">
                      {s.seen_on}
                      {s.activity !== null && ` · activity ${s.activity}`}
                      {[s.company_industry, s.company_size, s.company_country]
                        .filter(Boolean)
                        .map((x) => ` · ${x}`)
                        .join("")}
                    </span>
                  </span>
                  {s.signal_type === "pricing" && (
                    <Badge tone="blue">Pricing</Badge>
                  )}
                  <ActionForm action={dismissIntent} quiet>
                    <input type="hidden" name="signal" value={s.id} />
                    <SubmitButton variant="ghost" small pendingText="…">
                      Dismiss
                    </SubmitButton>
                  </ActionForm>
                </li>
              ))}
            </ul>
            <ActionForm
              id="keep-intent"
              action={keepIntent}
              className="space-y-2 border-t border-black/[0.06] p-4"
            >
              <SubmitButton disabled={!keepOn} pendingText="Starting…">
                Keep and find a contact
              </SubmitButton>
              <p className={hint}>
                {keepOn
                  ? "For the companies you tick: Dialvo finds a named person at each in the contact database (about 2 credits a company) and drafts a first email that waits for your approval. The email never mentions the review site."
                  : "Needs the contact database, which isn't switched on yet on Dialvo's side."}
              </p>
            </ActionForm>
          </>
        )}
        {decided.length > 0 && (
          <ul className="divide-y divide-black/[0.06] border-t border-black/[0.06]">
            {decided.map((s) => (
              <li
                key={s.id}
                className="flex items-center gap-3 px-4 py-2 text-[12.5px]"
              >
                <span className="min-w-0 flex-1 truncate text-[#0B0B0C]/70">
                  {s.company_name || s.company_domain}:{" "}
                  {TYPE[s.signal_type] ?? "Researched"}
                </span>
                <Badge tone={s.status === "queued" ? "ink" : "outline"}>
                  {STATUS[s.status] ?? s.status}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
