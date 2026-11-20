import type { NextConfig } from "next";

// Headers on every response. No other site may show ours in a frame, so
// nobody can overlay the signup form and trick a visitor into clicking it.
//
// The live voice demo (src/app/_site/voice-demo.tsx) needs two things from
// these headers, and has both. The Content-Security-Policy only restricts
// framing, so the browser may reach ElevenLabs (https and wss on
// api.elevenlabs.io and its WebRTC hosts under *.elevenlabs.io) and run the
// SDK's audio worklets. If a stricter policy is ever added, it must allow
// those in connect-src, plus blob: and data: for the worklets. And the
// Permissions-Policy lets our own pages, and nobody we might embed, ask for
// the microphone; the camera and location stay off for everyone.
const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  {
    key: "Permissions-Policy",
    value: "microphone=(self), camera=(), geolocation=()",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  images: {
    // 90 is for the paintings, which are soft already and blur further at
    // the default 75. Everything else keeps 75.
    qualities: [75, 90],
  },
  async redirects() {
    return [
      // The waitlist closed when sign-up opened (founder, 20 Nov 2026).
      { source: "/waitlist", destination: "/signup", permanent: false },
      // The app was reorganised around its two jobs. Agents became part of
      // Website chat, and the three sections that had nothing in them yet
      // went away. Old links and bookmarks still land somewhere useful.
      { source: "/app/agents", destination: "/app/chat", permanent: false },
      {
        source: "/app/agents/try",
        destination: "/app/chat/try",
        permanent: false,
      },
      ...["sequences", "calls", "analytics"].map((section) => ({
        source: `/app/${section}`,
        destination: "/app",
        permanent: false,
      })),
    ];
  },
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
