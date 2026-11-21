import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MCP_CONTACTS_MAX, MCP_LIST_MAX } from "./config";

// Dialvo's MCP server for reps: the tools a rep's assistant (Claude or any
// MCP client) can call, each on the key's own workspace. The tools decide
// what is allowed (read-only keys can't change anything) and turn answers
// into text; the data itself comes through McpData (data.ts), which names
// the workspace in every query.

export type LeadSummary = {
  id: string;
  name: string;
  email: string | null;
  company: string | null;
  website: string | null;
  status: string;
  source: string;
  created_at: string;
};

export interface McpData {
  searchLeads(input: {
    query: string;
    status: string | null;
    limit: number;
  }): Promise<LeadSummary[]>;
  getLead(input: {
    id?: string;
    email?: string;
  }): Promise<Record<string, unknown> | null>;
  listPlays(): Promise<
    { id: string; name: string; kind: string; status: string }[]
  >;
  listMeetings(input: {
    from: string;
    to: string;
    mine: boolean;
    limit: number;
  }): Promise<Record<string, unknown>[]>;
  addLead(input: {
    email: string;
    name: string;
    company: string;
    website: string;
    note: string;
  }): Promise<
    { status: "created"; lead: LeadSummary } | { status: "exists"; id: string }
  >;
  addToPlay(input: {
    playId: string;
    leadId: string;
    note: string;
  }): Promise<string>;
  latestBrief(leadId: string): Promise<Record<string, unknown> | null>;
  requestBrief(leadId: string): Promise<string>;
  findContacts(input: {
    domain: string;
    titles: string[];
    limit: number;
  }): Promise<
    | {
        status: "ok";
        contacts: {
          name: string;
          title: string;
          email: string | null;
          linkedin: string | null;
        }[];
        credits: number;
      }
    | { status: "off" | "capped" | "unavailable" | "invalid" }
  >;
}

export type McpAccess = { scope: "read" | "write"; workspaceName: string };

const json = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});
const refuse = (text: string) => ({
  content: [{ type: "text" as const, text }],
  isError: true,
});

const READ = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
};
const WRITE = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: false,
};

const NOT_WRITE =
  "This key is read-only, so it can't change anything. Ask an admin for a key with write access, or make a personal one in Dialvo, Settings, MCP.";

