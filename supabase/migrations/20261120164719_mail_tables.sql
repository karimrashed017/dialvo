-- Slice 3b, part 1 of 5: sending. Approved first emails go out from the customer's own
-- mailbox, follow-ups happen, and replies come back into the Inbox.
--
-- Everything here is additive. Six new tables:
--   mailboxes          a connected mailbox (SMTP + IMAP), without its password
--   mailbox_secrets    where each mailbox's app password is in Supabase
--                      Vault. Nobody signed in can read this table.
--   workspace_sending  who is sending (business name, postal address, the
--                      "we may email these businesses" confirmation), the
--                      booking link, follow-up timing, and the on/off switch
--   mail_threads       one per first email sent: the sequence's state
--   outbound_emails    every email to a lead: scheduled, sent, failed
--   mail_received      replies, bounces and auto-replies matched to a thread
-- plus one new counter on outbound_usage, two new kinds of team alert, and
-- the functions the app goes through.
--
-- Who writes what:
--   admins (signed in): connect, edit and disconnect mailboxes and save the
--     sending settings, through functions that check the role themselves.
--   members (signed in): approve or discard a follow-up or a reply draft,
--     queue their own reply, resolve an email whose fate is unknown.
--   the server (secret key only): everything that schedules, claims, sends,
--     reads and classifies. Every limit is passed in from
--     src/lib/mail/config.ts.
--   anyone with a signed link: unsubscribe (mail_unsubscribe).
--
-- NEVER SENDING TWICE. An email is sent by: claim the row (scheduled ->
-- sending, under a row lock), talk to the mail server, record the result
-- (sending -> sent / scheduled again / failed). Only 'scheduled' rows can be
-- claimed. A row left 'sending' by a step that died is never claimed again:
-- after a while it becomes 'needs_check' and a person decides.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- A valid time zone name, or UTC.
create function private.safe_tz(p_tz text)
returns text
language plpgsql
stable
set search_path = ''
as $$
begin
  perform now() at time zone p_tz;
  return p_tz;
exception when others then
  return 'UTC';
end;
$$;
revoke all on function private.safe_tz(text) from public;

-- The instant today began in that zone.
create function private.local_day_start(p_tz text)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select date_trunc('day', now() at time zone private.safe_tz(p_tz))
    at time zone private.safe_tz(p_tz);
$$;
revoke all on function private.local_day_start(text) from public;

-- Is this instant inside an agent's send window? The window is
-- { "days": [1..7], "start": "09:00", "end": "17:00" } in the workspace's
-- zone. A window that can't be read counts as closed.
create function private.in_send_window(p_window jsonb, p_tz text, p_at timestamptz)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_local timestamp := p_at at time zone private.safe_tz(p_tz);
begin
  return (p_window -> 'days') @> to_jsonb(extract(isodow from v_local)::integer)
    and v_local::time >= (p_window ->> 'start')::time
    and v_local::time < (p_window ->> 'end')::time;
exception when others then
  return false;
end;
$$;
revoke all on function private.in_send_window(jsonb, text, timestamptz) from public;

-- "Re: RE: Fwd: Hello " -> "hello": for matching a reply to its thread.
create function private.mail_norm_subject(p_subject text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(btrim(regexp_replace(
    coalesce(p_subject, ''),
    '^(\s*(re|fwd?|fw|aw|sv|tr|antw|wg)\s*(\[\d+\])?\s*:\s*)+', '', 'i'
  )));
$$;
revoke all on function private.mail_norm_subject(text) from public;

-- ---------------------------------------------------------------------------
-- mailboxes
-- ---------------------------------------------------------------------------
create table public.mailboxes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  provider text not null check (provider in ('google', 'microsoft', 'other')),
  -- The address the email comes from. Always the mailbox's own address.
  email text not null check (email = lower(email) and email ~ '^[^\s@]+@[a-z0-9-]+(\.[a-z0-9-]+)+$' and char_length(email) <= 254),
  -- The real person who is sending.
  sender_name text not null check (char_length(btrim(sender_name)) between 1 and 120),
  -- What to log in with; nearly always the address itself.
  username text not null check (char_length(username) between 1 and 254),
  smtp_host text not null check (smtp_host ~ '^[a-z0-9.-]+$' and char_length(smtp_host) between 3 and 253),
  smtp_port integer not null check (smtp_port between 1 and 65535),
  -- tls: encrypted from the first byte (port 465). starttls: upgraded (587).
  smtp_security text not null default 'starttls' check (smtp_security in ('tls', 'starttls')),
  imap_host text not null check (imap_host ~ '^[a-z0-9.-]+$' and char_length(imap_host) between 3 and 253),
  imap_port integer not null check (imap_port between 1 and 65535),
  -- The most this mailbox sends in a day once it has ramped up. 50 is the
  -- ceiling whatever the app asks for.
  daily_limit integer not null default 30 check (daily_limit between 1 and 50),
  status text not null default 'active' check (status in ('active', 'paused', 'disconnected')),
  pause_reason text check (pause_reason is null or char_length(pause_reason) <= 60),
  -- Logins refused in a row. Reset by a login that works.
  auth_failures integer not null default 0,
  last_error text check (last_error is null or char_length(last_error) <= 500),
  -- The ramp for a new mailbox counts days from here.
  connected_at timestamptz not null default now(),
  last_sent_at timestamptz,
  last_polled_at timestamptz,
  poll_locked_until timestamptz,
  -- Where reading the inbox got to.
  imap_uidvalidity bigint,
  imap_last_uid bigint not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id)
);
alter table public.mailboxes enable row level security;
create unique index mailboxes_one_per_address_idx
  on public.mailboxes (workspace_id, email) where status <> 'disconnected';
