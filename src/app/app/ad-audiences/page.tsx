import type { Metadata } from "next";
import { Suspense } from "react";
import { Download, Megaphone } from "lucide-react";
import { getAppContext } from "@/lib/app/context";
import { agoWords } from "@/lib/app/time";
import {
  AUDIENCE_EXPORT_MAX_ROWS,
  AUDIENCES_MAX,
} from "@/lib/audiences/config";
import { FORMATS, type Format } from "@/lib/audiences/formats";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
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
import { deleteAudience, saveAudience } from "./actions";

export const metadata: Metadata = { title: "Ad audiences" };

type AudienceRow = {
  id: string;
  name: string;
  kind: "contacts" | "companies" | "suppression";
  filters: Record<string, unknown>;
  last_exported_at: string | null;
  last_export_rows: number | null;
  created_at: string;
};

const KIND: Record<string, string> = {
  contacts: "People",
  companies: "Companies",
  suppression: "Suppression list",
};

function describe(a: AudienceRow): string {
  const f = a.filters;
  if (a.kind === "suppression")
    return f.preset === "customers"
      ? "Your customers (leads marked won)"
      : "Do not contact and unsubscribed";
  const parts: string[] = [];
  if (Array.isArray(f.statuses))
    parts.push(
      `at ${(f.statuses as string[]).join(" or ").replace(/_/g, " ")}`,
    );
  if (Array.isArray(f.sources))
    parts.push(`from ${(f.sources as string[]).join(" or ")}`);
  if (Array.isArray(f.countries))
    parts.push(`in ${(f.countries as string[]).join(" or ")}`);
  if (f.added_within_days)
    parts.push(`added in the last ${String(f.added_within_days)} days`);
  if (f.campaign_id) parts.push("in one play");
  if (f.owner_id) parts.push("of one owner");
  if (f.include_customers) parts.push("customers included");
  return parts.length
    ? `Leads ${parts.join(", ")}`
    : "Every lead you may contact";
}

