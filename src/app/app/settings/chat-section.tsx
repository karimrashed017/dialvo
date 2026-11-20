import Link from "next/link";
import { seenLine } from "@/lib/app/time";
import type { ChatWidget } from "@/lib/app/types";
import { cn } from "@/lib/utils";
import { ActionForm, SubmitButton } from "../_ui/form";
import { Badge, hint, input, labelCls, panel, panelHead } from "../_ui/kit";
import { RecheckButton } from "../_ui/recheck";
import {
  createChatWidget,
  deleteChatWidget,
  updateChatWidget,
} from "./actions";
import { ChatPreview } from "./chat-preview";
import { CopyButton } from "./copy";
import { chatSnippet, widgetUrl } from "./snippet";

/** Settings: the website chat, its embed code and a live preview. */
export function ChatSection({
  widgets,
  origin,
  admin,
  agentOn,
  runtime,
}: {
  widgets: ChatWidget[];
  origin: string;
  admin: boolean;
  /** The inbound chat agent is switched on in this workspace. */
  agentOn: boolean;
  /** This server has the keys to run an agent. */
  runtime: boolean;
}) {
  return (
    <section id="chat" className={cn(panel, "scroll-mt-28 lg:col-span-2")}>
      <h2 className={panelHead}>
        Website chat
        <span className="text-[11.5px] font-normal text-[#0B0B0C]/50">
          A chat button for your site: every chat becomes a lead and a
          conversation in your Inbox
        </span>
      </h2>
      <p className="border-b border-black/[0.06] px-4 py-2.5 text-[12.5px] leading-[1.45] text-[#0B0B0C]/70">
        {!agentOn ? (
          <>
            Your inbound agent is off, so visitors are told a team member will
            reply and their messages wait in the Inbox.{" "}
            <Link href="/app/agents" className="underline">
              Switch the agent on
            </Link>{" "}
            to have it answer.
          </>
        ) : !runtime ? (
          <>
            Your inbound agent is switched on, but the agent isn&apos;t switched
            on yet on Dialvo&apos;s side. Until it is, visitors are told a team
            member will reply and their messages wait in the Inbox.
          </>
        ) : (
          <>
            Your inbound agent answers these chats from your Knowledge. You can
            take any conversation over in the Inbox.
          </>
        )}
      </p>
      {widgets.length === 0 && (
        <div className="p-4">
          <p className="text-[13px] text-[#0B0B0C]/55">
            No chat yet.
            {!admin && " The workspace's owner or an admin can create one."}
          </p>
          {admin && (
            <ActionForm action={createChatWidget} quiet className="mt-3">
              <SubmitButton pendingText="Creating…">
                Create the chat
              </SubmitButton>
            </ActionForm>
          )}
        </div>
      )}
      <ul>
        {widgets.map((w) => {
          const snippet = chatSnippet(origin, w.token);
          return (
            <li
              key={w.id}
              className="border-b border-black/[0.06] p-4 last:border-0"
            >
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-[14px] font-medium">{w.name}</h3>
                <Badge tone={w.enabled ? "ink" : "outline"}>
                  {w.enabled ? "On" : "Switched off"}
                </Badge>
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  {w.enabled && (
                    <ChatPreview
                      src={`${widgetUrl(origin, w.token)}`}
                      token={w.token}
                    />
                  )}
                  {admin && (
                    <ActionForm action={updateChatWidget} quiet>
                      <input type="hidden" name="widget" value={w.id} />
                      <input
                        type="hidden"
                        name="enabled"
                        value={w.enabled ? "false" : "true"}
                      />
                      <SubmitButton variant="secondary" small pendingText="…">
                        {w.enabled ? "Switch off" : "Switch on"}
                      </SubmitButton>
                    </ActionForm>
                  )}
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between gap-2">
                <p className="text-[12px] font-medium text-[#0B0B0C]/75">
                  Paste this before &lt;/body&gt; on every page that should have
                  the chat
                </p>
                <CopyButton text={snippet} label="Copy code" />
              </div>
              <pre
                tabIndex={0}
                className="mt-1 overflow-auto rounded-xl bg-[#0B0B0C] p-3.5 font-mono text-[11.5px] leading-[1.6] text-white/90"
              >
                {snippet}
              </pre>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <span className="text-[12px] font-medium text-[#0B0B0C]/75">
                  On your site:
                </span>
                <span
                  data-seen={w.last_seen_at ? "true" : "false"}
                  className={cn(
                    "text-[12.5px]",
                    w.last_seen_at
                      ? "font-medium text-[#0B0B0C]"
                      : "text-[#0B0B0C]/55",
                  )}
                >
                  {seenLine(w)}
                </span>
                <RecheckButton />
              </div>
              <p className={`${hint} mt-1.5`}>
                The chat reports the site it loads on (its address only, nothing
                about the visitor), so you can tell your code works. The preview
                on this page doesn&apos;t count.
              </p>
              <p className={`${hint} mt-2`}>
                The preview is the real chat: a message you send from it arrives
                in your Inbox as a new conversation. The chat sets no cookies;
                it remembers a visitor&apos;s conversation in their browser, on
                your site only.
              </p>

              {admin && (
                <details className="mt-3 text-[12.5px]">
                  <summary className="cursor-pointer text-[#0B0B0C]/65">
                    Change the title and greeting, rename, or delete
                  </summary>
                  <ActionForm
                    action={updateChatWidget}
                    className="mt-3 grid gap-3 sm:grid-cols-2"
                  >
                    <input type="hidden" name="widget" value={w.id} />
                    <label className={labelCls}>
                      Title visitors see
                      <input
                        name="title"
                        required
                        maxLength={60}
                        defaultValue={w.title}
                        className={`${input} mt-1`}
                      />
                    </label>
                    <label className={labelCls}>
                      Name{" "}
                      <span className="font-normal text-[#0B0B0C]/45">
                        (only you see it)
                      </span>
                      <input
                        name="name"
                        required
                        maxLength={120}
                        defaultValue={w.name}
                        className={`${input} mt-1`}
                      />
                    </label>
                    <label className={`${labelCls} sm:col-span-2`}>
                      First line
                      <input
                        name="welcome"
                        maxLength={300}
                        defaultValue={w.welcome}
                        className={`${input} mt-1`}
                      />
                    </label>
                    <div className="sm:col-span-2">
                      <SubmitButton variant="secondary">Save</SubmitButton>
                    </div>
                  </ActionForm>
                  <ActionForm
                    action={deleteChatWidget}
                    confirm={`Delete "${w.name}"? The chat button disappears from every page that has its code. Past conversations are kept.`}
                    className="mt-2"
                  >
                    <input type="hidden" name="widget" value={w.id} />
                    <SubmitButton
                      variant="ghost"
                      small
                      pendingText="Deleting…"
                      className="text-[#B42318]"
                    >
                      Delete this chat
                    </SubmitButton>
                  </ActionForm>
                </details>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
