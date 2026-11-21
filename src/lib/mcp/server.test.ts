import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { describe, expect, it, vi } from "vitest";
import { buildMcpServer, type McpData } from "./server";

// The MCP server end to end through the official SDK's transport, as the
// route runs it (stateless, JSON answers), with the data faked.

const data = (): McpData & Record<string, ReturnType<typeof vi.fn>> => ({
  searchLeads: vi.fn(async () => [
    {
      id: "l1",
      name: "Pat",
      email: "pat@acme.example",
      company: "Acme",
      website: null,
      status: "new",
      source: "form",
      created_at: "2026-11-20T00:00:00Z",
    },
  ]),
  getLead: vi.fn(async () => null),
  listPlays: vi.fn(async () => []),
  listMeetings: vi.fn(async () => []),
  addLead: vi.fn(async () => ({ status: "exists" as const, id: "l1" })),
  addToPlay: vi.fn(async () => "added"),
  latestBrief: vi.fn(async () => null),
  requestBrief: vi.fn(async () => "queued"),
  findContacts: vi.fn(async () => ({ status: "capped" as const })),
});

async function rpc(
  d: McpData,
  scope: "read" | "write",
  method: string,
  params: unknown = {},
) {
  const server = buildMcpServer(d, { scope, workspaceName: "Agency A" });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  const res = await transport.handleRequest(
    new Request("https://trydialvo.com/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-06-18",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
  );
  await transport.close();
  return (await res.json()) as {
    result?: Record<string, unknown>;
    error?: unknown;
  };
}

describe("the MCP server", () => {
  it("initialises and lists its tools, read and write marked", async () => {
    const init = await rpc(data(), "read", "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    expect((init.result?.serverInfo as { name: string }).name).toBe("dialvo");
    const list = await rpc(data(), "read", "tools/list");
    const tools = list.result?.tools as {
      name: string;
      annotations?: { readOnlyHint?: boolean };
    }[];
    expect(tools.map((t) => t.name).sort()).toEqual([
      "add_lead",
      "add_lead_to_play",
      "find_contacts",
      "get_account_brief",
      "get_lead",
      "list_meetings",
      "list_plays",
      "search_leads",
    ]);
    expect(
      tools.find((t) => t.name === "search_leads")?.annotations?.readOnlyHint,
    ).toBe(true);
  });

  it("answers reading tools from the data", async () => {
    const d = data();
    const r = await rpc(d, "read", "tools/call", {
      name: "search_leads",
      arguments: { query: "acme" },
    });
    expect(d.searchLeads).toHaveBeenCalledWith({
      query: "acme",
      status: null,
      limit: 10,
    });
    expect(JSON.stringify(r.result)).toContain("pat@acme.example");
  });

  it("refuses writing tools to a read-only key, and never reaches the data", async () => {
    const d = data();
    for (const [name, args] of [
      ["add_lead", { email: "new@x.example" }],
      [
        "add_lead_to_play",
        {
          lead_id: "11111111-1111-4111-8111-111111111111",
          play_id: "11111111-1111-4111-8111-111111111112",
        },
      ],
      ["find_contacts", { website: "acme.example" }],
    ] as const) {
      const r = await rpc(d, "read", "tools/call", { name, arguments: args });
      expect(r.result?.isError, name).toBe(true);
      expect(JSON.stringify(r.result)).toMatch(/read-only/);
    }
    expect(d.addLead).not.toHaveBeenCalled();
    expect(d.addToPlay).not.toHaveBeenCalled();
    expect(d.findContacts).not.toHaveBeenCalled();
  });

  it("lets a write key add to a play and says when contact lookups are used up", async () => {
    const d = data();
    const added = await rpc(d, "write", "tools/call", {
      name: "add_lead_to_play",
      arguments: {
        lead_id: "11111111-1111-4111-8111-111111111111",
        play_id: "11111111-1111-4111-8111-111111111112",
      },
    });
    expect(JSON.stringify(added.result)).toContain("waits for approval");
    const capped = await rpc(d, "write", "tools/call", {
      name: "find_contacts",
      arguments: { website: "acme.example" },
    });
    expect(capped.result?.isError).toBe(true);
    expect(JSON.stringify(capped.result)).toMatch(/used up/);
  });
});
