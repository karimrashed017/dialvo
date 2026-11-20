import type { HttpDeps } from "../http";

// A pretend CRM for the unit tests: every request is recorded and answered
// by the first route whose method and path match. Time is fake too, so
// waits and spacing are checked without waiting.

export type Call = {
  method: string;
  url: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
};

export type Answer = {
  status?: number;
  json?: unknown;
  headers?: Record<string, string>;
};

export type Route = [
  method: string,
  path: RegExp,
  answer: Answer | ((call: Call, n: number) => Answer),
];

export function fakeCrm(routes: Route[]) {
  const calls: Call[] = [];
  const sleeps: number[] = [];
  let clock = 1_000_000;
  const seen = new Map<Route, number>();
  const deps: HttpDeps = {
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const u = new URL(url);
      const call: Call = {
        method: init?.method ?? "GET",
        url,
        path: u.pathname + u.search,
        headers: Object.fromEntries(
          Object.entries((init?.headers ?? {}) as Record<string, string>).map(
            ([k, v]) => [k.toLowerCase(), v],
          ),
        ),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      };
      calls.push(call);
      clock += 5;
      const route = routes.find(
        ([m, p]) => (m === "*" || m === call.method) && p.test(call.path),
      );
      if (!route)
        return new Response(JSON.stringify({ message: "no route" }), {
          status: 599,
        });
      const n = seen.get(route) ?? 0;
      seen.set(route, n + 1);
      const a = typeof route[2] === "function" ? route[2](call, n) : route[2];
      return new Response(a.json === undefined ? "" : JSON.stringify(a.json), {
        status: a.status ?? 200,
        headers: a.headers,
      });
    }) as typeof fetch,
  };
  return { deps, calls, sleeps };
}
