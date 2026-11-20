// The mail providers Dialvo knows the settings for. Safe in the browser:
// nothing here is secret.

export type Provider = "google" | "microsoft" | "other";

export type ServerSettings = {
  smtp_host: string;
  smtp_port: number;
  /** tls: encrypted from the first byte (465). starttls: upgraded (587). */
  smtp_security: "tls" | "starttls";
  imap_host: string;
  imap_port: number;
};

export const PRESETS: Record<
  Exclude<Provider, "other">,
  { label: string; settings: ServerSettings; steps: string[]; note: string }
> = {
  google: {
    label: "Google Workspace or Gmail",
    settings: {
      smtp_host: "smtp.gmail.com",
      smtp_port: 465,
      smtp_security: "tls",
      imap_host: "imap.gmail.com",
      imap_port: 993,
    },
    steps: [
      "Sign in to the Google account you send from and open myaccount.google.com/security.",
      "Turn on 2-Step Verification if it is off. App passwords only exist once it is on.",
      "Open myaccount.google.com/apppasswords, type a name such as Dialvo, and press Create.",
      "Google shows a 16-letter password once. Paste it below. The spaces don't matter.",
    ],
    note: "On Google Workspace, an administrator may have switched app passwords or IMAP off. If the page says the setting isn't available, ask them to allow it for your account.",
  },
  microsoft: {
    label: "Microsoft 365 or Outlook",
    settings: {
      smtp_host: "smtp.office365.com",
      smtp_port: 587,
      smtp_security: "starttls",
      imap_host: "outlook.office365.com",
      imap_port: 993,
    },
    steps: [
      "Sign in at mysignins.microsoft.com/security-info with the account you send from.",
      "Press Add sign-in method, choose App password, and give it a name such as Dialvo.",
      "Microsoft shows the password once. Paste it below.",
    ],
    note: 'Many Microsoft 365 organisations switch off app passwords and signing in to mail with a password ("basic authentication" and "SMTP AUTH"). If App password isn\'t in the list, or the check below says the login was refused, your administrator has to enable SMTP AUTH and IMAP for your mailbox first. Dialvo cannot work around that.',
  },
};

export const OTHER_STEPS = [
  "Find your mail provider's SMTP and IMAP settings (search for the provider's name and \"IMAP settings\").",
  "If the provider offers app passwords, create one for Dialvo and use it instead of your normal password.",
  "Fill in the servers below. Port 465 means TLS; port 587 means STARTTLS. IMAP is almost always port 993.",
];
