import type { HomeData } from "./types";

// What Home says, worked out from the workspace's real numbers. Pure
// functions, so the wording rules can be tested on their own: a count shows
// only when it isn't zero, and each job offers exactly one next step.

export type HomeAction = { label: string; href: string };

const n = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

/** "Needs your yes": one row per kind of thing waiting, nothing at zero. */
export function needsRows(needs: HomeData["needs"]): {
  id: "emails" | "chat-drafts" | "conversations";
  text: string;
  note: string;
  action: HomeAction;
}[] {
  return [
    needs.emailDrafts > 0 && {
      id: "emails" as const,
      text: `${n(needs.emailDrafts, "first email", "first emails")} to read and approve`,
      note: "Written for companies you kept. Approving stores it as ready: nothing is sent from Dialvo yet.",
      action: {
        label: needs.emailDrafts === 1 ? "Review email" : "Review emails",
        href: "/app/prospects?view=emails",
      },
    },
    needs.chatDrafts > 0 && {
      id: "chat-drafts" as const,
      text: `${n(needs.chatDrafts, "chat reply", "chat replies")} drafted by your agent`,
      note: "The visitor sees it only after you approve it.",
      action: {
        label: needs.chatDrafts === 1 ? "Review reply" : "Review replies",
        href: "/app/inbox",
      },
    },
    needs.chatsWaiting > 0 && {
      id: "conversations" as const,
      text: `${n(needs.chatsWaiting, "conversation", "conversations")} waiting for a person`,
      note: "A visitor asked for someone, or nobody has answered yet.",
      action: { label: "Open Inbox", href: "/app/inbox" },
    },
  ].filter((row) => row !== false);
}

/** The "Find new customers" card: where it stands, and the one next step. */
export function findJob(find: HomeData["find"]): {
  /** Nothing has been found yet. */
  fresh: boolean;
  status: string;
  action: HomeAction;
} {
  const page = "/app/prospects";
  if (find.running)
    return {
      fresh: false,
      status:
        find.found > 0
          ? `Searching now · ${n(find.found, "company", "companies")} found so far`
          : "Searching the web now",
      action: { label: "Watch the search", href: page },
    };
  if (find.found === 0)
    return {
      fresh: true,
      status:
        find.searches > 0
          ? "You've described who you sell to. Dialvo hasn't found any companies yet."
          : "Describe who you sell to. Dialvo finds real companies on the web, reads their websites and drafts a first email for each one you keep.",
      action: { label: "Find my first leads", href: page },
    };
  const status = [
    `${n(find.found, "company", "companies")} found`,
    `${n(find.drafted, "email", "emails")} drafted`,
    `${find.approved} approved`,
  ].join(" · ");
  const action =
    find.undecided > 0
      ? {
          label: `Review ${n(find.undecided, "company", "companies")}`,
          href: page,
        }
      : find.toWrite > 0
        ? {
            label: `Write ${n(find.toWrite, "first email", "first emails")}`,
            href: `${page}?view=emails`,
          }
        : find.drafted > find.approved
          ? { label: "Review first emails", href: `${page}?view=emails` }
          : { label: "Find more leads", href: page };
  return { fresh: false, status, action };
}

export type ChatFacts = {
  /** The workspace has a chat widget at all. */
  hasWidget: boolean;
  /** The site the chat was last seen on, e.g. "example.com". */
  seenOn: string | null;
  agentOn: boolean;
  mode: "auto" | "approve_first";
  chatsThisWeek: number;
  /** Chats and drafts waiting in the Inbox. */
  waiting: number;
};

/** The "Answer website visitors" card's sentence and, set up, its next step. */
export function chatJob(chat: ChatFacts): {
  status: string;
  action: HomeAction;
} {
  const status = [
    chat.seenOn
      ? `Chat installed on ${chat.seenOn}`
      : chat.hasWidget
        ? "Chat not seen on your website yet"
        : "No chat created yet",
    !chat.agentOn
      ? "agent off"
      : chat.mode === "auto"
        ? "agent on, answering on its own"
        : "agent on, asking you first",
    chat.chatsThisWeek > 0 &&
      `${n(chat.chatsThisWeek, "chat", "chats")} this week`,
  ]
    .filter(Boolean)
    .join(" · ");
  const action = !chat.seenOn
    ? { label: "Put the chat on your site", href: "/app/chat#install" }
    : !chat.agentOn
      ? { label: "Switch your agent on", href: "/app/chat" }
      : chat.waiting > 0
        ? { label: "Open Inbox", href: "/app/inbox" }
        : { label: "Open Website chat", href: "/app/chat" };
  return { status, action };
}

/** This week's numbers worth showing: only the ones that aren't zero. */
export function weekFacts(
  week: HomeData["week"],
): { id: string; value: number; label: string }[] {
  return [
    {
      id: "found",
      value: week.companiesFound,
      label: week.companiesFound === 1 ? "company found" : "companies found",
    },
    {
      id: "approved",
      value: week.emailsApproved,
      label: week.emailsApproved === 1 ? "email approved" : "emails approved",
    },
    {
      id: "answered",
      value: week.chatsAnswered,
      label: week.chatsAnswered === 1 ? "chat answered" : "chats answered",
    },
    {
      id: "qualified",
      value: week.leadsQualified,
      label: week.leadsQualified === 1 ? "lead qualified" : "leads qualified",
    },
  ].filter((fact) => fact.value > 0);
}

/** "Good morning", by the workspace's own clock. */
export function greeting(now: Date, timeZone: string): string {
  let hour = now.getUTCHours();
  try {
    hour = Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour: "numeric",
        hourCycle: "h23",
      }).format(now),
    );
  } catch {
    // An unknown time zone: UTC will do.
  }
  return hour < 12
    ? "Good morning"
    : hour < 18
      ? "Good afternoon"
      : "Good evening";
}
