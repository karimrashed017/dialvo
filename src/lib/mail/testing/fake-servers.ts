import { createServer, type Server, type Socket } from "node:net";

// Two tiny mail servers for the tests: just enough SMTP and IMAP, in plain
// text on a local port, for the real mail libraries to talk to. They exist
// so the transport code is tested against a server's actual words rather
// than against mocks of the libraries. Never used outside tests.

const listen = (server: Server) =>
  new Promise<number>((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve((server.address() as { port: number }).port),
    ),
  );

const stop = (server: Server, sockets: Set<Socket>) =>
  new Promise<void>((resolve) => {
    for (const s of sockets) s.destroy();
    server.close(() => resolve());
  });

export type FakeSmtp = {
  port: number;
  /** Every email the server accepted, as raw text. */
  accepted: string[];
  /** How many times a client got as far as handing an email over. */
  handedOver: number;
  close(): Promise<void>;
};

export type SmtpBehaviour = {
  user?: string;
  pass?: string;
  /** What RCPT TO answers, e.g. "550 5.1.1 No such user" or "451 4.7.1 Try later". */
  rcpt?: string;
  /** What the server does once it has the whole email. */
  afterData?: "accept" | "drop" | string;
};

export async function fakeSmtp(
  behaviour: SmtpBehaviour = {},
): Promise<FakeSmtp> {
  const sockets = new Set<Socket>();
  const state: FakeSmtp = {
    port: 0,
    accepted: [],
    handedOver: 0,
    close: () => stop(server, sockets),
  };
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    let buffer = "";
    let inData = false;
    const say = (line: string) => socket.write(`${line}\r\n`);
    say("220 fake.test ESMTP");
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      for (;;) {
        if (inData) {
          const end = buffer.indexOf("\r\n.\r\n");
          if (end < 0) return;
          const message = buffer.slice(0, end);
          buffer = buffer.slice(end + 5);
          inData = false;
          state.handedOver += 1;
          const after = behaviour.afterData ?? "accept";
          if (after === "drop") return socket.destroy();
          if (after !== "accept") {
            say(after);
            continue;
          }
          state.accepted.push(message);
          say("250 2.0.0 OK queued as fake-1");
          continue;
        }
        const eol = buffer.indexOf("\r\n");
        if (eol < 0) return;
        const line = buffer.slice(0, eol);
        buffer = buffer.slice(eol + 2);
        const verb = line.split(" ")[0].toUpperCase();
        if (verb === "EHLO" || verb === "HELO") {
          say("250-fake.test");
          say("250 AUTH PLAIN");
        } else if (verb === "AUTH") {
          const [, user, pass] = Buffer.from(line.split(" ")[2] ?? "", "base64")
            .toString("utf8")
            .split("\0");
          if (
            user === (behaviour.user ?? "sender@fake.test") &&
            pass === (behaviour.pass ?? "right-password")
          )
            say("235 2.7.0 Authentication successful");
          else say("535 5.7.8 Username and Password not accepted");
        } else if (verb === "MAIL") say("250 2.1.0 OK");
        else if (verb === "RCPT") say(behaviour.rcpt ?? "250 2.1.5 OK");
        else if (verb === "DATA") {
          say("354 Go ahead");
          inData = true;
        } else if (verb === "QUIT") {
          say("221 Bye");
          socket.end();
        } else if (verb === "RSET" || verb === "NOOP") say("250 OK");
        else say("502 Command not implemented");
      }
    });
  });
  state.port = await listen(server);
  return state;
}

export type FakeImap = {
  port: number;
  /** Commands the server saw, without their tags. */
  commands: string[];
  close(): Promise<void>;
};

export type ImapBehaviour = {
  user?: string;
  pass?: string;
  uidvalidity?: number;
  /** The inbox: each message's UID and raw text. */
  messages?: { uid: number; raw: string }[];
};

const unquote = (text: string) => text.replace(/^"(.*)"$/, "$1");

