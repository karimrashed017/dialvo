import Link from "next/link";
import { ArrowRight, Check, ChevronDown } from "lucide-react";
import type { checklistState } from "@/lib/app/checklist";
import { seenLine } from "@/lib/app/time";
import type { KnowledgeItem } from "@/lib/app/types";
import { cn } from "@/lib/utils";
import { setAgentEnabled } from "../chat/actions";
import { createChatWidget } from "../settings/actions";
import { CopyButton } from "../settings/copy";
import { chatSnippet } from "../settings/snippet";
import { readWebsite } from "../setup-actions";
import { ActionForm, SubmitButton } from "./form";
import { btn, input } from "./kit";
import { RecheckButton } from "./recheck";

// The four steps from a new workspace to an agent answering on the
// customer's site, shown inside Home's "Answer website visitors" card. Each
// step is worked out from what is really there (is there knowledge, has the
// agent answered a test, has the chat loaded on a site, is the agent on), so
// it can't claim something that didn't happen. The step to do next is open;
// the others show one line and open on a click.

export type ChatStepsProps = {
  state: ReturnType<typeof checklistState>;
  knowledge: KnowledgeItem[];
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
  line,
  done,
  open,
  children,
}: {
  n: number;
  id: string;
  title: string;
  /** Where the step stands, in one line. Always visible. */
  line: string;
  done: boolean;
  /** The step to do next: shown open. */
  open: boolean;
  children: React.ReactNode;
}) {
  return (
    <li
      data-step={id}
      data-done={done ? "true" : "false"}
      className="border-t border-black/[0.06] first:border-0"
    >
      <details open={open} className="group">
        <summary className="flex cursor-pointer list-none items-start gap-3 rounded-lg py-3 focus-visible:ring-2 focus-visible:ring-black/40 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
          <span
            className={cn(
              "mt-px grid size-[22px] shrink-0 place-items-center rounded-full text-[11px] font-medium tabular-nums",
              done
                ? "bg-[#0B0B0C] text-white"
                : "border border-black/20 text-[#0B0B0C]/55",
            )}
          >
            {done ? <Check aria-hidden className="size-3" /> : n}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13.5px] font-medium">
              {title}
              <span className="sr-only">{done ? " (done)" : " (to do)"}</span>
            </span>
            <span className="block text-[12.5px] leading-[1.45] text-[#0B0B0C]/55 group-open:hidden">
              {line}
            </span>
          </span>
          <ChevronDown
            aria-hidden
            className="mt-1 size-4 shrink-0 text-[#0B0B0C]/35 transition-transform group-open:rotate-180"
          />
        </summary>
        <div className="pb-4 pl-[34px] text-[12.5px] leading-[1.5] text-[#0B0B0C]/60">
          {children}
        </div>
      </details>
    </li>
  );
}

const host = (address: string | null) =>
  (address ?? "")
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .slice(0, 80);

export function ChatSteps({
  state,
  knowledge,
  website,
  origin,
  runtime,
  admin,
}: ChatStepsProps) {
  const { setup, reading, siteFailed, widget, inbound, done } = state;
  // Knowledge comes newest first; show the pages in the order they were read.
  const pages = knowledge.filter((k) => k.source_url).reverse();
  const notes = knowledge.length - pages.length;
  const site = host(setup.site_url ?? website);
  const next = (["teach", "try", "install", "on"] as const).find(
    (step) => !done[step],
  );
  const knows = [
    pages.length > 0 &&
      `${pages.length === 1 ? "1 page" : `${pages.length} pages`} of your website`,
    notes > 0 && (notes === 1 ? "1 note" : `${notes} notes`),
  ]
    .filter(Boolean)
    .join(" and ");

  return (
    <ol>
      <Step
        n={1}
        id="teach"
        title="Teach your agent"
        line={
          reading
            ? `Reading ${site || "your website"}…`
            : knowledge.length === 0
              ? "It only answers from what you give it."
              : `It answers from ${knows}.`
        }
        done={done.teach}
        // A failed read is worth showing even when the step counts as done.
        open={next === "teach" || siteFailed}
      >
        {reading ? (
          <p role="status">
            Reading {site || "your website"}… This takes up to half a minute.
            You can carry on in the meantime.
          </p>
        ) : (
          <>
            {knowledge.length === 0 ? (
              <p>
                Your agent only answers from what you give it. Add your website,
                or paste in your prices and FAQs.
              </p>
            ) : (
              <p>Your agent answers from {knows}.</p>
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
                  className="min-w-0 flex-1 basis-[240px]"
                >
                  <div className="flex flex-wrap gap-2">
                    <label className="min-w-0 flex-1 basis-[150px]">
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
                      variant={
                        siteFailed || knowledge.length === 0
                          ? "primary"
                          : "secondary"
                      }
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

      <Step
        n={2}
        id="try"
        title="Try your agent"
        line={
          done.try
            ? "You've talked to it."
            : "Ask it what a customer would ask, before anything goes on your site."
        }
        done={done.try}
        open={next === "try"}
      >
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
          href="/app/chat/try"
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
        line={
          !widget
            ? "This workspace has no chat yet."
            : widget.last_seen_at
              ? `${seenLine(widget)}.`
              : "One line of code, pasted into your site."
        }
        done={done.install}
        open={next === "install"}
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

      <Step
        n={4}
        id="on"
        title="Switch your agent on"
        line={
          done.on
            ? inbound?.approval_mode === "auto"
              ? "On. It answers visitors on its own."
              : "On. It asks you before anything is sent."
            : "It starts by asking you before anything is sent."
        }
        done={done.on}
        open={next === "on"}
      >
        {done.on ? (
          <p>
            Your agent is on
            {inbound?.approval_mode === "auto"
              ? " and answers visitors on its own."
              : ". It writes a draft for every message, and nothing is sent until you approve it in the Inbox."}
            {!runtime &&
              " The agent isn't switched on yet on Dialvo's side, so until it is, chats wait for you in the Inbox."}
          </p>
        ) : (
          <>
            <p>
              It starts on &quot;Ask me first&quot;: it writes a draft for every
              message and nothing reaches a visitor until you approve it. You
              can let it answer on its own later.
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
                href="/app/chat#agent"
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
  );
}
