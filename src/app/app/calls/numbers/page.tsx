import type { Metadata } from "next";
import { Suspense } from "react";
import { Phone } from "lucide-react";
import { getAppContext } from "@/lib/app/context";
import { dateOnly } from "@/lib/app/time";
import {
  BUYABLE_COUNTRIES,
  MAX_MONTHLY_PRICE_USD,
  MAX_NUMBERS_PER_WORKSPACE,
  phoneRuntime,
} from "@/lib/phone/config";
import { formatPrice, isBuyableCountry } from "@/lib/phone/numbers";
import {
  createTwilio,
  twilioCredentials,
  TwilioError,
  type AvailableNumber,
  type NumberPrice,
} from "@/lib/phone/twilio";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { ActionForm, SubmitButton } from "../../_ui/form";
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
} from "../../_ui/kit";
import { buyNumberAction, releaseNumberAction } from "../actions";
import { CallsTabs, daysAgo, SetupNotice } from "../ui";

export const metadata: Metadata = { title: "Phone numbers" };

// The workspace's numbers: buying (owner only, price shown first, capped),
// releasing, each number's own daily cap, and its health from real calls.

type NumberRow = {
  id: string;
  e164: string;
  country: string;
  monthly_price_micros: number | null;
  currency: string;
  bought_at: string;
};

async function Search({ country, area }: { country: string; area: string }) {
  const credentials = twilioCredentials();
  if (!credentials) return null;
  let found: AvailableNumber[] = [];
  let price: NumberPrice | null = null;
  let problem = "";
  try {
    const twilio = createTwilio(credentials);
    [found, price] = await Promise.all([
      twilio.searchNumbers(country, /^\d{3}$/.test(area) ? area : null),
      twilio.localNumberPrice(country),
    ]);
  } catch (error) {
    problem =
      error instanceof TwilioError
        ? error.message
        : "Twilio couldn't be reached.";
  }
  if (problem) return <p className="text-[13px] text-[#B42318]">{problem}</p>;
  if (!price)
    return (
      <p className="text-[13px] text-[#B42318]">
        Twilio&apos;s price couldn&apos;t be read, so nothing can be bought
        right now.
      </p>
    );
  const tooDear =
    price.currency !== "USD" || price.monthly > MAX_MONTHLY_PRICE_USD;
  if (!found.length)
    return (
      <p className={hint}>No numbers available there. Try another area code.</p>
    );
  return (
    <div className="space-y-2">
      <p className="text-[13px]">
        Each number costs{" "}
        <strong>{formatPrice(price.monthly, price.currency)} a month</strong>,
        charged by Twilio while you keep it, plus the per-minute and per-text
        prices below.
        {tooDear &&
          ` That is over the ${formatPrice(MAX_MONTHLY_PRICE_USD, "USD")} limit, so it can't be bought here.`}
      </p>
      <ul className="divide-y divide-black/[0.06] rounded-xl border border-black/[0.07]">
        {found.map((n) => (
          <li key={n.e164} className="px-3 py-2.5">
            <ActionForm
              action={buyNumberAction}
              className="flex flex-wrap items-center gap-3"
            >
              <input type="hidden" name="e164" value={n.e164} />
              <input type="hidden" name="country" value={country} />
              <input type="hidden" name="quoted" value={price.monthly} />
              <span className="min-w-36 text-[13px] font-medium tabular-nums">
                {n.friendlyName}
              </span>
              <span className="min-w-0 flex-1 text-[12px] text-[#0B0B0C]/55">
                {[n.locality, n.region].filter(Boolean).join(", ") || country}
                {!n.sms && " · no texting"}
              </span>
              <label className="flex items-center gap-1.5 text-[12px]">
                <input
                  type="checkbox"
                  name="confirm"
                  required
                  className="accent-[#0B0B0C]"
                  disabled={tooDear}
                />
                {formatPrice(price.monthly, price.currency)} a month
              </label>
              <SubmitButton
                small
                variant="secondary"
                disabled={tooDear}
                pendingText="Buying…"
              >
                Buy
              </SubmitButton>
            </ActionForm>
          </li>
        ))}
      </ul>
    </div>
  );
}