async function Content() {
  const { workspace, repo, preview } = await getAppContext();
  const head = (
    <PageHead
      title="Ad audiences"
      note="Turn your leads into audiences for ads: download them in the file LinkedIn, Meta and Google Ads take for a customer list, with emails hashed (SHA-256) where the platform accepts it. Suppression lists keep customers and people who opted out out of your ads."
    />
  );
  if (preview)
    return (
      <>
        {head}
        <section className={panel}>
          <Empty icon={Megaphone} title="Not part of the design preview" />
        </section>
      </>
    );
  const supabase = await createClient();
  const [audiences, plays, members, exports] = await Promise.all([
    supabase
      .from("ad_audiences")
      .select(
        "id, name, kind, filters, last_exported_at, last_export_rows, created_at",
      )
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("outbound_campaigns")
      .select("id, name")
      .eq("workspace_id", workspace.id)
      .not("kind", "in", "(accounts,lookalike,signals)")
      .order("created_at", { ascending: false })
      .limit(30),
    repo.members(),
    supabase
      .from("ad_audience_exports")
      .select(
        "id, format, hashed, rows, created_at, audience:ad_audiences(name)",
      )
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);
  const list = (audiences.data ?? []) as AudienceRow[];

  return (
    <>
      {head}
      <p
        role="note"
        className="mb-3 rounded-xl border border-black/15 bg-white px-4 py-2.5 text-[13px] leading-[1.5]"
      >
        Dialvo doesn&apos;t send audiences to ad platforms itself: syncing
        directly needs each platform&apos;s partner approval, which Dialvo
        doesn&apos;t have yet. Download a file here and upload it in the
        platform (LinkedIn Campaign Manager, Meta Ads Manager, Google Ads,
        Audience manager). Only upload people your privacy policy allows you to
        use for advertising.
      </p>
      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-3">
          <section className={panel}>
            <h2 className={panelHead}>
              Audiences
              <span className="text-[11.5px] font-normal text-[#0B0B0C]/50">
                {list.length} of {AUDIENCES_MAX}
              </span>
            </h2>
            {list.length === 0 ? (
              <Empty icon={Megaphone} title="No audiences yet">
                Make one on the right: for example qualified leads in the UK, or
                your customers as a suppression list.
              </Empty>
            ) : (
              <ul className="divide-y divide-black/[0.06]">
                {list.map((a) => {
                  const formats = (Object.keys(FORMATS) as Format[]).filter(
                    (f) =>
                      (FORMATS[f].kinds as readonly string[]).includes(a.kind),
                  );
                  return (
                    <li key={a.id} className="space-y-2 px-4 py-3 text-[13px]">
                      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium">{a.name}</span>
                          <span className="block text-[12.5px] text-[#0B0B0C]/60">
                            {describe(a)}
                          </span>
                          {a.last_exported_at && (
                            <span className="block text-[11.5px] text-[#0B0B0C]/40">
                              Last downloaded {agoWords(a.last_exported_at)}:{" "}
                              {a.last_export_rows ?? 0} rows
                            </span>
                          )}
                        </span>
                        <Badge tone="outline">{KIND[a.kind]}</Badge>
                        <ActionForm
                          action={deleteAudience}
                          confirm="Delete this audience? Files already downloaded aren't affected."
                          quiet
                        >
                          <input type="hidden" name="audience" value={a.id} />
                          <SubmitButton small variant="ghost" pendingText="…">
                            Delete
                          </SubmitButton>
                        </ActionForm>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {formats.map((f) => (
                          <a
                            key={f}
                            href={`/app/ad-audiences/${a.id}/export?format=${f}${FORMATS[f].hashable ? "&hashed=1" : ""}`}
                            className={cn(btn.secondary, btn.small)}
                            download
                          >
                            <Download aria-hidden className="size-3.5" />
                            {FORMATS[f].label}
                            {FORMATS[f].hashable && " (hashed)"}
                          </a>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
          <section className={panel}>
            <h2 className={panelHead}>What each file is</h2>
            <ul className="list-disc space-y-1.5 py-3 pr-4 pl-8 text-[12.5px] leading-[1.5] text-[#0B0B0C]/70">
              <li>
                LinkedIn contact list: LinkedIn&apos;s template columns; the
                email is SHA-256 hashed (the only column LinkedIn takes hashed),
                names, job title, company and country help it match. LinkedIn
                needs at least 300 rows and matches only work emails well.
              </li>
              <li>
                LinkedIn company list: company name, website, email domain,
                LinkedIn page when known, and country. At least 300 companies.
              </li>
              <li>
                Meta customer list: email, phone, first and last name and
                country, each normalised the way Meta asks and SHA-256 hashed.
                Phones without a country code are left out.
              </li>
              <li>
                Google Ads Customer Match: Google&apos;s combined template
                (Email, Phone, First Name, Last Name, Country, Zip); email,
                phone and names hashed with SHA-256 after Google&apos;s
                normalising (gmail.com addresses without dots), country never
                hashed. Dialvo doesn&apos;t hold post codes, so Zip is empty.
              </li>
              <li>
                Plain CSV: names, emails, company and country in clear text, for
                any other tool.
              </li>
            </ul>
            <p className={cn(hint, "px-4 pb-4")}>
              Check each platform&apos;s current template before a first upload:
              they change. Every download is recorded below. Up to{" "}
              {AUDIENCE_EXPORT_MAX_ROWS.toLocaleString("en-US")} rows a file.
            </p>
          </section>
          {(exports.data ?? []).length > 0 && (
            <section className={panel}>
              <h2 className={panelHead}>Downloads</h2>
              <ul className="divide-y divide-black/[0.06]">
                {(
                  exports.data as unknown as {
                    id: string;
                    format: Format;
                    hashed: boolean;
                    rows: number;
                    created_at: string;
                    audience: { name: string } | null;
                  }[]
                ).map((e) => (
                  <li
                    key={e.id}
                    className="flex flex-wrap items-center gap-x-3 px-4 py-2 text-[12.5px]"
                  >
                    <span className="min-w-0 flex-1">
                      {e.audience?.name ?? "An audience"}:{" "}
                      {FORMATS[e.format]?.label ?? e.format}
                      {e.hashed ? ", hashed" : ""}
                    </span>
                    <span className="text-[#0B0B0C]/50">
                      {e.rows} rows · {agoWords(e.created_at)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
        <section className={panel}>
          <h2 className={panelHead}>New audience</h2>
          <ActionForm
            action={saveAudience}
            resetOnSuccess
            className="space-y-3 p-4 text-[13px]"
          >
            <label className={labelCls}>
              Name
              <input
                name="name"
                required
                maxLength={80}
                placeholder="Qualified leads, UK"
                className={cn(input, "mt-1")}
              />
            </label>
            <label className={labelCls}>
              It holds
              <select
                name="kind"
                defaultValue="contacts"
                className={cn(input, "mt-1")}
              >
                <option value="contacts">People (for contact lists)</option>
                <option value="companies">Companies (for company lists)</option>
                <option value="suppression">A suppression list</option>
              </select>
            </label>
            <fieldset className="space-y-1">
              <legend className={labelCls}>Stages (none ticked: any)</legend>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {(
                  [
                    "new",
                    "engaged",
                    "qualified",
                    "meeting_booked",
                    "won",
                    "lost",
                  ] as const
                ).map((s) => (
                  <label
                    key={s}
                    className="flex items-center gap-1.5 text-[12.5px]"
                  >
                    <input
                      type="checkbox"
                      name="statuses"
                      value={s}
                      className="accent-[#0B0B0C]"
                    />
                    {s.replace("_", " ")}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className={labelCls}>
              Sources{" "}
              <span className="font-normal text-[#0B0B0C]/45">
                (comma separated, e.g. form, chat, import)
              </span>
              <input
                name="sources"
                maxLength={300}
                className={cn(input, "mt-1")}
              />
            </label>
            <label className={labelCls}>
              Countries{" "}
              <span className="font-normal text-[#0B0B0C]/45">
                (e.g. United Kingdom, DE)
              </span>
              <input
                name="countries"
                maxLength={300}
                className={cn(input, "mt-1")}
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className={labelCls}>
                Added in the last
                <select
                  name="added_within_days"
                  defaultValue=""
                  className={cn(input, "mt-1")}
                >
                  <option value="">Any time</option>
                  <option value="30">30 days</option>
                  <option value="90">90 days</option>
                  <option value="365">Year</option>
                </select>
              </label>
              <label className={labelCls}>
                Owner
                <select
                  name="owner_id"
                  defaultValue=""
                  className={cn(input, "mt-1")}
                >
                  <option value="">Anyone</option>
                  {members.map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {m.name || m.email}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className={labelCls}>
              In a play
              <select
                name="campaign_id"
                defaultValue=""
                className={cn(input, "mt-1")}
              >
                <option value="">Any</option>
                {((plays.data ?? []) as { id: string; name: string }[]).map(
                  (p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="include_customers"
                className="accent-[#0B0B0C]"
              />
              Include customers (leads marked won)
            </label>
            <label className={labelCls}>
              Suppression list of
              <select
                name="preset"
                defaultValue="do_not_contact"
                className={cn(input, "mt-1")}
              >
                <option value="do_not_contact">
                  Do not contact and unsubscribed
                </option>
                <option value="customers">Customers (won)</option>
              </select>
              <span className={cn(hint, "mt-1 block font-normal")}>
                Used only when it holds a suppression list; the filters above
                are then ignored.
              </span>
            </label>
            <SubmitButton small>Save audience</SubmitButton>
            <p className={hint}>
              People marked do not contact, unsubscribed or on your
              never-contact list are never in a people or company audience.
              Upload a suppression list as an excluded audience in the platform.
            </p>
          </ActionForm>
        </section>
      </div>
    </>
  );
}

export default function AdAudiencesPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content />
    </Suspense>
  );
}
