import "server-only";
import {
  apiError,
  apiJson,
  authorise,
  failed,
  isId,
  readBody,
} from "@/lib/api/v1";
import { cleanText, normalizeEmail } from "@/lib/leads/fields";

// POST /api/v1/plays/<id>/leads   adds one of your leads to a running play:
//      { "lead_id": "..." } or { "email": "..." }, and optionally "note" (why
//      now, one sentence the email may build on). Its email is written by
//      the play's next "Write emails" and waits for approval like every other.

const ANSWERS: Record<string, [number, string, string?]> = {
  added: [201, "added"],
  not_found: [404, "not_found"],
  not_a_lead_play: [
    422,
    "not_a_lead_play",
    "This play finds companies; it doesn't take leads.",
  ],
  stopped: [409, "stopped", "This play isn't running."],
  no_email: [422, "no_email", "That lead has no email address."],
  not_allowed: [
    422,
    "not_allowed",
    "That lead is do not contact, unsubscribed or on your never-contact list.",
  ],
  already_added: [409, "already_added", "That lead is already in this play."],
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorise(request);
  if (!auth.ok) return auth.response;
  const { ctx } = auth;
  const { id } = await params;
  if (!isId(id)) return apiError(404, "not_found");
  const read = await readBody(request);
  if (!read.ok) return read.response;
  let leadId = read.body.lead_id;
  if (leadId === undefined && read.body.email !== undefined) {
    const email = normalizeEmail(read.body.email);
    if (!email)
      return apiError(422, "invalid", "email isn't an email address.");
    const { data, error } = await ctx
      .from("leads", "id")
      .eq("email", email)
      .maybeSingle();
    if (error) return failed("find lead", error);
    if (!data)
      return apiError(
        404,
        "not_found",
        "No lead in this workspace has that email.",
      );
    leadId = (data as unknown as { id: string }).id;
  }
  if (!isId(leadId)) return apiError(422, "invalid", "Send lead_id or email.");
  const { data, error } = await ctx.supabase.rpc("api_play_add_lead", {
    p_workspace_id: ctx.workspaceId,
    p_campaign_id: id,
    p_lead_id: leadId,
    p_note: cleanText(read.body.note, 300) || null,
  });
  if (error) return failed("add lead to play", error);
  const r = data as { status: string; target_id?: string };
  const [status, code, message] = ANSWERS[r.status] ?? [422, "invalid"];
  return status === 201
    ? apiJson({ status: "added", lead_id: leadId, play_id: id }, 201)
    : apiError(status, code, message);
}
