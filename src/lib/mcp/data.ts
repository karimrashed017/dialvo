import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BRIEFS_PER_DAY } from "@/lib/briefs/config";
import { normalizeEmail } from "@/lib/leads/fields";
import { DEFAULT_TITLES } from "@/lib/plays/campaign-run";
import { CREDITS_EMAIL, CREDITS_EMPLOYEE } from "@/lib/plays/config";
import type { PlaysFindymail } from "@/lib/plays/findymail";
import { DAILY_CONTACT_CREDIT_CAP } from "@/lib/prospects/config";
import { isCompanySite, siteDomain } from "@/lib/prospects/domains";
import { MCP_HISTORY_MAX } from "./config";
import type { LeadSummary, McpData } from "./server";

// The MCP tools' data, with the secret key. THE SECRET KEY BYPASSES
// ROW-LEVEL SECURITY: every query here names the key's workspace
// (`workspaceId`, from the key, never from the request), and ids from the
// request are only looked up together with it.

const LEAD = "id, name, email, company, website, status, source, created_at";

/** For PostgREST's or(): no commas, brackets or wildcards from the caller. */
const term = (q: string) =>
  q
    .replace(/[%_,()*\\"']/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);

export function createMcpData(input: {
  supabase: SupabaseClient;
  workspaceId: string;
  userId: string | null;
  findymail: PlaysFindymail | null;
}): McpData {
  const { supabase, workspaceId, userId } = input;
  const leads = () =>
    supabase.from("leads").select(LEAD).eq("workspace_id", workspaceId);
  const must = <T>(
    r: { data: T; error: { message: string } | null },
    what: string,
  ): T => {
    if (r.error) throw new Error(`${what}: ${r.error.message}`);
    return r.data;
  };

  return {
    async searchLeads({ query, status, limit }) {
      let q = leads();
      const t = term(query);
      if (t)
        q = q.or(`name.ilike.%${t}%,email.ilike.%${t}%,company.ilike.%${t}%`);
      if (status) q = q.eq("status", status);
      return (must(
        await q.order("created_at", { ascending: false }).limit(limit),
        "search leads",
      ) ?? []) as LeadSummary[];
    },

    async getLead({ id, email }) {
      let q = supabase
        .from("leads")
        .select(
          `${LEAD}, phone, owner_id, do_not_contact, custom_fields, updated_at`,
        )
        .eq("workspace_id", workspaceId);
      if (id) q = q.eq("id", id);
      else q = q.eq("email", normalizeEmail(email) ?? "");
      const lead = must(await q.maybeSingle(), "get lead") as Record<
        string,
        unknown
      > | null;
      if (!lead) return null;
      const leadId = String(lead.id);
      const [convs, calls, meetings, notes, research, brief] =
        await Promise.all([
          supabase
            .from("conversations")
            .select("id, channel, status")
            .eq("workspace_id", workspaceId)
            .eq("lead_id", leadId),
          supabase
            .from("calls")
            .select("started_at, direction, status, summary")
            .eq("workspace_id", workspaceId)
            .eq("lead_id", leadId)
            .order("created_at", { ascending: false })
            .limit(5),
          supabase
            .from("meetings")
            .select("id, title, starts_at, status, source")
            .eq("workspace_id", workspaceId)
            .eq("lead_id", leadId)
            .order("starts_at", { ascending: false })
            .limit(10),
          supabase
            .from("activity_events")
            .select("created_at, kind, summary")
            .eq("workspace_id", workspaceId)
            .eq("lead_id", leadId)
            .order("created_at", { ascending: false })
            .limit(15),
          supabase
            .from("prospects")
            .select("summary, contact_role, facts, country, size_range")
            .eq("workspace_id", workspaceId)
            .eq("lead_id", leadId)
            .limit(1)
            .maybeSingle(),
          supabase
            .from("account_briefs")
            .select("id, kind, status, summary, ready_at")
            .eq("workspace_id", workspaceId)
            .eq("lead_id", leadId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);
      const convIds = ((convs.data ?? []) as { id: string }[]).map((c) => c.id);
      const messages = convIds.length
        ? ((
            await supabase
              .from("messages")
              .select("conversation_id, direction, author, body, sent_at")
              .eq("workspace_id", workspaceId)
              .in("conversation_id", convIds)
              .order("sent_at", { ascending: false })
              .limit(MCP_HISTORY_MAX)
          ).data ?? [])
        : [];
      const channel = new Map(
        ((convs.data ?? []) as { id: string; channel: string }[]).map((c) => [
          c.id,
          c.channel,
        ]),
      );
      return {
        lead,
        company_research: research.data ?? null,
        messages: (
          messages as {
            conversation_id: string;
            author: string;
            body: string;
            sent_at: string;
          }[]
        ).map((m) => ({
          at: m.sent_at,
          channel: channel.get(m.conversation_id),
          from: m.author,
          body: m.body.slice(0, 1500),
        })),
        calls: calls.data ?? [],
        meetings: meetings.data ?? [],
        timeline: notes.data ?? [],
        latest_brief: brief.data ?? null,
      };
    },

    async listPlays() {
      return (must(
        await supabase
          .from("outbound_campaigns")
          .select("id, name, kind, status")
          .eq("workspace_id", workspaceId)
          .order("created_at", { ascending: false })
          .limit(50),
        "list plays",
      ) ?? []) as { id: string; name: string; kind: string; status: string }[];
    },

    async listMeetings({ from, to, mine, limit }) {
      let q = supabase
        .from("meetings")
        .select(
          "id, title, starts_at, ends_at, status, source, host_id, lead:leads(id, name, email, company)",
        )
        .eq("workspace_id", workspaceId)
        .gte("starts_at", from)
        .lt("starts_at", to);
      if (mine && userId) q = q.eq("host_id", userId);
      return (must(await q.order("starts_at").limit(limit), "list meetings") ??
        []) as Record<string, unknown>[];
    },

    async addLead({ email, name, company, website, note }) {
      const e = normalizeEmail(email);
      if (!e) throw new Error("add lead: bad email");
      const existing = must(
        await supabase
          .from("leads")
          .select("id")
          .eq("workspace_id", workspaceId)
          .eq("email", e)
          .maybeSingle(),
        "find lead",
      ) as { id: string } | null;
      if (existing) return { status: "exists", id: existing.id };
      const r = await supabase
        .from("leads")
        .insert({
          workspace_id: workspaceId,
          email: e,
          name: name.slice(0, 200),
          company: company.slice(0, 200) || null,
          website: website.slice(0, 300) || null,
          source: "mcp",
          owner_id: userId,
        })
        .select(LEAD)
        .single();
      if (r.error?.code === "23505") {
        const again = (
          await supabase
            .from("leads")
            .select("id")
            .eq("workspace_id", workspaceId)
            .eq("email", e)
            .single()
        ).data as { id: string };
        return { status: "exists", id: again.id };
      }
      const lead = must(r, "add lead") as unknown as LeadSummary;
      if (note.trim())
        await supabase.from("activity_events").insert({
          workspace_id: workspaceId,
          lead_id: lead.id,
          actor_id: userId,
          kind: "note",
          summary: note.trim().slice(0, 1000),
          metadata: { via: "mcp" },
        });
      return { status: "created", lead };
    },

    async addToPlay({ playId, leadId, note }) {
      const r = must(
        await supabase.rpc("api_play_add_lead", {
          p_workspace_id: workspaceId,
          p_campaign_id: playId,
          p_lead_id: leadId,
          p_note: note || "Added from an assistant (MCP).",
        }),
        "add to play",
      ) as { status: string };
      return r.status;
    },

    async latestBrief(leadId) {
      return must(
        await supabase
          .from("account_briefs")
          .select(
            "id, kind, status, summary, content, sources, error, ready_at, created_at",
          )
          .eq("workspace_id", workspaceId)
          .eq("lead_id", leadId)
          .eq("kind", "brief")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        "latest brief",
      ) as Record<string, unknown> | null;
    },

    async requestBrief(leadId) {
      const r = must(
        await supabase.rpc("brief_request", {
          p_workspace_id: workspaceId,
          p_user_id: userId,
          p_lead_id: leadId,
          p_kind: "brief",
          p_reason: "mcp",
          p_max_per_day: BRIEFS_PER_DAY,
        }),
        "request brief",
      ) as { status: string };
      return r.status;
    },

    async findContacts({ domain, titles, limit }) {
      const d = siteDomain(domain);
      if (!d || !isCompanySite(d)) return { status: "invalid" };
      if (!input.findymail) return { status: "off" };
      const perPerson = CREDITS_EMPLOYEE + CREDITS_EMAIL;
      const reserved = limit * perPerson;
      const ok = must(
        await supabase.rpc("contact_credits_reserve", {
          p_workspace_id: workspaceId,
          p_credits: reserved,
          p_max_per_day: DAILY_CONTACT_CREDIT_CAP,
        }),
        "reserve credits",
      );
      if (!ok) return { status: "capped" };
      let spent = 0;
      try {
        const people = await input.findymail.employees(
          d,
          titles.length ? titles : DEFAULT_TITLES,
          limit,
        );
        if (!people.ok) return { status: "unavailable" };
        const found = people.value.slice(0, limit);
        spent += found.length * CREDITS_EMPLOYEE;
        const contacts = [];
        for (const p of found) {
          const e = await input.findymail.email(p.name, d);
          const email = e.ok ? e.value : null;
          if (email) spent += CREDITS_EMAIL;
          contacts.push({
            name: p.name,
            title: p.title,
            email,
            linkedin: p.linkedin,
          });
        }
        return { status: "ok", contacts, credits: spent };
      } finally {
        if (reserved - spent > 0)
          await supabase.rpc("contact_credits_reserve", {
            p_workspace_id: workspaceId,
            p_credits: -(reserved - spent),
            p_max_per_day: DAILY_CONTACT_CREDIT_CAP,
          });
      }
    },
  };
}
