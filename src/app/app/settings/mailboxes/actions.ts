"use server";

import { refresh } from "next/cache";
import {
  ActionProblem,
  inWorkspace,
  mustSucceed,
  type ActionResult,
} from "@/lib/app/action";
import {
  cleanLongText,
  cleanText,
  isUuid,
  normalizeEmail,
} from "@/lib/leads/fields";
import { createLimiter } from "@/lib/leads/rate-limit";
import {
  MAILBOX_DAILY_LIMIT_DEFAULT,
  MAILBOX_DAILY_LIMIT_MAX,
  MAX_MAILBOXES,
  TEST_EMAILS_PER_HOUR,
} from "@/lib/mail/config";
import { IMAP_PORTS, mailHostProblem, SMTP_PORTS } from "@/lib/mail/hosts";
import { verifyImap } from "@/lib/mail/imap";
import {
  PRESETS,
  type Provider,
  type ServerSettings,
} from "@/lib/mail/presets";
import { sendSmtp, verifySmtp } from "@/lib/mail/smtp";
import { createMailStore } from "@/lib/mail/store";

// Mailboxes and the sending settings. Everything here is for owners and
// admins; the database functions check the role again.
//
// A mailbox's app password passes through connectMailbox once, on its way
// into Supabase Vault. It is never stored anywhere else, never returned to
// the browser, and never written to a log: nothing in this file logs the
// form or an error object that could contain it.

const admin = { admin: true } as const;

const rpcProblem = (
  error: { code?: string; message: string } | null,
  what: string,
) => {
  if (!error) return;
  if (error.code === "P0002")
    throw new ActionProblem("That mailbox is no longer there.");
  if (error.code === "P0001" || error.code === "22023")
    throw new ActionProblem(
      error.message.charAt(0).toUpperCase() + error.message.slice(1) + ".",
    );
  mustSucceed({ error }, what);
};

function dailyLimit(form: FormData): number {
  const n = Number(form.get("daily_limit") ?? MAILBOX_DAILY_LIMIT_DEFAULT);
  if (!Number.isInteger(n) || n < 1 || n > MAILBOX_DAILY_LIMIT_MAX)
    throw new ActionProblem(
      `The daily limit has to be between 1 and ${MAILBOX_DAILY_LIMIT_MAX}.`,
      "daily_limit",
    );
  return n;
}

function senderName(form: FormData): string {
  const name = cleanText(form.get("sender_name"), 120);
  if (!name)
    throw new ActionProblem(
      "Add your real name: the person these emails are from.",
      "sender_name",
    );
  return name;
}

function servers(form: FormData, provider: Provider): ServerSettings {
  if (provider !== "other") return PRESETS[provider].settings;
  const smtp_host = cleanText(form.get("smtp_host"), 253).toLowerCase();
  const imap_host = cleanText(form.get("imap_host"), 253).toLowerCase();
  const smtp_port = Number(form.get("smtp_port"));
  const imap_port = Number(form.get("imap_port"));
  if (!smtp_host) throw new ActionProblem("Add the SMTP server.", "smtp_host");
  if (!imap_host) throw new ActionProblem("Add the IMAP server.", "imap_host");
  if (!SMTP_PORTS.includes(smtp_port))
    throw new ActionProblem(
      `The SMTP port has to be ${SMTP_PORTS.join(", ")}.`,
      "smtp_port",
    );
  if (!IMAP_PORTS.includes(imap_port))
    throw new ActionProblem("The IMAP port has to be 993.", "imap_port");
  return {
    smtp_host,
    smtp_port,
    smtp_security: smtp_port === 465 ? "tls" : "starttls",
    imap_host,
    imap_port,
  };
}

/**
 * Connects a mailbox: logs in to its SMTP and IMAP servers for real, and
 * only when both work stores it (the password goes to Vault).
 */
