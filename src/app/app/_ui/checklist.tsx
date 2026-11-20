import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { checklistState } from "@/lib/app/checklist";
import { seenLine } from "@/lib/app/time";
import type {
  Agent,
  ChatWidget,
  KnowledgeItem,
  WorkspaceSetup,
} from "@/lib/app/types";
import { cn } from "@/lib/utils";
import { setAgentEnabled } from "../agents/actions";
import { createChatWidget } from "../settings/actions";
import { CopyButton } from "../settings/copy";
import { chatSnippet } from "../settings/snippet";
import { dismissChecklist, readWebsite } from "../setup-actions";
import { ActionForm, SubmitButton } from "./form";
import { btn, input, panel } from "./kit";
import { LiveRefresh } from "./live";
import { RecheckButton } from "./recheck";

// "Get started": the four steps from a new workspace to an agent answering
// on the customer's site. Each step is worked out from what is really there
// (is there knowledge, has the agent answered a test, has the chat loaded on
// a site, is the agent on), so it can't claim something that didn't happen.

export type ChecklistProps = {
  setup: WorkspaceSetup | null;
  knowledge: KnowledgeItem[];
  widgets: ChatWidget[];
  agents: Agent[];
  website: string | null;
  /** This site's address, for the embed code. */
  origin: string;
  /** This server has the keys to run an agent. */
  runtime: boolean;
  admin: boolean;
};

function Step({
  n,
  id,
  title,
  done,
  children,
}: {
  n: number;
  id: string;
  title: string;
  done: boolean;
  children: React.ReactNode;
}) {
  return (
    <li
      data-step={id}
      data-done={done ? "true" : "false"}
      className="flex gap-3 border-t border-black/[0.06] px-4 py-3.5 first:border-0 sm:px-5"
    >
      <span
        className={cn(
          "mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-[11.5px] font-medium tabular-nums",
          done
            ? "bg-[#0B0B0C] text-white"
            : "border border-black/20 text-[#0B0B0C]/55",
        )}
      >
        {done ? <Check aria-hidden className="size-3.5" /> : n}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="text-[13.5px] font-medium">
          {title}
          <span className="sr-only">{done ? " (done)" : " (to do)"}</span>
        </h3>
        <div className="mt-1 text-[12.5px] leading-[1.5] text-[#0B0B0C]/60">
          {children}
        </div>
      </div>
    </li>
  );
}

const host = (address: string | null) =>
  (address ?? "")
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .slice(0, 80);

