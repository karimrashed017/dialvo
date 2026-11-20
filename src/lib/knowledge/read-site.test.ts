import { describe, expect, it, vi } from "vitest";
import {
  fetchPageWithLinks,
  PageFetchError,
  pageLinks,
  type FetchedPage,
  type PageDeps,
  type PageLink,
  type RawResponse,
} from "./fetch-page";
import { pickPages, readSite, siteHost, siteTitle } from "./read-site";
import { readSiteIntoKnowledge } from "./site-knowledge";

// Reading a whole site, with the fetcher faked: which links are followed,
// that nothing off the site is read, that slow and broken pages are left
// out quietly, and what ends up in Knowledge.

const link = (url: string, text = ""): PageLink => ({ url, text });
const page = (url: string, title = "", text = "x".repeat(60)): FetchedPage => ({
  url,
  title,
  text,
  truncated: false,
});

describe("pageLinks", () => {
  it("makes links absolute, keeps https only, and drops fragments and duplicates", () => {
    const html = `
      <nav><a href="/pricing">Pricing</a> <a href='about/'>About <b>us</b></a></nav>
      <a href=/contact>Contact</a>
      <a href="https://example.org/pricing#plans">Plans</a>
      <a href="http://example.org/insecure">No</a>
      <a href="mailto:hi@example.org">Mail</a>
      <a href="tel:+15550100">Call</a>
      <a href="javascript:void(0)">Nope</a>
      <a href="#top">Top</a>
      <a href="https://other.example/x?a=1&amp;b=2">Elsewhere</a>`;
    expect(pageLinks(html, "https://example.org/home/")).toEqual([
      { url: "https://example.org/pricing", text: "Pricing" },
      { url: "https://example.org/home/about/", text: "About us" },
      { url: "https://example.org/contact", text: "Contact" },
      { url: "https://other.example/x?a=1&b=2", text: "Elsewhere" },
    ]);
  });

  it("comes back from the fetcher along with the page", async () => {
    const response: RawResponse = {
      status: 200,
      headers: { "content-type": "text/html" },
      body: Buffer.from(
        `<html><body><nav><a href="/pricing">Pricing</a></nav><p>${"Websites for dental clinics. ".repeat(4)}</p></body></html>`,
      ),
    };
    const deps: PageDeps = {
      resolve: async () => [{ address: "93.184.215.14", family: 4 }],
      request: async () => response,
    };
    const { page: read, links } = await fetchPageWithLinks("example.org", deps);
    expect(read.url).toBe("https://example.org/");
    // The menu is left out of the text, but its links are what we want.
    expect(read.text).not.toMatch(/Pricing/);
    expect(links).toEqual([
      { url: "https://example.org/pricing", text: "Pricing" },
    ]);
  });
});

