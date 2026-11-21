import "server-only";
import {
  apiError,
  apiJson,
  authorise,
  failed,
  isId,
  pageOf,
  paged,
  readPage,
} from "@/lib/api/v1";

// GET /api/v1/conversations   the workspace's conversations, newest first.
//     ?limit &cursor &lead_id= &channel= &status=open|waiting_for_you|closed
//     &include=messages  (the last 20 messages of each, oldest first)

const CHANNELS = ["voice", "email", "chat", "social", "sms", "whatsapp"];
const STATUSES = ["open", "waiting_for_you", "closed"];

export async function GET(request: Request) {
  const auth = await authorise(request);
  if (!auth.ok) return auth.response;
  const { ctx } = auth;
  const url = new URL(request.url);
  const page = readPage(url);
  if (!page.ok) return page.response;
  let q = ctx.from(
    "conversations",
    "id, lead_id, channel, status, last_message_at, created_at, updated_at",
  );
  const lead = url.searchParams.get("lead_id");
  if (lead !== null) {
    if (!isId(lead)) return apiError(422, "invalid", "lead_id must be an id.");
    q = q.eq("lead_id", lead);
  }
  const channel = url.searchParams.get("channel");
  if (channel !== null) {
    if (!CHANNELS.includes(channel))
      return apiError(
        422,
        "invalid",
        `channel must be one of ${CHANNELS.join(", ")}.`,
      );
    q = q.eq("channel", channel);
  }
  const status = url.searchParams.get("status");
  if (status !== null) {
    if (!STATUSES.includes(status))
      return apiError(
        422,
        "invalid",
        `status must be one of ${STATUSES.join(", ")}.`,
      );
    q = q.eq("status", status);
  }
  const { data, error } = await paged(q, page.cursor, page.size);
  if (error) return failed("list conversations", error);
  const out = pageOf(
    (data ?? []) as unknown as { created_at: string; id: string }[],
    page.size,
  );
  if (url.searchParams.get("include") !== "messages" || out.data.length === 0)
    return apiJson(out);
  const ids = out.data.map((c) => c.id);
  const { data: msgs, error: mErr } = await ctx
    .from(
      "messages",
      "id, conversation_id, direction, author, body, delivery_status, sent_at",
    )
    .in("conversation_id", ids)
    .order("sent_at", { ascending: false })
    .limit(ids.length * 20);
  if (mErr) return failed("list messages", mErr);
  const by = new Map<string, unknown[]>();
  for (const m of (
    (msgs ?? []) as unknown as { conversation_id: string }[]
  ).reverse()) {
    const list = by.get(m.conversation_id) ?? [];
    list.push(m);
    by.set(m.conversation_id, list.slice(-20));
  }
  return apiJson({
    ...out,
    data: out.data.map((c) => ({ ...c, messages: by.get(c.id) ?? [] })),
  });
}
