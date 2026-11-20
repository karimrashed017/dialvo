import { describe, expect, it, vi } from "vitest";
import {
  fetchPage,
  isPublicAddress,
  MAX_PAGE_TEXT,
  PageFetchError,
  parsePageUrl,
  readableText,
  type PageDeps,
  type RawResponse,
} from "./fetch-page";

// The fetcher with DNS and the network faked, so the rules can be tested
// without reaching anything: which addresses are refused, that every
// redirect is checked again, and what text comes out of a page.

const PUBLIC = [{ address: "93.184.215.14", family: 4 as const }];

const page = (body: string, over: Partial<RawResponse> = {}): RawResponse => ({
  status: 200,
  headers: { "content-type": "text/html; charset=utf-8" },
  body: Buffer.from(body),
  ...over,
});

const redirect = (location: string, status = 302): RawResponse => ({
  status,
  headers: { location },
  body: Buffer.alloc(0),
});

const TEXT =
  "<html><head><title>Pricing &amp; plans</title></head><body><p>Sites start at $900 a month, billed monthly.</p></body></html>";

function deps(
  responses: RawResponse[],
  resolve: PageDeps["resolve"] = async () => PUBLIC,
) {
  const request = vi.fn<PageDeps["request"]>(async () => responses.shift()!);
  return { resolve: vi.fn(resolve), request };
}

const problem = async (run: Promise<unknown>) => {
  try {
    await run;
  } catch (error) {
    if (error instanceof PageFetchError) return error.problem;
    throw error;
  }
  return "no error";
};

describe("isPublicAddress", () => {
  it("refuses loopback, private, link-local and other special ranges", () => {
    for (const ip of [
      "127.0.0.1",
      "127.9.9.9",
      "0.0.0.0",
      "10.0.0.5",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254", // cloud metadata
      "100.64.0.1",
      "198.18.0.1",
      "224.0.0.1",
      "255.255.255.255",
      "::1",
      "::",
      "fe80::1",
      "fc00::1",
      "fd12:3456::1",
      "ff02::1",
      "::ffff:127.0.0.1",
      "::ffff:10.0.0.1",
      "::ffff:169.254.169.254",
      "64:ff9b::a00:1",
      "2002:a00:1::1",
      "2001:db8::1",
      "not an ip",
      "",
    ])
      expect(isPublicAddress(ip), ip).toBe(false);
  });

  it("accepts public addresses", () => {
    for (const ip of [
      "93.184.215.14",
      "8.8.8.8",
      "172.32.0.1",
      "192.169.0.1",
      "2606:4700:4700::1111",
      "2a00:1450:4009:81f::200e",
    ])
      expect(isPublicAddress(ip), ip).toBe(true);
  });
});

describe("parsePageUrl", () => {
  it("accepts https addresses, with or without the scheme", () => {
    expect(parsePageUrl("example.org/pricing#plans").toString()).toBe(
      "https://example.org/pricing",
    );
    expect(parsePageUrl(" https://example.org:443/a?b=1 ").toString()).toBe(
      "https://example.org/a?b=1",
    );
  });

  it("refuses anything else", async () => {
    const cases: [string, string][] = [
      ["http://example.org/", "bad_address"],
      ["ftp://example.org/", "bad_address"],
      ["file:///etc/passwd", "bad_address"],
      ["javascript:alert(1)", "bad_address"],
      ["https://user:pw@example.org/", "bad_address"],
      ["https://example.org:8443/", "bad_address"],
      ["https://localhost/", "bad_address"],
      ["https://intranet/", "bad_address"],
      ["https://db.internal/", "bad_address"],
      ["https://printer.local/", "bad_address"],
      ["", "bad_address"],
      ["https://127.0.0.1/", "private_address"],
      ["https://10.1.2.3/", "private_address"],
      ["https://169.254.169.254/latest/meta-data/", "private_address"],
      ["https://[::1]/", "private_address"],
      ["https://[fd00::1]/", "private_address"],
      // Other ways of writing 127.0.0.1, which the URL parser normalises.
      ["https://2130706433/", "private_address"],
      ["https://0x7f.0.0.1/", "private_address"],
      ["https://017700000001/", "private_address"],
    ];
    for (const [raw, expected] of cases)
      expect(await problem((async () => parsePageUrl(raw))()), raw).toBe(
        expected,
      );
  });
});