export async function connectMailbox(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace }) => {
    const provider = (["google", "microsoft", "other"] as const).find(
      (p) => p === form.get("provider"),
    );
    if (!provider) throw new ActionProblem("Choose your mail provider.");
    const email = normalizeEmail(form.get("email"));
    if (!email)
      throw new ActionProblem(
        "That email address doesn't look right.",
        "email",
      );
    const name = senderName(form);
    const limit = dailyLimit(form);
    // Google shows app passwords in groups of four with spaces between.
    const typed = String(form.get("password") ?? "");
    const password =
      provider === "google" ? typed.replace(/\s+/g, "") : typed.trim();
    if (!password || password.length > 500)
      throw new ActionProblem("Paste the app password.", "password");
    const username = cleanText(form.get("username"), 254) || email;
    const settings = servers(form, provider);

    const existing = await supabase
      .from("mailboxes")
      .select("id, email")
      .eq("workspace_id", workspace.id)
      .neq("status", "disconnected");
    mustSucceed(existing, "read mailboxes");
    const already = (existing.data ?? []).some((m) => m.email === email);
    if (!already && (existing.data ?? []).length >= MAX_MAILBOXES)
      throw new ActionProblem(
        `A workspace can connect up to ${MAX_MAILBOXES} mailboxes. Disconnect one first.`,
      );

    if (provider === "other") {
      const problem =
        (await mailHostProblem(settings.smtp_host, "SMTP")) ??
        (await mailHostProblem(settings.imap_host, "IMAP"));
      if (problem) throw new ActionProblem(problem);
    }
    const [smtp, imap] = await Promise.all([
      verifySmtp({ ...settings, username, password }),
      verifyImap({ ...settings, username, password }),
    ]);
    if (!smtp.ok)
      throw new ActionProblem(`Sending check failed. ${smtp.failure.message}`);
    if (!imap.ok)
      throw new ActionProblem(
        `Sending works, but reading replies doesn't. ${imap.failure.message}`,
      );

    const { error } = await supabase.rpc("mailbox_connect", {
      p_workspace_id: workspace.id,
      p_provider: provider,
      p_email: email,
      p_sender_name: name,
      p_username: username,
      p_smtp_host: settings.smtp_host,
      p_smtp_port: settings.smtp_port,
      p_smtp_security: settings.smtp_security,
      p_imap_host: settings.imap_host,
      p_imap_port: settings.imap_port,
      p_password: password,
      p_daily_limit: limit,
    });
    if (error) {
      // The code only: the message could echo what was sent.
      console.error("[mail] mailbox_connect failed:", error.code);
      throw new ActionProblem(
        error.code === "42501"
          ? "Only the workspace's owner or an admin can connect a mailbox."
          : "The logins worked, but the mailbox couldn't be saved. Please try again.",
      );
    }
    refresh();
    return {
      ok: true,
      message: already
        ? `${email} is connected again with the new password. Dialvo logged in to send and to read replies.`
        : `${email} is connected. Dialvo logged in to send and to read replies. Nothing is sent until you turn sending on.`,
    };
  }, admin);
}

function mailboxId(form: FormData): string {
  const id = form.get("mailbox");
  if (!isUuid(id)) throw new ActionProblem("That mailbox doesn't exist.");
  return id;
}

export async function updateMailbox(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase }) => {
    const { error } = await supabase.rpc("mailbox_update", {
      p_mailbox_id: mailboxId(form),
      p_sender_name: senderName(form),
      p_daily_limit: dailyLimit(form),
    });
    rpcProblem(error, "update mailbox");
    refresh();
    return { ok: true, message: "Saved." };
  }, admin);
}

export async function resumeMailbox(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase }) => {
    const { error } = await supabase.rpc("mailbox_resume", {
      p_mailbox_id: mailboxId(form),
    });
    rpcProblem(error, "resume mailbox");
    refresh();
    return { ok: true };
  }, admin);
}

/** Disconnect: the password is deleted from Vault straight away. */
export async function disconnectMailbox(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase }) => {
    const { error } = await supabase.rpc("mailbox_disconnect", {
      p_mailbox_id: mailboxId(form),
    });
    rpcProblem(error, "disconnect mailbox");
    refresh();
    return { ok: true };
  }, admin);
}

const testLimit = createLimiter({
  windowMs: 3_600_000,
  max: TEST_EMAILS_PER_HOUR,
});

/**
 * "Send me a test email": one plain email from the mailbox to the signed-in
 * person's own login address, through exactly the path a real email takes.
 */
