import "server-only";
import { ImapFlow } from "imapflow";
import {
  IMAP_TIMEOUT_MS,
  MAX_MESSAGE_BYTES,
  MESSAGES_PER_POLL,
} from "./config";
import type { MailFailure } from "./smtp";

// Reading a customer's inbox for replies. One short visit per read: log in,
// look at what arrived since last time, log out. Messages are only read,
// never changed, moved, marked or deleted.

export type ImapSettings = {
  imap_host: string;
  imap_port: number;
  username: string;
  password: string;
  /** Tests only: talk to a local fake server without TLS. */
  insecure?: boolean;
};

type ImapError = Error & {
  authenticationFailed?: boolean;
  responseText?: string;
  code?: string;
};

export function describeImapFailure(
  error: ImapError,
  settings: ImapSettings,
): MailFailure {
  const said = (error.responseText || error.message || "")
    .split(settings.password)
    .join("[password]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
  const where = `${settings.imap_host}:${settings.imap_port}`;
  if (error.authenticationFailed)
    return {
      kind: "auth",
      message: `The mail server refused the IMAP login for ${settings.username}. Check that IMAP is switched on for this mailbox and use an app password. The server said: ${said || "(nothing)"}`,
    };
  if (/ENOTFOUND|getaddrinfo/.test(error.message))
    return {
      kind: "connection",
      message: `No mail server was found at ${settings.imap_host}. Check the IMAP server name.`,
    };
  if (/ECONNREFUSED/.test(error.message))
    return {
      kind: "connection",
      message: `${where} refused the connection. IMAP is almost always port 993.`,
    };
  if (/timeout|ETIMEDOUT/i.test(`${error.code} ${error.message}`))
    return {
      kind: "connection",
      message: `${where} didn't answer in time. Check the IMAP server name and the port.`,
    };
  return { kind: "connection", message: `Couldn't read ${where}: ${said}` };
}

function client(settings: ImapSettings): ImapFlow {
  const flow = new ImapFlow({
    host: settings.imap_host,
    port: settings.imap_port,
    secure: !settings.insecure,
    auth: { user: settings.username, pass: settings.password },
    // Nothing about the conversation is logged: it contains the login.
    logger: false,
    connectionTimeout: IMAP_TIMEOUT_MS,
    greetingTimeout: IMAP_TIMEOUT_MS,
    socketTimeout: IMAP_TIMEOUT_MS,
    disableAutoIdle: true,
  });
  // A dropped connection is reported by the call in progress; without a
  // listener it would also crash the process.
  flow.on("error", () => {});
  return flow;
}

/** Logs in to IMAP, opens the inbox and leaves: can replies be read? */
export async function verifyImap(
  settings: ImapSettings,
): Promise<{ ok: true } | { ok: false; failure: MailFailure }> {
  const flow = client(settings);
  try {
    await flow.connect();
    const lock = await flow.getMailboxLock("INBOX", { readOnly: true });
    lock.release();
    await flow.logout().catch(() => {});
    return { ok: true };
  } catch (error) {
    flow.close();
    return {
      ok: false,
      failure: describeImapFailure(error as ImapError, settings),
    };
  }
}

export type PollCursor = {
  uidvalidity: number | null;
  last_uid: number;
  /** A mailbox read for the first time starts from when it was connected. */
  connected_at: string;
};

export type Fetched =
  | {
      ok: true;
      uidvalidity: number;
      last_uid: number;
      /** Raw emails (headers only for very large ones), oldest first. */
      messages: Buffer[];
    }
  | { ok: false; failure: MailFailure };

/**
 * The emails that arrived in the inbox since the cursor, at most
 * MESSAGES_PER_POLL of them; the rest are picked up by the next read.
 */
export async function fetchNew(
  settings: ImapSettings,
  cursor: PollCursor,
): Promise<Fetched> {
  const flow = client(settings);
  try {
    await flow.connect();
    const lock = await flow.getMailboxLock("INBOX", { readOnly: true });
    try {
      const box = flow.mailbox;
      if (!box) throw new Error("The inbox could not be opened.");
      const uidvalidity = Number(box.uidValidity);
      const fresh = cursor.uidvalidity !== uidvalidity;
      let uids: number[];
      if (fresh) {
        // First read, or the server renumbered the inbox: start from what
        // arrived since the mailbox was connected.
        uids =
          (await flow.search(
            { since: new Date(cursor.connected_at) },
            { uid: true },
          )) || [];
      } else {
        uids =
          (await flow.search(
            { uid: `${cursor.last_uid + 1}:*` },
            { uid: true },
          )) || [];
        // "n:*" always includes the newest message, even one below n.
        uids = uids.filter((uid) => uid > cursor.last_uid);
      }
      uids = uids.sort((a, b) => a - b).slice(0, MESSAGES_PER_POLL);
      if (uids.length === 0)
        return {
          ok: true,
          uidvalidity,
          last_uid: fresh
            ? Math.max(Number(box.uidNext) - 1, 0)
            : cursor.last_uid,
          messages: [],
        };
      const sizes = new Map<number, number>();
      for await (const m of flow.fetch(
        uids,
        { uid: true, size: true },
        { uid: true },
      ))
        sizes.set(m.uid, m.size ?? 0);
      const small = uids.filter(
        (uid) => (sizes.get(uid) ?? 0) <= MAX_MESSAGE_BYTES,
      );
      const large = uids.filter(
        (uid) => (sizes.get(uid) ?? 0) > MAX_MESSAGE_BYTES,
      );
      const found = new Map<number, Buffer>();
      if (small.length)
        for await (const m of flow.fetch(
          small,
          { uid: true, source: true },
          { uid: true },
        ))
          if (m.source) found.set(m.uid, m.source);
      if (large.length)
        for await (const m of flow.fetch(
          large,
          { uid: true, headers: true },
          { uid: true },
        ))
          if (m.headers) found.set(m.uid, m.headers);
      return {
        ok: true,
        uidvalidity,
        last_uid: uids[uids.length - 1],
        messages: uids.flatMap((uid) => found.get(uid) ?? []),
      };
    } finally {
      lock.release();
      await flow.logout().catch(() => {});
    }
  } catch (error) {
    flow.close();
    return {
      ok: false,
      failure: describeImapFailure(error as ImapError, settings),
    };
  }
}
