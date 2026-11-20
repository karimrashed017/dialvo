import "server-only";
import MailComposer from "nodemailer/lib/mail-composer";
import SMTPConnection from "nodemailer/lib/smtp-connection";
import { SMTP_TIMEOUT_MS } from "./config";
import type { ComposedEmail } from "./compose";

// Talking to a customer's mail server to send. One connection per email,
// opened, used and closed here.
//
// The connection is driven step by step (connect, log in, hand over the
// email) rather than through a one-call helper, for one reason: to know for
// certain how far a failed send got. A failure before the email was handed
// over means it was NOT sent and may be tried again. A dropped connection
// after it was handed over means nobody knows, and the email must never be
// resent automatically. The mail library reports both as the same error, so
// the phase is tracked here.

export type SmtpSettings = {
  smtp_host: string;
  smtp_port: number;
  smtp_security: "tls" | "starttls";
  username: string;
  password: string;
  /** Tests only: talk to a local fake server without TLS. */
  insecure?: boolean;
};

export type MailFailure = {
  /**
   * auth: the login was refused. temporary: the server said try later.
   * permanent: the server refused for good. connection: couldn't reach or
   * talk to the server; nothing was handed over. unknown: the connection
   * dropped after the email was handed over.
   */
  kind: "auth" | "temporary" | "permanent" | "connection" | "unknown";
  /** For a person to read. Never contains the password. */
  message: string;
  code?: number;
};

type SmtpError = Error & {
  code?: string;
  responseCode?: number;
  response?: string;
};

const clean = (text: string | undefined, password: string) =>
  (text ?? "")
    .split(password)
    .join("[password]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);

/** What went wrong, in words a person can act on. */
export function describeSmtpFailure(
  error: SmtpError,
  phase: "connect" | "login" | "send",
  settings: SmtpSettings,
): MailFailure {
  const said = clean(error.response || error.message, settings.password);
  const code = error.responseCode;
  const where = `${settings.smtp_host}:${settings.smtp_port}`;
  if (
    phase === "login" ||
    error.code === "EAUTH" ||
    code === 535 ||
    code === 534
  )
    return {
      kind: "auth",
      code,
      message: `The mail server refused the login for ${settings.username}. Check the address and use an app password, not your normal password. The server said: ${said || "(nothing)"}`,
    };
  if (phase === "connect") {
    const why =
      error.code === "EDNS" || /ENOTFOUND|getaddrinfo/.test(error.message)
        ? `No mail server was found at ${settings.smtp_host}. Check the server name.`
        : error.code === "ETIMEDOUT" || /timeout/i.test(error.message)
          ? `${where} didn't answer in time. Check the server name and the port.`
          : /ECONNREFUSED/.test(error.message)
            ? `${where} refused the connection. Check the port (465 for TLS, 587 for STARTTLS).`
            : /TLS|SSL|certificate|wrong version/i.test(error.message)
              ? `A secure connection to ${where} couldn't be made. Port 465 needs TLS and port 587 needs STARTTLS: check they match. (${said})`
              : `Couldn't connect to ${where}: ${said}`;
    return { kind: "connection", message: why };
  }
  if (code && code >= 400 && code < 500)
    return {
      kind: "temporary",
      code,
      message: `The mail server asked to try again later: ${said}`,
    };
  if (code && code >= 500)
    return {
      kind: "permanent",
      code,
      message: `The mail server refused the email: ${said}`,
    };
  return {
    kind: "unknown",
    message: `The connection to the mail server dropped while the email was being handed over, so it isn't known whether it was sent. (${said})`,
  };
}

function open(settings: SmtpSettings): SMTPConnection {
  return new SMTPConnection({
    host: settings.smtp_host,
    port: settings.smtp_port,
    secure: !settings.insecure && settings.smtp_security === "tls",
    requireTLS: !settings.insecure && settings.smtp_security === "starttls",
    ignoreTLS: Boolean(settings.insecure),
    connectionTimeout: SMTP_TIMEOUT_MS,
    greetingTimeout: SMTP_TIMEOUT_MS,
    socketTimeout: SMTP_TIMEOUT_MS,
    // Nothing about the conversation is logged: it contains the login.
    logger: false,
  });
}

type Session =
  | { ok: true; connection: SMTPConnection }
  | { ok: false; failure: MailFailure };

/** Connects and logs in. The caller closes the connection. */
function begin(settings: SmtpSettings): Promise<Session> {
  return new Promise((resolve) => {
    const connection = open(settings);
    let phase: "connect" | "login" = "connect";
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      connection.close();
      resolve({
        ok: false,
        failure: describeSmtpFailure(error as SmtpError, phase, settings),
      });
    };
    connection.on("error", fail);
    connection.connect(() => {
      phase = "login";
      connection.login(
        { user: settings.username, pass: settings.password },
        (error) => {
          if (error) return fail(error);
          if (settled) return;
          settled = true;
          connection.removeListener("error", fail);
          resolve({ ok: true, connection });
        },
      );
    });
  });
}

/** Logs in to SMTP and leaves again: is the mailbox able to send? */
export async function verifySmtp(
  settings: SmtpSettings,
): Promise<{ ok: true } | { ok: false; failure: MailFailure }> {
  const session = await begin(settings);
  if (!session.ok) return session;
  session.connection.quit();
  return { ok: true };
}

export type SendOutcome =
  { ok: true; response: string } | { ok: false; failure: MailFailure };

/** Sends one email to one recipient. Never throws. */
export async function sendSmtp(
  settings: SmtpSettings,
  email: ComposedEmail,
): Promise<SendOutcome> {
  let raw: Buffer;
  try {
    raw = await new MailComposer({
      from: email.from,
      to: email.to,
      subject: email.subject,
      text: email.text,
      messageId: email.messageId,
      inReplyTo: email.inReplyTo,
      references: email.references,
      headers: email.headers,
    })
      .compile()
      .build();
  } catch (error) {
    return {
      ok: false,
      failure: {
        kind: "permanent",
        message: `The email couldn't be put together: ${(error as Error).message.slice(0, 200)}`,
      },
    };
  }
  const session = await begin(settings);
  if (!session.ok) return session;
  const { connection } = session;
  return new Promise((resolve) => {
    let settled = false;
    const done = (outcome: SendOutcome) => {
      if (settled) return;
      settled = true;
      connection.close();
      resolve(outcome);
    };
    const fail = (error: Error) =>
      done({
        ok: false,
        failure: describeSmtpFailure(error as SmtpError, "send", settings),
      });
    connection.on("error", fail);
    connection.send(
      { from: email.from.address, to: [email.to] },
      raw,
      (error, info) => {
        if (error) return fail(error);
        // One recipient: rejected means refused, with the server's reason.
        if (info.rejected?.length)
          return done({
            ok: false,
            failure: {
              kind: "permanent",
              message: `The mail server refused the address ${email.to}.`,
            },
          });
        done({ ok: true, response: String(info.response ?? "").slice(0, 300) });
      },
    );
  });
}
