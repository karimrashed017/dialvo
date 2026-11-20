import type { Metadata } from "next";
import { Suspense } from "react";
import {
  HandCoins,
  PhoneIncoming,
  Send,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { agentRuntimeStatus } from "@/lib/agents/config";
import { getAppContext } from "@/lib/app/context";
import { CHANNEL_LABEL, CHANNELS, type Agent } from "@/lib/app/types";
import { cn } from "@/lib/utils";
import { ActionForm, SubmitButton } from "../_ui/form";
import {
  Badge,
  hint,
  input,
  labelCls,
  PageHead,
  PageSkeleton,
  panel,
} from "../_ui/kit";
import { setAgentEnabled, updateAgent } from "./actions";

export const metadata: Metadata = { title: "Agents" };

const ROLE: Record<
  Agent["role"],
  { icon: LucideIcon; title: string; does: string; placeholder: string }
> = {
  inbound: {
    icon: PhoneIncoming,
    title: "Inbound",
    does: "Answers and qualifies every new lead, then books the meeting.",
    placeholder:
      "e.g. Ask how many locations they have and what they use today. Book qualified leads with Priya. Never quote a price below the published plans.",
  },
  outbound: {
    icon: Send,
    title: "Outbound",
    does: "Finds and researches prospects, and writes to them one by one.",
    placeholder:
      "e.g. Write to owners of clinics with 2 to 10 locations. Lead with what you found on their site. One short email, no attachments.",
  },
  closing: {
    icon: HandCoins,
    title: "Closing",
    does: "Finishes simple sales with a clear price; hands bigger deals to you.",
    placeholder:
      "e.g. Close the Starter plan on the spot with the payment link. Anything custom or over $1,000 goes to a person.",
  },
  expansion: {
    icon: TrendingUp,
    title: "Expansion",
    does: "Checks in with customers who opted in, and spots upgrades.",
    placeholder:
      "e.g. Check in 30 days after signup. Offer the annual plan to customers who have used it weekly.",
  },
};

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function AgentCard({
  agent,
  canEdit,
  timezone,
  runtime,
}: {
  agent: Agent;
  canEdit: boolean;
  timezone: string;
  /** Whether this server has the keys to run an agent at all. */
  runtime: boolean;
}) {
  const role = ROLE[agent.role];
  // The one agent that acts today: inbound, on the website chat.
  const answersChat = agent.role === "inbound" && agent.channel === "chat";
  const days = new Set(agent.send_window?.days ?? []);
  return (
    <section className={panel}>
      <header className="flex flex-wrap items-center gap-3 border-b border-black/[0.06] px-4 py-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-black/[0.08] bg-white">
          <role.icon aria-hidden className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="flex flex-wrap items-center gap-2 text-[14.5px] font-medium">
            {agent.name}
            <Badge>{role.title}</Badge>
          </h2>
          <p className="text-[12.5px] text-[#0B0B0C]/55">{role.does}</p>
        </div>
        <ActionForm
          action={setAgentEnabled}
          quiet
          className="flex items-center gap-2"
        >
          <input type="hidden" name="agent" value={agent.id} />
          <input
            type="hidden"
            name="enabled"
            value={agent.enabled ? "false" : "true"}
          />
          <Badge tone={agent.enabled ? "ink" : "outline"}>
            {agent.enabled ? "On" : "Off"}
          </Badge>
          {canEdit && (
            <SubmitButton variant="secondary" small pendingText="…">
              {agent.enabled ? "Switch off" : "Switch on"}
            </SubmitButton>
          )}
        </ActionForm>
      </header>

      {agent.enabled && (
        <p className="border-b border-black/[0.06] bg-[#1F3BFF]/[0.05] px-4 py-2 text-[12.5px] leading-[1.45] text-[#0B0B0C]/75">
          {!answersChat ? (
            <>
              Switched on, but not live yet: this agent can&apos;t answer, send
              or call until its channel is connected in a later release. Its
              settings are saved and ready.
            </>
          ) : !runtime ? (
            <>
              Switched on, but the agent isn&apos;t switched on yet on
              Dialvo&apos;s side. Until it is, visitors&apos; chat messages are
              saved to your Inbox and nobody is answered automatically.
            </>
          ) : (
            <>
              Live on your website chat.{" "}
              {agent.approval_mode === "auto"
                ? "It answers visitors on its own."
                : "It writes a draft for every message, and nothing is sent until you approve it in the Inbox."}{" "}
              <Link href="/app/settings#chat" className="underline">
                Add the chat to your site
              </Link>
              .
            </>
          )}
        </p>
      )}
      {!agent.enabled && answersChat && (
        <p className="border-b border-black/[0.06] px-4 py-2 text-[12.5px] leading-[1.45] text-[#0B0B0C]/60">
          Off. Switch it on and it answers visitors in your website chat from
          your Knowledge. While it is off, chats wait for you in the Inbox.
        </p>
      )}

      <ActionForm action={updateAgent} className="p-4">
        <input type="hidden" name="agent" value={agent.id} />
        <fieldset disabled={!canEdit} className="grid gap-4 lg:grid-cols-2">
          <div className="lg:col-span-2">
            <label className={labelCls}>
              Instructions
              <textarea
                name="instructions"
                rows={5}
                maxLength={20000}
                defaultValue={agent.instructions}
                placeholder={role.placeholder}
                className={`${input} mt-1`}
              />
            </label>
            <p className={`${hint} mt-1.5`}>
              In plain words: who to help, what to ask, what never to say. Facts
              like prices belong in Knowledge.
            </p>
          </div>

          <div className="lg:col-span-2">
            <label className={labelCls}>
              Qualifying questions
              <textarea
                name="qualifying_questions"
                rows={3}
                maxLength={4000}
                defaultValue={agent.qualifying_questions}
                placeholder={
                  "One per line, e.g.\nHow many locations do you have?\nWhat do you use today?\nWhen do you want to start?"
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

          <label className={labelCls}>
            Name
            <input
              name="name"
              required
              maxLength={80}
              defaultValue={agent.name}
              className={`${input} mt-1`}
            />
          </label>
          <label className={labelCls}>
            Main channel
            <select
              name="channel"
              defaultValue={agent.channel}
              className={`${input} mt-1`}
            >
              {CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {CHANNEL_LABEL[c]}
                </option>
              ))}
            </select>
          </label>

          <fieldset>
            <legend className={labelCls}>Before it sends</legend>
            <div className="mt-1.5 space-y-1.5">
              {(
                [
                  [
                    "approve_first",
                    "Ask me first",
                    "Drafts wait in your inbox for a yes.",
                  ],
                  ["auto", "Send on its own", "Within its instructions."],
                ] as const
              ).map(([value, title, text]) => (
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
                    <span className="block text-[12px] text-[#0B0B0C]/55">
                      {text}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className={labelCls}>Send window</legend>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {DAYS.map((day, i) => (
                <label
                  key={day}
                  className="flex h-8 cursor-pointer items-center rounded-full border border-black/15 px-2.5 text-[12px] font-medium has-checked:border-[#0B0B0C] has-checked:bg-[#0B0B0C] has-checked:text-white has-focus-visible:ring-2 has-focus-visible:ring-black/40"
                >
                  <input
                    type="checkbox"
                    name="days"
                    value={i + 1}
                    defaultChecked={days.has(i + 1)}
                    className="sr-only"
                  />
                  {day}
                </label>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2 text-[12.5px] text-[#0B0B0C]/60">
              <label>
                <span className="sr-only">From</span>
                <input
                  type="time"
                  name="start"
                  required
                  defaultValue={agent.send_window?.start ?? "09:00"}
                  className={cn(input, "h-8 w-[112px] py-0 text-[12.5px]")}
                />
              </label>
              to
              <label>
                <span className="sr-only">Until</span>
                <input
                  type="time"
                  name="end"
                  required
                  defaultValue={agent.send_window?.end ?? "17:00"}
                  className={cn(input, "h-8 w-[112px] py-0 text-[12.5px]")}
                />
              </label>
            </div>
            <p className={`${hint} mt-1.5`}>
              {timezone.replace(/_/g, " ")} time. For messages the agent starts
              itself. Replies to a visitor who is chatting are not held back.
            </p>
          </fieldset>

          {agent.channel === "voice" && (
            <label className={labelCls}>
              Voice
              <input
                name="voice"
                maxLength={80}
                defaultValue={agent.voice ?? ""}
                placeholder="e.g. Professional"
                className={`${input} mt-1`}
              />
            </label>
          )}
        </fieldset>
        {canEdit ? (
          <div className="mt-4 flex justify-end">
            <SubmitButton>Save settings</SubmitButton>
          </div>
        ) : (
          <p className={`${hint} mt-3`}>
            Only the workspace&apos;s owner and admins can change agents.
          </p>
        )}
      </ActionForm>
    </section>
  );
}

async function Agents() {
  const { repo, workspace } = await getAppContext();
  const agents = await repo.agents();
  const canEdit = workspace.role !== "member";
  const runtime = agentRuntimeStatus().on;
  return (
    <>
      <PageHead
        title="Agents"
        note="Four agents, one per job. The inbound agent answers your website chat once you switch it on. The other three are settings only for now: they don't contact anyone yet."
      />
      <div className="flex flex-col gap-3">
        {agents.map((agent) => (
          <AgentCard
            key={agent.id}
            agent={agent}
            canEdit={canEdit}
            timezone={workspace.timezone}
            runtime={runtime}
          />
        ))}
      </div>
    </>
  );
}

export default function AgentsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Agents />
    </Suspense>
  );
}
