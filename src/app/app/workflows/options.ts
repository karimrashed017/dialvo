import "server-only";
import type { Repo } from "@/lib/app/repo";
import type { Supabase } from "@/lib/supabase/server";
import type { BuilderOptions } from "./builder";

// What the builder can pick from: teammates, running plays on leads, active
// webhook endpoints, and whether Slack is connected. Read as the signed-in
// person (row-level security applies).
export async function builderOptions(
  supabase: Supabase,
  repo: Repo,
  workspaceId: string,
): Promise<BuilderOptions> {
  const [members, plays, endpoints, slack] = await Promise.all([
    repo.members(),
    supabase
      .from("outbound_campaigns")
      .select("id, name, kind")
      .eq("workspace_id", workspaceId)
      .eq("status", "active")
      .not("kind", "in", "(accounts,lookalike,signals)")
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("webhook_endpoints")
      .select("id, url, description")
      .eq("workspace_id", workspaceId)
      .eq("status", "active")
      .limit(10),
    supabase
      .from("slack_connections")
      .select("status")
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
  ]);
  return {
    members: members.map((m) => ({ id: m.user_id, name: m.name || m.email })),
    plays: ((plays.data ?? []) as { id: string; name: string }[]).map((p) => ({
      id: p.id,
      name: p.name,
    })),
    endpoints: (
      (endpoints.data ?? []) as {
        id: string;
        url: string;
        description: string;
      }[]
    ).map((e) => ({
      id: e.id,
      label: e.description || e.url,
    })),
    slack: (slack.data as { status?: string } | null)?.status === "active",
  };
}