/** Which of the inbox's UIDs a sequence set like "3:*" or "1,4" names. */
function uidsIn(set: string, all: number[]): number[] {
  const max = Math.max(0, ...all);
  const picked = new Set<number>();
  for (const part of set.split(",")) {
    const [a, b = a] = part.split(":");
    const lo = a === "*" ? max : Number(a);
    const hi = b === "*" ? max : Number(b);
    for (const uid of all)
      if (uid >= Math.min(lo, hi) && uid <= Math.max(lo, hi)) picked.add(uid);
  }
  return [...picked].sort((x, y) => x - y);
}

export async function fakeImap(
  behaviour: ImapBehaviour = {},
): Promise<FakeImap> {
  const sockets = new Set<Socket>();
  const messages = behaviour.messages ?? [];
  const uids = messages.map((m) => m.uid);
  const state: FakeImap = {
    port: 0,
    commands: [],
    close: () => stop(server, sockets),
  };
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    let buffer = "";
    const say = (line: string) => socket.write(`${line}\r\n`);
    say("* OK [CAPABILITY IMAP4rev1] fake ready");
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      for (;;) {
        const eol = buffer.indexOf("\r\n");
        if (eol < 0) return;
        const line = buffer.slice(0, eol);
        buffer = buffer.slice(eol + 2);
        const [tag, ...rest] = line.split(" ");
        const command = rest.join(" ");
        const upper = command.toUpperCase();
        state.commands.push(upper.startsWith("LOGIN") ? "LOGIN" : command);
        if (upper === "CAPABILITY") {
          say("* CAPABILITY IMAP4rev1");
          say(`${tag} OK done`);
        } else if (upper.startsWith("LOGIN")) {
          const [, user, pass] = command.split(" ").map(unquote);
          if (
            user === (behaviour.user ?? "sender@fake.test") &&
            pass === (behaviour.pass ?? "right-password")
          )
            say(`${tag} OK [CAPABILITY IMAP4rev1] logged in`);
          else say(`${tag} NO [AUTHENTICATIONFAILED] Invalid credentials`);
        } else if (upper.startsWith("SELECT") || upper.startsWith("EXAMINE")) {
          say(`* ${messages.length} EXISTS`);
          say("* 0 RECENT");
          say("* FLAGS (\\Seen)");
          say(`* OK [UIDVALIDITY ${behaviour.uidvalidity ?? 7}] ok`);
          say(`* OK [UIDNEXT ${Math.max(0, ...uids) + 1}] ok`);
          say(`${tag} OK [READ-ONLY] done`);
        } else if (upper.startsWith("UID SEARCH")) {
          const set = /UID ([\d:*,]+)$/.exec(
            upper.replace("UID SEARCH ", ""),
          )?.[1];
          const found = set ? uidsIn(set, uids) : uids;
          say(`* SEARCH${found.length ? ` ${found.join(" ")}` : ""}`);
          say(`${tag} OK done`);
        } else if (upper.startsWith("UID FETCH")) {
          const [, , set] = upper.split(" ");
          for (const uid of uidsIn(set, uids)) {
            const message = messages.find((m) => m.uid === uid)!;
            const seq = uids.indexOf(uid) + 1;
            const bytes = Buffer.byteLength(message.raw);
            if (upper.includes("BODY.PEEK[]") || upper.includes("BODY[]")) {
              socket.write(`* ${seq} FETCH (UID ${uid} BODY[] {${bytes}}\r\n`);
              socket.write(message.raw);
              say(")");
            } else say(`* ${seq} FETCH (UID ${uid} RFC822.SIZE ${bytes})`);
          }
          say(`${tag} OK done`);
        } else if (upper === "LOGOUT") {
          say("* BYE");
          say(`${tag} OK done`);
          socket.end();
        } else say(`${tag} OK done`);
      }
    });
  });
  state.port = await listen(server);
  return state;
}
