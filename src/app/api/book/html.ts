import "server-only";

// The two small pages the booking links can end on. Plain HTML, black on
// paper, like the unsubscribe page.

const HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex",
  "Referrer-Policy": "no-referrer",
};

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function bookingPage(title: string, text: string, status = 200) {
  return new Response(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#F7F5F1;color:#0B0B0C;font:16px/1.5 system-ui,sans-serif"><main style="max-width:440px;padding:32px;text-align:center"><h1 style="font-size:24px;font-weight:500;margin:0 0 8px">${escapeHtml(title)}</h1><p style="margin:0;opacity:.7">${escapeHtml(text)}</p></main></body></html>`,
    { status, headers: HEADERS },
  );
}
