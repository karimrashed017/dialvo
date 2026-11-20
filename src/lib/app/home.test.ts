import { describe, expect, it } from "vitest";
import {
  chatJob,
  findJob,
  greeting,
  needsRows,
  weekFacts,
  type ChatFacts,
} from "./home";
import type { HomeData } from "./types";

const find = (over: Partial<HomeData["find"]> = {}): HomeData["find"] => ({
  searches: 0,
  running: false,
  found: 0,
  undecided: 0,
  toWrite: 0,
  drafted: 0,
  approved: 0,
  ...over,
});

const chat = (over: Partial<ChatFacts> = {}): ChatFacts => ({
  hasWidget: true,
  seenOn: null,
  agentOn: false,
  mode: "approve_first",
  chatsThisWeek: 0,
  waiting: 0,
  ...over,
});

describe("Needs your yes", () => {
  it("is empty when nothing is waiting", () => {
    expect(
      needsRows({ emailDrafts: 0, chatDrafts: 0, chatsWaiting: 0 }),
    ).toEqual([]);
  });

  it("has one row per kind of thing waiting, each with one button", () => {
    const rows = needsRows({ emailDrafts: 11, chatDrafts: 1, chatsWaiting: 3 });
    expect(rows.map((r) => r.id)).toEqual([
      "emails",
      "chat-drafts",
      "conversations",
    ]);
    expect(rows[0].text).toBe("11 first emails to read and approve");
    expect(rows[0].action).toEqual({
      label: "Review emails",
      href: "/app/prospects?view=emails",
    });
    expect(rows[1].text).toBe("1 chat reply drafted by your agent");
    expect(rows[2].text).toBe("3 conversations waiting for a person");
  });

  it("never says an approved email is sent", () => {
    const [row] = needsRows({ emailDrafts: 1, chatDrafts: 0, chatsWaiting: 0 });
    expect(row.note).toMatch(/nothing is sent/);
  });
});

describe("the Find new customers card", () => {
  it("offers a new workspace its first search, in one step", () => {
    const job = findJob(find());
    expect(job.fresh).toBe(true);
    expect(job.action).toEqual({
      label: "Find my first leads",
      href: "/app/prospects",
    });
    // No count of anything while there is nothing to count.
    expect(job.status).not.toMatch(/\d/);
  });

  it("still offers the first search when a description is saved but nothing was found", () => {
    const job = findJob(find({ searches: 1 }));
    expect(job.fresh).toBe(true);
    expect(job.action.label).toBe("Find my first leads");
  });

  it("says a search is running", () => {
    const job = findJob(find({ searches: 1, running: true, found: 4 }));
    expect(job.status).toBe("Searching now · 4 companies found so far");
    expect(job.action.label).toBe("Watch the search");
  });

  it("states what was found, drafted and approved", () => {
    const job = findJob(
      find({ searches: 1, found: 22, undecided: 0, drafted: 11, approved: 0 }),
    );
    expect(job.status).toBe(
      "22 companies found · 11 emails drafted · 0 approved",
    );
  });

  it("walks the flow one step at a time: review, write, approve, find more", () => {
    const base = { searches: 1, found: 10 };
    expect(findJob(find({ ...base, undecided: 6, toWrite: 2 })).action).toEqual(
      { label: "Review 6 companies", href: "/app/prospects" },
    );
    expect(findJob(find({ ...base, toWrite: 1 })).action).toEqual({
      label: "Write 1 first email",
      href: "/app/prospects?view=emails",
    });
    expect(findJob(find({ ...base, drafted: 4, approved: 1 })).action).toEqual({
      label: "Review first emails",
      href: "/app/prospects?view=emails",
    });
    expect(findJob(find({ ...base, drafted: 4, approved: 4 })).action).toEqual({
      label: "Find more leads",
      href: "/app/prospects",
    });
  });
});

describe("the Answer website visitors card", () => {
  it("says where the chat is installed, whether the agent is on, and this week's chats", () => {
    expect(
      chatJob(chat({ seenOn: "example.com", chatsThisWeek: 3 })).status,
    ).toBe("Chat installed on example.com · agent off · 3 chats this week");
  });

  it("leaves a zero count out", () => {
    expect(chatJob(chat()).status).toBe(
      "Chat not seen on your website yet · agent off",
    );
    expect(chatJob(chat({ hasWidget: false })).status).toBe(
      "No chat created yet · agent off",
    );
  });

  it("says how the agent answers", () => {
    expect(
      chatJob(chat({ seenOn: "example.com", agentOn: true })).status,
    ).toMatch(/agent on, asking you first$/);
    expect(
      chatJob(chat({ seenOn: "example.com", agentOn: true, mode: "auto" }))
        .status,
    ).toMatch(/agent on, answering on its own$/);
  });

  it("offers the one next step", () => {
    expect(chatJob(chat()).action.href).toBe("/app/chat#install");
    expect(chatJob(chat({ seenOn: "example.com" })).action.label).toBe(
      "Switch your agent on",
    );
    expect(
      chatJob(chat({ seenOn: "example.com", agentOn: true, waiting: 2 })).action
        .href,
    ).toBe("/app/inbox");
    expect(
      chatJob(chat({ seenOn: "example.com", agentOn: true })).action.href,
    ).toBe("/app/chat");
  });
});

describe("this week's numbers", () => {
  it("shows nothing for a workspace with nothing to show", () => {
    expect(
      weekFacts({
        companiesFound: 0,
        emailsApproved: 0,
        chats: 0,
        chatsAnswered: 0,
        leadsQualified: 0,
      }),
    ).toEqual([]);
  });

  it("shows only the numbers that aren't zero", () => {
    expect(
      weekFacts({
        companiesFound: 22,
        emailsApproved: 0,
        chats: 5,
        chatsAnswered: 1,
        leadsQualified: 3,
      }),
    ).toEqual([
      { id: "found", value: 22, label: "companies found" },
      { id: "answered", value: 1, label: "chat answered" },
      { id: "qualified", value: 3, label: "leads qualified" },
    ]);
  });
});

describe("greeting", () => {
  it("goes by the workspace's clock", () => {
    const at = new Date("2026-11-20T08:00:00Z");
    expect(greeting(at, "UTC")).toBe("Good morning");
    expect(greeting(at, "Asia/Tokyo")).toBe("Good afternoon");
    expect(greeting(at, "Pacific/Auckland")).toBe("Good evening");
    expect(greeting(at, "Not/AZone")).toBe("Good morning");
  });
});
