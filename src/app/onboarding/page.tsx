import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { listWorkspaces } from "@/lib/app/context";
import { requireUser } from "@/lib/auth/user";
import { APP_CONFIGURED } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { AuthFrame, SetupNotice } from "../(auth)/frame";
import { siteViewport } from "../_site/theme";
import { AcceptInvitation, WorkspaceForm } from "./form";

export const viewport = siteViewport;
export const metadata: Metadata = {
  title: "Set up your workspace",
  robots: { index: false, follow: false },
};

type Invite = { id: string; workspace_name: string; role: string };

function timezones(): string[] {
  const all = Intl.supportedValuesOf("timeZone");
  return all.includes("UTC") ? all : ["UTC", ...all];
}

async function Onboarding({
  searchParams,
}: {
  searchParams: PageProps<"/onboarding">["searchParams"];
}) {
  const user = await requireUser("/onboarding");
  const supabase = await createClient();
  const [workspaces, invites, params] = await Promise.all([
    listWorkspaces(supabase, user.id),
    supabase.rpc("my_invitations"),
    searchParams,
  ]);
  // Someone who already has a workspace only comes here to add another.
  const adding = workspaces.length > 0;
  if (adding && params.new === undefined) redirect("/app");
  const pending = (invites.data ?? []) as Invite[];

  return (
    <AuthFrame
      title={adding ? "New workspace" : "Set up your workspace"}
      intro={
        adding
          ? "A separate workspace for another client or brand, with its own leads, agents and knowledge."
          : "Four questions, then you're in. Your agents start switched off."
      }
    >
      {pending.length > 0 && (
        <div className="mb-6 space-y-2">
          {pending.map((i) => (
            <AcceptInvitation
              key={i.id}
              id={i.id}
              workspace={i.workspace_name}
              role={i.role}
            />
          ))}
          <p className="pt-3 text-center text-[12.5px] text-[#0B0B0C]/50">
            Or create a workspace of your own:
          </p>
        </div>
      )}
      <WorkspaceForm timezones={timezones()} />
    </AuthFrame>
  );
}

export default function OnboardingPage({
  searchParams,
}: PageProps<"/onboarding">) {
  if (!APP_CONFIGURED) return <SetupNotice />;
  return (
    <Suspense
      fallback={<AuthFrame title="Set up your workspace">{null}</AuthFrame>}
    >
      <Onboarding searchParams={searchParams} />
    </Suspense>
  );
}