create index mailboxes_workspace_idx on public.mailboxes (workspace_id, created_at);
create index mailboxes_poll_idx on public.mailboxes (last_polled_at nulls first) where status = 'active';
create index mailboxes_created_by_idx on public.mailboxes (created_by);

create trigger mailboxes_set_updated_at
  before update on public.mailboxes
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- mailbox_secrets: which Vault entry holds a mailbox's app password. The
-- password itself is only ever in Vault. Row-level security is on and there
-- is no policy and no grant: nobody signed in can read or write this table.
-- The row is deleted, with the Vault entry, when the mailbox is disconnected.
-- ---------------------------------------------------------------------------
create table public.mailbox_secrets (
  mailbox_id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  secret_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key (mailbox_id, workspace_id)
    references public.mailboxes (id, workspace_id) on delete cascade
);
alter table public.mailbox_secrets enable row level security;
create index mailbox_secrets_mailbox_idx on public.mailbox_secrets (mailbox_id, workspace_id);
create index mailbox_secrets_workspace_idx on public.mailbox_secrets (workspace_id);

-- ---------------------------------------------------------------------------
-- workspace_sending: one row per workspace, made the first time it is saved.
-- ---------------------------------------------------------------------------
create table public.workspace_sending (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  -- Printed under every email.
  business_name text not null default '' check (char_length(business_name) <= 200),
  postal_address text not null default '' check (char_length(postal_address) <= 500),
  -- "We only contact businesses we are allowed to email": who said so, when.
  allowed_confirmed_at timestamptz,
  allowed_confirmed_by uuid references auth.users (id) on delete set null,
  -- A scheduling page the agents may offer. Any https link.
  booking_url text check (booking_url is null or (booking_url ~ '^https://[^\s]+$' and char_length(booking_url) <= 500)),
  followups_enabled boolean not null default true,
  -- Days after the first email.
  followup_1_days integer not null default 3 check (followup_1_days between 1 and 30),
  followup_2_days integer not null default 7 check (followup_2_days between 2 and 60),
  -- Replies the agent writes to people who answered.
  reply_mode text not null default 'approve_first' check (reply_mode in ('approve_first', 'auto')),
  -- The switch. Nothing is sent to a lead while this is off.
  sending_on boolean not null default false,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (followup_2_days > followup_1_days)
);
alter table public.workspace_sending enable row level security;
create index workspace_sending_confirmed_by_idx on public.workspace_sending (allowed_confirmed_by);
create index workspace_sending_updated_by_idx on public.workspace_sending (updated_by);

create trigger workspace_sending_set_updated_at
  before update on public.workspace_sending
  for each row execute function private.set_updated_at();

-- No send happens until all three exist.
create function private.sending_ready(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_sending s
    where s.workspace_id = p_workspace_id
      and btrim(s.business_name) <> '' and btrim(s.postal_address) <> ''
      and s.allowed_confirmed_at is not null
  );
$$;
revoke all on function private.sending_ready(uuid) from public;

