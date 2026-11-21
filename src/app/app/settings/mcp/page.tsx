import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft, Plug } from "lucide-react";
import { getAppContext } from "@/lib/app/context";
import { agoWords } from "@/lib/app/time";
import { requestOrigin } from "@/lib/auth/origin";
import { MCP_CALLS_PER_MINUTE } from "@/lib/mcp/config";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
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
import { createScopedKey, revokeOwnKey } from "./actions";
import { SecretOnce } from "./secret-once";

export const metadata: Metadata = { title: "Assistants (MCP)" };

type KeyRow = {
  id: string;
  name: string;
  key_prefix: string;
  scope: string;
  user_id: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

const TOOLS: [string, string, "read" | "write"][] = [
  ["search_leads", "Find leads by name, email or company, at a stage", "read"],
  [
    "get_lead",
    "A lead with its company research, messages, calls, meetings, notes and brief",
    "read",
  ],
  ["list_plays", "The workspace's plays, with their ids", "read"],
  [
    "list_meetings",
    "Meetings in a time range (yours, with a personal key)",
    "read",
  ],
  [
    "get_account_brief",
    "The latest account brief; with make=true, asks for one (write)",
    "read",
  ],
  ["add_lead", "Adds a lead (a personal key makes you its owner)", "write"],
  [
    "add_lead_to_play",
    "Puts a lead in a running play; its email waits for approval",
    "write",
  ],
  [
    "find_contacts",
    "People and work emails at a company, from the contact database (spends credits)",
    "write",
  ],
];

function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-xl bg-black/[0.05] p-3 text-[12px] leading-[1.5]">
      <code>{children}</code>
    </pre>
  );
}