async function Content({
  searchParams,
}: {
  searchParams: PageProps<"/app/calls/numbers">["searchParams"];
}) {
  const { workspace, preview } = await getAppContext();
  const params = await searchParams;
  const owner = workspace.role === "owner";
  const head = (
    <PageHead
      title="Calls"
      note={`Your business's phone numbers. Calls and texts to them reach your agent. Dialvo never makes outbound calls from them. Up to ${MAX_NUMBERS_PER_WORKSPACE} per workspace.`}
    />
  );
  if (preview)
    return (
      <>
        {head}
        <CallsTabs current="numbers" />
        <section className={panel}>
          <Empty title="Not part of the design preview" />
        </section>
      </>
    );
  const supabase = await createClient();
  const since = daysAgo(7).toISOString();
  const [rows, calls] = await Promise.all([
    supabase
      .from("phone_numbers")
      .select("id, e164, country, monthly_price_micros, currency, bought_at")
      .eq("workspace_id", workspace.id)
      .eq("status", "active")
      .order("bought_at"),
    supabase
      .from("calls")
      .select(
        "phone_number_id, direction, status, duration_seconds, created_at, ended_at",
      )
      .eq("workspace_id", workspace.id)
      .eq("direction", "inbound")
      .gte("created_at", since)
      .not("phone_number_id", "is", null)
      .limit(5000),
  ]);
  const numbers = (rows.data ?? []) as NumberRow[];
  const log = (calls.data ?? []) as {
    phone_number_id: string;
    direction: string;
    status: string;
    duration_seconds: number | null;
    created_at: string;
    ended_at: string | null;
  }[];
  const runtime = phoneRuntime();
  const country = isBuyableCountry(params.country) ? params.country : "US";
  const area =
    typeof params.area === "string"
      ? params.area.replace(/\D/g, "").slice(0, 3)
      : "";
  const searching =
    owner &&
    runtime.on &&
    params.search === "1" &&
    numbers.length < MAX_NUMBERS_PER_WORKSPACE;

  return (
    <>
      {head}
      <CallsTabs current="numbers" />
      <SetupNotice prices />
      <section className={panel}>
        <h2 className={panelHead}>
          Your numbers
          <span className="text-[12px] font-normal text-[#0B0B0C]/50">
            {numbers.length} of {MAX_NUMBERS_PER_WORKSPACE}
          </span>
        </h2>
        {numbers.length === 0 ? (
          <Empty icon={Phone} title="No numbers yet">
            {owner
              ? "Find one below. The price is shown before you buy."
              : "The workspace's owner buys numbers."}
          </Empty>
        ) : (
          <ul className="divide-y divide-black/[0.06]">
            {numbers.map((n) => {
              const mine = log.filter((c) => c.phone_number_id === n.id);
              const today = mine.filter(
                (c) =>
                  new Date(c.created_at).toDateString() ===
                  new Date().toDateString(),
              ).length;
              const finished = mine.filter(
                (c) => c.status === "completed" && c.ended_at,
              ).length;
              return (
                <li key={n.id} className="space-y-3 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[15px] font-medium tabular-nums">
                      {n.e164}
                    </span>
                    <Badge>In use</Badge>
                    <span className="text-[12px] text-[#0B0B0C]/50">
                      Since {dateOnly(n.bought_at, workspace.timezone)}
                      {n.monthly_price_micros != null &&
                        ` · ${formatPrice(n.monthly_price_micros / 1_000_000, n.currency)} a month`}
                    </span>
                  </div>
                  <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-black/[0.07] bg-black/[0.07]">
                    {[
                      ["Incoming calls, 7 days", String(mine.length)],
                      ["Finished calls, 7 days", String(finished)],
                      ["Today", String(today)],
                    ].map(([label, value]) => (
                      <div key={label} className="bg-white px-3 py-2">
                        <dt className="text-[11.5px] text-[#0B0B0C]/50">
                          {label}
                        </dt>
                        <dd className="text-[14px] font-medium tabular-nums">
                          {value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  {owner && (
                    <ActionForm
                      action={releaseNumberAction}
                      confirm={`Release ${n.e164}? Calls and texts to it will stop reaching you, and Twilio may give it to someone else.`}
                    >
                      <input type="hidden" name="number" value={n.id} />
                      <SubmitButton
                        variant="danger"
                        small
                        pendingText="Releasing…"
                      >
                        Release this number
                      </SubmitButton>
                    </ActionForm>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {owner && numbers.length < MAX_NUMBERS_PER_WORKSPACE && (
        <section className={cn(panel, "mt-3")}>
          <h2 className={panelHead}>Get a number</h2>
          <div className="space-y-3 p-4">
            {!runtime.on ? (
              <p className={hint}>
                Buying numbers needs Twilio to be connected on Dialvo&apos;s
                side (see above).
              </p>
            ) : (
              <>
                <form
                  className="flex flex-wrap items-end gap-2"
                  action="/app/calls/numbers"
                >
                  <input type="hidden" name="search" value="1" />
                  <label>
                    <span className={labelCls}>Country</span>
                    <select
                      name="country"
                      defaultValue={country}
                      className={cn(input, "mt-1")}
                    >
                      {BUYABLE_COUNTRIES.map((c) => (
                        <option key={c} value={c}>
                          {c === "US" ? "United States" : "Canada"}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span className={labelCls}>Area code (optional)</span>
                    <input
                      name="area"
                      defaultValue={area}
                      inputMode="numeric"
                      maxLength={3}
                      placeholder="415"
                      className={cn(input, "mt-1 w-28")}
                    />
                  </label>
                  <button type="submit" className={cn(btn.secondary)}>
                    Find numbers
                  </button>
                </form>
                <p className={hint}>
                  Local numbers only, in the US and Canada; elsewhere Twilio
                  needs identity documents first. A local number is easy for the
                  people who call you to recognise.
                </p>
                {searching && (
                  <Suspense fallback={<p className={hint}>Asking Twilio…</p>}>
                    <Search country={country} area={area} />
                  </Suspense>
                )}
              </>
            )}
          </div>
        </section>
      )}
    </>
  );
}

export default function NumbersPage({
  searchParams,
}: PageProps<"/app/calls/numbers">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}
