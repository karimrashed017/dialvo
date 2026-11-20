// The inbound chat agent's fixed settings. Changing the model or the caps is
// a cost decision: ask the founder first.

/** The model that writes replies. */
export const AGENT_MODEL = "claude-haiku-4-5";

/** The most one reply may cost in output, the JSON around it included. */
export const MAX_OUTPUT_TOKENS = 700;

/** A chat reply longer than this is cut: nobody reads an essay in a widget. */
export const MAX_REPLY_CHARS = 1500;

/** Replies (sent or drafted) one workspace's agent may write in 24 hours. */
export const DAILY_REPLY_CAP = 300;

/** How much of the workspace's knowledge goes into one prompt. */
export const MAX_KNOWLEDGE_CHARS = 60_000;

/** How long one model call may take before the visitor is left to a person. */
export const MODEL_TIMEOUT_MS = 20_000;

/**
 * Whether this server can run the agent at all: it needs the Anthropic key to
 * write a reply and the Supabase secret key to read the workspace's knowledge
 * and store the reply without a signed-in person. Without either, visitors'
 * messages are still saved to the Inbox and nobody is answered automatically.
 */
export function agentRuntimeStatus(
  env: Record<string, string | undefined> = process.env,
): { on: boolean; missing: string[] } {
  const missing = ["ANTHROPIC_API_KEY", "SUPABASE_SECRET_KEY"].filter(
    (name) => !env[name],
  );
  return { on: missing.length === 0, missing };
}
