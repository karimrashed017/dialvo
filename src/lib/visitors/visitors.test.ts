import { describe, expect, it, vi } from "vitest";
import {
  lookupCompany,
  lookupWorthy,
  readIpapi,
  visitorIdStatus,
} from "./identify";
import {
  cleanHost,
  cleanPath,
  handleTrack,
  ipHash,
  type TrackDeps,
} from "./track";

describe("company lookups (ipapi.is)", () => {
  it("keep only business networks", () => {
    const business = {
      company: { name: "Acme Corp", domain: "www.acme.com", type: "business" },
      location: { country_code: "GB" },
    };
    expect(readIpapi(business)).toEqual({
      domain: "acme.com",
      name: "Acme Corp",
      country: "GB",
      source: "ipapi",
    });
    expect(
      readIpapi({ ...business, company: { ...business.company, type: "isp" } }),
    ).toBe(null);
    expect(readIpapi({ ...business, is_vpn: true })).toBe(null);
    expect(readIpapi({ ...business, is_datacenter: true })).toBe(null);
    expect(readIpapi({ ...business, is_mobile: true })).toBe(null);
    expect(readIpapi({ company: null })).toBe(null);
  });

  it("never sends a private address, and keeps the key out of the URL", async () => {
    expect(lookupWorthy("10.1.2.3")).toBe(false);
    expect(lookupWorthy("192.168.0.4")).toBe(false);
    expect(lookupWorthy("::1")).toBe(false);
    expect(lookupWorthy("81.2.69.160")).toBe(true);
    const fetcher = vi.fn(async () =>
      Response.json({ company: { domain: "acme.com", type: "business" } }),
    );
    expect(
      await lookupCompany("10.0.0.1", "k", fetcher as unknown as typeof fetch),
    ).toBe(null);
    expect(fetcher).not.toHaveBeenCalled();
    await lookupCompany(
      "81.2.69.160",
      "secret-key",
      fetcher as unknown as typeof fetch,
    );
    const [url, init] = fetcher.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.ipapi.is");
    expect(url).not.toContain("secret-key");
    expect(JSON.parse(String(init.body))).toEqual({
      q: "81.2.69.160",
      key: "secret-key",
    });
    expect(
      await lookupCompany(
        "81.2.69.160",
        "k",
        (async () =>
          new Response("", { status: 429 })) as unknown as typeof fetch,
      ),
    ).toBe("failed");
  });

  it("says which key is missing", () => {
    expect(visitorIdStatus({})).toEqual({
      on: false,
      provider: "ipapi.is",
      envName: "IPAPI_IS_API_KEY",
    });
    expect(visitorIdStatus({ IPAPI_IS_API_KEY: "x" }).on).toBe(true);
  });
});

describe("the tracker endpoint's logic", () => {
  const token = "a".repeat(64);
  const make = (answers: Record<string, unknown>, key: string | null = "k") => {
    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) =>
      args ? answers[name] : undefined,
    );
    const later: (() => Promise<void>)[] = [];
    const fetcher = vi.fn(async () =>
      Response.json({
        company: { domain: "acme.com", name: "Acme", type: "business" },
      }),
    );
    const deps: TrackDeps = {
      rpc,
      providerKey: key,
      fetch: fetcher as unknown as typeof fetch,
      later: (t) => later.push(t),
    };
    return { deps, rpc, later, fetcher };
  };

  it("keeps the path only, and hashes the browser id and the address", async () => {
    expect(cleanPath("/pricing?email=a@b.com#x")).toBe("/pricing");
    expect(cleanPath("https://evil.example/")).toBe(null);
    expect(cleanHost("www.Google.com")).toBe("www.google.com");
    expect(cleanHost("javascript:alert(1)")).toBe(null);
    const { deps, rpc } = make({
      site_track: { status: "recorded", lookup: false },
    });
    await handleTrack(
      {
        token,
        ip: "81.2.69.160",
        body: {
          t: "view",
          v: "browser-id-1234567890",
          s: "session-1",
          p: "/pricing?x=1",
          ti: "Pricing",
          r: "google.com",
        },
      },
      deps,
    );
    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_path).toBe("/pricing");
    expect(args.p_visitor_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(args.p_visitor_hash).not.toContain("browser-id");
    expect(args.p_ip_hash).toBe(ipHash(token, "81.2.69.160"));
    expect(JSON.stringify(args)).not.toContain("81.2.69.160");
  });

  it("looks a company up after answering, within the day's allowance", async () => {
    const { deps, rpc, later, fetcher } = make({
      site_track: {
        status: "recorded",
        lookup: true,
        workspace_id: "w",
        visitor_id: "v",
      },
      site_lookup_reserve: true,
    });
    const r = await handleTrack(
      {
        token,
        ip: "81.2.69.160",
        body: { t: "view", v: "browser-id-1234567890", s: "session-1", p: "/" },
      },
      deps,
    );
    expect(r).toEqual({ ok: true, status: 200, track: true });
    expect(fetcher).not.toHaveBeenCalled();
    await later[0]();
    expect(rpc).toHaveBeenCalledWith(
      "site_lookup_save",
      expect.objectContaining({
        p_company: {
          domain: "acme.com",
          name: "Acme",
          country: "",
          source: "ipapi",
        },
      }),
    );
  });

  it("makes no lookup without a key or over the allowance", async () => {
    const none = make(
      {
        site_track: {
          status: "recorded",
          lookup: true,
          workspace_id: "w",
          visitor_id: "v",
        },
      },
      null,
    );
    await handleTrack(
      {
        token,
        ip: "81.2.69.160",
        body: { t: "view", v: "browser-id-1234567890", s: "session-1", p: "/" },
      },
      none.deps,
    );
    expect(none.later).toHaveLength(0);
    const capped = make({
      site_track: {
        status: "recorded",
        lookup: true,
        workspace_id: "w",
        visitor_id: "v",
      },
      site_lookup_reserve: false,
    });
    await handleTrack(
      {
        token,
        ip: "81.2.69.160",
        body: { t: "view", v: "browser-id-1234567890", s: "session-1", p: "/" },
      },
      capped.deps,
    );
    await capped.later[0]();
    expect(capped.fetcher).not.toHaveBeenCalled();
  });

  it("tells the script to stop when tracking is off, and refuses junk", async () => {
    const off = make({ site_track: { status: "off" } });
    expect(
      await handleTrack(
        {
          token,
          ip: "x",
          body: {
            t: "view",
            v: "browser-id-1234567890",
            s: "session-1",
            p: "/",
          },
        },
        off.deps,
      ),
    ).toEqual({ ok: false, status: 200, track: false });
    expect(
      (
        await handleTrack(
          {
            token,
            ip: "x",
            body: { t: "view", v: "short", s: "session-1", p: "/" },
          },
          off.deps,
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await handleTrack(
          { token, ip: "x", body: { t: "other", v: "browser-id-1234567890" } },
          off.deps,
        )
      ).status,
    ).toBe(422);
  });
});
