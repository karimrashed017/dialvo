import type { Metadata } from "next";
import { Suspense } from "react";
import { getAppContext } from "@/lib/app/context";
import { createClient } from "@/lib/supabase/server";
import { PageHead, PageSkeleton, panel } from "../../_ui/kit";
import { CampaignView } from "../campaign-view";
import { FindTabs } from "../tabs";

export const metadata: Metadata = { title: "Lookalike" };

async function Content({
  searchParams,
}: {
  searchParams: PageProps<"/app/prospects/lookalike">["searchParams"];
}) {
  const params = await searchParams;
  const { workspace, preview } = await getAppContext();
  const head = (
    <>
      <PageHead
        title="Find leads"
        note="Give a few of your best customers. Dialvo finds companies like them, a named person and an email at each, and drafts a first email for you to approve."
      />
      <FindTabs current="lookalike" />
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
        kind="lookalike"
        supabase={supabase}
        workspaceId={workspace.id}
        selected={typeof params.campaign === "string" ? params.campaign : null}
      />
    </>
  );
}

export default function Page({
  searchParams,
}: PageProps<"/app/prospects/lookalike">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}