describe("pickPages", () => {
  const HOME = "https://www.example.org/";

  it("picks one page per kind, the most useful kinds first, at most four", () => {
    const picked = pickPages(HOME, [
      link("https://www.example.org/contact", "Contact"),
      link("https://www.example.org/about-us", "About"),
      link("https://www.example.org/blog/pricing-update-2024", "News"),
      link("https://www.example.org/pricing", "Pricing"),
      link("https://www.example.org/faq", "FAQ"),
      link("https://www.example.org/services", "Services"),
      link("https://www.example.org/plans", "Plans"),
    ]);
    expect(picked.map((p) => [p.kind, p.url])).toEqual([
      ["pricing", "https://www.example.org/pricing"],
      ["offer", "https://www.example.org/services"],
      ["faq", "https://www.example.org/faq"],
      ["about", "https://www.example.org/about-us"],
    ]);
  });

  it("stays on the same site: other hosts, subdomains and ports are refused", () => {
    const picked = pickPages(HOME, [
      link("https://evil.example/pricing", "Pricing"),
      link("https://shop.example.org/pricing", "Pricing"),
      link("https://example.org.evil.example/about", "About"),
      link("https://www.example.org:8443/faq", "FAQ"),
      link("http://www.example.org/services", "Services"),
      link("https://example.org/contact", "Contact"),
    ]);
    // Only the bare-domain spelling of the same site gets through.
    expect(picked.map((p) => p.url)).toEqual(["https://example.org/contact"]);
  });

  it("uses the words on a link when the address says nothing", () => {
    const picked = pickPages(HOME, [
      link("https://www.example.org/p/17", "Our prices"),
      link("https://www.example.org/p/18", "Read the blog"),
    ]);
    expect(picked.map((p) => [p.kind, p.url])).toEqual([
      ["pricing", "https://www.example.org/p/17"],
    ]);
  });

  it("skips the home page itself, files, and log-in and legal pages", () => {
    expect(
      pickPages(HOME, [
        link("https://www.example.org/", "Home"),
        link("https://example.org", "Home"),
        link("https://www.example.org/pricing.pdf", "Pricing"),
        link("https://www.example.org/login", "Help"),
        link("https://www.example.org/privacy", "About your data"),
        link("https://www.example.org/careers", "Join the team"),
      ]),
    ).toEqual([]);
  });

  it("treats www and the bare domain as one site", () => {
    expect(siteHost("WWW.Example.org")).toBe("example.org");
  });
});

describe("readSite", () => {
  const HOME = "https://www.example.org/";
  const links = [
    link("https://www.example.org/pricing", "Pricing"),
    link("https://www.example.org/services", "Services"),
    link("https://www.example.org/faq", "FAQ"),
    link("https://www.example.org/about", "About"),
    link("https://www.example.org/contact", "Contact"),
    link("https://elsewhere.example/pricing", "Pricing"),
  ];

  it("reads the home page and four more pages of the same site", async () => {
    const fetch = vi.fn(async (url: string) =>
      url === "example.org"
        ? { page: page(HOME, "Example"), links }
        : { page: page(url, `T ${url}`), links: [] },
    );
    const site = await readSite("example.org", { fetch });
    expect(site.ok).toBe(true);
    if (!site.ok) return;
    expect(site.pages.map((p) => [p.kind, p.url])).toEqual([
      ["home", HOME],
      ["pricing", "https://www.example.org/pricing"],
      ["offer", "https://www.example.org/services"],
      ["faq", "https://www.example.org/faq"],
      ["about", "https://www.example.org/about"],
    ]);
    expect(fetch).toHaveBeenCalledTimes(5);
    for (const [url] of fetch.mock.calls.slice(1))
      expect(siteHost(new URL(url).hostname)).toBe("example.org");
  });

  it("says so, without throwing, when the home page can't be read", async () => {
    expect(
      await readSite("https://10.0.0.1/", {
        fetch: async () => {
          throw new PageFetchError("private_address");
        },
      }),
    ).toEqual({ ok: false, problem: "private_address" });
    expect(
      await readSite("example.org", {
        fetch: async () => {
          throw new Error("socket hang up");
        },
      }),
    ).toEqual({ ok: false, problem: "unreachable" });
  });

  it("leaves out pages that fail, repeat, or redirect off the site", async () => {
    const fetch = async (url: string) => {
      if (url === "example.org") return { page: page(HOME), links };
      if (url.endsWith("/pricing")) throw new PageFetchError("not_found");
      if (url.endsWith("/services"))
        return { page: page("https://booking.example/app"), links: [] };
      if (url.endsWith("/faq")) return { page: page(HOME), links: [] };
      return { page: page(url), links: [] };
    };
    const site = await readSite("example.org", { fetch });
    expect(site.ok && site.pages.map((p) => p.url)).toEqual([
      HOME,
      "https://www.example.org/about",
    ]);
  });

  it("stops waiting when the time is up, and keeps what it has", async () => {
    const fetch = async (url: string) => {
      if (url === "example.org") return { page: page(HOME), links };
      if (url.endsWith("/pricing")) return { page: page(url), links: [] };
      return new Promise<never>(() => {}); // never answers
    };
    const started = Date.now();
    const site = await readSite("example.org", { fetch, budgetMs: 150 });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(site.ok && site.pages.map((p) => p.kind)).toEqual([
      "home",
      "pricing",
    ]);
  });

  it("names a page by its title, or by what kind of page it is", () => {
    expect(siteTitle({ ...page(HOME, "Example Dental"), kind: "home" })).toBe(
      "Example Dental",
    );
    expect(
      siteTitle({ ...page("https://www.example.org/x"), kind: "pricing" }),
    ).toBe("Pricing (example.org)");
  });
});

