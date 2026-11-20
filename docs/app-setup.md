# The app: connecting Supabase, and checking it works

The signed-in app (slice 1) lives at `/app`, with `/signup`, `/login`,
`/forgot-password`, `/reset-password`, `/onboarding`, `/auth/confirm` and
`/logout` around it, and the public lead form endpoint at
`/api/leads/capture/[token]`. Everything is stored in one Supabase project.

Status on 20 Nov 2026: the project `qpvdafpdjxvlqecpjrim` (eu-west-1,
Postgres 17) has all six migrations applied, and the app was run against it
locally (see "What was tested" at the end). The steps below are what is left
to do by hand, and how to repeat the setup on another project.

## 1. Environment variables

Names are in `.env.example`. Values come from the Supabase dashboard, under
Project Settings, API keys.

| Variable                               | Where                                    | Notes                                                                                                                                            |
| -------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`             | Vercel (all environments), `.env.local`  | `https://<ref>.supabase.co`                                                                                                                      |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Vercel (all environments), `.env.local`  | `sb_publishable_...`. Safe in the browser.                                                                                                       |
| `SUPABASE_SECRET_KEY`                  | Vercel (Production and Preview) **only** | `sb_secret_...`. Server only. Optional in slice 1: the lead form uses it when present and works without it. Slice 2 (agents, webhooks) needs it. |

Next.js builds the two public values into the pages, so **redeploy after
adding or changing them**. Without them, `/login` and `/app` show "Dialvo's
app is being set up", the capture endpoint answers 503, and the marketing
site is unaffected (the nav shows no "Log in" link).

## 2. Migrations

`supabase/migrations/`, applied in file-name order. On this project they are
already applied, under the same versions as the file names:

1. `20261120110506_workspaces_and_members.sql`
2. `20261120110707_leads_conversations_messages.sql`
3. `20261120110711_agents_and_knowledge.sql`
4. `20261120110715_meetings_calls_activity.sql`
5. `20261120111142_lead_forms_and_functions.sql`
6. `20261120112000_profile_email.sql`

For another project: `npx supabase link --project-ref <ref>` then
`npx supabase db push`, or paste each file into the SQL editor in that order.
Never edit a migration that has been applied; add a new one. `npm test` runs
all of them against an in-memory Postgres and checks the isolation rules
(`supabase/tests/rls.test.ts`), so run it before pushing a new one.

## 3. Settings to change by hand in the Supabase dashboard

**Authentication, URL Configuration**

- Site URL: `https://trydialvo.com`
- Redirect URLs (add all):
  - `https://trydialvo.com/auth/confirm`
  - `https://trydialvo.com/**`
  - `http://localhost:3000/**` (local development)
  - `https://*-<your-vercel-team>.vercel.app/**` if previews should be able
    to log in

**Authentication, Sign In / Providers, Email**

- Email provider: on. "Confirm email": **on**. Invitations are matched on a
  _confirmed_ address, so this must stay on.
