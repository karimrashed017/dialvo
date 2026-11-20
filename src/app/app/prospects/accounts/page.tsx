import type { Metadata } from "next";
import { Suspense } from "react";
import { getAppContext } from "@/lib/app/context";
import { createClient } from "@/lib/supabase/server";
import { PageHead, PageSkeleton, panel } from "../../_ui/kit";
import { CampaignView } from "../campaign-view";
import { FindTabs } from "../tabs";

export const metadata: Metadata = { title: "Target accounts" };

async function Content({
  searchParams,
}: {
  searchParams: PageProps<"/app/prospects/accounts">["searchParams"];
}) {
  const params = await searchParams;
  const { workspace, preview } = await getAppContext();
  const head = (
    <>
      <PageHead
        title="Find leads"
        note="Bring the companies you want to sell to. Dialvo finds a named decision-maker with an email at each, reads their site and drafts a first email for you to approve."
      />
      <FindTabs current="accounts" />
    </>
  );
  if (preview)
    return (
      <>
        {head}
        <section className={panel + " p-4 text-[13px]"}>
          This needs the real app. Nothing is shown here with made-up data.
        </section>
      </>
    );
  const supabase = await createClient();
  return (
    <>
      {head}
      <CampaignView
        kind="accounts"
        supabase={supabase}
        workspaceId={workspace.id}
        selected={typeof params.campaign === "string" ? params.campaign : null}
      />
    </>
  );
}

export default function Page({
  searchParams,
}: PageProps<"/app/prospects/accounts">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}
