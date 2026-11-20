"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { RotateCcw } from "lucide-react";
import { OUTCOME_LABEL } from "@/lib/app/types";
import { cn } from "@/lib/utils";
import { Badge, btn, input } from "../../_ui/kit";
import { sendTestMessage, type TestReply } from "./actions";

type Turn =
  | { id: string; from: "you"; body: string }
  | { id: string; from: "agent"; reply: TestReply }
  | { id: string; from: "note"; body: string };

const SUGGESTIONS = [
  "What do you offer?",
  "How much does it cost?",
  "Can I talk to a person?",
];

/**
 * The test chat. The teammate types what a customer would; the answer comes
 * from their real agent. Under each answer it shows what the agent would
 * have done with a real visitor (hand over, mark as qualified).
 */
export function TryChat({
  initial,
  session,
  disabled,
  welcome,
}: {
  initial: Turn[];
  /** The chat to continue, when there is one. */
  session: string | null;
  /** Why the agent can't answer here, when it can't. */
  disabled: string | null;
  welcome: string;
}) {
  const [turns, setTurns] = useState<Turn[]>(initial);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const sessionRef = useRef<string | null>(session);
  const log = useRef<HTMLDivElement>(null);
  const counter = useRef(0);
  const nextId = () => `local-${++counter.current}`;

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [turns, pending]);

  function send(body: string) {
    const message = body.trim();
    if (!message || pending || disabled) return;
    sessionRef.current ??= crypto.randomUUID();
    const mine = nextId();
    setError("");
    setText("");
    setTurns((list) => [...list, { id: mine, from: "you", body: message }]);
    start(async () => {
      const form = new FormData();
      form.set("session", sessionRef.current!);
      form.set("message", message);
      let result: Awaited<ReturnType<typeof sendTestMessage>>;
      try {
        result = await sendTestMessage(form);
      } catch {
        result = {
          ok: false,
          message:
            "That didn't go through. Check your connection and try again.",
        };
      }
      setTurns((list) => {
        // Show what was really sent (a card number is taken out on the way).
        const shown = list.map((t) =>
          t.id === mine && t.from === "you" && result.sent
            ? { ...t, body: result.sent }
            : t,
        );
        if (result.reply)
          return [
            ...shown,
            { id: nextId(), from: "agent", reply: result.reply },
          ];
        if (result.silent)
          return [
            ...shown,
            {
              id: nextId(),
              from: "note",
              body: "No reply: here your agent would hand the conversation to your team without saying more.",
            },
          ];
        return shown;
      });
      if (!result.ok) {
        setError(result.message ?? "That didn't send. Please try again.");
        // Nothing was answered: give the text back to edit or resend.
        if (!result.sent) {
          setTurns((list) => list.filter((t) => t.id !== mine));
          setText(message);
        }
      }
    });
  }

  function startOver() {
    sessionRef.current = crypto.randomUUID();
    setTurns([]);
    setError("");
  }

  return (
    <div className="flex min-h-[420px] flex-col">
      <div
        ref={log}
        role="log"
        aria-live="polite"
        aria-label="Test chat"
        className="flex max-h-[52vh] min-h-[260px] flex-1 flex-col gap-2 overflow-y-auto px-4 py-4"
      >
        <p className="w-fit max-w-[84%] rounded-2xl rounded-bl-md bg-black/[0.055] px-3 py-2 text-[13.5px] leading-[1.45]">
          {welcome}
        </p>
        {turns.map((turn) =>
          turn.from === "you" ? (
            <p
              key={turn.id}
              data-from="you"
              className="w-fit max-w-[84%] self-end rounded-2xl rounded-br-md bg-[#0B0B0C] px-3 py-2 text-[13.5px] leading-[1.45] whitespace-pre-wrap text-white"
            >
              {turn.body}
            </p>
          ) : turn.from === "agent" ? (
            <div key={turn.id} data-from="agent" className="max-w-[84%]">
              <p className="mb-1 ml-0.5 text-[11px] text-[#0B0B0C]/50">
                Your agent
              </p>
              <p className="w-fit rounded-2xl rounded-bl-md bg-black/[0.055] px-3 py-2 text-[13.5px] leading-[1.45] whitespace-pre-wrap">
                {turn.reply.body}
              </p>
              {(turn.reply.handoff ||
                turn.reply.stop_contact ||
                turn.reply.outcome !== "none") && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {turn.reply.outcome !== "none" && (
                    <Badge tone="outline">
                      Would mark: {OUTCOME_LABEL[turn.reply.outcome]}
                    </Badge>
                  )}
                  {turn.reply.handoff && (
                    <Badge tone="outline">Would hand over to your team</Badge>
                  )}
                  {turn.reply.stop_contact && (
                    <Badge tone="outline">Would mark do not contact</Badge>
                  )}
                </div>
              )}
              {turn.reply.summary && (
                <p className="mt-1 ml-0.5 text-[11.5px] leading-[1.45] text-[#0B0B0C]/55">
                  Note for your team: {turn.reply.summary}
                </p>
              )}
            </div>
          ) : (
            <p
              key={turn.id}
              className="self-center px-4 text-center text-[12px] leading-[1.45] text-[#0B0B0C]/55"
            >
              {turn.body}
            </p>
          ),
        )}
        {pending && (
          <p
            aria-label="Your agent is writing"
            className="w-fit rounded-2xl rounded-bl-md bg-black/[0.055] px-3 py-2.5 text-[13.5px] text-[#0B0B0C]/45"
          >
            Writing…
          </p>
        )}
      </div>

      {turns.length === 0 && !disabled && (
        <div className="flex flex-wrap gap-1.5 px-4 pb-3">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              className={cn(btn.secondary, btn.small)}
              onClick={() => send(s)}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {error && (
        <p role="alert" className="px-4 pb-2 text-[12.5px] text-[#B42318]">
          {error}
        </p>
      )}
      <form
        className="flex items-end gap-2 border-t border-black/[0.06] p-3"
        onSubmit={(event) => {
          event.preventDefault();
          send(text);
        }}
      >
        <label className="min-w-0 flex-1">
          <span className="sr-only">Your message</span>
          <textarea
            name="message"
            rows={1}
            maxLength={2000}
            value={text}
            disabled={Boolean(disabled)}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                send(text);
              }
            }}
            placeholder={
              disabled ? "Not available yet" : "Ask what a customer would ask"
            }
            className={cn(input, "max-h-[120px] min-h-10 resize-none")}
          />
        </label>
        <button
          type="submit"
          disabled={pending || Boolean(disabled) || !text.trim()}
          className={btn.primary}
        >
          {pending ? "Sending…" : "Send"}
        </button>
        <button
          type="button"
          onClick={startOver}
          disabled={pending || turns.length === 0}
          className={cn(btn.ghost, "px-3")}
          title="Start a new test chat"
        >
          <RotateCcw aria-hidden className="size-3.5" />
          <span className="sr-only sm:not-sr-only">Start over</span>
        </button>
      </form>
    </div>
  );
}