async function Content() {
  const { workspace, user, preview } = await getAppContext();
  const admin = workspace.role !== "member";
  const head = (
    <PageHead
      title="Assistants (MCP)"
      note="Let your own AI assistant work in Dialvo: search leads, read a lead's history and brief, list meetings, add leads, add them to a play and find contacts, from Claude or any app that speaks the Model Context Protocol."
    >
      <Link href="/app/settings" className={cn(btn.ghost, btn.small)}>
        <ArrowLeft aria-hidden className="size-3.5" />
        Settings
      </Link>
    </PageHead>
  );
  if (preview)
    return (
      <>
        {head}
        <section className={panel}>
          <Empty icon={Plug} title="Not part of the design preview" />
        </section>
      </>
    );
  const supabase = await createClient();
  const { data } = await supabase
    .from("workspace_api_keys")
    .select(
      "id, name, key_prefix, scope, user_id, created_at, last_used_at, revoked_at",
    )
    .eq("workspace_id", workspace.id)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(40);
  const keys = (data ?? []) as KeyRow[];
  const mine = keys.filter((k) => k.user_id === user.id);
  const team = keys.filter((k) => k.user_id === null);
  const url = `${await requestOrigin()}/api/mcp`;
  const on = Boolean(createServiceClient());

  const keyList = (list: KeyRow[], canRevoke: boolean) =>
    list.length === 0 ? (
      <p className={cn(hint, "px-4 pb-4")}>None yet.</p>
    ) : (
      <ul className="divide-y divide-black/[0.06] border-t border-black/[0.06]">
        {list.map((k) => (
          <li
            key={k.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-[13px]"
          >
            <span className="min-w-0 flex-1">
              <span className="font-medium">{k.name}</span>{" "}
              <code className="text-[12px] text-[#0B0B0C]/55">
                {k.key_prefix}…
              </code>
              <span className="block text-[11.5px] text-[#0B0B0C]/50">
                Made {agoWords(k.created_at)}
                {k.last_used_at
                  ? `, last used ${agoWords(k.last_used_at)}`
                  : ", not used yet"}
              </span>
            </span>
            <Badge tone={k.scope === "write" ? "ink" : "outline"}>
              {k.scope === "write" ? "Read and write" : "Read only"}
            </Badge>
            {canRevoke && (
              <ActionForm
                action={revokeOwnKey}
                confirm="Revoke this key? Assistants using it stop working."
              >
                <input type="hidden" name="key" value={k.id} />
                <SubmitButton variant="ghost" small pendingText="Revoking…">
                  Revoke
                </SubmitButton>
              </ActionForm>
            )}
          </li>
        ))}
      </ul>
    );

  const maker = (owner: "me" | "workspace") => (
    <div className="p-4">
      <SecretOnce
        action={createScopedKey}
        submit="Make a key"
        disabled={!on}
        note="Keep it in your assistant's settings only. Anyone with it can do what the key allows in this workspace."
      >
        <input type="hidden" name="owner" value={owner} />
        <label className={cn(labelCls, "min-w-[160px] flex-1")}>
          Name
          <input
            name="name"
            maxLength={80}
            placeholder={owner === "me" ? "My Claude" : "Team assistant"}
            className={cn(input, "mt-1")}
          />
        </label>
        <label className={labelCls}>
          Access
          <select
            name="scope"
            defaultValue="read"
            className={cn(input, "mt-1")}
          >
            <option value="read">Read only</option>
            <option value="write">Read and write</option>
          </select>
        </label>
      </SecretOnce>
    </div>
  );

  return (
    <>
      {head}
      <div className="grid items-start gap-3 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-3">
          <section className={panel}>
            <h2 className={panelHead}>Your keys</h2>
            <p className={cn(hint, "px-4 pt-3")}>
              A personal key acts as you: leads it adds are yours, and &quot;my
              meetings&quot; are yours. It stops working if you leave the
              workspace. At most three.
            </p>
            {maker("me")}
            {keyList(mine, true)}
          </section>
          {admin && (
            <section className={panel}>
              <h2 className={panelHead}>Workspace keys</h2>
              <p className={cn(hint, "px-4 pt-3")}>
                For a shared assistant. They are the same keys as the
                API&apos;s: at most three, and a read-only key is refused by
                every API call that changes something.
              </p>
              {maker("workspace")}
              {keyList(team, true)}
            </section>
          )}
          <section className={panel}>
            <h2 className={panelHead}>What it can do</h2>
            <ul className="divide-y divide-black/[0.06]">
              {TOOLS.map(([name, what, scope]) => (
                <li
                  key={name}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-[13px]"
                >
                  <code className="text-[12.5px]">{name}</code>
                  <span className="min-w-0 flex-1 text-[#0B0B0C]/65">
                    {what}
                  </span>
                  <Badge tone={scope === "write" ? "plain" : "outline"}>
                    {scope === "write" ? "Needs write" : "Read"}
                  </Badge>
                </li>
              ))}
            </ul>
            <p className={cn(hint, "p-4")}>
              Nothing an assistant does sends an email: a lead added to a play
              gets a first email that waits for approval here. At most{" "}
              {MCP_CALLS_PER_MINUTE} calls a minute per key. Contact lookups use
              the workspace&apos;s daily allowance.
            </p>
          </section>
        </div>
        <section className={panel}>
          <h2 className={panelHead}>Connect your assistant</h2>
          <div className="space-y-4 p-4 text-[13px] leading-[1.5]">
            <div>
              <p className={labelCls}>The server</p>
              <Code>{url}</Code>
              <p className={hint}>
                Streamable HTTP (MCP 2025-11-25 and 2025-06-18), with the header
                Authorization: Bearer followed by your key. Replace
                dv_live_YOUR_KEY below with it.
              </p>
            </div>
            <div>
              <p className={labelCls}>Claude Code</p>
              <Code>{`claude mcp add --transport http dialvo ${url} \\\n  --header "Authorization: Bearer dv_live_YOUR_KEY"`}</Code>
            </div>
            <div>
              <p className={labelCls}>
                Claude Desktop (claude_desktop_config.json)
              </p>
              <Code>
                {JSON.stringify(
                  {
                    mcpServers: {
                      dialvo: {
                        command: "npx",
                        args: [
                          "-y",
                          "mcp-remote",
                          url,
                          "--header",
                          "Authorization:${DIALVO_AUTH}",
                        ],
                        env: { DIALVO_AUTH: "Bearer dv_live_YOUR_KEY" },
                      },
                    },
                  },
                  null,
                  2,
                )}
              </Code>
              <p className={hint}>
                Needs Node.js on your computer. Restart Claude Desktop after
                saving.
              </p>
            </div>
            <div>
              <p className={labelCls}>
                Cursor (.cursor/mcp.json) and other clients that take a URL and
                headers
              </p>
              <Code>
                {JSON.stringify(
                  {
                    mcpServers: {
                      dialvo: {
                        url,
                        headers: { Authorization: "Bearer dv_live_YOUR_KEY" },
                      },
                    },
                  },
                  null,
                  2,
                )}
              </Code>
            </div>
            <div>
              <p className={labelCls}>VS Code (.vscode/mcp.json)</p>
              <Code>
                {JSON.stringify(
                  {
                    servers: {
                      dialvo: {
                        type: "http",
                        url,
                        headers: { Authorization: "Bearer dv_live_YOUR_KEY" },
                      },
                    },
                  },
                  null,
                  2,
                )}
              </Code>
            </div>
            <p className={hint}>
              Connectors added in a browser (for example claude.ai&apos;s custom
              connectors) sign in with OAuth, which Dialvo doesn&apos;t offer
              yet; use one of the apps above. Try a first question such as
              &quot;Who are my meetings with this week, and what should I know
              before each?&quot;
            </p>
          </div>
        </section>
      </div>
    </>
  );
}

export default function McpPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content />
    </Suspense>
  );
}
