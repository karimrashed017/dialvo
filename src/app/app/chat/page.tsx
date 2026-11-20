import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight, MessageCircle } from "lucide-react";
import { agentRuntimeStatus } from "@/lib/agents/config";
import { getAppContext } from "@/lib/app/context";
import type { Agent } from "@/lib/app/types";
import { requestOrigin } from "@/lib/auth/origin";
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
import { setAgentEnabled, updateChatAgent } from "./actions";
import { ChatSection } from "./chat-section";

export const metadata: Metadata = { title: "Website chat" };

const MODES = [
  [
    "approve_first",
    "Ask me first",
    "It writes a draft for every message. Nothing reaches a visitor until you approve it in the Inbox.",
  ],
  [
    "auto",
    "Answer on its own",
    "It replies to visitors straight away, within its instructions and your Knowledge.",
  ],
] as const;

/** The agent that answers the chat: on or off, how it answers, what it asks. */
function AgentPanel({
  agent,
  canEdit,
  runtime,
}: {
  agent: Agent;
  canEdit: boolean;
  /** Whether this server has the keys to run an agent at all. */
  runtime: boolean;
}) {
  return (
    <section id="agent" className={cn(panel, "scroll-mt-28")}>
      <h2 className={panelHead}>
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate">Your agent</span>
          <Badge tone={agent.enabled ? "ink" : "outline"}>
            {agent.enabled ? "On" : "Off"}
          </Badge>
        </span>
        {canEdit && (
          <ActionForm action={setAgentEnabled} quiet>
            <input type="hidden" name="agent" value={agent.id} />
            <input
              type="hidden"
              name="enabled"
              value={agent.enabled ? "false" : "true"}
            />
            <SubmitButton
              variant={agent.enabled ? "secondary" : "primary"}
              small
              pendingText="…"
            >
              {agent.enabled ? "Switch off" : "Switch on"}
            </SubmitButton>
          </ActionForm>
        )}
      </h2>
      <p
        data-agent-state
        className="border-b border-black/[0.06] px-4 py-2.5 text-[12.5px] leading-[1.45] text-[#0B0B0C]/70"
      >
        {!agent.enabled
          ? "Off. Switch it on and it answers visitors in your website chat from your Knowledge. While it is off, chats wait for you in the Inbox."
          : !runtime
            ? "Switched on, but the agent isn't switched on yet on Dialvo's side. Until it is, visitors' chat messages are saved to your Inbox and nobody is answered automatically."
            : agent.approval_mode === "auto"
              ? "Live on your website chat. It answers visitors on its own."
              : "Live on your website chat. It writes a draft for every message, and nothing is sent until you approve it in the Inbox."}
      </p>

      <ActionForm action={updateChatAgent} className="p-4">
        <input type="hidden" name="agent" value={agent.id} />
        <fieldset disabled={!canEdit} className="space-y-4">
          <fieldset>
            <legend className={labelCls}>Before it replies</legend>
            <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
              {MODES.map(([value, title, text]) => (
                <label
                  key={value}
                  className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-black/[0.08] px-3 py-2 has-checked:border-[#0B0B0C]"
                >
                  <input
                    type="radio"
                    name="approval_mode"
                    value={value}
                    defaultChecked={agent.approval_mode === value}
                    className="mt-1 accent-[#0B0B0C]"
                  />
                  <span>
                    <span className="block text-[13px] font-medium">
                      {title}
                    </span>
                    <span className="block text-[12px] leading-[1.45] text-[#0B0B0C]/55">
                      {text}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <label className={labelCls}>
              Instructions
              <textarea
                name="instructions"
                rows={5}
                maxLength={20000}
                defaultValue={agent.instructions}
                placeholder="For example: ask how many locations they have and what they use today. Offer a call with Priya to anyone who is a fit. Never quote a price below the published plans."
                className={`${input} mt-1`}
              />
            </label>
            <p className={`${hint} mt-1.5`}>
              In plain words: who to help, what to ask, what never to say. Facts
              like prices belong in{" "}
              <Link href="/app/knowledge" className="underline">
                Knowledge
              </Link>
              .
            </p>
          </div>

          <div>
            <label className={labelCls}>
              Qualifying questions
              <textarea
                name="qualifying_questions"
                rows={3}
                maxLength={4000}
                defaultValue={agent.qualifying_questions}
                placeholder={
                  "One per line, for example:\nHow many locations do you have?\nWhat do you use today?\nWhen do you want to start?"
                }
                className={`${input} mt-1`}
              />
            </label>
            <p className={`${hint} mt-1.5`}>
              The agent works these into the conversation, one at a time, and
              records whether the lead is qualified, not a fit, or needs a
              person.
            </p>
          </div>

          <label className={cn(labelCls, "max-w-[320px]")}>
            Agent&apos;s name{" "}
            <span className="font-normal text-[#0B0B0C]/45">
              (only your team sees it)
            </span>
            <input
              name="name"
              required
              maxLength={80}
              defaultValue={agent.name}
              className={`${input} mt-1`}
            />
          </label>
        </fieldset>
        {canEdit ? (
          <div className="mt-4 flex justify-end">
            <SubmitButton>Save</SubmitButton>
          </div>
        ) : (
          <p className={`${hint} mt-3`}>
            Only the workspace&apos;s owner and admins can change the agent.
          </p>
        )}
      </ActionForm>
    </section>
  );
}

async function Chat() {
  const { repo, workspace } = await getAppContext();
  const [agents, widgets, origin] = await Promise.all([
    repo.agents(),
    repo.chatWidgets(),
    requestOrigin(),
  ]);
  const agent = agents.find(
    (a) => a.role === "inbound" && a.channel === "chat",
  );
  const admin = workspace.role !== "member";
  const runtime = agentRuntimeStatus().on;
  return (
    <>
      <PageHead
        title="Website chat"
        note="A chat button for your website. Your agent answers visitors from your Knowledge and finds out whether they are a fit. Every chat becomes a lead and a conversation in your Inbox."
      >
        <Link href="/app/chat/try" className={btn.primary}>
          Try your agent
          <ArrowRight aria-hidden className="size-3.5" />
        </Link>
      </PageHead>
      <div className="grid items-start gap-3 lg:grid-cols-2">
        {agent ? (
          <AgentPanel agent={agent} canEdit={admin} runtime={runtime} />
        ) : (
          <section id="agent" className={panel}>
            <h2 className={panelHead}>Your agent</h2>
            <Empty icon={MessageCircle} title="No agent for the chat">
              This workspace has no agent set to answer the website chat, so
              chats wait for your team in the Inbox.
            </Empty>
          </section>
        )}
        <div className="flex min-w-0 flex-col gap-3">
          <ChatSection
            widgets={widgets}
            origin={origin}
            admin={admin}
            agentOn={Boolean(agent?.enabled)}
            runtime={runtime}
          />
          <p className={cn(hint, "px-1")}>
            Want an email when a chat is qualified, needs a person or has a
            draft waiting?{" "}
            <Link href="/app/settings#alerts" className="underline">
              Email alerts are in Settings
            </Link>
            .
          </p>
        </div>
      </div>
    </>
  );
}

export default function ChatPage() {
  return (
    // The page reads the session, so it streams in behind this boundary.
    <Suspense fallback={<PageSkeleton />}>
      <Chat />
    </Suspense>
  );
}
