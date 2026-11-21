import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Building2 } from "lucide-react";
import { getAppContext } from "@/lib/app/context";
import { ACCOUNTS_MAX } from "@/lib/data/config";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { ActionForm, SubmitButton } from "../_ui/form";
import {
  Badge,
  Empty,
  hint,
  input,
  labelCls,
  PageHead,
  PageSkeleton,
  panel,
  panelHead,
} from "../_ui/kit";
import { addAccount } from "./actions";

export const metadata: Metadata = { title: "Accounts" };

type Account = {
  id: string;
  domain: string;
  name: string;
  country: string;
  size_range: string;
  fit_score: number | null;
  owner_id: string | null;
  territory_id: string | null;
};

async function Content({
  searchParams,
}: {
  searchParams: PageProps<"/app/accounts">["searchParams"];
}) {
  const sp = await searchParams;
  const { workspace, preview, repo } = await getAppContext();
  const head = (
    <PageHead
      title="Accounts"
      note="The companies you target, each with everyone you know there: their leads, conversations and meetings in one place. Find a company's buying committee by job title, then start a playbook for the whole account."
    />
  );
  if (preview)
    return (
      <>
        {head}
        <section className={cn(panel, "p-4 text-[13px]")}>
          Accounts need the real app. Nothing is shown here with made-up data.
        </section>
      </>
    );
  const owner = typeof sp.owner === "string" ? sp.owner : "";
  const supabase = await createClient();
  let query = supabase
    .from("accounts")
    .select(
      "id, domain, name, country, size_range, fit_score, owner_id, territory_id",
    )
    .eq("workspace_id", workspace.id)
    .order("fit_score", { ascending: false, nullsFirst: false })
    .order("created_at")
    .limit(300);
  if (owner === "none") query = query.is("owner_id", null);
  else if (/^[0-9a-f-]{36}$/.test(owner)) query = query.eq("owner_id", owner);
  const [accountsRes, members, territoriesRes, listsRes, leadsRes] =
    await Promise.all([
      query,
      repo.members(),
      supabase
        .from("territories")
        .select("id, name")
        .eq("workspace_id", workspace.id),
      supabase
        .from("data_lists")
        .select("id, name")
        .eq("workspace_id", workspace.id)
        .eq("is_target", true)
        .is("archived_at", null),
      supabase
        .from("leads")
        .select("account_id")
        .eq("workspace_id", workspace.id)
        .not("account_id", "is", null)
        .limit(5000),
    ]);
  const accounts = (accountsRes.data ?? []) as Account[];
  const nameOf = new Map(members.map((m) => [m.user_id, m.name || m.email]));
  const territory = new Map(
    ((territoriesRes.data ?? []) as { id: string; name: string }[]).map((t) => [
      t.id,
      t.name,
    ]),
  );
  const people = new Map<string, number>();
  for (const l of (leadsRes.data ?? []) as { account_id: string }[])
    people.set(l.account_id, (people.get(l.account_id) ?? 0) + 1);
  const lists = (listsRes.data ?? []) as { id: string; name: string }[];
  return (
    <>
      {head}
      <form
        action="/app/accounts"
        className="mb-3 flex flex-wrap items-center gap-2"
      >
        <label>
          <span className="sr-only">Owner</span>
          <select
            name="owner"
            defaultValue={owner}
            className={cn(input, "h-9 w-auto rounded-full py-0 pr-8")}
          >
            <option value="">Anyone&apos;s</option>
            <option value="none">Nobody&apos;s yet</option>
            {members.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.name || m.email}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="h-9 rounded-full border border-black/15 px-4 text-[13px]"
        >
          Filter
        </button>
        <span className="ml-auto text-[12px] text-[#0B0B0C]/45 tabular-nums">
          {accounts.length} {accounts.length === 1 ? "account" : "accounts"}
        </span>
      </form>
      <div className="grid gap-3 lg:grid-cols-[1fr_340px]">
        <section className={cn(panel, "min-w-0 overflow-hidden")}>
          {accounts.length === 0 ? (
            <Empty icon={Building2} title="No accounts yet">
              Add one on the right, or press &quot;Make target accounts&quot; on
              a list of companies.
            </Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-[13px]">
                <thead className="border-b border-black/[0.06] text-[11.5px] text-[#0B0B0C]/50">
                  <tr>
                    {["Company", "Fit", "People", "Owner", "Territory"].map(
                      (h) => (
                        <th key={h} className="px-4 py-2.5 font-medium">
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/[0.045]">
                  {accounts.map((a) => (
                    <tr key={a.id} className="hover:bg-black/[0.02]">
                      <td className="px-4 py-2.5">
                        <Link
                          href={`/app/accounts/${a.id}`}
                          className="font-medium underline-offset-2 hover:underline"
                        >
                          {a.name || a.domain}
                        </Link>
                        <span className="block text-[12px] text-[#0B0B0C]/50">
                          {[a.domain, a.country, a.size_range]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 tabular-nums">
                        {a.fit_score ?? "–"}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums">
                        {people.get(a.id) ?? 0}
                      </td>
                      <td className="px-4 py-2.5 text-[12.5px]">
                        {a.owner_id ? (
                          (nameOf.get(a.owner_id) ?? "A teammate")
                        ) : (
                          <Badge tone="outline">Nobody</Badge>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-[12.5px] text-[#0B0B0C]/60">
                        {a.territory_id ? territory.get(a.territory_id) : "–"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <aside className="min-w-0 space-y-3">
          <section className={panel}>
            <h2 className={panelHead}>Add an account</h2>
            <ActionForm action={addAccount} className="space-y-3 p-4">
              <label className={labelCls}>
                Company website
                <input
                  name="domain"
                  required
                  maxLength={300}
                  placeholder="harborfitness.co.uk"
                  className={cn(input, "mt-1")}
                />
              </label>
              <label className={labelCls}>
                Name{" "}
                <span className="font-normal text-[#0B0B0C]/45">
                  (optional)
                </span>
                <input
                  name="name"
                  maxLength={200}
                  className={cn(input, "mt-1")}
                />
              </label>
              <SubmitButton small>Add</SubmitButton>
              <p className={hint}>
                Up to {ACCOUNTS_MAX.toLocaleString("en-GB")} accounts. Leads at
                that company are linked to it.
              </p>
            </ActionForm>
          </section>
          <section className={panel}>
            <h2 className={panelHead}>Target account lists</h2>
            {lists.length === 0 ? (
              <p className={cn(hint, "p-4")}>
                Make a list of companies on{" "}
                <Link href="/app/lists" className="underline">
                  Lists
                </Link>
                , then press &quot;Make target accounts&quot;.
              </p>
            ) : (
              <ul className="divide-y divide-black/[0.06]">
                {lists.map((l) => (
                  <li key={l.id}>
                    <Link
                      href={`/app/lists/${l.id}`}
                      className="block px-4 py-2.5 text-[13px] hover:bg-black/[0.02]"
                    >
                      {l.name}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className={panel}>
            <h2 className={panelHead}>Owners and territories</h2>
            <p className={cn(hint, "p-4")}>
              Give accounts to reps one by one here, or all at once by territory
              in{" "}
              <Link href="/app/settings/territories" className="underline">
                Territories
              </Link>
              . New leads at an owned account go to its owner.
            </p>
          </section>
        </aside>
      </div>
    </>
  );
}

export default function AccountsPage(props: PageProps<"/app/accounts">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content searchParams={props.searchParams} />
    </Suspense>
  );
}