export function buildMcpServer(data: McpData, access: McpAccess): McpServer {
  const server = new McpServer(
    { name: "dialvo", title: "Dialvo", version: "1.0.0" },
    {
      instructions: `Dialvo is the sales workspace of ${access.workspaceName}. These tools read and update its leads, plays, meetings and account briefs. Nothing here sends an email: adding a lead to a play writes a first email that waits for approval in Dialvo.${access.scope === "read" ? " This key is read-only." : ""}`,
    },
  );
  const canWrite = access.scope === "write";

  server.registerTool(
    "search_leads",
    {
      title: "Search leads",
      description:
        "Find leads by name, email or company, optionally at one stage. Newest first.",
      inputSchema: {
        query: z
          .string()
          .max(120)
          .optional()
          .describe("Words in the name, email or company"),
        status: z
          .enum([
            "new",
            "engaged",
            "qualified",
            "meeting_booked",
            "won",
            "lost",
            "unsubscribed",
          ])
          .optional(),
        limit: z.number().int().min(1).max(MCP_LIST_MAX).optional(),
      },
      annotations: READ,
    },
    async ({ query, status, limit }) =>
      json(
        await data.searchLeads({
          query: query ?? "",
          status: status ?? null,
          limit: limit ?? 10,
        }),
      ),
  );

  server.registerTool(
    "get_lead",
    {
      title: "Get a lead with its history",
      description:
        "One lead by id or email: the lead, what Dialvo knows about the company, recent messages on every channel, calls, meetings, notes and the latest account brief's summary.",
      inputSchema: {
        lead_id: z.string().uuid().optional(),
        email: z.string().email().max(254).optional(),
      },
      annotations: READ,
    },
    async ({ lead_id, email }) => {
      if (!lead_id && !email) return refuse("Give lead_id or email.");
      const lead = await data.getLead({ id: lead_id, email });
      return lead ? json(lead) : refuse("No such lead in this workspace.");
    },
  );

  server.registerTool(
    "list_plays",
    {
      title: "List plays",
      description:
        "The workspace's plays, with their ids, for add_lead_to_play.",
      inputSchema: {},
      annotations: READ,
    },
    async () => json(await data.listPlays()),
  );

  server.registerTool(
    "list_meetings",
    {
      title: "List meetings",
      description:
        "Meetings between two times (default: the next 7 days), soonest first.",
      inputSchema: {
        from: z.string().datetime({ offset: true }).optional(),
        to: z.string().datetime({ offset: true }).optional(),
        mine: z
          .boolean()
          .optional()
          .describe("Only the key's own person's meetings (personal keys)"),
        limit: z.number().int().min(1).max(MCP_LIST_MAX).optional(),
      },
      annotations: READ,
    },
    async ({ from, to, mine, limit }) => {
      const start = from ? new Date(from) : new Date();
      const end = to
        ? new Date(to)
        : new Date(start.getTime() + 7 * 86_400_000);
      if (end <= start) return refuse("to must be after from.");
      return json(
        await data.listMeetings({
          from: start.toISOString(),
          to: end.toISOString(),
          mine: mine ?? false,
          limit: limit ?? 20,
        }),
      );
    },
  );

  server.registerTool(
    "get_account_brief",
    {
      title: "Get the account brief",
      description:
        "The latest account brief for a lead: company facts, people, past conversations, open questions and talking points, with sources. With make=true and none ready, asks Dialvo to make one (it takes a minute or two; call again).",
      inputSchema: {
        lead_id: z.string().uuid(),
        make: z.boolean().optional(),
      },
      annotations: { ...WRITE, readOnlyHint: false },
    },
    async ({ lead_id, make }) => {
      const brief = await data.latestBrief(lead_id);
      if (brief && brief.status === "ready") return json(brief);
      if (!make)
        return brief
          ? json(brief)
          : refuse("No brief yet. Call again with make=true to ask for one.");
      if (!canWrite) return refuse(NOT_WRITE);
      const status = await data.requestBrief(lead_id);
      if (status === "queued" || status === "waiting")
        return json({
          status: "being_made",
          note: "Dialvo is writing the brief. Call again in a minute or two.",
        });
      if (status === "capped")
        return refuse(
          "Today's limit of briefs is used up. Try again tomorrow.",
        );
      return refuse("No such lead in this workspace.");
    },
  );

  server.registerTool(
    "add_lead",
    {
      title: "Add a lead",
      description:
        "Adds a lead to the workspace (a personal key makes its person the owner). Nothing is sent to them.",
      inputSchema: {
        email: z.string().email().max(254),
        name: z.string().max(200).optional(),
        company: z.string().max(200).optional(),
        website: z.string().max(300).optional(),
        note: z.string().max(1000).optional(),
      },
      annotations: WRITE,
    },
    async (input) => {
      if (!canWrite) return refuse(NOT_WRITE);
      const r = await data.addLead({
        email: input.email,
        name: input.name ?? "",
        company: input.company ?? "",
        website: input.website ?? "",
        note: input.note ?? "",
      });
      return r.status === "created"
        ? json(r.lead)
        : json({
            status: "exists",
            lead_id: r.id,
            note: "A lead with that email is already in this workspace.",
          });
    },
  );

  server.registerTool(
    "add_lead_to_play",
    {
      title: "Add a lead to a play",
      description:
        "Puts one of the workspace's leads into a running play (ids from list_plays). Its first email is written by Dialvo and waits for approval under the play's rules.",
      inputSchema: {
        lead_id: z.string().uuid(),
        play_id: z.string().uuid(),
        note: z
          .string()
          .max(300)
          .optional()
          .describe("Why now, shown to the writer"),
      },
      annotations: WRITE,
    },
    async ({ lead_id, play_id, note }) => {
      if (!canWrite) return refuse(NOT_WRITE);
      const status = await data.addToPlay({
        playId: play_id,
        leadId: lead_id,
        note: note ?? "",
      });
      const said: Record<string, string> = {
        added: "Added. The first email waits for approval in Dialvo.",
        already_added: "That lead is already in this play.",
        no_email: "The lead has no email address.",
        not_allowed:
          "The lead is do not contact, unsubscribed or on the never-contact list.",
        stopped: "That play isn't running.",
        not_a_lead_play: "That play works on companies, not leads.",
        not_found: "No such play or lead in this workspace.",
      };
      return status === "added"
        ? json({ status, note: said.added })
        : refuse(said[status] ?? "That didn't work.");
    },
  );

  server.registerTool(
    "find_contacts",
    {
      title: "Find contacts at a company",
      description: `Looks up up to ${MCP_CONTACTS_MAX} people at a company by its website, with their work email when found, from Dialvo's contact database. Spends contact credits from the workspace's daily allowance. Doesn't add them as leads.`,
      inputSchema: {
        website: z
          .string()
          .min(3)
          .max(300)
          .describe("The company's website or domain"),
        titles: z
          .array(z.string().max(60))
          .max(5)
          .optional()
          .describe('Job titles to look for, e.g. "Head of Sales"'),
        limit: z.number().int().min(1).max(MCP_CONTACTS_MAX).optional(),
      },
      annotations: { ...WRITE, openWorldHint: true },
    },
    async ({ website, titles, limit }) => {
      if (!canWrite)
        return refuse(`${NOT_WRITE} (Finding contacts spends credits.)`);
      const r = await data.findContacts({
        domain: website,
        titles: titles ?? [],
        limit: limit ?? 1,
      });
      switch (r.status) {
        case "ok":
          return json(r);
        case "off":
          return refuse(
            "The contact database isn't switched on for Dialvo yet.",
          );
        case "capped":
          return refuse(
            "Today's contact lookups are used up for this workspace. Try again tomorrow.",
          );
        case "invalid":
          return refuse("That isn't a company website.");
        default:
          return refuse(
            "The contact database didn't answer. Try again in a minute.",
          );
      }
    },
  );

  return server;
}