- Minimum password length: 8 (the app's forms say 8).

**Authentication, Emails, SMTP settings: set up your own SMTP before inviting
anyone.** Supabase's built-in sender is for testing only. On 20 Nov it
refused to send after a handful of attempts ("email rate limit exceeded"),
which blocked sign-up entirely for the rest of the hour, and it rejects some
addresses outright. Use the provider you already send from (Resend, Postmark,
SES...), sender `Dialvo <no-reply@trydialvo.com>`, then raise "Rate limit for
sending emails" under Authentication, Rate Limits.

**Authentication, Emails, Templates.** Replace the link in each template so
it lands on our `/auth/confirm` with a token hash. This is what makes the
links work when the email is opened on another device or in an in-app
browser:

| Template       | Link (`href`)                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------------- |
| Confirm signup | `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/onboarding`          |
| Magic Link     | `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/app`                 |
| Reset Password | `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password`   |
| Change Email   | `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email_change&next=/app/settings` |

With the default templates the flows still work, but only in the browser the
email was requested from.

**Advisors.** After the migrations the security advisor shows four warnings,
all intended:

- `capture_lead` is a `SECURITY DEFINER` function callable by `anon`. That is
  the public lead form: it is the only thing anon can do, it validates every
  field itself, has its own rate limit (30 a minute and 2,000 a day per
  form), writes only into the workspace that owns the form token and returns
  nothing about the lead.
- `create_workspace`, `my_invitations` and `accept_invitation` are
  `SECURITY DEFINER` functions callable by signed-in users. They are the
  onboarding and invitation calls; each acts only for `auth.uid()`.

The performance advisor lists every index as unused until there is traffic.

## 4. Manual test checklist

Run through this on production once the settings above are in. Use two
browsers (or one normal and one private window) and two email addresses you
can read.

Sign-up and log-in

- [ ] `/signup` with address A: "Check your email" appears; the email
      arrives; its link lands on `/onboarding`, signed in.
- [ ] `/signup` again with address A: the same "check your email" answer (it
      must not say the address is taken).
- [ ] `/logout` (user menu), then `/login` with a wrong password: "That email
      and password don't match." With the right one: lands in the app.
- [ ] `/login`, "Email me a link": the email arrives and its link logs in.
- [ ] `/forgot-password`: the email arrives; the link lands on
      `/reset-password`; a new password works, the old one doesn't.
- [ ] Logged out, open `/app/leads?status=new`: redirected to `/login`, and
      after logging in you land back on `/app/leads?status=new`.
- [ ] `/login?next=https://example.com` then log in: you land on `/app`.

Onboarding and the workspace

- [ ] Onboarding asks for name, what you sell, website, time zone, and
      lands on Today with zeros and "Get your workspace ready".
- [ ] Knowledge has "What we sell" with what you typed.
- [ ] Agents shows four agents, all off.

Leads

- [ ] Add a lead with no email or phone: refused, and what you typed stays.
- [ ] Add one properly: you land on its page. Change status, add a note,
      record consent for calls, mark do not contact: each shows on the
      timeline.
- [ ] Add the same email again: refused as a duplicate.
- [ ] Import a CSV (include a row with the same email as the lead above, a
      repeated row and a row with no contact details): the preview counts
      match, and the result says how many were added and skipped.
- [ ] Search and the status filter on `/app/leads` find what you expect.

Lead capture

- [ ] Settings, Lead-capture forms: paste the HTML into a test page on
      another domain, submit it with only the email consent box ticked. You
      see the thank-you page; the lead appears with a conversation in
      "Waiting for you", and its consent shows Email agreed with the form's
      name and nothing else.
- [ ] Switch the form off: submitting now says the form doesn't exist.

Inbox

- [ ] Open the conversation, write a reply: it appears marked "Saved, not
      delivered", the conversation leaves the waiting queue, and nothing is
      sent to the lead.
- [ ] Assign it, close it, reopen it.

Team and isolation

- [ ] Settings: invite address B. It says no email is sent.
- [ ] Sign up as B (other browser): onboarding offers the workspace. Create
      B's **own** workspace instead.
- [ ] As B: Leads, Inbox, Knowledge are empty. Paste the address of one of
      A's lead pages: "Nothing here".
- [ ] As B, go to `/onboarding?new=1` and accept the invitation: the
      workspace switcher now lists both, and switching shows each
      workspace's own data.
- [ ] As A: change B's role to admin and back; remove B. As B: the workspace
      is gone from the switcher.
- [ ] As A: "New workspace" is refused on Starter with the Scale message.

To repeat most of this automatically against a running app, see
`scripts/e2e-app.mjs`.

## 5. The design preview (development only)

`DIALVO_DEV_FIXTURES=1 npm run dev` draws the whole app shell with made-up
data and no database, for looking at the design. It cannot run in
production: the switch also requires `NODE_ENV !== "production"`, which
`next build` and `next start` fix, and the preview data is left out of the
build altogether. `npm run build && node scripts/check-no-preview-data.mjs`
proves it.

## What was tested on 20 Nov 2026, and what wasn't

Tested against the real project, with the app running locally and a browser
driving it (62 checks, `scripts/e2e-app.mjs`): log-in and wrong password,
onboarding, the zero state, add lead and its validation, status, notes,
consent, do not contact, duplicate refusal, CSV import with duplicates, the
capture endpoint (JSON, form post, bad input, unknown token, honeypot) using
only the publishable key, the Today numbers, inbox reply and close,
knowledge add/edit/delete, agent settings, invitations, the one-workspace
limit, log-out, and from a second person in a second workspace: empty lists
in the app, "not found" for the first workspace's pages, and through the
database's own API with each person's token, no rows of the other workspace
in any of the 13 tables, refused inserts, updates and deletes, no
self-promotion, no plan change, and anon refused everywhere.

Not tested, and why:

- **Sign-up, email confirmation, the magic link and password reset end to
  end.** Supabase's built-in sender hit its rate limit, so no auth email
  could be sent. The two test accounts were created directly in the
  database instead. The forms, their error messages and `/auth/confirm` are
  built and typechecked, but nobody has clicked a real link yet: do the
  first block of the checklist once SMTP is set.
- Accepting an invitation, changing roles and removing members in the
  browser (covered by the database tests, not clicked through).
- The capture endpoint with `SUPABASE_SECRET_KEY` set (the key wasn't
  available; the database test covers the service role calling it).
- Anything on the deployed site: nothing was pushed.
