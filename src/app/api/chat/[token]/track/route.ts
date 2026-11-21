import "server-only";
import { after } from "next/server";
import {
  CHAT_TOKEN,
  chatJson,
  chatOptions,
  clientIp,
  pageOrigin,
  readChatBody,
} from "@/lib/chat/http";
import { createLimiter } from "@/lib/leads/rate-limit";
import { createServiceClient } from "@/lib/supabase/service";
import { IPAPI_ENV } from "@/lib/visitors/identify";
import { handleTrack } from "@/lib/visitors/track";

// Website visitors: the chat script's page views and form emails.
//
//   GET  /api/chat/<token>/track   is tracking on, and must it wait for
//                                  consent? Asked before anything is sent.
//   POST /api/chat/<token>/track   { t: "view" | "identify", ... }
//
// The script sends nothing when the browser has Do Not Track or Global
// Privacy Control on, or (by default) before the site says the visitor
// agreed. Loads on Dialvo's own pages are ignored. See src/lib/visitors.

export const OPTIONS = chatOptions;

const perAddress = createLimiter({ windowMs: 60_000, max: 120 });

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!CHAT_TOKEN.test(token)) return chatJson({ ok: false }, 404);
  const supabase = createServiceClient();
  if (!supabase) return chatJson({ ok: true, on: false });
  if (perAddress.take(clientIp(request)) > 0)
    return chatJson({ ok: false }, 429, { "Retry-After": "60" });
  const { data, error } = await supabase.rpc("site_tracker_config", {
    p_token: token,
  });
  if (error) return chatJson({ ok: true, on: false });
  const config = (data ?? { on: false }) as { on: boolean; consent?: string };
  return chatJson(
    { ok: true, on: Boolean(config.on), consent: config.consent ?? "wait" },
    200,
    // The answer is the same for every visitor: browsers may keep it a while.
    { "Cache-Control": "public, max-age=300" },
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!CHAT_TOKEN.test(token)) return chatJson({ ok: false }, 404);
  const supabase = createServiceClient();
  if (!supabase) return chatJson({ ok: false, track: false });
  // Dialvo's own pages (the preview in Settings) aren't the customer's site.
  if (!pageOrigin(request)) return chatJson({ ok: true, track: false });
  const ip = clientIp(request);
  if (perAddress.take(ip) > 0)
    return chatJson({ ok: false }, 429, { "Retry-After": "60" });
  const body = await readChatBody(request);
  if (typeof body === "string") return chatJson({ ok: false }, 422);
  try {
    const r = await handleTrack(
      { token, ip, body },
      {
        rpc: async (name, args) => {
          const { data, error } = await supabase.rpc(name, args);
          if (error) throw new Error(`${name}: ${error.message}`);
          return data;
        },
        providerKey: process.env[IPAPI_ENV] || null,
        fetch: (...a) => fetch(...a),
        later: (task) =>
          after(() =>
            task().catch((e) =>
              console.error("[visitors] lookup failed:", (e as Error).message),
            ),
          ),
      },
    );
    return chatJson({ ok: r.ok, track: r.track ?? true }, r.status);
  } catch (error) {
    console.error("[visitors] track failed:", (error as Error).message);
    return chatJson({ ok: false }, 503);
  }
}