-- ---------------------------------------------------------------------------
-- mail_threads: one per first email that went out. It is the email
-- conversation with that lead, and the follow-up sequence's state.
-- ---------------------------------------------------------------------------
create table public.mail_threads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  lead_id uuid not null,
  conversation_id uuid not null,
  -- Follow-ups and replies leave from the mailbox the first email left from.
  mailbox_id uuid not null,
  to_email text not null check (to_email = lower(to_email) and char_length(to_email) between 3 and 254),
  subject text not null check (char_length(subject) between 1 and 200),
  -- active: follow-ups may still go. replied / bounced / unsubscribed: what
  -- ended it. stopped: a person or a rule ended it. finished: all sent.
  status text not null default 'active'
    check (status in ('active', 'replied', 'bounced', 'unsubscribed', 'stopped', 'finished')),
  stop_reason text check (stop_reason is null or char_length(stop_reason) <= 60),
  followups_sent integer not null default 0 check (followups_sent between 0 and 2),
  next_followup_at timestamptz,
  first_sent_at timestamptz not null default now(),
  last_sent_at timestamptz,
  last_reply_at timestamptz,
  -- What the latest real reply was: interested, question, not_now,
  -- not_interested, wrong_person, unsubscribe.
  reply_class text check (reply_class is null or char_length(reply_class) <= 30),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (conversation_id),
  foreign key (lead_id, workspace_id)
    references public.leads (id, workspace_id) on delete cascade,
  foreign key (conversation_id, workspace_id)
    references public.conversations (id, workspace_id) on delete cascade,
  foreign key (mailbox_id, workspace_id)
    references public.mailboxes (id, workspace_id) on delete cascade
);
alter table public.mail_threads enable row level security;
create index mail_threads_lead_idx on public.mail_threads (lead_id, workspace_id);
create index mail_threads_conversation_idx on public.mail_threads (conversation_id, workspace_id);
create index mail_threads_mailbox_idx on public.mail_threads (mailbox_id, workspace_id, to_email);
create index mail_threads_due_idx on public.mail_threads (workspace_id, next_followup_at) where status = 'active';

create trigger mail_threads_set_updated_at
  before update on public.mail_threads
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- outbound_emails: every email to a lead, from "being written" to "sent".
-- ---------------------------------------------------------------------------
create table public.outbound_emails (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  lead_id uuid not null,
  prospect_id uuid,
  -- The approved first-email draft this sends (kind = 'first').
  draft_id uuid,
  thread_id uuid,
  mailbox_id uuid,
  kind text not null check (kind in ('first', 'followup', 'reply')),
  -- 0 for a first email or a reply; 1 or 2 for a follow-up.
  step integer not null default 0 check (step between 0 and 2),
  written_by text not null default 'agent' check (written_by in ('agent', 'user')),
  author_user_id uuid references auth.users (id) on delete set null,
  -- Always the lead's own address, set by the database. Never taken from a
  -- model's answer or from an incoming email.
  to_email text not null check (to_email = lower(to_email) and char_length(to_email) between 3 and 254),
  subject text not null default '' check (char_length(subject) <= 200),
  body text not null default '' check (char_length(body) <= 5000),
  -- writing: the model is on it. draft: waiting for a person. queued:
  -- approved, waiting for a time slot. scheduled: has one. sending: claimed
  -- by a server. sent / failed. needs_check: claimed and never heard of
  -- again, so nobody knows whether it went. cancelled: will not be sent.
  status text not null
    check (status in ('writing', 'draft', 'queued', 'scheduled', 'sending', 'sent', 'failed', 'needs_check', 'cancelled')),
  scheduled_at timestamptz,
  claimed_at timestamptz,
  sent_at timestamptz,
  attempts integer not null default 0,
  -- The email's Message-ID, made when it is first claimed and never changed,
  -- so a reply can be matched even to an email whose step died.
  message_id text check (message_id is null or char_length(message_id) <= 300),
  in_reply_to text check (in_reply_to is null or char_length(in_reply_to) <= 300),
  reference_ids text check (reference_ids is null or char_length(reference_ids) <= 4000),
  -- The reply this answers (kind = 'reply', written by the agent).
  answers_received_id uuid,
  error text check (error is null or char_length(error) <= 500),
  cancel_reason text check (cancel_reason is null or char_length(cancel_reason) <= 60),
  bounced_at timestamptz,
  model text check (model is null or char_length(model) <= 80),
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  check (status not in ('draft', 'queued', 'scheduled', 'sending', 'sent') or (char_length(subject) > 0 and char_length(body) > 0)),
  check (status <> 'scheduled' or (scheduled_at is not null and mailbox_id is not null)),
  foreign key (lead_id, workspace_id)
    references public.leads (id, workspace_id) on delete cascade,
  foreign key (prospect_id, workspace_id)
    references public.prospects (id, workspace_id) on delete set null (prospect_id),
  foreign key (thread_id, workspace_id)
    references public.mail_threads (id, workspace_id) on delete cascade,
  foreign key (mailbox_id, workspace_id)
    references public.mailboxes (id, workspace_id) on delete cascade
);
alter table public.outbound_emails enable row level security;
-- One live email per approved draft: a draft can't be scheduled twice.
create unique index outbound_emails_one_per_draft_idx
  on public.outbound_emails (draft_id) where draft_id is not null and status <> 'cancelled';