export function Checklist(props: ChecklistProps) {
  const { knowledge, website, origin, runtime, admin } = props;
  const state = checklistState(props);
  if (state.hidden) return null;
  const { setup, reading, siteFailed, widget, inbound, done } = state;
  // Knowledge comes newest first; show the pages in the order they were read.
  const pages = knowledge.filter((k) => k.source_url).reverse();
  const notes = knowledge.length - pages.length;
  const site = host(setup.site_url ?? website);

  return (
    <section
      id="get-started"
      aria-labelledby="get-started-title"
      className={panel}
    >
      {reading && <LiveRefresh every={3000} />}
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pt-4 pb-3 sm:px-5">
        <h2 id="get-started-title" className="text-[15px] font-medium">
          Get started
        </h2>
        <span className="text-[12px] text-[#0B0B0C]/50 tabular-nums">
          {state.count} of 4 done
        </span>
        <ActionForm action={dismissChecklist} quiet className="ml-auto">
          <SubmitButton variant="ghost" small pendingText="…">
            Dismiss
          </SubmitButton>
        </ActionForm>
      </header>
      <ol>
        <Step n={1} id="teach" title="Teach your agent" done={done.teach}>
          {reading ? (
            <p role="status">
              Reading {site || "your website"}… This takes up to half a minute.
              You can carry on in the meantime.
            </p>
          ) : (
            <>
              {knowledge.length === 0 ? (
                <p>
                  Your agent only answers from what you give it. Add your
                  website, or paste in your prices and FAQs.
                </p>
              ) : (
                <p>
                  Your agent answers from{" "}
                  {pages.length > 0 && (
                    <>
                      {pages.length === 1 ? "1 page" : `${pages.length} pages`}{" "}
                      of your website
                    </>
                  )}
                  {pages.length > 0 && notes > 0 && " and "}
                  {notes > 0 && (notes === 1 ? "1 note" : `${notes} notes`)}.
                </p>
              )}
              {pages.length > 0 && (
                <ul className="mt-1.5 space-y-0.5">
                  {pages.slice(0, 6).map((k) => (
                    <li key={k.id} className="truncate">
                      <span className="text-[#0B0B0C]/85">{k.title}</span>{" "}
                      <span className="text-[#0B0B0C]/40">
                        {k.source_url!.replace(/^https:\/\//, "")}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {siteFailed && (
                <p className="mt-1.5 text-[#0B0B0C]/75">
                  We couldn&apos;t read {site || "your website"}. Try again, or
                  paste your text into Knowledge instead.
                </p>
              )}
              <div className="mt-2.5 flex flex-wrap items-start gap-2">
                {(pages.length === 0 || siteFailed) && (
                  <ActionForm
                    action={readWebsite}
                    quiet
                    className="min-w-0 flex-1 basis-[280px]"
                  >
                    <div className="flex flex-wrap gap-2">
                      <label className="min-w-0 flex-1 basis-[180px]">
                        <span className="sr-only">Your website</span>
                        <input
                          name="url"
                          maxLength={300}
                          inputMode="url"
                          defaultValue={setup.site_url ?? website ?? ""}
                          placeholder="yourcompany.com"
                          className={cn(input, "h-8 py-0 text-[12.5px]")}
                        />
                      </label>
                      <SubmitButton
                        variant={siteFailed ? "primary" : "secondary"}
                        small
                        pendingText="Starting…"
                      >
                        {siteFailed ? "Try again" : "Read my website"}
                      </SubmitButton>
                    </div>
                  </ActionForm>
                )}
                <Link
                  href="/app/knowledge"
                  className={cn(btn.secondary, btn.small)}
                >
                  {siteFailed ? "Paste text instead" : "Open Knowledge"}
                  <ArrowRight aria-hidden className="size-3.5" />
                </Link>
              </div>
            </>
          )}
        </Step>

        <Step n={2} id="try" title="Try your agent" done={done.try}>
          <p>
            {done.try
              ? "You've talked to your agent. Try it again whenever you change its knowledge or instructions."
              : "Ask it what a customer would ask, here in the app, before anything goes on your site. Test chats aren't leads and don't show in your Inbox."}
          </p>
          {!runtime && (
            <p className="mt-1.5 text-[#0B0B0C]/75">
              The agent isn&apos;t switched on yet on Dialvo&apos;s side, so it
              can&apos;t answer here yet.
            </p>
          )}
          <Link
            href="/app/agents/try"
            className={cn(
              done.try ? btn.secondary : btn.primary,
              btn.small,
              "mt-2.5",
            )}
          >
            Try your agent
            <ArrowRight aria-hidden className="size-3.5" />
          </Link>
        </Step>

        <Step
          n={3}
          id="install"
          title="Put the chat on your website"
          done={done.install}
        >
          {!widget ? (
            <>
              <p>
                This workspace has no chat yet.
                {!admin && " The workspace's owner or an admin can create one."}
              </p>
              {admin && (
                <ActionForm action={createChatWidget} quiet className="mt-2.5">
                  <SubmitButton small pendingText="Creating…">
                    Create the chat
                  </SubmitButton>
                </ActionForm>
              )}
            </>
          ) : (
            <>
              <p>
                Paste this line before &lt;/body&gt; on every page that should
                have the chat. Chats land in your Inbox whether or not the agent
                is on.
              </p>
              <pre
                tabIndex={0}
                className="mt-2 overflow-auto rounded-xl bg-[#0B0B0C] p-3 font-mono text-[11.5px] leading-[1.6] text-white/90"
              >
                {chatSnippet(origin, widget.token)}
              </pre>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <CopyButton
                  text={chatSnippet(origin, widget.token)}
                  label="Copy code"
                />
                <RecheckButton />
                <span
                  data-seen={widget.last_seen_at ? "true" : "false"}
                  className={cn(
                    "text-[12.5px]",
                    widget.last_seen_at
                      ? "font-medium text-[#0B0B0C]"
                      : "text-[#0B0B0C]/55",
                  )}
                >
                  {seenLine(widget)}
                </span>
              </div>
            </>
          )}
        </Step>

        <Step n={4} id="on" title="Switch your agent on" done={done.on}>
          {done.on ? (
            <p>
              Your inbound agent is on
              {inbound?.approval_mode === "auto"
                ? " and answers visitors on its own."
                : ". It writes a draft for every message, and nothing is sent until you approve it in the Inbox."}
              {!runtime &&
                " The agent isn't switched on yet on Dialvo's side, so until it is, chats wait for you in the Inbox."}
            </p>
          ) : (
            <>
              <p>
                It starts on &quot;Ask me first&quot;: it writes a draft for
                every message and nothing reaches a visitor until you approve
                it. You can let it send on its own later.
              </p>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                {admin && inbound && (
                  <ActionForm action={setAgentEnabled} quiet>
                    <input type="hidden" name="agent" value={inbound.id} />
                    <input type="hidden" name="enabled" value="true" />
                    <SubmitButton small pendingText="Switching on…">
                      Switch the agent on
                    </SubmitButton>
                  </ActionForm>
                )}
                <Link
                  href="/app/agents"
                  className={cn(btn.secondary, btn.small)}
                >
                  Agent settings
                  <ArrowRight aria-hidden className="size-3.5" />
                </Link>
              </div>
              {!admin && (
                <p className="mt-1.5">
                  The workspace&apos;s owner or an admin can switch it on.
                </p>
              )}
            </>
          )}
        </Step>
      </ol>
    </section>
  );
}
