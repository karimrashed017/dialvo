-- Slice 3b: sending. Approved first emails go out from the customer's own
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

-- ---------------------------------------------------------------------------
-- Admins: mailboxes and settings
-- ---------------------------------------------------------------------------

-- Connects a mailbox, or replaces the password and settings of one that is
-- already connected with the same address. The server has logged in to SMTP
-- and IMAP with these details before calling this. The password goes
-- straight into Vault; nothing returns it to a signed-in person.
create function public.mailbox_connect(
  p_workspace_id uuid, p_provider text, p_email text, p_sender_name text, p_username text,
  p_smtp_host text, p_smtp_port integer, p_smtp_security text,
  p_imap_host text, p_imap_port integer, p_password text, p_daily_limit integer default 30
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_id uuid;
  v_secret uuid;
  v_limit integer := least(greatest(coalesce(p_daily_limit, 30), 1), 50);
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if not (select private.is_workspace_admin(p_workspace_id)) then
    raise exception 'only an owner or admin can connect a mailbox' using errcode = '42501';
  end if;
  if char_length(coalesce(p_password, '')) < 1 or char_length(p_password) > 500 then
    raise exception 'a password is required' using errcode = '22023';
  end if;
  perform 1 from public.workspaces w where w.id = p_workspace_id for update;

  select m.id, x.secret_id into v_id, v_secret from public.mailboxes m
  join public.mailbox_secrets x on x.mailbox_id = m.id
  where m.workspace_id = p_workspace_id and m.email = v_email and m.status <> 'disconnected';
  if found then
    perform vault.update_secret(v_secret, p_password);
    update public.mailboxes m
    set provider = p_provider, sender_name = btrim(p_sender_name), username = btrim(p_username),
        smtp_host = lower(btrim(p_smtp_host)), smtp_port = p_smtp_port, smtp_security = p_smtp_security,
        imap_host = lower(btrim(p_imap_host)), imap_port = p_imap_port, daily_limit = v_limit,
        status = 'active', pause_reason = null, auth_failures = 0, last_error = null
    where m.id = v_id;
    return v_id;
  end if;

  -- A backstop, not the product's limit: see MAX_MAILBOXES in config.ts.
  if (select count(*) from public.mailboxes m
      where m.workspace_id = p_workspace_id and m.status <> 'disconnected') >= 10 then
    raise exception 'too many mailboxes' using errcode = 'P0001';
  end if;
  v_id := gen_random_uuid();
  v_secret := vault.create_secret(p_password, 'mailbox_' || v_id::text, 'App password of a mailbox connected in Dialvo');
  insert into public.mailboxes (
    id, workspace_id, provider, email, sender_name, username, smtp_host, smtp_port,
    smtp_security, imap_host, imap_port, daily_limit, created_by
  ) values (
    v_id, p_workspace_id, p_provider, v_email, btrim(p_sender_name), btrim(p_username),
    lower(btrim(p_smtp_host)), p_smtp_port, p_smtp_security,
    lower(btrim(p_imap_host)), p_imap_port, v_limit, v_user
  );
  insert into public.mailbox_secrets (mailbox_id, workspace_id, secret_id)
  values (v_id, p_workspace_id, v_secret);
  return v_id;
end;
$$;

-- The sender's name and the daily limit.
create function public.mailbox_update(p_mailbox_id uuid, p_sender_name text, p_daily_limit integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  update public.mailboxes m
  set sender_name = btrim(p_sender_name),
      daily_limit = least(greatest(coalesce(p_daily_limit, m.daily_limit), 1), 50)
  where m.id = p_mailbox_id and m.status <> 'disconnected'
    and (select private.is_workspace_admin(m.workspace_id));
  if not found then
    raise exception 'mailbox not found' using errcode = 'P0002';
  end if;
end;
$$;

-- A paused mailbox is switched back on by an admin (after fixing what was
-- wrong, usually by connecting it again with a new app password).
create function public.mailbox_resume(p_mailbox_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  update public.mailboxes m
  set status = 'active', pause_reason = null, auth_failures = 0
  where m.id = p_mailbox_id and m.status = 'paused'
    and (select private.is_workspace_admin(m.workspace_id));
  if not found then
    raise exception 'mailbox not found' using errcode = 'P0002';
  end if;
end;
$$;

-- Disconnect: the password is deleted from Vault at once. What the mailbox
-- already sent stays as a record. First emails it was going to send go back
-- to waiting for a slot (another mailbox may take them); its follow-ups and
-- replies are cancelled, because they can only leave from the same mailbox.
create function public.mailbox_disconnect(p_mailbox_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_box public.mailboxes%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  select m.* into v_box from public.mailboxes m
  where m.id = p_mailbox_id and m.status <> 'disconnected'
    and (select private.is_workspace_admin(m.workspace_id))
  for update;
  if not found then
    raise exception 'mailbox not found' using errcode = 'P0002';
  end if;
  delete from vault.secrets s
  where s.id in (select x.secret_id from public.mailbox_secrets x where x.mailbox_id = v_box.id);
  delete from public.mailbox_secrets x where x.mailbox_id = v_box.id;
  update public.mailboxes m
  set status = 'disconnected', pause_reason = null, poll_locked_until = null
  where m.id = v_box.id;
  update public.outbound_emails e
  set status = 'queued', mailbox_id = null, scheduled_at = null
  where e.mailbox_id = v_box.id and e.workspace_id = v_box.workspace_id
    and e.kind = 'first' and e.status in ('queued', 'scheduled');
  update public.outbound_emails e
  set status = 'cancelled', cancel_reason = 'mailbox_disconnected'
  where e.workspace_id = v_box.workspace_id and e.kind <> 'first'
    and e.status in ('writing', 'draft', 'queued', 'scheduled')
    and (e.mailbox_id = v_box.id or e.thread_id in (
      select t.id from public.mail_threads t
      where t.mailbox_id = v_box.id and t.workspace_id = v_box.workspace_id));
  update public.mail_threads t
  set status = 'stopped', stop_reason = 'mailbox_disconnected', next_followup_at = null
  where t.mailbox_id = v_box.id and t.workspace_id = v_box.workspace_id and t.status = 'active';
end;
$$;

-- Saves who is sending and how. p_settings may hold any of: business_name,
-- postal_address, confirm_allowed (true records who confirmed and when; it
-- is never un-confirmed here), booking_url, followups_enabled,
-- followup_1_days, followup_2_days, reply_mode, sending_on.
-- Sending can only be switched on once the sender details exist.
create function public.sending_settings_save(p_workspace_id uuid, p_settings jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_row public.workspace_sending%rowtype;
  v_booking text;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if not (select private.is_workspace_admin(p_workspace_id)) then
    raise exception 'only an owner or admin can change this' using errcode = '42501';
  end if;
  insert into public.workspace_sending (workspace_id) values (p_workspace_id)
  on conflict (workspace_id) do nothing;
  select s.* into v_row from public.workspace_sending s
  where s.workspace_id = p_workspace_id for update;

  if p_settings ? 'business_name' then
    v_row.business_name := left(btrim(coalesce(p_settings ->> 'business_name', '')), 200);
  end if;
  if p_settings ? 'postal_address' then
    v_row.postal_address := left(btrim(coalesce(p_settings ->> 'postal_address', '')), 500);
  end if;
  if (p_settings ->> 'confirm_allowed')::boolean is true and v_row.allowed_confirmed_at is null then
    v_row.allowed_confirmed_at := now();
    v_row.allowed_confirmed_by := v_user;
  end if;
  if p_settings ? 'booking_url' then
    v_booking := nullif(btrim(coalesce(p_settings ->> 'booking_url', '')), '');
    if v_booking is not null and (v_booking !~ '^https://[^\s]+$' or char_length(v_booking) > 500) then
      raise exception 'the booking link must start with https://' using errcode = '22023';
    end if;
    v_row.booking_url := v_booking;
  end if;
  if p_settings ? 'followups_enabled' then
    v_row.followups_enabled := coalesce((p_settings ->> 'followups_enabled')::boolean, true);
  end if;
  if p_settings ? 'followup_1_days' then
    v_row.followup_1_days := (p_settings ->> 'followup_1_days')::integer;
  end if;
  if p_settings ? 'followup_2_days' then
    v_row.followup_2_days := (p_settings ->> 'followup_2_days')::integer;
  end if;
  if p_settings ? 'reply_mode' then
    v_row.reply_mode := p_settings ->> 'reply_mode';
  end if;
  if p_settings ? 'sending_on' then
    v_row.sending_on := coalesce((p_settings ->> 'sending_on')::boolean, false);
  end if;
  if v_row.sending_on and (
    btrim(v_row.business_name) = '' or btrim(v_row.postal_address) = '' or v_row.allowed_confirmed_at is null
  ) then
    raise exception 'add the sender details first' using errcode = 'P0001';
  end if;

  update public.workspace_sending s
  set business_name = v_row.business_name, postal_address = v_row.postal_address,
      allowed_confirmed_at = v_row.allowed_confirmed_at, allowed_confirmed_by = v_row.allowed_confirmed_by,
      booking_url = v_row.booking_url, followups_enabled = v_row.followups_enabled,
      followup_1_days = v_row.followup_1_days, followup_2_days = v_row.followup_2_days,
      reply_mode = v_row.reply_mode, sending_on = v_row.sending_on, updated_by = v_user
  where s.workspace_id = p_workspace_id;
  return jsonb_build_object('sending_on', v_row.sending_on);
end;
$$;

-- ---------------------------------------------------------------------------
-- Members: decide on what the agent wrote, and reply by hand
-- ---------------------------------------------------------------------------

-- A follow-up or a reply the agent drafted.
--   'approve': it goes into the queue, with the edits if any.
--   'save':    keep the edits.
--   'discard': drop it. Discarding a follow-up ends that lead's sequence.
create function public.outbound_email_decide(
  p_email_id uuid, p_action text, p_subject text default null, p_body text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_e public.outbound_emails%rowtype;
  v_subject text;
  v_body text;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  select e.* into v_e from public.outbound_emails e
  where e.id = p_email_id and e.status = 'draft'
    and (select private.is_workspace_member(e.workspace_id))
  for update;
  if not found then
    raise exception 'email not found' using errcode = 'P0002';
  end if;
  if p_action = 'discard' then
    update public.outbound_emails e
    set status = 'cancelled', cancel_reason = 'by_person', approved_by = v_user, approved_at = now()
    where e.id = v_e.id;
    if v_e.kind = 'followup' then
      update public.mail_threads t
      set status = 'stopped', stop_reason = 'followup_discarded', next_followup_at = null
      where t.id = v_e.thread_id and t.status = 'active';
    end if;
    return 'cancelled';
  end if;
  if p_action not in ('approve', 'save') then
    raise exception 'unknown action' using errcode = '22023';
  end if;
  -- A follow-up keeps its thread's subject; a reply's can be edited.
  v_subject := case when v_e.kind = 'followup' then v_e.subject else coalesce(
    nullif(btrim(regexp_replace(coalesce(p_subject, ''), '\s+', ' ', 'g')), ''), v_e.subject) end;
  v_body := coalesce(nullif(btrim(coalesce(p_body, '')), ''), v_e.body);
  if char_length(v_subject) > 200 or char_length(v_body) > 5000 then
    raise exception 'the subject or the email is too long' using errcode = '22023';
  end if;
  if p_action = 'approve' then
    if private.outbound_is_suppressed(v_e.workspace_id, v_e.to_email, null) then
      raise exception 'that address is on the suppression list' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.leads l
               where l.id = v_e.lead_id and l.workspace_id = v_e.workspace_id and l.do_not_contact) then
      raise exception 'that lead is marked do not contact' using errcode = 'P0001';
    end if;
  end if;
  update public.outbound_emails e
  set subject = v_subject, body = v_body,
      status = case when p_action = 'approve' then 'queued' else e.status end,
      approved_by = case when p_action = 'approve' then v_user else e.approved_by end,
      approved_at = case when p_action = 'approve' then now() else e.approved_at end
  where e.id = v_e.id;
  return case when p_action = 'approve' then 'queued' else 'draft' end;
end;
$$;

-- A teammate's own reply in an email conversation. It leaves from the same
-- mailbox, in the same thread, the next time the sender runs. A draft the
-- agent had waiting for this conversation is dropped.
create function public.mail_reply_queue(p_conversation_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_t public.mail_threads%rowtype;
  v_body text := btrim(coalesce(p_body, ''));
  v_id uuid;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  select t.* into v_t from public.mail_threads t
  where t.conversation_id = p_conversation_id
    and (select private.is_workspace_member(t.workspace_id))
  for update;
  if not found then
    raise exception 'conversation not found' using errcode = 'P0002';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 5000 then
    raise exception 'a reply must be 1 to 5000 characters' using errcode = '22023';
  end if;
  if private.outbound_is_suppressed(v_t.workspace_id, v_t.to_email, null) then
    raise exception 'that address is on the suppression list' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.leads l
             where l.id = v_t.lead_id and l.workspace_id = v_t.workspace_id and l.do_not_contact) then
    raise exception 'that lead is marked do not contact' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.mailboxes m
                 where m.id = v_t.mailbox_id and m.workspace_id = v_t.workspace_id and m.status <> 'disconnected') then
    raise exception 'the mailbox this conversation used is disconnected' using errcode = 'P0001';
  end if;
  update public.outbound_emails e
  set status = 'cancelled', cancel_reason = 'replaced_by_person'
  where e.thread_id = v_t.id and e.kind = 'reply' and e.written_by = 'agent'
    and e.status in ('writing', 'draft');
  insert into public.outbound_emails (
    workspace_id, lead_id, thread_id, mailbox_id, kind, written_by, author_user_id,
    to_email, subject, body, status, approved_by, approved_at
  ) values (
    v_t.workspace_id, v_t.lead_id, v_t.id, v_t.mailbox_id, 'reply', 'user', v_user,
    v_t.to_email, left('Re: ' || v_t.subject, 200), v_body, 'queued', v_user, now()
  )
  returning id into v_id;
  update public.conversations c
  set status = 'open', assigned_to = coalesce(c.assigned_to, v_user)
  where c.id = v_t.conversation_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- The server's side (secret key only)
-- ---------------------------------------------------------------------------

-- How many emails a mailbox may send today: a new one starts low and climbs
-- to its limit.
create function private.mailbox_allowance(
  p_daily_limit integer, p_connected_at timestamptz, p_tz text, p_ramp_start integer, p_ramp_step integer
)
returns integer
language sql
stable
set search_path = ''
as $$
  select least(
    p_daily_limit,
    greatest(p_ramp_start, 1) + greatest(p_ramp_step, 0) * greatest(
      (now() at time zone private.safe_tz(p_tz))::date
        - (p_connected_at at time zone private.safe_tz(p_tz))::date, 0)
  );
$$;
revoke all on function private.mailbox_allowance(integer, timestamptz, text, integer, integer) from public;

-- Emails a mailbox has sent today (or may have: claimed ones count).
create function private.mailbox_used_today(p_mailbox_id uuid, p_workspace_id uuid, p_day_start timestamptz)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from public.outbound_emails e
  where e.mailbox_id = p_mailbox_id and e.workspace_id = p_workspace_id
    and e.status in ('sent', 'sending', 'needs_check')
    and coalesce(e.sent_at, e.claimed_at) >= p_day_start;
$$;
revoke all on function private.mailbox_used_today(uuid, uuid, timestamptz) from public;

-- The mailbox's settings with its password, for the server to log in with.
-- This is the only way the password is ever read back.
create function public.mail_mailbox_secret(p_workspace_id uuid, p_mailbox_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', m.id, 'email', m.email, 'sender_name', m.sender_name, 'username', m.username,
    'smtp_host', m.smtp_host, 'smtp_port', m.smtp_port, 'smtp_security', m.smtp_security,
    'imap_host', m.imap_host, 'imap_port', m.imap_port, 'status', m.status,
    'password', s.decrypted_secret
  )
  from public.mailboxes m
  join public.mailbox_secrets x on x.mailbox_id = m.id and x.workspace_id = m.workspace_id
  join vault.decrypted_secrets s on s.id = x.secret_id
  where m.id = p_mailbox_id and m.workspace_id = p_workspace_id and m.status <> 'disconnected';
$$;

-- What happened when the server logged in to a mailbox. A refused login is
-- counted; p_pause_after of them in a row pause the mailbox and queue an
-- alert for the team. A login that works resets the count.
--   { "paused": bool, "newly_paused": bool }
create function public.mail_mailbox_result(
  p_workspace_id uuid, p_mailbox_id uuid, p_outcome text, p_error text, p_pause_after integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_box public.mailboxes%rowtype;
  v_newly boolean := false;
begin
  select m.* into v_box from public.mailboxes m
  where m.id = p_mailbox_id and m.workspace_id = p_workspace_id and m.status <> 'disconnected'
  for update;
  if not found then
    return jsonb_build_object('paused', true, 'newly_paused', false);
  end if;
  if p_outcome = 'ok' then
    update public.mailboxes m set auth_failures = 0, last_error = null where m.id = v_box.id;
  elsif p_outcome = 'auth_failed' then
    v_newly := v_box.status = 'active' and v_box.auth_failures + 1 >= greatest(p_pause_after, 1);
    update public.mailboxes m
    set auth_failures = m.auth_failures + 1, last_error = left(p_error, 500),
        status = case when v_newly then 'paused' else m.status end,
        pause_reason = case when v_newly then 'login_refused' else m.pause_reason end
    where m.id = v_box.id;
    if v_newly then
      insert into public.team_alerts (workspace_id, conversation_id, kind, summary)
      values (p_workspace_id, null, 'mailbox_paused', left(
        'Dialvo paused sending from ' || v_box.email || ' because its mail server refused the login '
        || greatest(p_pause_after, 1) || ' times in a row. Connect it again with a new app password.', 1000));
    end if;
  else
    update public.mailboxes m set last_error = left(p_error, 500) where m.id = v_box.id;
  end if;
  return jsonb_build_object(
    'paused', v_newly or v_box.status = 'paused', 'newly_paused', v_newly);
end;
$$;

-- Workspaces with something for the sender or the writer to do: sending is
-- on and at least one mailbox is active.
create function public.mail_work_list()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(s.workspace_id order by s.workspace_id), '{}'::uuid[])
  from public.workspace_sending s
  where s.sending_on and (select private.sending_ready(s.workspace_id))
    and exists (select 1 from public.mailboxes m
                where m.workspace_id = s.workspace_id and m.status = 'active');
$$;

-- Makes sure a prospect has a lead (replies land on a lead's conversation).
create function private.prospect_ensure_lead(p_prospect_id uuid, p_workspace_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.prospects%rowtype;
  v_lead uuid;
begin
  select pr.* into p from public.prospects pr
  where pr.id = p_prospect_id and pr.workspace_id = p_workspace_id for update;
  if not found then
    return null;
  end if;
  if p.lead_id is not null then
    return p.lead_id;
  end if;
  if p.email is not null then
    select l.id into v_lead from public.leads l
    where l.workspace_id = p_workspace_id and l.email = p.email;
  end if;
  if v_lead is null then
    insert into public.leads (workspace_id, name, email, phone, company, website, source, custom_fields)
    values (
      p_workspace_id, p.contact_name, p.email, p.phone, nullif(p.company_name, ''), p.website,
      'found by Dialvo',
      jsonb_build_object('research', jsonb_build_object(
        'summary', p.summary, 'location', p.location, 'contact_role', p.contact_role,
        'email_source_url', p.email_source_url, 'phone_source_url', p.phone_source_url,
        'facts', p.facts, 'pages', p.pages, 'prospect_id', p.id
      ))
    )
    returning id into v_lead;
    insert into public.activity_events (workspace_id, lead_id, kind, summary, channel, metadata)
    values (p_workspace_id, v_lead, 'lead_created',
            'Found by Dialvo on the web and added to leads when its first email was scheduled.',
            null, jsonb_build_object('prospect_id', p.id, 'via', 'find_leads'));
  end if;
  update public.prospects pr set lead_id = v_lead where pr.id = p.id;
  return v_lead;
end;
$$;
revoke all on function private.prospect_ensure_lead(uuid, uuid) from public;

-- What the planner needs to give waiting emails a time and a mailbox:
--   { "on": bool, "timezone", "window", "sent_today": n,
--     "mailboxes": [{ "id", "allowance", "used", "planned": ["<time>", ...] }],
--     "waiting": [{ "draft_id" } | { "email_id", "mailbox_id", "by_person": bool }] }
-- "waiting" is approved first-email drafts with no email yet, and queued
-- emails (approved follow-ups and replies, and first emails pushed back).
create function public.mail_schedule_context(
  p_workspace_id uuid, p_limit integer, p_ramp_start integer, p_ramp_step integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws public.workspaces%rowtype;
  v_set public.workspace_sending%rowtype;
  v_agent public.agents%rowtype;
  v_day timestamptz;
  v_boxes jsonb;
  v_waiting jsonb;
begin
  select w.* into v_ws from public.workspaces w where w.id = p_workspace_id;
  if not found then
    return null;
  end if;
  select s.* into v_set from public.workspace_sending s where s.workspace_id = p_workspace_id;
  select a.* into v_agent from public.agents a
  where a.workspace_id = p_workspace_id and a.role = 'outbound'
  order by (a.channel = 'email') desc, a.created_at
  limit 1;
  v_day := private.local_day_start(v_ws.timezone);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id,
    'allowance', private.mailbox_allowance(m.daily_limit, m.connected_at, v_ws.timezone, p_ramp_start, p_ramp_step),
    'daily_limit', m.daily_limit,
    'connected_at', m.connected_at,
    'used', private.mailbox_used_today(m.id, m.workspace_id, v_day),
    'planned', coalesce((
      select jsonb_agg(e.scheduled_at order by e.scheduled_at) from public.outbound_emails e
      where e.mailbox_id = m.id and e.workspace_id = m.workspace_id and e.status = 'scheduled'
    ), '[]'::jsonb)
  ) order by m.created_at, m.id), '[]'::jsonb) into v_boxes
  from public.mailboxes m
  where m.workspace_id = p_workspace_id and m.status = 'active';

  select coalesce(jsonb_agg(w.item), '[]'::jsonb) into v_waiting from (
    (select jsonb_build_object('email_id', e.id, 'mailbox_id', coalesce(e.mailbox_id, t.mailbox_id),
                               'by_person', e.written_by = 'user', 'kind', e.kind) as item,
            0 as rank, e.created_at as ts
     from public.outbound_emails e
     left join public.mail_threads t on t.id = e.thread_id and t.workspace_id = e.workspace_id
     where e.workspace_id = p_workspace_id and e.status = 'queued'
     order by e.created_at
     limit greatest(p_limit, 0))
    union all
    (select jsonb_build_object('draft_id', d.id) as item, 1 as rank, d.decided_at as ts
     from public.outbound_drafts d
     where d.workspace_id = p_workspace_id and d.status = 'approved'
       and not exists (select 1 from public.outbound_emails e
                       where e.draft_id = d.id and e.status <> 'cancelled')
     order by d.decided_at, d.id
     limit greatest(p_limit, 0))
    order by rank, ts
    limit greatest(p_limit, 0)
  ) w;

  return jsonb_build_object(
    'on', coalesce(v_set.sending_on, false) and private.sending_ready(p_workspace_id),
    'timezone', private.safe_tz(v_ws.timezone),
    'window', coalesce(v_agent.send_window, '{"days": [1, 2, 3, 4, 5], "start": "09:00", "end": "17:00"}'::jsonb),
    'sent_today', (select count(*) from public.outbound_emails e
                   where e.workspace_id = p_workspace_id and e.status in ('sent', 'sending', 'needs_check')
                     and coalesce(e.sent_at, e.claimed_at) >= v_day),
    'mailboxes', v_boxes,
    'waiting', v_waiting
  );
end;
$$;

-- Stores the planner's decisions. p_plans:
--   [{ "draft_id" | "email_id", "mailbox_id", "send_at": "<time>" }, ...]
-- A draft becomes a scheduled email (and its prospect a lead, so a reply
-- has somewhere to land); a queued email gets its time. Anything that has
-- changed meanwhile (no longer approved, suppressed, mailbox gone) is
-- skipped. Returns how many were scheduled.
create function public.mail_schedule_commit(p_workspace_id uuid, p_plans jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
  v_plan record;
  v_d public.outbound_drafts%rowtype;
  v_p public.prospects%rowtype;
  v_lead uuid;
begin
  for v_plan in
    select * from jsonb_to_recordset(coalesce(p_plans, '[]'::jsonb))
      as x(draft_id uuid, email_id uuid, mailbox_id uuid, send_at timestamptz)
  loop
    continue when v_plan.send_at is null or v_plan.mailbox_id is null;
    continue when not exists (
      select 1 from public.mailboxes m
      where m.id = v_plan.mailbox_id and m.workspace_id = p_workspace_id and m.status = 'active');

    if v_plan.email_id is not null then
      update public.outbound_emails e
      set status = 'scheduled', scheduled_at = v_plan.send_at,
          -- A follow-up or a reply keeps its thread's mailbox whatever was asked.
          mailbox_id = coalesce(
            (select t.mailbox_id from public.mail_threads t where t.id = e.thread_id), v_plan.mailbox_id)
      where e.id = v_plan.email_id and e.workspace_id = p_workspace_id and e.status = 'queued';
      if found then
        v_count := v_count + 1;
      end if;
      continue;
    end if;

    select d.* into v_d from public.outbound_drafts d
    where d.id = v_plan.draft_id and d.workspace_id = p_workspace_id and d.status = 'approved'
    for update;
    continue when not found;
    select p.* into v_p from public.prospects p
    where p.id = v_d.prospect_id and p.workspace_id = p_workspace_id;
    continue when private.outbound_is_suppressed(p_workspace_id, v_d.to_email, v_p.domain);
    v_lead := private.prospect_ensure_lead(v_d.prospect_id, p_workspace_id);
    continue when v_lead is null;
    continue when exists (select 1 from public.leads l where l.id = v_lead and l.do_not_contact);
    insert into public.outbound_emails (
      workspace_id, lead_id, prospect_id, draft_id, mailbox_id, kind, written_by,
      to_email, subject, body, status, scheduled_at, model, approved_by, approved_at
    ) values (
      p_workspace_id, v_lead, v_d.prospect_id, v_d.id, v_plan.mailbox_id, 'first', 'agent',
      v_d.to_email, v_d.subject, v_d.body, 'scheduled', v_plan.send_at, v_d.model, v_d.decided_by, v_d.decided_at
    )
    on conflict do nothing;
    if found then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

-- Claims the emails that are due, at most one per mailbox per call, and
-- hands back everything needed to send each one. Before an email is handed
-- out it is checked again, at this moment:
--   * the first email's draft is still approved (its latest text is used);
--   * the address isn't on the never-contact list, the lead isn't marked do
--     not contact, unsubscribed or lost;
--   * a follow-up's sequence is still running (no reply, bounce or stop);
--   * the mailbox is active, inside its allowance for today, and the
--     workspace is under its daily cap, and it is inside the send window.
-- An email that fails a "never" check is cancelled with the reason. One
-- that is only early (cap, allowance, window) goes back to the queue for a
-- new slot. A person's own reply skips the cap, the allowance and the
-- window: someone chose to send it now.
--
-- First, rows left 'sending' for longer than p_stale_seconds become
-- 'needs_check'. They are never handed out again.
create function public.mail_send_claim(
  p_workspace_id uuid, p_limit integer, p_ramp_start integer, p_ramp_step integer,
  p_workspace_cap integer, p_stale_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws public.workspaces%rowtype;
  v_set public.workspace_sending%rowtype;
  v_agent public.agents%rowtype;
  v_window jsonb;
  v_day timestamptz;
  v_sent_today integer;
  v_out jsonb := '[]'::jsonb;
  v_busy uuid[] := '{}'::uuid[];
  v_e public.outbound_emails%rowtype;
  v_d public.outbound_drafts%rowtype;
  v_l public.leads%rowtype;
  v_t public.mail_threads%rowtype;
  v_m public.mailboxes%rowtype;
  v_cancel text;
  v_domain text;
  v_in_reply_to text;
  v_refs text;
  v_free boolean;
begin
  update public.outbound_emails e
  set status = 'needs_check',
      error = 'The step that was sending this stopped before it could say whether it went.'
  where e.workspace_id = p_workspace_id and e.status = 'sending'
    and e.claimed_at < now() - make_interval(secs => greatest(p_stale_seconds, 60));

  select w.* into v_ws from public.workspaces w where w.id = p_workspace_id for update;
  if not found then
    return null;
  end if;
  select s.* into v_set from public.workspace_sending s where s.workspace_id = p_workspace_id;
  if not found or not v_set.sending_on or not private.sending_ready(p_workspace_id) then
    return jsonb_build_object('emails', '[]'::jsonb, 'on', false);
  end if;
  select a.* into v_agent from public.agents a
  where a.workspace_id = p_workspace_id and a.role = 'outbound'
  order by (a.channel = 'email') desc, a.created_at
  limit 1;
  v_window := coalesce(v_agent.send_window, '{"days": [1, 2, 3, 4, 5], "start": "09:00", "end": "17:00"}'::jsonb);
  v_day := private.local_day_start(v_ws.timezone);
  select count(*) into v_sent_today from public.outbound_emails e
  where e.workspace_id = p_workspace_id and e.status in ('sent', 'sending', 'needs_check')
    and coalesce(e.sent_at, e.claimed_at) >= v_day;

  for v_e in
    select e.* from public.outbound_emails e
    where e.workspace_id = p_workspace_id and e.status = 'scheduled' and e.scheduled_at <= now()
    order by e.scheduled_at, e.id
    limit greatest(p_limit, 1) * 5
    for update skip locked
  loop
    exit when jsonb_array_length(v_out) >= greatest(p_limit, 1);
    v_cancel := null;
    v_free := v_e.written_by = 'user';

    select l.* into v_l from public.leads l where l.id = v_e.lead_id and l.workspace_id = p_workspace_id;
    v_domain := null;
    if v_e.prospect_id is not null then
      select p.domain into v_domain from public.prospects p
      where p.id = v_e.prospect_id and p.workspace_id = p_workspace_id;
    end if;
    if v_e.kind = 'first' then
      select d.* into v_d from public.outbound_drafts d
      where d.id = v_e.draft_id and d.workspace_id = p_workspace_id;
      if not found or v_d.status <> 'approved' then
        v_cancel := 'no_longer_approved';
      else
        -- Edits saved after it was scheduled are what goes out.
        v_e.subject := v_d.subject;
        v_e.body := v_d.body;
        v_e.to_email := v_d.to_email;
      end if;
    else
      select t.* into v_t from public.mail_threads t
      where t.id = v_e.thread_id and t.workspace_id = p_workspace_id;
      if not found then
        v_cancel := 'no_thread';
      elsif v_e.kind = 'followup' and v_t.status <> 'active' then
        v_cancel := 'sequence_ended';
      elsif v_t.status in ('bounced', 'unsubscribed') then
        v_cancel := 'sequence_ended';
      end if;
    end if;
    if v_cancel is null and private.outbound_is_suppressed(p_workspace_id, v_e.to_email, v_domain) then
      v_cancel := 'suppressed';
    end if;
    if v_cancel is null and (v_l.do_not_contact or exists (
      select 1 from public.leads l2
      where l2.workspace_id = p_workspace_id and l2.email = v_e.to_email and l2.do_not_contact)) then
      v_cancel := 'do_not_contact';
    end if;
    if v_cancel is null and v_l.status in ('unsubscribed', 'lost') then
      v_cancel := 'lead_closed';
    end if;
    -- A cold email to someone who is already talking to the team is noise.
    if v_cancel is null and v_e.kind = 'first' and exists (
      select 1 from public.mail_threads t2
      where t2.workspace_id = p_workspace_id and t2.to_email = v_e.to_email) then
      v_cancel := 'already_contacted';
    end if;
    if v_cancel is not null then
      update public.outbound_emails e set status = 'cancelled', cancel_reason = v_cancel where e.id = v_e.id;
      continue;
    end if;

    select m.* into v_m from public.mailboxes m
    where m.id = v_e.mailbox_id and m.workspace_id = p_workspace_id
    for update;
    if v_m.status = 'disconnected' then
      if v_e.kind = 'first' then
        update public.outbound_emails e
        set status = 'queued', mailbox_id = null, scheduled_at = null where e.id = v_e.id;
      else
        update public.outbound_emails e
        set status = 'cancelled', cancel_reason = 'mailbox_disconnected' where e.id = v_e.id;
      end if;
      continue;
    end if;
    -- A paused mailbox keeps its emails until it is resumed.
    continue when v_m.status <> 'active';
    -- One per mailbox per call: the next call is the gap between two emails.
    continue when v_m.id = any (v_busy);

    if not v_free and (
      not private.in_send_window(v_window, v_ws.timezone, now())
      or (v_e.kind <> 'reply' and (
        v_sent_today >= p_workspace_cap
        or private.mailbox_used_today(v_m.id, p_workspace_id, v_day)
           >= private.mailbox_allowance(v_m.daily_limit, v_m.connected_at, v_ws.timezone, p_ramp_start, p_ramp_step)
      ))
    ) then
      update public.outbound_emails e
      set status = 'queued', scheduled_at = null,
          mailbox_id = case when e.kind = 'first' then null else e.mailbox_id end
      where e.id = v_e.id;
      continue;
    end if;

    -- Threading: a follow-up answers the first email; a reply answers the
    -- latest email in the thread, whoever sent it.
    v_in_reply_to := null;
    v_refs := null;
    if v_e.kind <> 'first' then
      select string_agg(x.message_id, ' ' order by x.ts) into v_refs from (
        select e2.message_id, e2.sent_at as ts from public.outbound_emails e2
        where e2.thread_id = v_t.id and e2.status = 'sent' and e2.message_id is not null
        union all
        select r.message_id, r.received_at from public.mail_received r
        where r.thread_id = v_t.id and r.kind = 'reply'
        order by ts desc limit 20
      ) x;
      if v_e.kind = 'reply' then
        select x.message_id into v_in_reply_to from (
          select e2.message_id, e2.sent_at as ts from public.outbound_emails e2
          where e2.thread_id = v_t.id and e2.status = 'sent' and e2.message_id is not null
          union all
          select r.message_id, r.received_at from public.mail_received r
          where r.thread_id = v_t.id and r.kind = 'reply'
        ) x order by x.ts desc limit 1;
      else
        select e2.message_id into v_in_reply_to from public.outbound_emails e2
        where e2.thread_id = v_t.id and e2.kind = 'first' and e2.status = 'sent';
      end if;
    end if;

    update public.outbound_emails e
    set status = 'sending', claimed_at = now(), attempts = e.attempts + 1,
        subject = v_e.subject, body = v_e.body, to_email = v_e.to_email,
        message_id = coalesce(e.message_id,
          '<' || replace(gen_random_uuid()::text, '-', '') || '@' || split_part(v_m.email, '@', 2) || '>'),
        in_reply_to = v_in_reply_to, reference_ids = left(v_refs, 4000)
    where e.id = v_e.id
    returning e.* into v_e;
    v_busy := v_busy || v_m.id;
    v_sent_today := v_sent_today + 1;
    v_out := v_out || jsonb_build_object(
      'id', v_e.id, 'kind', v_e.kind, 'mailbox_id', v_m.id, 'attempts', v_e.attempts,
      'to', v_e.to_email, 'subject', v_e.subject, 'body', v_e.body,
      'message_id', v_e.message_id, 'in_reply_to', v_e.in_reply_to, 'references', v_e.reference_ids,
      'from_email', v_m.email, 'sender_name', v_m.sender_name,
      'business_name', v_set.business_name, 'postal_address', v_set.postal_address,
      'unsubscribe_token', private.mail_unsub_token(v_e.id)
    );
  end loop;
  return jsonb_build_object('emails', v_out, 'on', true);
end;
$$;

-- An email went out: the record, the thread, the conversation in the Inbox
-- and the next follow-up's date. Internal; called once per email.
create function private.mail_mark_sent(p_email_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_e public.outbound_emails%rowtype;
  v_set public.workspace_sending%rowtype;
  v_t public.mail_threads%rowtype;
  v_conv uuid;
  v_thread uuid;
begin
  update public.outbound_emails e
  set status = 'sent', sent_at = now(), error = null
  where e.id = p_email_id
  returning e.* into v_e;
  select s.* into v_set from public.workspace_sending s where s.workspace_id = v_e.workspace_id;
  update public.mailboxes m set last_sent_at = now() where m.id = v_e.mailbox_id;

  if v_e.kind = 'first' then
    insert into public.conversations (workspace_id, lead_id, channel, status, last_message_at)
    values (v_e.workspace_id, v_e.lead_id, 'email', 'open', now())
    returning id into v_conv;
    insert into public.mail_threads (
      workspace_id, lead_id, conversation_id, mailbox_id, to_email, subject,
      next_followup_at, first_sent_at, last_sent_at
    ) values (
      v_e.workspace_id, v_e.lead_id, v_conv, v_e.mailbox_id, v_e.to_email, v_e.subject,
      case when coalesce(v_set.followups_enabled, true)
        then now() + make_interval(days => coalesce(v_set.followup_1_days, 3)) end,
      now(), now()
    )
    returning id into v_thread;
    update public.outbound_emails e set thread_id = v_thread where e.id = v_e.id;
  else
    select t.* into v_t from public.mail_threads t where t.id = v_e.thread_id for update;
    v_conv := v_t.conversation_id;
    if v_e.kind = 'followup' then
      update public.mail_threads t
      set followups_sent = greatest(t.followups_sent, v_e.step),
          last_sent_at = now(),
          status = case when t.status = 'active' and v_e.step >= 2 then 'finished' else t.status end,
          next_followup_at = case
            when t.status = 'active' and v_e.step < 2 and coalesce(v_set.followups_enabled, true)
            then greatest(
              t.first_sent_at + make_interval(days => coalesce(v_set.followup_2_days, 7)),
              now() + interval '1 day')
          end
      where t.id = v_t.id;
    else
      update public.mail_threads t set last_sent_at = now() where t.id = v_t.id;
    end if;
    update public.conversations c
    set last_message_at = now(),
        status = case when v_e.kind = 'reply' and c.status = 'waiting_for_you' then 'open' else c.status end
    where c.id = v_conv;
  end if;

  insert into public.messages
    (workspace_id, conversation_id, direction, author, author_user_id, body, delivery_status, metadata)
  values (
    v_e.workspace_id, v_conv, 'out', v_e.written_by,
    case when v_e.written_by = 'user' then v_e.author_user_id end,
    v_e.body, 'sent',
    jsonb_build_object('via', 'email', 'email_id', v_e.id, 'subject', v_e.subject, 'kind', v_e.kind, 'step', v_e.step)
  );
  insert into public.activity_events (workspace_id, lead_id, actor_id, kind, summary, channel, metadata)
  values (
    v_e.workspace_id, v_e.lead_id,
    case when v_e.written_by = 'user' then v_e.author_user_id end,
    'email_sent',
    case v_e.kind
      when 'first' then 'First email sent: ' || v_e.subject
      when 'followup' then 'Follow-up ' || v_e.step || ' sent'
      else 'Reply sent by email' end,
    'email', jsonb_build_object('conversation_id', v_conv, 'email_id', v_e.id)
  );
end;
$$;
revoke all on function private.mail_mark_sent(uuid) from public;

-- What the mail server said about a claimed email. Only a row still
-- 'sending' changes, so a late or repeated call does nothing.
--   'sent'     accepted by the mail server.
--   'retry'    certainly not sent (the server said "try later", or nothing
--              was handed over). Scheduled again for p_retry_at, until
--              p_max_attempts is reached; then it is failed.
--   'failed'   refused for good, with the reason.
--   'unknown'  the connection dropped after the email was handed over.
--              Nobody knows: 'needs_check', never resent on its own.
create function public.mail_send_result(
  p_workspace_id uuid, p_email_id uuid, p_outcome text, p_error text,
  p_retry_at timestamptz, p_max_attempts integer
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_e public.outbound_emails%rowtype;
begin
  select e.* into v_e from public.outbound_emails e
  where e.id = p_email_id and e.workspace_id = p_workspace_id and e.status = 'sending'
  for update;
  if not found then
    return 'ignored';
  end if;
  if p_outcome = 'sent' then
    perform private.mail_mark_sent(v_e.id);
    return 'sent';
  end if;
  if p_outcome = 'retry' and v_e.attempts < greatest(p_max_attempts, 1) then
    update public.outbound_emails e
    set status = 'scheduled', scheduled_at = coalesce(p_retry_at, now() + interval '10 minutes'),
        error = left(p_error, 500)
    where e.id = v_e.id;
    return 'scheduled';
  end if;
  if p_outcome = 'unknown' then
    update public.outbound_emails e
    set status = 'needs_check', error = left(p_error, 500) where e.id = v_e.id;
    return 'needs_check';
  end if;
  update public.outbound_emails e
  set status = 'failed', error = left(coalesce(p_error, 'The mail server did not accept it.'), 500)
  where e.id = v_e.id;
  return 'failed';
end;
$$;

-- A person settles an email that failed or whose fate is unknown.
--   'sent':   (needs_check only) they found it in the mailbox's Sent folder.
--   'resend': queue it again.
--   'cancel': leave it unsent.
create function public.outbound_email_resolve(p_email_id uuid, p_action text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_e public.outbound_emails%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  select e.* into v_e from public.outbound_emails e
  where e.id = p_email_id and e.status in ('failed', 'needs_check')
    and (select private.is_workspace_member(e.workspace_id))
  for update;
  if not found then
    raise exception 'email not found' using errcode = 'P0002';
  end if;
  if p_action = 'sent' and v_e.status = 'needs_check' then
    perform private.mail_mark_sent(v_e.id);
    return 'sent';
  elsif p_action = 'resend' then
    update public.outbound_emails e
    set status = 'queued', scheduled_at = null, attempts = 0, error = null,
        mailbox_id = case when e.kind = 'first' then null else e.mailbox_id end
    where e.id = v_e.id;
    return 'queued';
  elsif p_action = 'cancel' then
    update public.outbound_emails e
    set status = 'cancelled', cancel_reason = 'by_person' where e.id = v_e.id;
    return 'cancelled';
  end if;
  raise exception 'unknown action' using errcode = '22023';
end;
$$;

-- ---------------------------------------------------------------------------
-- Reading the inbox
-- ---------------------------------------------------------------------------

-- Takes up to p_limit active mailboxes that haven't been read for
-- p_interval_seconds, and a lease on each so two readers never overlap.
create function public.mail_poll_claim(p_limit integer, p_interval_seconds integer, p_lease_seconds integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_out jsonb;
begin
  with picked as (
    select m.id from public.mailboxes m
    where m.status = 'active'
      and (m.last_polled_at is null
           or m.last_polled_at < now() - make_interval(secs => greatest(p_interval_seconds, 30)))
      and (m.poll_locked_until is null or m.poll_locked_until < now())
    order by m.last_polled_at nulls first, m.id
    limit greatest(p_limit, 1)
    for update skip locked
  ), marked as (
    update public.mailboxes m
    set poll_locked_until = now() + make_interval(secs => greatest(p_lease_seconds, 30))
    from picked where m.id = picked.id
    returning m.id, m.workspace_id, m.imap_uidvalidity, m.imap_last_uid, m.connected_at
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'mailbox_id', k.id, 'workspace_id', k.workspace_id, 'uidvalidity', k.imap_uidvalidity,
    'last_uid', k.imap_last_uid, 'connected_at', k.connected_at
  )), '[]'::jsonb) into v_out from marked k;
  return v_out;
end;
$$;

-- Ends a read: where it got to, and the lease is released. With p_ok false
-- nothing moves, so the next read starts from the same place.
create function public.mail_poll_done(
  p_workspace_id uuid, p_mailbox_id uuid, p_ok boolean, p_uidvalidity bigint, p_last_uid bigint
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.mailboxes m
  set poll_locked_until = null,
      last_polled_at = now(),
      imap_uidvalidity = case when p_ok then coalesce(p_uidvalidity, m.imap_uidvalidity) else m.imap_uidvalidity end,
      imap_last_uid = case when p_ok then coalesce(p_last_uid, m.imap_last_uid) else m.imap_last_uid end
  where m.id = p_mailbox_id and m.workspace_id = p_workspace_id;
$$;

-- One incoming email. p_message:
--   { "message_id", "from_email", "subject", "kind": reply|bounce|auto_reply,
--     "body", "received_at", "references": ["<id>", ...],
--     "failed_recipients": ["a@b.c"], "asks_to_stop": bool }
-- Matching: first by the ids it refers to (In-Reply-To / References, or the
-- original's id inside a bounce), then by who it is from and its subject;
-- a bounce also by the address that failed. Only this mailbox's own threads
-- are considered. Returns:
--   'unmatched'  not about anything Dialvo sent: nothing is stored.
--   'duplicate'  seen before.
--   'reply'      stored on the lead's conversation; the sequence stops.
--   'bounce'     the address is marked bad; the sequence stops.
--   'auto_reply' stored, and nothing else changes.
--   'stopped'    a reply that plainly asked to stop: handled at once.
create function public.mail_inbound_commit(p_workspace_id uuid, p_mailbox_id uuid, p_message jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text := p_message ->> 'kind';
  v_mid text := left(btrim(coalesce(p_message ->> 'message_id', '')), 300);
  v_from text := lower(btrim(coalesce(p_message ->> 'from_email', '')));
  v_subject text := left(coalesce(p_message ->> 'subject', ''), 300);
  v_body text := left(btrim(coalesce(p_message ->> 'body', '')), 20000);
  v_refs text[] := array(select jsonb_array_elements_text(coalesce(p_message -> 'references', '[]'::jsonb)));
  v_failed text[] := array(select lower(x) from jsonb_array_elements_text(coalesce(p_message -> 'failed_recipients', '[]'::jsonb)) x);
  v_at timestamptz := coalesce((p_message ->> 'received_at')::timestamptz, now());
  v_t public.mail_threads%rowtype;
  v_email uuid;
  v_received uuid;
begin
  if v_mid = '' or v_kind not in ('reply', 'bounce', 'auto_reply') then
    return 'unmatched';
  end if;
  if not exists (select 1 from public.mailboxes m
                 where m.id = p_mailbox_id and m.workspace_id = p_workspace_id) then
    return 'unmatched';
  end if;
  if exists (select 1 from public.mail_received r
             where r.mailbox_id = p_mailbox_id and r.message_id = v_mid) then
    return 'duplicate';
  end if;

  -- By the ids it refers to.
  select e.id, e.thread_id into v_email, v_t.id from public.outbound_emails e
  where e.workspace_id = p_workspace_id and e.mailbox_id = p_mailbox_id
    and e.message_id = any (v_refs) and e.thread_id is not null
  order by e.sent_at desc nulls last
  limit 1;
  if v_t.id is null and v_kind = 'bounce' and cardinality(v_failed) > 0 then
    select t.id into v_t.id from public.mail_threads t
    where t.workspace_id = p_workspace_id and t.mailbox_id = p_mailbox_id
      and t.to_email = any (v_failed) and t.last_sent_at > now() - interval '30 days'
    order by t.last_sent_at desc
    limit 1;
  end if;
  if v_t.id is null and v_kind <> 'bounce' and v_from <> '' then
    select t.id into v_t.id from public.mail_threads t
    where t.workspace_id = p_workspace_id and t.mailbox_id = p_mailbox_id
      and t.to_email = v_from
      and private.mail_norm_subject(t.subject) = private.mail_norm_subject(v_subject)
    order by t.last_sent_at desc nulls last
    limit 1;
  end if;
  if v_t.id is null then
    return 'unmatched';
  end if;
  select t.* into v_t from public.mail_threads t where t.id = v_t.id for update;
  if v_body = '' then
    v_body := '(No text.)';
  end if;

  insert into public.mail_received (
    workspace_id, mailbox_id, thread_id, message_id, from_email, subject, kind, body, received_at,
    classification, classified_at
  ) values (
    p_workspace_id, p_mailbox_id, v_t.id, v_mid, left(v_from, 254), v_subject, v_kind, v_body, v_at,
    null, null
  )
  on conflict (mailbox_id, message_id) do nothing
  returning id into v_received;
  if v_received is null then
    return 'duplicate';
  end if;

  if v_kind = 'bounce' then
    update public.outbound_emails e set bounced_at = now()
    where e.thread_id = v_t.id and e.status = 'sent' and e.bounced_at is null;
    update public.outbound_emails e set status = 'cancelled', cancel_reason = 'bounced'
    where e.thread_id = v_t.id and e.status in ('writing', 'draft', 'queued', 'scheduled');
    update public.mail_threads t
    set status = 'bounced', stop_reason = 'bounced', next_followup_at = null
    where t.id = v_t.id and t.status not in ('unsubscribed');
    -- The address is bad: never write to it again. The lead stays, and can
    -- still be reached another way.
    insert into public.outbound_suppressions (workspace_id, kind, value, note)
    values (p_workspace_id, 'email', v_t.to_email, 'Bounced: the address did not accept email')
    on conflict (workspace_id, kind, value) do nothing;
    update public.leads l
    set custom_fields = l.custom_fields || jsonb_build_object('email_bounced_at', now())
    where l.id = v_t.lead_id and l.workspace_id = p_workspace_id;
    insert into public.activity_events (workspace_id, lead_id, kind, summary, channel, metadata)
    values (p_workspace_id, v_t.lead_id, 'email_bounced',
            'The email to ' || v_t.to_email || ' bounced. The address is on the never-contact list and no follow-up will be sent.',
            'email', jsonb_build_object('conversation_id', v_t.conversation_id));
    return 'bounce';
  end if;

  insert into public.messages
    (workspace_id, conversation_id, direction, author, body, delivery_status, metadata, sent_at)
  values (
    p_workspace_id, v_t.conversation_id, 'in', 'lead', v_body, 'received',
    jsonb_build_object('via', 'email', 'received_id', v_received, 'subject', v_subject,
                       'from', v_from, 'auto_reply', v_kind = 'auto_reply'),
    v_at
  );

  if v_kind = 'auto_reply' then
    -- An out-of-office isn't an answer: the sequence carries on.
    update public.conversations c set last_message_at = now() where c.id = v_t.conversation_id;
    return 'auto_reply';
  end if;

  -- A real reply: the sequence stops, whatever it says.
  update public.outbound_emails e set status = 'cancelled', cancel_reason = 'replied'
  where e.thread_id = v_t.id and e.kind = 'followup' and e.status in ('writing', 'draft', 'queued', 'scheduled');
  update public.mail_threads t
  set status = case when t.status in ('active', 'finished', 'stopped') then 'replied' else t.status end,
      stop_reason = case when t.status in ('active', 'finished', 'stopped') then 'replied' else t.stop_reason end,
      next_followup_at = null, last_reply_at = v_at
  where t.id = v_t.id;
  update public.conversations c
  set status = 'waiting_for_you', last_message_at = now() where c.id = v_t.conversation_id;
  update public.leads l set status = 'engaged'
  where l.id = v_t.lead_id and l.workspace_id = p_workspace_id and l.status = 'new';
  insert into public.activity_events (workspace_id, lead_id, kind, summary, channel, metadata)
  values (p_workspace_id, v_t.lead_id, 'email_reply', 'Replied by email. Follow-ups have stopped.',
          'email', jsonb_build_object('conversation_id', v_t.conversation_id, 'received_id', v_received));

  if (p_message ->> 'asks_to_stop')::boolean is true then
    update public.mail_received r
    set classification = 'unsubscribe', classified_at = now(),
        class_summary = 'Asked not to be contacted again.'
    where r.id = v_received;
    update public.mail_threads t set reply_class = 'unsubscribe' where t.id = v_t.id;
    perform private.mail_stop_contact(
      p_workspace_id, v_t.lead_id, v_t.to_email, 'unsubscribed', 'asked_to_stop', 'unsubscribed',
      'Asked by email not to be contacted again. Added to the never-contact list.');
    if v_from <> v_t.to_email and v_from ~ '^[^\s@]+@[a-z0-9-]+(\.[a-z0-9-]+)+$' then
      insert into public.outbound_suppressions (workspace_id, kind, value, note)
      values (p_workspace_id, 'email', v_from, 'Asked by email not to be contacted again')
      on conflict (workspace_id, kind, value) do nothing;
    end if;
    update public.conversations c set status = 'closed' where c.id = v_t.conversation_id;
    return 'stopped';
  end if;
  return 'reply';
end;
$$;

-- ---------------------------------------------------------------------------
-- The writer: classify replies, draft answers, draft follow-ups
-- ---------------------------------------------------------------------------

-- Hands out the next replies to classify and the next follow-ups to write,
-- at most p_limit together, and counts them against the day's cap on
-- model-written emails (p_max_writes_per_day) and the day's spend.
--   { "capped": bool, "context": { workspace, business_name, instructions,
--       knowledge, booking_url }, "replies": [...], "followups": [...] }
-- A reply is leased for two minutes; a follow-up is reserved as a 'writing'
-- row. Either is handed out again if its writer died, up to p_max_attempts.
create function public.mail_write_claim(
  p_workspace_id uuid, p_limit integer, p_max_writes_per_day integer,
  p_max_cost_micros_per_day bigint, p_max_attempts integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws public.workspaces%rowtype;
  v_set public.workspace_sending%rowtype;
  v_agent public.agents%rowtype;
  v_usage jsonb;
  v_room integer;
  v_replies jsonb := '[]'::jsonb;
  v_followups jsonb := '[]'::jsonb;
  v_id uuid;
  r record;
  t record;
begin
  select w.* into v_ws from public.workspaces w where w.id = p_workspace_id for update;
  if not found then
    return null;
  end if;
  select s.* into v_set from public.workspace_sending s where s.workspace_id = p_workspace_id;
  select a.* into v_agent from public.agents a
  where a.workspace_id = p_workspace_id and a.role = 'outbound'
  order by (a.channel = 'email') desc, a.created_at
  limit 1;
  v_usage := private.outbound_usage_json(p_workspace_id);
  v_room := least(greatest(p_limit, 0), p_max_writes_per_day - coalesce((
    select u.mail_writes from public.outbound_usage u
    where u.workspace_id = p_workspace_id and u.day = (now() at time zone 'utc')::date), 0));
  if (v_usage ->> 'cost_micros')::bigint >= p_max_cost_micros_per_day then
    v_room := 0;
  end if;

  -- Give up on what has been tried too often: a person reads the reply.
  update public.mail_received x
  set classification = 'unclear', classified_at = now(),
      class_summary = 'Dialvo could not read this reply. Please read it yourself.'
  where x.workspace_id = p_workspace_id and x.kind = 'reply' and x.classification is null
    and x.class_attempts >= greatest(p_max_attempts, 1)
    and (x.class_locked_until is null or x.class_locked_until < now());
  update public.outbound_emails e
  set status = 'cancelled', cancel_reason = 'could_not_write'
  where e.workspace_id = p_workspace_id and e.status = 'writing'
    and e.attempts >= greatest(p_max_attempts, 1) and e.updated_at < now() - interval '2 minutes';

  for r in
    select x.*, th.subject as thread_subject, th.conversation_id, th.to_email, th.lead_id as t_lead,
           mb.sender_name
    from public.mail_received x
    join public.mail_threads th on th.id = x.thread_id and th.workspace_id = x.workspace_id
    join public.mailboxes mb on mb.id = th.mailbox_id and mb.workspace_id = th.workspace_id
    where x.workspace_id = p_workspace_id and x.kind = 'reply' and x.classification is null
      and (x.class_locked_until is null or x.class_locked_until < now())
    order by x.received_at, x.id
    limit greatest(v_room, 0)
    for update of x skip locked
  loop
    update public.mail_received x
    set class_locked_until = now() + interval '2 minutes', class_attempts = x.class_attempts + 1
    where x.id = r.id;
    v_replies := v_replies || jsonb_build_object(
      'received_id', r.id, 'subject', r.thread_subject, 'body', r.body, 'sender_name', r.sender_name,
      'lead', (select jsonb_build_object('name', l.name, 'company', coalesce(l.company, ''))
               from public.leads l where l.id = r.t_lead and l.workspace_id = p_workspace_id),
      -- The conversation so far, oldest first, without the reply itself.
      'history', coalesce((
        select jsonb_agg(jsonb_build_object('from', h.who, 'body', h.body) order by h.sent_at)
        from (
          select case when m.direction = 'in' then 'them' else 'us' end as who, m.body, m.sent_at
          from public.messages m
          where m.conversation_id = r.conversation_id and m.workspace_id = p_workspace_id
            and coalesce(m.metadata ->> 'received_id', '') <> r.id::text
          order by m.sent_at desc
          limit 6
        ) h
      ), '[]'::jsonb)
    );
  end loop;
  v_room := v_room - jsonb_array_length(v_replies);

  if coalesce(v_set.sending_on, false) and coalesce(v_set.followups_enabled, false) then
    for t in
      select th.*, w.id as writing_id, m.sender_name
      from public.mail_threads th
      join public.mailboxes m on m.id = th.mailbox_id and m.workspace_id = th.workspace_id and m.status = 'active'
      left join public.outbound_emails w
        on w.thread_id = th.id and w.kind = 'followup' and w.step = th.followups_sent + 1 and w.status <> 'cancelled'
      where th.workspace_id = p_workspace_id and th.status = 'active'
        and th.followups_sent < 2 and th.next_followup_at <= now()
        and (w.id is null or (w.status = 'writing' and w.updated_at < now() - interval '2 minutes'
                              and w.attempts < greatest(p_max_attempts, 1)))
      order by th.next_followup_at, th.id
      limit greatest(v_room, 0)
      for update of th skip locked
    loop
      if t.writing_id is null then
        insert into public.outbound_emails (
          workspace_id, lead_id, thread_id, mailbox_id, kind, step, written_by, to_email, subject, status, attempts
        ) values (
          p_workspace_id, t.lead_id, t.id, t.mailbox_id, 'followup', t.followups_sent + 1, 'agent',
          t.to_email, left('Re: ' || t.subject, 200), 'writing', 1
        )
        returning id into v_id;
      else
        update public.outbound_emails e set attempts = e.attempts + 1 where e.id = t.writing_id
        returning e.id into v_id;
      end if;
      v_followups := v_followups || jsonb_build_object(
        'email_id', v_id, 'step', t.followups_sent + 1, 'subject', t.subject, 'sender_name', t.sender_name,
        'lead', (select jsonb_build_object('name', l.name, 'company', coalesce(l.company, ''))
                 from public.leads l where l.id = t.lead_id and l.workspace_id = p_workspace_id),
        'prospect', (select jsonb_build_object('summary', p.summary, 'facts', p.facts)
                     from public.outbound_emails f
                     join public.prospects p on p.id = f.prospect_id and p.workspace_id = f.workspace_id
                     where f.thread_id = t.id and f.kind = 'first' limit 1),
        'sent', coalesce((
          select jsonb_agg(jsonb_build_object('step', s.step, 'body', s.body) order by s.sent_at)
          from public.outbound_emails s
          where s.thread_id = t.id and s.status = 'sent' and s.kind in ('first', 'followup')
        ), '[]'::jsonb)
      );
    end loop;
  end if;

  insert into public.outbound_usage as u (workspace_id, day, mail_writes)
  values (p_workspace_id, (now() at time zone 'utc')::date,
          jsonb_array_length(v_replies) + jsonb_array_length(v_followups))
  on conflict (workspace_id, day) do update set mail_writes = u.mail_writes + excluded.mail_writes;

  return jsonb_build_object(
    'capped', v_room <= 0 and jsonb_array_length(v_replies) + jsonb_array_length(v_followups) = 0,
    'replies', v_replies,
    'followups', v_followups,
    'context', jsonb_build_object(
      'workspace', jsonb_build_object('name', v_ws.name, 'website', v_ws.website),
      'business_name', coalesce(v_set.business_name, ''),
      'booking_url', v_set.booking_url,
      'instructions', coalesce(v_agent.instructions, ''),
      'knowledge', coalesce((
        select jsonb_agg(
          jsonb_build_object('title', k.title, 'content', k.content, 'source_url', k.source_url)
          order by k.created_at desc)
        from (
          select k.title, k.content, k.source_url, k.created_at
          from public.knowledge_items k
          where k.workspace_id = p_workspace_id and k.status = 'ready'
            and (k.kind = 'text' or k.source_url is not null)
          order by k.created_at desc
          limit 50
        ) k
      ), '[]'::jsonb)
    )
  );
end;
$$;

-- Stores a written follow-up on the row reserved for it. It waits for a
-- person unless the outbound agent is set to send on its own. With p_ok
-- false the row stays 'writing' and is tried again later.
create function public.mail_followup_save(
  p_workspace_id uuid, p_email_id uuid, p_ok boolean, p_body text, p_model text, p_cost_micros bigint
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ok boolean := coalesce(p_ok, false) and char_length(btrim(coalesce(p_body, ''))) between 1 and 5000;
  v_auto boolean;
  v_status text;
begin
  perform private.outbound_usage_add(p_workspace_id, p_cost_micros, 0, 0);
  if not v_ok then
    return 'retry';
  end if;
  select coalesce((
    select a.approval_mode = 'auto' from public.agents a
    where a.workspace_id = p_workspace_id and a.role = 'outbound'
    order by (a.channel = 'email') desc, a.created_at limit 1), false) into v_auto;
  v_status := case when v_auto then 'queued' else 'draft' end;
  update public.outbound_emails e
  set status = v_status, body = btrim(p_body), model = left(p_model, 80)
  where e.id = p_email_id and e.workspace_id = p_workspace_id and e.status = 'writing'
    and exists (select 1 from public.mail_threads t where t.id = e.thread_id and t.status = 'active');
  if not found then
    return 'ignored';
  end if;
  return v_status;
end;
$$;

-- Stores what the model made of one reply, and acts on it. p_result:
--   { "class": interested|question|not_now|not_interested|wrong_person|
--              unsubscribe|unclear, "summary": "...", "reply": "..." , "model" }
--   unsubscribe, not_interested: never-contact list and do not contact, now.
--   not_now, wrong_person, unclear: the sequence has stopped already; the
--     conversation waits for a person.
--   interested, question: the agent's answer is stored as a draft, or
--     queued when replies are set to go on their own. "interested" queues
--     an alert for the team.
-- The answer always goes to the thread's own address. With p_ok false the
-- reply is released to be tried again.
create function public.mail_reply_commit(
  p_workspace_id uuid, p_received_id uuid, p_ok boolean, p_result jsonb, p_cost_micros bigint
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r public.mail_received%rowtype;
  v_t public.mail_threads%rowtype;
  v_set public.workspace_sending%rowtype;
  v_class text := p_result ->> 'class';
  v_summary text := left(btrim(coalesce(p_result ->> 'summary', '')), 600);
  v_reply text := left(btrim(coalesce(p_result ->> 'reply', '')), 5000);
begin
  perform private.outbound_usage_add(p_workspace_id, p_cost_micros, 0, 0);
  select x.* into v_r from public.mail_received x
  where x.id = p_received_id and x.workspace_id = p_workspace_id
    and x.kind = 'reply' and x.classification is null
  for update;
  if not found then
    return 'ignored';
  end if;
  if not coalesce(p_ok, false) or v_class is null or v_class not in
     ('interested', 'question', 'not_now', 'not_interested', 'wrong_person', 'unsubscribe', 'unclear') then
    update public.mail_received x set class_locked_until = null where x.id = v_r.id;
    return 'retry';
  end if;
  select t.* into v_t from public.mail_threads t where t.id = v_r.thread_id for update;
  select s.* into v_set from public.workspace_sending s where s.workspace_id = p_workspace_id;

  update public.mail_received x
  set classification = v_class, class_summary = nullif(v_summary, ''), classified_at = now(),
      class_locked_until = null
  where x.id = v_r.id;
  update public.mail_threads t set reply_class = v_class where t.id = v_t.id;
  update public.conversations c
  set outcome_summary = nullif(v_summary, '') where c.id = v_t.conversation_id;

  if v_class in ('unsubscribe', 'not_interested') then
    perform private.mail_stop_contact(
      p_workspace_id, v_t.lead_id, v_t.to_email, 'unsubscribed',
      case when v_class = 'unsubscribe' then 'asked_to_stop' else 'not_interested' end,
      case when v_class = 'unsubscribe' then 'unsubscribed' else 'lost' end,
      case when v_class = 'unsubscribe'
        then 'Asked by email not to be contacted again. Added to the never-contact list.'
        else 'Replied that they are not interested. Added to the never-contact list.' end);
    if v_r.from_email <> v_t.to_email and v_r.from_email ~ '^[^\s@]+@[a-z0-9-]+(\.[a-z0-9-]+)+$' then
      insert into public.outbound_suppressions (workspace_id, kind, value, note)
      values (p_workspace_id, 'email', v_r.from_email, 'Asked by email not to be contacted again')
      on conflict (workspace_id, kind, value) do nothing;
    end if;
    update public.conversations c set status = 'closed' where c.id = v_t.conversation_id;
    return v_class;
  end if;

  if v_class in ('interested', 'question') and v_reply <> ''
     and v_t.status not in ('bounced', 'unsubscribed')
     and not private.outbound_is_suppressed(p_workspace_id, v_t.to_email, null)
     and not exists (select 1 from public.leads l where l.id = v_t.lead_id and l.do_not_contact)
     -- A person may have answered already.
     and not exists (select 1 from public.outbound_emails e
                     where e.thread_id = v_t.id and e.kind = 'reply'
                       and e.created_at > v_r.created_at and e.status <> 'cancelled') then
    insert into public.outbound_emails (
      workspace_id, lead_id, thread_id, mailbox_id, kind, written_by, to_email, subject, body,
      status, answers_received_id, model
    ) values (
      p_workspace_id, v_t.lead_id, v_t.id, v_t.mailbox_id, 'reply', 'agent', v_t.to_email,
      left('Re: ' || v_t.subject, 200), v_reply,
      case when coalesce(v_set.reply_mode, 'approve_first') = 'auto' then 'queued' else 'draft' end,
      v_r.id, left(p_result ->> 'model', 80)
    );
  end if;
  if v_class = 'interested' then
    insert into public.team_alerts (workspace_id, conversation_id, kind, summary)
    values (p_workspace_id, v_t.conversation_id, 'reply_interested',
            left(coalesce(nullif(v_summary, ''), 'A lead replied to your email and sounds interested.'), 1000));
  end if;
  return v_class;
end;
$$;

-- Hands the server the email alerts waiting for one workspace (an
-- interested reply, a paused mailbox), with who to email. Like
-- claim_team_alerts: each alert is handed out once, at most 20 an hour per
-- workspace, and nothing older than 15 minutes.
create function public.mail_claim_team_alerts(p_workspace_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws public.workspaces%rowtype;
  v_recipients text[];
  v_sent integer;
  v_alert record;
  v_alerts jsonb := '[]'::jsonb;
begin
  select * into v_ws from public.workspaces w where w.id = p_workspace_id;
  if not found then
    return null;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('team_alerts:' || v_ws.id::text, 0));
  select array_agg(p.email order by p.email) into v_recipients
  from public.workspace_members m
  join public.profiles p on p.id = m.user_id
  where m.workspace_id = v_ws.id and p.alert_emails and p.email <> '';
  select count(*) into v_sent from public.team_alerts t
  where t.workspace_id = v_ws.id and t.status in ('sending', 'sent')
    and t.created_at > now() - interval '1 hour';
  for v_alert in
    select t.id, t.kind, t.summary, t.conversation_id,
           (select l.name from public.conversations c
            join public.leads l on l.id = c.lead_id and l.workspace_id = c.workspace_id
            where c.id = t.conversation_id) as lead
    from public.team_alerts t
    where t.workspace_id = v_ws.id and t.kind in ('reply_interested', 'mailbox_paused')
      and t.status = 'pending' and t.created_at > now() - interval '15 minutes'
    order by t.created_at
    for update
  loop
    if v_recipients is null or v_sent >= 20 then
      update public.team_alerts t set status = 'skipped' where t.id = v_alert.id;
    else
      update public.team_alerts t set status = 'sending' where t.id = v_alert.id;
      v_sent := v_sent + 1;
      v_alerts := v_alerts || jsonb_build_object(
        'id', v_alert.id, 'kind', v_alert.kind, 'summary', v_alert.summary,
        'conversation_id', v_alert.conversation_id, 'lead', coalesce(v_alert.lead, ''));
    end if;
  end loop;
  return jsonb_build_object(
    'workspace', v_ws.name,
    'recipients', to_jsonb(coalesce(v_recipients, array[]::text[])),
    'alerts', v_alerts
  );
end;
$$;

-- Workspaces with a team alert of ours waiting.
create function public.mail_alert_work_list()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct t.workspace_id), '{}'::uuid[])
  from public.team_alerts t
  where t.status = 'pending' and t.kind in ('reply_interested', 'mailbox_paused')
    and t.created_at > now() - interval '15 minutes';
$$;

-- Workspaces with a reply to classify (whether or not sending is on: a
-- reply is read even after sending was switched off).
create function public.mail_write_work_list()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct x.workspace_id), '{}'::uuid[]) from (
    select r.workspace_id from public.mail_received r
    where r.kind = 'reply' and r.classification is null
    union all
    select t.workspace_id from public.mail_threads t
    join public.workspace_sending s on s.workspace_id = t.workspace_id and s.sending_on and s.followups_enabled
    where t.status = 'active' and t.followups_sent < 2 and t.next_followup_at <= now()
  ) x;
$$;

-- ---------------------------------------------------------------------------
-- Unsubscribe: the link in every email. No login; the signed token is the
-- proof. With p_confirm false it only says whether the link is good (the
-- page a person sees first); with true it stops all contact.
--   { "status": "invalid" } | { "status": "ok" | "done", "business": "..." }
-- ---------------------------------------------------------------------------
create function public.mail_unsubscribe(p_token text, p_confirm boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_e public.outbound_emails%rowtype;
  v_business text;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[0-9a-f]{64}$' then
    return jsonb_build_object('status', 'invalid');
  end if;
  v_id := split_part(p_token, '.', 1)::uuid;
  if private.mail_unsub_token(v_id) is distinct from p_token then
    return jsonb_build_object('status', 'invalid');
  end if;
  select e.* into v_e from public.outbound_emails e where e.id = v_id;
  if not found then
    return jsonb_build_object('status', 'invalid');
  end if;
  select coalesce(nullif(s.business_name, ''), w.name) into v_business
  from public.workspaces w
  left join public.workspace_sending s on s.workspace_id = w.id
  where w.id = v_e.workspace_id;
  if not coalesce(p_confirm, false) then
    return jsonb_build_object('status', 'ok', 'business', v_business);
  end if;
  if not private.outbound_is_suppressed(v_e.workspace_id, v_e.to_email, null) then
    perform private.mail_stop_contact(
      v_e.workspace_id, v_e.lead_id, v_e.to_email, 'unsubscribed', 'unsubscribe_link', 'unsubscribed',
      'Unsubscribed with the link in an email. Added to the never-contact list.');
  end if;
  return jsonb_build_object('status', 'done', 'business', v_business);
end;
$$;

-- ---------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------
revoke all on function public.mailbox_connect(uuid, text, text, text, text, text, integer, text, text, integer, text, integer) from public, anon;
revoke all on function public.mailbox_update(uuid, text, integer) from public, anon;
revoke all on function public.mailbox_resume(uuid) from public, anon;
revoke all on function public.mailbox_disconnect(uuid) from public, anon;
revoke all on function public.sending_settings_save(uuid, jsonb) from public, anon;
revoke all on function public.outbound_email_decide(uuid, text, text, text) from public, anon;
revoke all on function public.mail_reply_queue(uuid, text) from public, anon;
revoke all on function public.outbound_email_resolve(uuid, text) from public, anon;
grant execute on function public.mailbox_connect(uuid, text, text, text, text, text, integer, text, text, integer, text, integer) to authenticated;
grant execute on function public.mailbox_update(uuid, text, integer) to authenticated;
grant execute on function public.mailbox_resume(uuid) to authenticated;
grant execute on function public.mailbox_disconnect(uuid) to authenticated;
grant execute on function public.sending_settings_save(uuid, jsonb) to authenticated;
grant execute on function public.outbound_email_decide(uuid, text, text, text) to authenticated;
grant execute on function public.mail_reply_queue(uuid, text) to authenticated;
grant execute on function public.outbound_email_resolve(uuid, text) to authenticated;

revoke all on function public.mail_mailbox_secret(uuid, uuid) from public, anon, authenticated;
revoke all on function public.mail_mailbox_result(uuid, uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public.mail_work_list() from public, anon, authenticated;
revoke all on function public.mail_write_work_list() from public, anon, authenticated;
revoke all on function public.mail_alert_work_list() from public, anon, authenticated;
revoke all on function public.mail_schedule_context(uuid, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.mail_schedule_commit(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.mail_send_claim(uuid, integer, integer, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.mail_send_result(uuid, uuid, text, text, timestamptz, integer) from public, anon, authenticated;
revoke all on function public.mail_poll_claim(integer, integer, integer) from public, anon, authenticated;
revoke all on function public.mail_poll_done(uuid, uuid, boolean, bigint, bigint) from public, anon, authenticated;
revoke all on function public.mail_inbound_commit(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.mail_write_claim(uuid, integer, integer, bigint, integer) from public, anon, authenticated;
revoke all on function public.mail_followup_save(uuid, uuid, boolean, text, text, bigint) from public, anon, authenticated;
revoke all on function public.mail_reply_commit(uuid, uuid, boolean, jsonb, bigint) from public, anon, authenticated;
revoke all on function public.mail_claim_team_alerts(uuid) from public, anon, authenticated;
grant execute on function public.mail_mailbox_secret(uuid, uuid) to service_role;
grant execute on function public.mail_mailbox_result(uuid, uuid, text, text, integer) to service_role;
grant execute on function public.mail_work_list() to service_role;
grant execute on function public.mail_write_work_list() to service_role;
grant execute on function public.mail_alert_work_list() to service_role;
grant execute on function public.mail_schedule_context(uuid, integer, integer, integer) to service_role;
grant execute on function public.mail_schedule_commit(uuid, jsonb) to service_role;
grant execute on function public.mail_send_claim(uuid, integer, integer, integer, integer, integer) to service_role;
grant execute on function public.mail_send_result(uuid, uuid, text, text, timestamptz, integer) to service_role;
grant execute on function public.mail_poll_claim(integer, integer, integer) to service_role;
grant execute on function public.mail_poll_done(uuid, uuid, boolean, bigint, bigint) to service_role;
grant execute on function public.mail_inbound_commit(uuid, uuid, jsonb) to service_role;
grant execute on function public.mail_write_claim(uuid, integer, integer, bigint, integer) to service_role;
grant execute on function public.mail_followup_save(uuid, uuid, boolean, text, text, bigint) to service_role;
grant execute on function public.mail_reply_commit(uuid, uuid, boolean, jsonb, bigint) to service_role;
grant execute on function public.mail_claim_team_alerts(uuid) to service_role;

-- The unsubscribe link works for anyone who holds it.
revoke all on function public.mail_unsubscribe(text, boolean) from public;
grant execute on function public.mail_unsubscribe(text, boolean) to anon, authenticated, service_role;