/** Just enough of the Supabase client: records writes, answers one read. */
function fakeDb(existing: { id: string; source_url: string }[] = []) {
  const writes: {
    table: string;
    op: string;
    values: Record<string, unknown>;
  }[] = [];
  const chain = (
    table: string,
    op: string,
    values: Record<string, unknown>,
  ) => {
    if (op !== "select") writes.push({ table, op, values });
    const result = { data: op === "select" ? existing : null, error: null };
    const self: Record<string, unknown> = {
      eq: () => self,
      not: () => self,
      limit: () => self,
      then: (resolve: (value: typeof result) => unknown) => resolve(result),
    };
    return self;
  };
  const from = (table: string) => ({
    select: () => chain(table, "select", {}),
    insert: (values: Record<string, unknown>) => chain(table, "insert", values),
    update: (values: Record<string, unknown>) => chain(table, "update", values),
  });
  return { client: { from } as never, writes };
}

describe("readSiteIntoKnowledge", () => {
  const input = { workspaceId: "ws", userId: "me", address: "example.org" };
  const HOME = "https://www.example.org/";

  it("adds each page to Knowledge with where it came from, and marks the read done", async () => {
    const { client, writes } = fakeDb();
    const fetch = async (url: string) =>
      url === "example.org"
        ? {
            page: page(HOME, "Example Dental", "We build sites. ".repeat(5)),
            links: [link("https://www.example.org/pricing", "Pricing")],
          }
        : { page: page(url, "", "Plans from $900. ".repeat(5)), links: [] };
    expect(await readSiteIntoKnowledge(client, input, { fetch })).toEqual({
      ok: true,
      pages: 2,
    });
    const added = writes.filter((w) => w.op === "insert");
    expect(
      added.map((w) => [w.table, w.values.title, w.values.source_url]),
    ).toEqual([
      ["knowledge_items", "Example Dental", HOME],
      [
        "knowledge_items",
        "Pricing (example.org)",
        "https://www.example.org/pricing",
      ],
    ]);
    for (const w of added)
      expect(w.values).toMatchObject({
        workspace_id: "ws",
        kind: "url",
        status: "ready",
        created_by: "me",
      });
    expect(writes.at(-1)).toMatchObject({
      table: "workspace_setup",
      op: "update",
      values: { site_status: "done", site_pages: 2 },
    });
  });

  it("reads a page that is already in Knowledge again in place, without a duplicate", async () => {
    const { client, writes } = fakeDb([{ id: "k1", source_url: HOME }]);
    const fetch = async () => ({ page: page(HOME, "Example"), links: [] });
    await readSiteIntoKnowledge(client, input, { fetch });
    expect(writes.filter((w) => w.op === "insert")).toEqual([]);
    expect(writes[0]).toMatchObject({
      table: "knowledge_items",
      op: "update",
      values: { status: "ready" },
    });
  });

  it("fails quietly: nothing is added and the checklist is told", async () => {
    const { client, writes } = fakeDb();
    const fetch = async () => {
      throw new PageFetchError("unreachable");
    };
    expect(await readSiteIntoKnowledge(client, input, { fetch })).toEqual({
      ok: false,
      pages: 0,
    });
    expect(writes).toEqual([
      expect.objectContaining({
        table: "workspace_setup",
        values: expect.objectContaining({ site_status: "failed" }),
      }),
    ]);
  });
});
