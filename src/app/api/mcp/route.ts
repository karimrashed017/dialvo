import "server-only";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { apiError, authorise } from "@/lib/api/v1";
import { MCP_BODY_MAX_BYTES, MCP_CALLS_PER_MINUTE } from "@/lib/mcp/config";
import { createMcpData } from "@/lib/mcp/data";
import { buildMcpServer } from "@/lib/mcp/server";
import { createPlaysFindymail } from "@/lib/plays/findymail";
import { SITE_URL } from "@/lib/site";

// POST /api/mcp: Dialvo's remote MCP server for reps, over Streamable HTTP
// (MCP spec 2025-11-25, also 2025-06-18 and 2025-03-26 clients), with the
// official TypeScript SDK's web-standard transport. Stateless: every
// request builds the server for the key's workspace and answers in JSON,
// so it runs as an ordinary serverless function. No sessions, no stream to
// resume, nothing kept between requests.
//
//   Authorization: Bearer dv_live_...   a workspace or personal API key
//
// The key decides the workspace (never the request) and what may change: a
// read-only key can call the reading tools only. Calls count against the
// key's per-minute cap in the database, like the REST API.

export const maxDuration = 60;

function originAllowed(request: Request): boolean {
  // MCP clients call from servers or desktop apps, which send no Origin. A
  // browser page on another site must not be able to call this with a key
  // it found: only our own origin is let through (DNS-rebinding advice in
  // the MCP spec).
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(SITE_URL).origin;
}

export async function POST(request: Request) {
  if (!originAllowed(request)) return apiError(403, "forbidden_origin");
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MCP_BODY_MAX_BYTES) return apiError(413, "too_large");
  const auth = await authorise(request, {
    perMinute: MCP_CALLS_PER_MINUTE,
    readOnPost: true,
  });
  if (!auth.ok) return auth.response;
  const { ctx } = auth;
  const { data: ws } = await ctx.supabase
    .from("workspaces")
    .select("name")
    .eq("id", ctx.workspaceId)
    .maybeSingle();
  const server = buildMcpServer(
    createMcpData({
      supabase: ctx.supabase,
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      findymail: createPlaysFindymail(),
    }),
    {
      scope: ctx.scope,
      workspaceName: (ws as { name?: string } | null)?.name ?? "your workspace",
    },
  );
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    maxRequestBodySize: MCP_BODY_MAX_BYTES,
  });
  try {
    await server.connect(transport);
    return await transport.handleRequest(request);
  } catch (error) {
    console.error("[mcp] request failed:", (error as Error).message);
    return apiError(500, "failed");
  } finally {
    // Stateless: nothing outlives the request.
    void transport.close().catch(() => undefined);
  }
}

// No server-sent stream and no sessions to end, so these say so.
const notHere = () =>
  new Response(null, {
    status: 405,
    headers: { Allow: "POST", "Cache-Control": "no-store" },
  });
export const GET = notHere;
export const DELETE = notHere;
