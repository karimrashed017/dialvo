import { beforeEach, describe, expect, it, vi } from "vitest";
import { PageFetchError, type PageSource } from "@/lib/knowledge/fetch-page";
import { clearRobotsCache, mayRead, parseRobots, robotsAllow } from "./robots";
import { readSite } from "./site";

beforeEach(() => clearRobotsCache());

describe("robots.txt", () => {
  it("follows the group for DialvoBot when there is one, else the one for every robot", () => {
    const text = `
      User-agent: *
      Disallow: /

      User-agent: DialvoBot
      Disallow: /private
      Allow: /private/press
    `;
    const rules = parseRobots(text);
    expect(robotsAllow(rules, "/")).toBe(true);
    expect(robotsAllow(rules, "/private/team")).toBe(false);
    expect(robotsAllow(rules, "/private/press")).toBe(true);
    // Only for others: everyone else is kept out, we follow our own group.
    expect(
      robotsAllow(parseRobots("User-agent: *\nDisallow: /"), "/about"),
    ).toBe(false);
    expect(
      robotsAllow(parseRobots("User-agent: Googlebot\nDisallow: /"), "/"),
    ).toBe(true);
    // A name that merely starts like ours isn't ours.
    expect(
      robotsAllow(
        parseRobots("User-agent: D\nDisallow: /\nUser-agent: *\nAllow: /"),
        "/",
      ),
    ).toBe(true);
  });

  it("uses the longest match, Allow on a tie, and the * and $ wildcards", () => {
    const rules = parseRobots(
      "User-agent: *\nDisallow: /*.pdf$\nDisallow: /shop\nAllow: /shop/about\nDisallow:\n",
    );
    expect(robotsAllow(rules, "/files/a.pdf")).toBe(false);
    expect(robotsAllow(rules, "/files/a.pdf?x=1")).toBe(true);
    expect(robotsAllow(rules, "/shop/cart")).toBe(false);
    expect(robotsAllow(rules, "/shop/about")).toBe(true);
    expect(
      robotsAllow(parseRobots("User-agent: *\nDisallow: /a\nAllow: /a"), "/a"),
    ).toBe(true);
    expect(robotsAllow(parseRobots("User-agent: *\nDisallow:"), "/x")).toBe(
      true,
    );
  });

  it("reads a site normally when there's no robots.txt, and asks each host once", async () => {
    const fetchRobots = vi.fn(async () => {
      throw new PageFetchError("not_found");
    });
    expect(await mayRead("https://a.example/", fetchRobots)).toBe(true);
    expect(await mayRead("https://a.example/contact", fetchRobots)).toBe(true);
    expect(fetchRobots).toHaveBeenCalledTimes(1);
    expect(fetchRobots).toHaveBeenCalledWith("https://a.example/robots.txt");
  });
});

describe("reading a company's site", () => {
  const page = (url: string, body: string, html = true): PageSource => ({
    url,
    html,
    body,
  });

  it("skips a site that asks not to be read, without fetching a page of it", async () => {
    const fetchSource = vi.fn(async (url: string) => {
      if (url === "https://closed.example/robots.txt")
        return page(url, "User-agent: *\nDisallow: /\n", false);
      throw new Error(`should not have read ${url}`);
    });
    expect(await readSite("https://closed.example/", fetchSource)).toEqual({
      ok: false,
      problem: "robots_disallowed",
    });
    expect(fetchSource).toHaveBeenCalledTimes(1);
  });

  it("leaves out the pages it is asked not to read", async () => {
    const home = `<html><body><h1>Open Ltd</h1><p>We make good things in Leeds for people.</p>
      <a href="/contact">Contact</a><a href="/about">About</a></body></html>`;
    const fetchSource = vi.fn(async (url: string) => {
      if (url === "https://open.example/robots.txt")
        return page(url, "User-agent: DialvoBot\nDisallow: /about\n", false);
      if (url === "https://open.example/") return page(url, home);
      if (url === "https://open.example/contact")
        return page(
          url,
          "<html><body><p>Write to us at the mill, Leeds, any day.</p></body></html>",
        );
      throw new Error(`should not have read ${url}`);
    });
    const read = await readSite("https://open.example/", fetchSource);
    expect(read.ok && read.pages.map((p) => p.url)).toEqual([
      "https://open.example/",
      "https://open.example/contact",
    ]);
  });

  it("treats a robots.txt that is really a web page as no rules", async () => {
    const fetchSource = vi.fn(async (url: string) =>
      url.endsWith("/robots.txt")
        ? page(url, "<html><body>Disallow: /</body></html>")
        : page(
            url,
            "<html><body><h1>Acme</h1><p>A family firm in Leeds, since 1950, making anvils.</p></body></html>",
          ),
    );
    const read = await readSite("https://acme.example/", fetchSource);
    expect(read.ok).toBe(true);
  });
});
