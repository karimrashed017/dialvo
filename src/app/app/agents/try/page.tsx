import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { agentRuntimeStatus } from "@/lib/agents/config";
import { getAppContext } from "@/lib/app/context";
import { trialState } from "@/lib/billing/trial";
import { cn } from "@/lib/utils";
import { Badge, btn, hint, PageHead, PageSkeleton, panel } from "../../_ui/kit";
import { TryChat } from "./try-chat";

export const metadata: Metadata = { title: "Try your agent" };

async function Try() {
  const { repo, workspace } = await getAppContext();
  const [agents, knowledge, history, widgets] = await Promise.all([
    repo.agents(),
    repo.knowledge(),
    repo.testChat(),
    repo.chatWidgets(),
  ]);
  const agent = agents.find(
    (a) => a.role === "inbound" && a.channel === "chat",
  );
  const runtime = agentRuntimeStatus().on;
  const locked = trialState(workspace).locked;
  const ready = knowledge.filter(
    (k) => k.status === "ready" && (k.kind === "text" || k.source_url),
  ).length;

  // Why the agent can't answer here, in the order a person can fix them.
  const disabled = !agent
    ? "This workspace has no inbound agent on the Chat channel. Set one up on the Agents page."
    : !runtime
      ? "The agent isn't switched on yet on Dialvo's side, so it can't answer here yet. Everything else is ready: your knowledge and instructions are saved."
      : locked
        ? "Your free trial has ended, so your agent has stopped replying. Pick a plan to switch it back on."
        : null;

  return (
    <>
      <PageHead
        title="Try your agent"
        note="Talk to your inbound agent the way a visitor would. It answers with your real knowledge and instructions. Test chats are not leads, and they don't show in your Inbox or on Today."
      >
        <Link href="/app/agents" className={cn(btn.secondary, btn.small)}>
          <ArrowLeft aria-hidden className="size-3.5" />
          Agents
        </Link>
      </PageHead>
      <div className="grid items-start gap-3 lg:grid-cols-[1.6fr_1fr]">
        <section className={panel}>
          <header className="flex flex-wrap items-center gap-2 border-b border-black/[0.06] px-4 py-2.5">
            <h2 className="text-[13.5px] font-medium">
              {agent?.name ?? "Inbound agent"}
            </h2>
            <Badge tone="outline">Test chat</Badge>
            {agent && (
              <Badge tone={agent.enabled ? "ink" : "outline"}>
                {agent.enabled ? "On for visitors" : "Off for visitors"}
              </Badge>
            )}
          </header>
          {disabled && (
            <p
              role="status"
              data-state="unavailable"
              className="border-b border-black/[0.06] bg-black/[0.03] px-4 py-2.5 text-[12.5px] leading-[1.45] text-[#0B0B0C]/75"
            >
              {disabled}
            </p>
          )}
          <TryChat
            initial={history.map((m) =>
              m.author === "user"
                ? { id: m.id, from: "you" as const, body: m.body }
                : {
                    id: m.id,
                    from: "agent" as const,
                    reply: {
                      body: m.body,
                      outcome: m.metadata.outcome ?? "none",
                      summary: m.metadata.summary ?? "",
                      handoff: m.metadata.handoff === true,
                      stop_contact: m.metadata.stop_contact === true,
                    },
                  },
            )}
            session={history[0]?.session_id ?? null}
            disabled={disabled}
            welcome={widgets[0]?.welcome || "Hi. How can we help?"}
          />
        </section>

        <aside className={cn(panel, "p-4")}>
          <h2 className="text-[13.5px] font-medium">What it is working with</h2>
          <dl className="mt-2 space-y-2.5 text-[12.5px] leading-[1.45]">
            <div>
              <dt className="text-[#0B0B0C]/50">Knowledge</dt>
              <dd>
                {ready === 0
                  ? "Nothing yet. It will say it doesn't know."
                  : `${ready} ${ready === 1 ? "item" : "items"} it can answer from.`}{" "}
                <Link href="/app/knowledge" className="underline">
                  Edit knowledge
                </Link>
              </dd>
            </div>
            <div>
              <dt className="text-[#0B0B0C]/50">Instructions</dt>
              <dd>
                {agent?.instructions.trim()
                  ? "Your instructions are in use."
                  : "None written yet."}{" "}
                {agent?.qualifying_questions.trim()
                  ? "It works your qualifying questions in."
                  : "No qualifying questions yet."}{" "}
                <Link href="/app/agents" className="underline">
                  Edit the agent
                </Link>
              </dd>
            </div>
            <div>
              <dt className="text-[#0B0B0C]/50">On your website</dt>
              <dd>
                {!agent?.enabled
                  ? "The agent is off, so visitors' chats wait for you in the Inbox."
                  : agent.approval_mode === "auto"
                    ? "It answers visitors on its own."
                    : "It writes a draft and waits for your approval. Here you see the answer straight away."}
              </dd>
            </div>
          </dl>
          <p className={`${hint} mt-3`}>
            Answers here count towards your agent&apos;s daily reply limit, like
            real ones.
          </p>
        </aside>
      </div>
    </>
  );
}

export default function TryAgentPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Try />
    </Suspense>
  );
}