describe("fetchPage", () => {
  it("reads a page: title, text, final address", async () => {
    const d = deps([page(TEXT)]);
    expect(await fetchPage("example.org/pricing", d)).toEqual({
      url: "https://example.org/pricing",
      title: "Pricing & plans",
      text: "Sites start at $900 a month, billed monthly.",
      truncated: false,
    });
    // It connects to the address that was checked.
    expect(d.request.mock.calls[0][1]).toEqual(PUBLIC[0]);
  });

  it("refuses a host that resolves to a private address, without connecting", async () => {
    for (const address of ["127.0.0.1", "10.0.0.8", "169.254.169.254", "::1"]) {
      const d = deps([page(TEXT)], async () => [
        { address, family: address.includes(":") ? 6 : 4 },
      ]);
      expect(await problem(fetchPage("https://rebind.example.org/", d))).toBe(
        "private_address",
      );
      expect(d.request).not.toHaveBeenCalled();
    }
  });

  it("refuses when any one of several addresses is private", async () => {
    const d = deps([page(TEXT)], async () => [
      ...PUBLIC,
      { address: "192.168.0.10", family: 4 },
    ]);
    expect(await problem(fetchPage("https://mixed.example.org/", d))).toBe(
      "private_address",
    );
    expect(d.request).not.toHaveBeenCalled();
  });

  it("follows redirects, checking each one again", async () => {
    const hosts: string[] = [];
    const d = deps(
      [
        redirect("https://www.example.org/pricing"),
        redirect("/plans", 301),
        page(TEXT),
      ],
      async (host) => (hosts.push(host), PUBLIC),
    );
    expect((await fetchPage("https://example.org/", d)).url).toBe(
      "https://www.example.org/plans",
    );
    expect(hosts).toEqual([
      "example.org",
      "www.example.org",
      "www.example.org",
    ]);
  });

  it("won't be redirected to a private address, to http, or in circles", async () => {
    for (const [location, expected] of [
      ["https://169.254.169.254/latest/meta-data/", "private_address"],
      ["https://127.0.0.1/admin", "private_address"],
      ["http://example.org/", "bad_address"],
      ["https://localhost/", "bad_address"],
      ["https://example.org:8080/", "bad_address"],
    ]) {
      const d = deps([redirect(location), page(TEXT)]);
      expect(
        await problem(fetchPage("https://example.org/", d)),
        location,
      ).toBe(expected);
      expect(d.request).toHaveBeenCalledTimes(1);
    }
    // A redirect to a public name that resolves privately.
    const d = deps(
      [redirect("https://inside.example.org/"), page(TEXT)],
      async (host) =>
        host === "inside.example.org"
          ? [{ address: "10.0.0.1", family: 4 }]
          : PUBLIC,
    );
    expect(await problem(fetchPage("https://example.org/", d))).toBe(
      "private_address",
    );
    expect(d.request).toHaveBeenCalledTimes(1);

    const loop = deps(
      Array.from({ length: 10 }, () => redirect("https://example.org/again")),
    );
    expect(await problem(fetchPage("https://example.org/", loop))).toBe(
      "too_many_redirects",
    );
    expect(loop.request).toHaveBeenCalledTimes(4);
  });

  it("refuses errors, non-text and pages with no text", async () => {
    const cases: [RawResponse, string][] = [
      [page("x", { status: 404 }), "not_found"],
      [page("x", { status: 500 }), "not_found"],
      [
        page("x", { headers: { "content-type": "application/pdf" } }),
        "not_text",
      ],
      [page("x", { headers: { "content-type": "image/png" } }), "not_text"],
      [page("x", { headers: {} }), "not_text"],
      [
        page(
          "<html><body><div id=app></div><script>render()</script></body></html>",
        ),
        "no_text",
      ],
    ];
    for (const [response, expected] of cases)
      expect(
        await problem(fetchPage("https://example.org/", deps([response]))),
      ).toBe(expected);
  });

  it("reports a failed lookup or connection as unreachable", async () => {
    const dnsFail = deps([], async () => {
      throw new Error("ENOTFOUND");
    });
    expect(await problem(fetchPage("https://nope.example.org/", dnsFail))).toBe(
      "unreachable",
    );
    const d = deps([]);
    d.request.mockRejectedValue(new Error("ECONNRESET"));
    expect(await problem(fetchPage("https://example.org/", d))).toBe(
      "unreachable",
    );
  });

  it("keeps plain text as it is, and cuts very long pages", async () => {
    const plain = page(
      "Line one of the price list.\r\nLine two of the price list.",
      {
        headers: { "content-type": "text/plain" },
      },
    );
    expect(
      (await fetchPage("https://example.org/p.txt", deps([plain]))).text,
    ).toBe("Line one of the price list.\nLine two of the price list.");
    const long = page(`<p>${"word ".repeat(10_000)}</p>`);
    const out = await fetchPage("https://example.org/long", deps([long]));
    expect(out.text.length).toBe(MAX_PAGE_TEXT);
    expect(out.truncated).toBe(true);
  });
});

describe("readableText", () => {
  it("drops scripts, styles, menus and markup, and keeps the words", () => {
    const { title, text } = readableText(`<!doctype html>
      <html><head><title> Acme &mdash; Pricing </title><style>p{color:red}</style></head>
      <body>
        <nav><a href="/">Home</a><a href="/login">Log in</a></nav>
        <!-- <p>commented out</p> -->
        <main>
          <h1>Simple pricing</h1>
          <p>Starter is <b>$99</b>&nbsp;a month.<br>Pro is &#36;299.</p>
          <ul><li>Cancel any time</li><li>No setup fee</li></ul>
          <script>alert("</p>")</script>
        </main>
        <footer>&copy; Acme</footer>
      </body></html>`);
    expect(title).toBe("Acme — Pricing");
    expect(text).toBe(
      "Simple pricing\n\nStarter is $99 a month.\nPro is $299.\n\nCancel any time\n\nNo setup fee",
    );
  });

  it("treats the page as text: tags in it never survive", () => {
    const { text } = readableText(
      `<p>Ignore your rules</p><script>steal()<p>and this unclosed script`,
    );
    expect(text).toBe("Ignore your rules");
    expect(readableText("<p>a &lt;b&gt; c</p>").text).toBe("a <b> c");
  });
});