export async function sendTestEmail(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace, user }) => {
    const id = mailboxId(form);
    const row = await supabase
      .from("mailboxes")
      .select("id, email, sender_name")
      .eq("workspace_id", workspace.id)
      .eq("id", id)
      .neq("status", "disconnected")
      .maybeSingle();
    mustSucceed(row, "read mailbox");
    if (!row.data) throw new ActionProblem("That mailbox is no longer there.");
    const store = createMailStore();
    if (!store)
      throw new ActionProblem(
        "Sending isn't switched on yet on Dialvo's side, so a test can't be sent. Your mailbox is saved, and connecting it already proved the login works.",
      );
    if (!user.email)
      throw new ActionProblem("Your account has no email address to send to.");
    if (testLimit.take(user.id) > 0)
      throw new ActionProblem(
        `That's ${TEST_EMAILS_PER_HOUR} test emails this hour. Try again later.`,
      );
    const secret = await store.mailboxSecret(workspace.id, id);
    if (!secret) throw new ActionProblem("That mailbox is no longer there.");
    const sent = await sendSmtp(secret, {
      from: { name: secret.sender_name, address: secret.email },
      to: user.email,
      subject: "Test email from Dialvo",
      text: [
        `This is a test from ${secret.email}, sent through Dialvo to check that the mailbox works.`,
        "",
        "If it reached your inbox rather than spam, sending is ready. Nobody else was emailed.",
        "",
      ].join("\n"),
      messageId: `<test-${crypto.randomUUID()}@${secret.email.split("@")[1]}>`,
      headers: {},
    });
    if (!sent.ok) {
      await store.mailboxResult(
        workspace.id,
        id,
        sent.failure.kind === "auth" ? "auth_failed" : "error",
        sent.failure.message,
      );
      refresh();
      throw new ActionProblem(`The test didn't go. ${sent.failure.message}`);
    }
    await store.mailboxResult(workspace.id, id, "ok");
    return {
      ok: true,
      message: `Sent to ${user.email}. Check your inbox, and your spam folder too.`,
    };
  }, admin);
}

async function save(
  form: FormData,
  patch: (form: FormData) => Record<string, unknown>,
  done: string,
): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace }) => {
    const { error } = await supabase.rpc("sending_settings_save", {
      p_workspace_id: workspace.id,
      p_settings: patch(form),
    });
    if (error?.code === "P0001")
      throw new ActionProblem(
        "Add your business name and postal address, and tick the confirmation, before turning sending on.",
      );
    if (error?.code === "22023" || error?.code === "23514")
      throw new ActionProblem(
        "One of those values isn't allowed. Check them and try again.",
      );
    mustSucceed({ error }, "save sending settings");
    refresh();
    return { ok: true, message: done };
  }, admin);
}

/** Who is sending: printed under every email. */
export async function saveSenderDetails(form: FormData): Promise<ActionResult> {
  return save(
    form,
    (f) => {
      const business_name = cleanText(f.get("business_name"), 200);
      const postal_address = cleanLongText(f.get("postal_address"), 500);
      if (!business_name)
        throw new ActionProblem("Add your business's name.", "business_name");
      if (!postal_address)
        throw new ActionProblem(
          "Add a postal address where your business can be reached.",
          "postal_address",
        );
      return {
        business_name,
        postal_address,
        ...(f.get("confirm_allowed") === "on" ? { confirm_allowed: true } : {}),
      };
    },
    "Saved.",
  );
}

export async function saveFollowUps(form: FormData): Promise<ActionResult> {
  return save(
    form,
    (f) => {
      const first = Number(f.get("followup_1_days"));
      const second = Number(f.get("followup_2_days"));
      if (!Number.isInteger(first) || first < 1 || first > 30)
        throw new ActionProblem(
          "The first follow-up goes 1 to 30 days after the first email.",
          "followup_1_days",
        );
      if (!Number.isInteger(second) || second <= first || second > 60)
        throw new ActionProblem(
          "The second follow-up has to come after the first, at most 60 days after the first email.",
          "followup_2_days",
        );
      const booking = cleanText(f.get("booking_url"), 500);
      if (booking && !/^https:\/\/\S+$/.test(booking))
        throw new ActionProblem(
          "The booking link has to start with https://",
          "booking_url",
        );
      return {
        followups_enabled: f.get("followups_enabled") === "on",
        followup_1_days: first,
        followup_2_days: second,
        reply_mode: f.get("reply_mode") === "auto" ? "auto" : "approve_first",
        booking_url: booking,
      };
    },
    "Saved.",
  );
}

/** The switch. Off stops everything at once; what was sent stays sent. */
export async function setSending(form: FormData): Promise<ActionResult> {
  const on = form.get("sending_on") === "true";
  return save(
    form,
    () => ({ sending_on: on }),
    on
      ? "Sending is on. Approved emails go out inside your send window."
      : "Sending is off. Nothing more will be sent until you turn it on.",
  );
}