-- One live follow-up per step of a thread.
create unique index outbound_emails_one_per_step_idx
  on public.outbound_emails (thread_id, step) where kind = 'followup' and status <> 'cancelled';
create index outbound_emails_due_idx on public.outbound_emails (workspace_id, status, scheduled_at);
create index outbound_emails_message_id_idx on public.outbound_emails (workspace_id, message_id) where message_id is not null;
create index outbound_emails_mailbox_idx on public.outbound_emails (mailbox_id, workspace_id, sent_at desc);
create index outbound_emails_thread_idx on public.outbound_emails (thread_id, workspace_id);
create index outbound_emails_lead_idx on public.outbound_emails (lead_id, workspace_id);
create index outbound_emails_prospect_idx on public.outbound_emails (prospect_id, workspace_id) where prospect_id is not null;
create index outbound_emails_recent_idx on public.outbound_emails (workspace_id, created_at desc);
create index outbound_emails_author_idx on public.outbound_emails (author_user_id) where author_user_id is not null;
create index outbound_emails_approved_by_idx on public.outbound_emails (approved_by) where approved_by is not null;

create trigger outbound_emails_set_updated_at
  before update on public.outbound_emails
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- mail_received: incoming mail that belongs to a thread. Mail that matches
-- nothing Dialvo sent is never stored anywhere.
-- ---------------------------------------------------------------------------
create table public.mail_received (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  mailbox_id uuid not null,
  thread_id uuid not null,
  -- The email's own Message-ID: the same email is never stored twice.
  message_id text not null check (char_length(message_id) between 1 and 300),
  from_email text not null check (char_length(from_email) <= 254),
  subject text not null default '' check (char_length(subject) <= 300),
  kind text not null check (kind in ('reply', 'bounce', 'auto_reply')),
  body text not null default '' check (char_length(body) <= 20000),
  -- For a real reply, what the model made of it. Null until it has.
  classification text check (
    classification is null or classification in
      ('interested', 'question', 'not_now', 'not_interested', 'wrong_person', 'unsubscribe', 'unclear')
  ),
  class_summary text check (class_summary is null or char_length(class_summary) <= 600),
  class_attempts integer not null default 0,
  class_locked_until timestamptz,
  classified_at timestamptz,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (mailbox_id, message_id),
  foreign key (mailbox_id, workspace_id)
    references public.mailboxes (id, workspace_id) on delete cascade,
  foreign key (thread_id, workspace_id)
    references public.mail_threads (id, workspace_id) on delete cascade
);
alter table public.mail_received enable row level security;
create index mail_received_mailbox_idx on public.mail_received (mailbox_id, workspace_id);
create index mail_received_thread_idx on public.mail_received (thread_id, workspace_id, received_at desc);
create index mail_received_recent_idx on public.mail_received (workspace_id, received_at desc);
create index mail_received_todo_idx on public.mail_received (workspace_id, received_at)
  where kind = 'reply' and classification is null;

alter table public.outbound_emails
  add foreign key (answers_received_id, workspace_id)
    references public.mail_received (id, workspace_id) on delete set null (answers_received_id);
create index outbound_emails_answers_idx on public.outbound_emails (answers_received_id, workspace_id)
  where answers_received_id is not null;

-- ---------------------------------------------------------------------------
-- Existing tables: one counter, and two more kinds of team alert.
-- ---------------------------------------------------------------------------

-- Follow-ups and replies the model wrote today, for the daily cap.
alter table public.outbound_usage
  add column mail_writes integer not null default 0;

-- An interested reply has a conversation; a paused mailbox doesn't.
alter table public.team_alerts alter column conversation_id drop not null;
alter table public.team_alerts drop constraint team_alerts_kind_check;
alter table public.team_alerts add constraint team_alerts_kind_check
  check (kind in ('qualified', 'needs_human', 'draft_waiting', 'reply_interested', 'mailbox_paused'));
