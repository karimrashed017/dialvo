import { BadgeCheck } from "lucide-react";
import { MAX_TIERS } from "@/lib/prospects/contact-query";
import type { Prospect, ProspectSearch } from "@/lib/prospects/types";
import { cn } from "@/lib/utils";
import { ActionForm, SubmitButton } from "../_ui/form";
import { Badge, hint, labelCls } from "../_ui/kit";
import { rewriteSearchDetails, saveSearchDetails } from "./contact-actions";
import { field } from "./ui";

// What the contact database (Findymail) adds to "Find leads": the contact on
// a result, and the "Search details" a run asks the database for.

/**
 * Findymail's match score, in words. Its scale is 0 to 100; where the lines
 * fall is our own reading of it, not Findymail's.
 */
export function fitLabel(score: number | null): string | null {
  if (score === null) return null;
  if (score >= 80) return "Strong fit";
  if (score >= 60) return "Good fit";
  return "Possible fit";
}

/** Why a found company has no details from its own site. */
const SITE_NOTE: Record<string, string> = {
  robots_disallowed:
    "Their site asks not to be read, so nothing was taken from it.",
  unreadable: "Their site couldn't be read, so nothing was taken from it.",
  no_website: "No website of their own was found to read.",
};

/** The contact column of a result from the contact database. */
export function ContactCell({ p }: { p: Prospect }) {
  const fit = fitLabel(p.match_score);
  return (
    <div className="min-w-0 text-[12.5px] leading-[1.5]">
      {p.contact_name ? (
        <p className="text-[13.5px] font-medium">
          {p.contact_name}
          {p.contact_role && (
            <span className="block text-[12.5px] font-normal text-[#0B0B0C]/65">
              {p.contact_role}
            </span>
          )}
        </p>
      ) : (
        <p className="text-[#0B0B0C]/55">No named contact</p>
      )}
      {p.email && (
        <p className="mt-1 break-all">
          {p.email}
          {p.email_verified && (
            <Badge tone="ink" className="ml-1.5 align-middle">
              <BadgeCheck aria-hidden className="size-3" />
              Verified email
            </Badge>
          )}
        </p>
      )}
      <p className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {fit && <Badge tone="outline">{fit}</Badge>}
        <span className="text-[12px] text-[#0B0B0C]/50">
          {p.email_verified
            ? "Contact and email from Findymail"
            : "Company from Findymail"}
          {p.email && !p.email_verified && p.email_source_url
            ? "; email from their site"
            : ""}
        </span>
      </p>
      {p.phone && <p className="mt-1">{p.phone}</p>}
      {p.skip_reason && SITE_NOTE[p.skip_reason] && (
        <p className="mt-1 text-[12px] text-[#0B0B0C]/50">
          {SITE_NOTE[p.skip_reason]}
        </p>
      )}
    </div>
  );
}

/** One line about the company from the database, under its name. */
export function ContactCompanyLine({ p }: { p: Prospect }) {
  const parts = [
    p.size_range && `${p.size_range} staff`,
    p.industries.slice(0, 2).join(", "),
    !p.location && p.country,
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return (
    <p className="mt-0.5 text-[12px] text-[#0B0B0C]/50">{parts.join(" · ")}</p>
  );
}

/**
 * "Search details": the query and job titles the next run sends to the
 * contact database, written from the search, and editable.
 */
export function SearchDetails({
  search,
  stale,
}: {
  search: ProspectSearch;
  /** Written for an earlier version of the search. */
  stale: boolean;
}) {
  const tiers = Array.from(
    { length: MAX_TIERS },
    (_, i) => search.contact_titles[i]?.join(", ") ?? "",
  );
  return (
    <details className="group mt-3 rounded-xl border border-black/[0.08] px-3 py-2">
      <summary className="cursor-pointer list-none text-[12.5px] font-medium text-[#0B0B0C]/75 [&::-webkit-details-marker]:hidden">
        Search details
        <span className="ml-1.5 font-normal text-[#0B0B0C]/50">
          {search.contact_query
            ? "what the contact database is asked for"
            : "written when you save who you sell to"}
        </span>
      </summary>
      <div className="mt-2.5">
        <p className={hint}>
          Dialvo looks these companies up in Findymail&apos;s contact database
          and asks for one person at each, trying the job titles in order. If
          the search looks wrong, fix it here before you run it.
        </p>
        {stale && (
          <p className="mt-1.5 text-[12px] text-[#0B0B0C]/70">
            {search.contact_query_edited
              ? "You changed who you sell to after editing these. Check they still fit, or write them again."
              : "These were written for an earlier description. They'll be written again when you run it."}
          </p>
        )}
        <ActionForm action={saveSearchDetails} className="mt-2.5 space-y-2.5">
          <input type="hidden" name="search" value={search.id} />
          <label className="block">
            <span className={labelCls}>Companies to look for</span>
            <textarea
              name="contact_query"
              defaultValue={search.contact_query}
              rows={2}
              maxLength={500}
              className={cn(field, "mt-1 resize-y")}
            />
          </label>
          {tiers.map((value, i) => (
            <label key={i} className="block">
              <span className={labelCls}>
                {i === 0
                  ? "Job titles to ask for first"
                  : i === 1
                    ? "Then"
                    : "Then, if neither is there"}
              </span>
              <input
                name={`tier_${i + 1}`}
                defaultValue={value}
                maxLength={300}
                placeholder={i === 0 ? "Owner, Founder, CEO" : ""}
                className={cn(field, "mt-1")}
              />
            </label>
          ))}
          <p className={hint}>Separate titles with commas.</p>
          <div className="flex flex-wrap gap-2">
            <SubmitButton variant="secondary" small>
              Save search details
            </SubmitButton>
          </div>
        </ActionForm>
        <ActionForm action={rewriteSearchDetails} className="mt-2">
          <input type="hidden" name="search" value={search.id} />
          <SubmitButton variant="ghost" small pendingText="Writing…">
            Write them again from the description
          </SubmitButton>
        </ActionForm>
      </div>
    </details>
  );
}
