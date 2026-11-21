import { describe, expect, it, vi } from "vitest";
import { newsStep, readNews, type NewsStore } from "./check";

const now = new Date("2026-11-21T12:00:00Z");
const searched = [
  { url: "https://news.example/acme-raises", title: "Acme raises $5M" },
  { url: "https://news.example/acme-old", title: "Old" },
];

describe("company news", () => {
  it("keeps only items whose link the search returned, of the kinds asked for, and recent", () => {
    const text =
      "```json\n" +
      JSON.stringify({
        items: [
          {
            kind: "funding",
            headline: "Acme raises $5M",
            summary: "Seed",
            source_url: "https://news.example/acme-raises/",
            published_on: "2026-11-10",
          },
          {
            kind: "funding",
            headline: "Made up",
            source_url: "https://invented.example/x",
            published_on: "2026-11-10",
          },
          {
            kind: "launch",
            headline: "Not asked for",
            source_url: "https://news.example/acme-raises",
            published_on: "2026-11-10",
          },
          {
            kind: "funding",
            headline: "Too old",
            source_url: "https://news.example/acme-old",
            published_on: "2025-01-01",
          },
        ],
      }) +
      "\n```";
    expect(readNews(text, searched, ["funding", "leadership"], now)).toEqual([
      {
        kind: "funding",
        headline: "Acme raises $5M",
        summary: "Seed",
        source_url: "https://news.example/acme-raises",
        source_title: "Acme raises $5M",
        published_on: "2026-11-10",
      },
    ]);
    expect(readNews("nothing found", searched, ["funding"], now)).toEqual([]);
  });

  it("a step checks each due company with the model faked and records what it found or that it failed", async () => {
    const store: NewsStore = {
      claim: vi.fn(async () => [
        {
          id: "c1",
          workspace_id: "w1",
          domain: "acme.example",
          name: "Acme",
          lead_id: null,
          kinds: ["funding"],
        },
        {
          id: "c2",
          workspace_id: "w1",
          domain: "beta.example",
          name: "Beta",
          lead_id: null,
          kinds: ["funding"],
        },
      ]),
      ingest: vi.fn(async () => ({ added: 1, duplicates: 0 })),
      fail: vi.fn(async () => undefined),
    };
    const create = vi.fn(
      async (params: { messages: { content: string }[] }) => {
        if (params.messages[0].content.includes("Beta"))
          throw new (await import("@anthropic-ai/sdk")).default.APIError(
            500,
            {},
            "x",
            new Headers(),
          );
        return {
          stop_reason: "end_turn",
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            server_tool_use: { web_search_requests: 1 },
          },
          content: [
            {
              type: "web_search_tool_result",
              content: [
                {
                  type: "web_search_result",
                  url: searched[0].url,
                  title: searched[0].title,
                },
              ],
            },
            {
              type: "text",
              text: JSON.stringify({
                items: [
                  {
                    kind: "funding",
                    headline: "Acme raises",
                    source_url: searched[0].url,
                    published_on: "",
                  },
                ],
              }),
            },
          ],
        };
      },
    );
    const r = await newsStep({
      store,
      client: { messages: { create } } as never,
      now: () => now,
    });
    expect(r).toEqual({ checked: 2, added: 1, failed: 1 });
    expect(store.ingest).toHaveBeenCalledWith(
      "w1",
      "c1",
      [
        expect.objectContaining({
          headline: "Acme raises",
          published_on: null,
        }),
      ],
      100 + 250 + 10_000,
    );
    expect(store.fail).toHaveBeenCalledWith(
      "w1",
      "c2",
      "The search didn't answer.",
      0,
    );
  });
});