create index team_alerts_pending_idx on public.team_alerts (workspace_id, created_at) where status = 'pending';

-- ---------------------------------------------------------------------------
-- Grants and policies. People read; every write goes through a function.
-- ---------------------------------------------------------------------------
revoke all on public.mailboxes, public.mailbox_secrets, public.workspace_sending,
  public.mail_threads, public.outbound_emails, public.mail_received
  from anon, authenticated;
grant all on public.mailboxes, public.workspace_sending, public.mail_threads,
  public.outbound_emails, public.mail_received
  to service_role;
-- Not even the secret key reads mailbox_secrets as a table: only the
-- functions below do (mailbox_connect, mailbox_disconnect, mail_mailbox_secret).
revoke all on public.mailbox_secrets from service_role;

grant select on public.mailboxes to authenticated;
grant select on public.workspace_sending to authenticated;
grant select on public.mail_threads to authenticated;
grant select on public.outbound_emails to authenticated;
grant select on public.mail_received to authenticated;

create policy "Members read mailboxes" on public.mailboxes for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));
create policy "Members read sending settings" on public.workspace_sending for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));
create policy "Members read email threads" on public.mail_threads for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));
create policy "Members read outgoing emails" on public.outbound_emails for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));
create policy "Members read received emails" on public.mail_received for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));

-- ---------------------------------------------------------------------------
-- Secrets in Vault
-- ---------------------------------------------------------------------------

-- The key the unsubscribe links are signed with. Made once, here; it never
-- leaves the database.
select vault.create_secret(
  replace(gen_random_uuid()::text || gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  'dialvo_unsubscribe_key',
  'Signs the unsubscribe links in emails Dialvo sends. Do not change: old links would stop working.'
)
where not exists (select 1 from vault.secrets where name = 'dialvo_unsubscribe_key');

-- "<email id>.<signature>". The signature is a keyed hash of the id, so a
-- link can't be made up for an email id someone happens to know.
create function private.mail_unsub_token(p_email_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p_email_id::text || '.' || encode(sha256(convert_to(
    k.decrypted_secret || ':' || p_email_id::text || ':' || k.decrypted_secret, 'UTF8'
  )), 'hex')
  from vault.decrypted_secrets k
  where k.name = 'dialvo_unsubscribe_key';
$$;
revoke all on function private.mail_unsub_token(uuid) from public;

-- ---------------------------------------------------------------------------
-- Stopping contact, in one place: an unsubscribe link, a reply that says
-- stop or "not interested". The address goes on the never-contact list (the
-- trigger there discards waiting drafts), the lead is marked do not contact,
-- its threads end and nothing still queued for it is sent.
-- ---------------------------------------------------------------------------
create function private.mail_stop_contact(
  p_workspace_id uuid, p_lead_id uuid, p_email text,
  p_thread_status text, p_reason text, p_lead_status text, p_summary text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if v_email ~ '^[^\s@]+@[a-z0-9-]+(\.[a-z0-9-]+)+$' then
    insert into public.outbound_suppressions (workspace_id, kind, value, note)
    values (p_workspace_id, 'email', v_email, left(p_summary, 200))
    on conflict (workspace_id, kind, value) do nothing;
  end if;
  update public.leads l
  set do_not_contact = true,
      do_not_contact_at = coalesce(l.do_not_contact_at, now()),
      status = case when p_lead_status is null or l.status in ('won') then l.status else p_lead_status end
  where l.id = p_lead_id and l.workspace_id = p_workspace_id;
  update public.mail_threads t
  set status = p_thread_status, stop_reason = left(p_reason, 60), next_followup_at = null
  where t.lead_id = p_lead_id and t.workspace_id = p_workspace_id
    and t.status in ('active', 'replied', 'stopped', 'finished');
  update public.outbound_emails e
  set status = 'cancelled', cancel_reason = left(p_reason, 60)
  where e.workspace_id = p_workspace_id
    and (e.lead_id = p_lead_id or e.to_email = v_email)
    and e.status in ('writing', 'draft', 'queued', 'scheduled');
  insert into public.activity_events (workspace_id, lead_id, kind, summary, channel, metadata)
  values (p_workspace_id, p_lead_id, 'do_not_contact', left(p_summary, 5000), 'email',
          jsonb_build_object('reason', p_reason));
end;
$$;
revoke all on function private.mail_stop_contact(uuid, uuid, text, text, text, text, text) from public;
