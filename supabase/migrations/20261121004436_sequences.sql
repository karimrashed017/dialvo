-- Sequences: custom steps per sequence, up to five follow-ups, and the
-- language each sequence writes in. Additive. Builds on the mail migrations
-- (20261120164719 and after) and the plays migration.
--
--   sequences                one per sequence a workspace builds: its name,
--                            its language ('auto' or a fixed language), its
--                            approval mode, and its follow-up steps (each with
--                            its own wait and its own instructions for the
--                            writer). At most one is the workspace's default.
--                            Members read; owners and admins save
--                            (sequence_save, sequence_archive).
--   prospect_searches        + sequence_id: the sequence a Find leads search's
--                            first emails start.
--   outbound_campaigns       + sequence_id, language: the same for a play run.
--   outbound_drafts          + sequence_id, language, guidance: copied from the
--                            campaign or search when the draft is made, so the
--                            writer and the thread know them.
--   mail_threads             + sequence_id, language, play: copied from the
--                            first email's draft when the thread starts.
--   followups_sent / step    now up to 5.
--
-- The engine's rules do not change for any step: a reply, a bounce or an
-- unsubscribe ends the thread (and with it every later step), a follow-up is
-- only ever claimed for sending while its thread is active, and every email
-- still goes through mail_send_claim's suppression, do-not-contact and CRM
-- checks. A thread without a sequence (every thread before this migration)
-- keeps the workspace's old settings: up to two follow-ups, days after the
-- first email.

-- ---------------------------------------------------------------------------
-- sequences
-- ---------------------------------------------------------------------------

-- A sequence's steps: [{ "wait_days": 1..60, "angle": "..." }], at most five.
-- wait_days counts from the email before it. Internal; used in a check.
create function private.sequence_steps_ok(p_steps jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_steps) = 'array'
    and jsonb_array_length(p_steps) <= 5
    and not exists (
      select 1 from jsonb_array_elements(p_steps) s
      where jsonb_typeof(s) <> 'object'
        or jsonb_typeof(s -> 'wait_days') <> 'number'
        or (s ->> 'wait_days')::numeric not between 1 and 60
        or (s ->> 'wait_days')::numeric <> floor((s ->> 'wait_days')::numeric)
        or (s ? 'angle' and (jsonb_typeof(s -> 'angle') <> 'string' or char_length(s ->> 'angle') > 600))
    );
$$;
revoke all on function private.sequence_steps_ok(jsonb) from public;

create table public.sequences (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  -- 'auto': first emails in the language of the company's own website (or
  -- of what the lead wrote), follow-ups in the language of the emails before
  -- them. Otherwise a two-letter language code: every email in it.
  language text not null default 'auto' check (language ~ '^(auto|[a-z]{2})$'),
  -- Its follow-ups wait for a person, or are sent on their own.
  approval_mode text not null default 'approve_first' check (approval_mode in ('approve_first', 'auto')),
  steps jsonb not null default '[]'::jsonb check (private.sequence_steps_ok(steps)),
  -- Used for every first email that names no other sequence.
  is_default boolean not null default false,
  -- A ready-made sequence a play keeps for itself ('onboarding', 'nurture'),
  -- made the first time that play is started. Null for the team's own.
  purpose text check (purpose is null or purpose in ('onboarding', 'nurture')),
  -- Archived: offered for nothing new. Threads already on it run to the end.
  archived_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id)
);
alter table public.sequences enable row level security;
create index sequences_workspace_idx on public.sequences (workspace_id, created_at);
create unique index sequences_one_default_idx on public.sequences (workspace_id) where is_default and archived_at is null;
create unique index sequences_one_purpose_idx on public.sequences (workspace_id, purpose) where purpose is not null;
create index sequences_created_by_idx on public.sequences (created_by);
create index sequences_updated_by_idx on public.sequences (updated_by);
create trigger sequences_set_updated_at
  before update on public.sequences
  for each row execute function private.set_updated_at();

revoke all on public.sequences from anon, authenticated;
grant all on public.sequences to service_role;
grant select on public.sequences to authenticated;
create policy "Members read sequences" on public.sequences for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));

-- Saves a sequence, for an owner or admin, signed in. p_id null makes a new
-- one. Returns its id. Making one the default takes that from any other.
create function public.sequence_save(
  p_workspace_id uuid, p_id uuid, p_name text, p_language text, p_approval text,
  p_steps jsonb, p_default boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_id uuid;
  v_count integer;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if not (select private.is_workspace_admin(p_workspace_id)) then
    raise exception 'only an owner or admin can change this' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 80
     or coalesce(p_language, '') !~ '^(auto|[a-z]{2})$'
     or coalesce(p_approval, '') not in ('approve_first', 'auto')
     or not private.sequence_steps_ok(coalesce(p_steps, 'null'::jsonb)) then
    raise exception 'those settings are out of range' using errcode = '22023';
  end if;
  -- One save at a time per workspace, so two defaults can't race.
  perform 1 from public.workspaces w where w.id = p_workspace_id for update;
  if p_id is null then
    select count(*) into v_count from public.sequences s
    where s.workspace_id = p_workspace_id and s.archived_at is null;
    if v_count >= 25 then
      raise exception 'too many sequences' using errcode = 'P0001';
    end if;
  end if;
  if coalesce(p_default, false) then
    update public.sequences s set is_default = false, updated_by = v_user
    where s.workspace_id = p_workspace_id and s.is_default and s.id is distinct from p_id;
  end if;
  if p_id is null then
    insert into public.sequences (workspace_id, name, language, approval_mode, steps, is_default, created_by, updated_by)
    values (p_workspace_id, btrim(p_name), p_language, p_approval, p_steps, coalesce(p_default, false), v_user, v_user)
    returning id into v_id;
  else
    update public.sequences s
    set name = btrim(p_name), language = p_language, approval_mode = p_approval, steps = p_steps,
        is_default = coalesce(p_default, false), updated_by = v_user
    where s.id = p_id and s.workspace_id = p_workspace_id and s.archived_at is null
    returning s.id into v_id;
    if v_id is null then
      raise exception 'sequence not found' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end;
$$;
revoke all on function public.sequence_save(uuid, uuid, text, text, text, jsonb, boolean) from public, anon;
grant execute on function public.sequence_save(uuid, uuid, text, text, text, jsonb, boolean) to authenticated;

-- Archives a sequence, for an owner or admin. Threads already on it finish
-- their steps; searches and plays that named it fall back to the default.
create function public.sequence_archive(p_workspace_id uuid, p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if not (select private.is_workspace_admin(p_workspace_id)) then
    raise exception 'only an owner or admin can change this' using errcode = '42501';
  end if;
  update public.sequences s
  set archived_at = now(), is_default = false, updated_by = (select auth.uid())
  where s.id = p_id and s.workspace_id = p_workspace_id and s.archived_at is null;
  if not found then
    raise exception 'sequence not found' using errcode = 'P0002';
  end if;
  update public.prospect_searches ps set sequence_id = null
  where ps.workspace_id = p_workspace_id and ps.sequence_id = p_id;
end;
$$;
revoke all on function public.sequence_archive(uuid, uuid) from public, anon;
grant execute on function public.sequence_archive(uuid, uuid) to authenticated;

-- A play's ready-made sequence ('onboarding', 'nurture'), made the first
-- time it is needed. Server only: the play's start calls it. Returns its id.
create function public.sequence_for_purpose(p_workspace_id uuid, p_purpose text, p_name text, p_steps jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_purpose not in ('onboarding', 'nurture') or not private.sequence_steps_ok(p_steps) then
    raise exception 'unknown sequence' using errcode = '22023';
  end if;
  select s.id into v_id from public.sequences s
  where s.workspace_id = p_workspace_id and s.purpose = p_purpose;
  if v_id is null then
    insert into public.sequences (workspace_id, name, steps, purpose)
    values (p_workspace_id, left(btrim(p_name), 80), p_steps, p_purpose)
    on conflict (workspace_id, purpose) where purpose is not null do nothing
    returning id into v_id;
    if v_id is null then
      select s.id into v_id from public.sequences s
      where s.workspace_id = p_workspace_id and s.purpose = p_purpose;
    end if;
  end if;
  -- Archived by the team: brought back, since the play is being used again.
  update public.sequences s set archived_at = null
  where s.id = v_id and s.archived_at is not null;
  return v_id;
end;
$$;
revoke all on function public.sequence_for_purpose(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.sequence_for_purpose(uuid, text, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Where a sequence is chosen, and where it is remembered
-- ---------------------------------------------------------------------------
alter table public.prospect_searches
  add column sequence_id uuid,
  add foreign key (sequence_id, workspace_id)
    references public.sequences (id, workspace_id) on delete set null (sequence_id);
create index prospect_searches_sequence_idx on public.prospect_searches (sequence_id, workspace_id) where sequence_id is not null;
-- Members choose a search's sequence themselves (the foreign key keeps it
-- inside the workspace).
grant update (sequence_id) on public.prospect_searches to authenticated;

alter table public.outbound_campaigns
  add column sequence_id uuid,
  add column language text check (language is null or language ~ '^(auto|[a-z]{2})$'),
  add foreign key (sequence_id, workspace_id)
    references public.sequences (id, workspace_id) on delete set null (sequence_id);
create index outbound_campaigns_sequence_idx on public.outbound_campaigns (sequence_id, workspace_id) where sequence_id is not null;

alter table public.outbound_drafts
  add column sequence_id uuid,
  add column language text not null default 'auto' check (language ~ '^(auto|[a-z]{2})$'),
  -- What a playbook asked its first email to do, in the team's words.
  add column guidance text not null default '' check (char_length(guidance) <= 1500),
  add foreign key (sequence_id, workspace_id)
    references public.sequences (id, workspace_id) on delete set null (sequence_id);
create index outbound_drafts_sequence_idx on public.outbound_drafts (sequence_id, workspace_id) where sequence_id is not null;

alter table public.mail_threads
  add column sequence_id uuid,
  add column language text not null default 'auto' check (language ~ '^(auto|[a-z]{2})$'),
  add column play text check (play is null or char_length(play) <= 40),
  add foreign key (sequence_id, workspace_id)
    references public.sequences (id, workspace_id) on delete set null (sequence_id);
create index mail_threads_sequence_idx on public.mail_threads (sequence_id, workspace_id) where sequence_id is not null;

-- Up to five follow-ups.
alter table public.mail_threads drop constraint mail_threads_followups_sent_check;
alter table public.mail_threads add constraint mail_threads_followups_sent_check
  check (followups_sent between 0 and 5);
alter table public.outbound_emails drop constraint outbound_emails_step_check;
alter table public.outbound_emails add constraint outbound_emails_step_check
  check (step between 0 and 5);

-- A new draft takes its campaign's (or search's) sequence, language and
-- guidance. A campaign's own language wins over its sequence's.
create function private.outbound_draft_sequence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign uuid := new.campaign_id;
  v_search uuid;
  v_c public.outbound_campaigns%rowtype;
  v_seq uuid;
  v_lang text;
begin
  if new.prospect_id is not null then
    select coalesce(v_campaign, p.campaign_id), p.search_id into v_campaign, v_search
    from public.prospects p
    where p.id = new.prospect_id and p.workspace_id = new.workspace_id;
  end if;
  if v_campaign is not null then
    select c.* into v_c from public.outbound_campaigns c
    where c.id = v_campaign and c.workspace_id = new.workspace_id;
  end if;
  v_seq := coalesce(new.sequence_id, v_c.sequence_id,
    (select s.sequence_id from public.prospect_searches s
     where s.id = v_search and s.workspace_id = new.workspace_id));
  if v_seq is not null and not exists (
    select 1 from public.sequences q
    where q.id = v_seq and q.workspace_id = new.workspace_id and q.archived_at is null) then
    v_seq := null;
  end if;
  v_lang := coalesce(
    nullif(v_c.language, 'auto'),
    (select q.language from public.sequences q where q.id = v_seq and q.workspace_id = new.workspace_id),
    'auto');
  new.sequence_id := v_seq;
  if new.language = 'auto' then
    new.language := v_lang;
  end if;
  if new.guidance = '' then
    new.guidance := left(coalesce(v_c.settings ->> 'guidance', ''), 1500);
  end if;
  return new;
end;
$$;
revoke all on function private.outbound_draft_sequence() from public;
-- After outbound_drafts_play (triggers of a kind run in name order).
create trigger outbound_drafts_sequence
  before insert on public.outbound_drafts
  for each row execute function private.outbound_draft_sequence();

-- ---------------------------------------------------------------------------
-- When the next follow-up is due
-- ---------------------------------------------------------------------------

-- How many follow-ups a thread gets: its sequence's steps, or (no sequence)
-- the workspace's old setting. Internal.
create function private.sequence_total(p_workspace_id uuid, p_sequence_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_sequence_id is not null then coalesce((
      select jsonb_array_length(q.steps) from public.sequences q
      where q.id = p_sequence_id and q.workspace_id = p_workspace_id), 0)
    else coalesce((
      select case when s.followups_enabled then least(greatest(s.followup_count, 0), 2) else 0 end
      from public.workspace_sending s where s.workspace_id = p_workspace_id), 2)
  end;
$$;
revoke all on function private.sequence_total(uuid, uuid) from public;

-- When the next follow-up is due once p_sent follow-ups have gone (0: only
-- the first email). Null when there are no more. A sequence's wait counts
-- from now (the email just sent); the old settings count from the first
-- email, as they always did. Internal.
create function private.sequence_next_at(
  p_workspace_id uuid, p_sequence_id uuid, p_sent integer, p_first_sent timestamptz
)
returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_steps jsonb;
  v_set public.workspace_sending%rowtype;
begin
  if p_sequence_id is not null then
    select q.steps into v_steps from public.sequences q
    where q.id = p_sequence_id and q.workspace_id = p_workspace_id;
    if v_steps is null or p_sent >= jsonb_array_length(v_steps) then
      return null;
    end if;
    return now() + make_interval(days => (v_steps -> p_sent ->> 'wait_days')::integer);
  end if;
  select s.* into v_set from public.workspace_sending s where s.workspace_id = p_workspace_id;
  if not coalesce(v_set.followups_enabled, true)
     or p_sent >= least(coalesce(v_set.followup_count, 2), 2) then
    return null;
  end if;
  if p_sent = 0 then
    return now() + make_interval(days => coalesce(v_set.followup_1_days, 3));
  end if;
  return greatest(p_first_sent + make_interval(days => coalesce(v_set.followup_2_days, 7)),
                  now() + interval '1 day');
end;
$$;
revoke all on function private.sequence_next_at(uuid, uuid, integer, timestamptz) from public;

-- A thread starts when a first email is sent (private.mail_mark_sent). It
-- takes the sequence, language and play of that email's draft. A draft with
-- no sequence uses the workspace's default sequence, unless it came from a
-- single-touch play (mail_threads_play_rules has already finished those).
-- Runs after mail_threads_play_rules.
create function private.mail_thread_sequence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_d public.outbound_drafts%rowtype;
  v_seq uuid;
  v_next timestamptz;
begin
  select d.* into v_d
  from public.outbound_emails e
  join public.outbound_drafts d on d.id = e.draft_id and d.workspace_id = e.workspace_id
  where e.workspace_id = new.workspace_id and e.lead_id = new.lead_id and e.to_email = new.to_email
    and e.kind = 'first' and e.status = 'sent' and e.thread_id is null
  order by e.sent_at desc nulls last
  limit 1;
  new.play := v_d.play;
  new.language := coalesce(v_d.language, 'auto');
  v_seq := v_d.sequence_id;
  if v_seq is null and coalesce(new.stop_reason, '') <> 'single_touch_play' then
    select q.id into v_seq from public.sequences q
    where q.workspace_id = new.workspace_id and q.is_default and q.archived_at is null;
    if v_seq is not null and new.language = 'auto' then
      new.language := (select q.language from public.sequences q where q.id = v_seq);
    end if;
  end if;
  if v_seq is null then
    return new;
  end if;
  new.sequence_id := v_seq;
  v_next := private.sequence_next_at(new.workspace_id, v_seq, 0, now());
  if v_next is null then
    new.status := 'finished';
    new.stop_reason := 'no_followups';
    new.next_followup_at := null;
  else
    -- A single-touch play with a sequence of its own runs that sequence.
    new.status := 'active';
    new.stop_reason := null;
    new.next_followup_at := v_next;
  end if;
  return new;
end;
$$;
revoke all on function private.mail_thread_sequence() from public;
create trigger mail_threads_sequence
  before insert on public.mail_threads
  for each row execute function private.mail_thread_sequence();

-- The old "stop after one follow-up" rule only applies to threads without a
-- sequence; a sequence's own steps decide.
create or replace function private.mail_thread_followup_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.sequence_id is null and new.status = 'active' and new.followups_sent > old.followups_sent
     and new.followups_sent >= coalesce((
       select s.followup_count from public.workspace_sending s where s.workspace_id = new.workspace_id), 2) then
    new.status := 'finished';
    new.next_followup_at := null;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- The engine, step by step
-- ---------------------------------------------------------------------------

-- As in 20261120165129, with each follow-up's next date from the thread's
-- sequence (or the old settings), and the thread finished after its last.
create or replace function private.mail_mark_sent(p_email_id uuid)
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
  v_total integer;
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
    -- The thread's own triggers then apply a sequence and the play's rules.
    insert into public.mail_threads (
      workspace_id, lead_id, conversation_id, mailbox_id, to_email, subject,
      next_followup_at, first_sent_at, last_sent_at
    ) values (
      v_e.workspace_id, v_e.lead_id, v_conv, v_e.mailbox_id, v_e.to_email, v_e.subject,
      private.sequence_next_at(v_e.workspace_id, null, 0, now()),
      now(), now()
    )
    returning id into v_thread;
    update public.outbound_emails e set thread_id = v_thread where e.id = v_e.id;
  else
    select t.* into v_t from public.mail_threads t where t.id = v_e.thread_id for update;
    v_conv := v_t.conversation_id;
    if v_e.kind = 'followup' then
      v_total := private.sequence_total(v_t.workspace_id, v_t.sequence_id);
      update public.mail_threads t
      set followups_sent = greatest(t.followups_sent, v_e.step),
          last_sent_at = now(),
          status = case when t.status = 'active' and v_e.step >= v_total then 'finished' else t.status end,
          next_followup_at = case
            when t.status = 'active' and v_e.step < v_total
            then private.sequence_next_at(t.workspace_id, t.sequence_id, v_e.step, t.first_sent_at)
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

-- As in 20261120171651, with: a thread's follow-ups counted against its own
-- sequence (up to five), threads on a sequence written even when the
-- workspace's old follow-up switch is off, and each follow-up handed to the
-- writer with its step's instructions, the total, the language and the play.
create or replace function public.mail_write_claim(
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

  if coalesce(v_set.sending_on, false) then
    for t in
      select th.*, w.id as writing_id, m.sender_name,
             private.sequence_total(th.workspace_id, th.sequence_id) as total
      from public.mail_threads th
      join public.mailboxes m on m.id = th.mailbox_id and m.workspace_id = th.workspace_id and m.status = 'active'
      left join public.outbound_emails w
        on w.thread_id = th.id and w.kind = 'followup' and w.step = th.followups_sent + 1 and w.status <> 'cancelled'
      where th.workspace_id = p_workspace_id and th.status = 'active'
        and (th.sequence_id is not null or coalesce(v_set.followups_enabled, false))
        and th.followups_sent < private.sequence_total(th.workspace_id, th.sequence_id)
        and th.next_followup_at <= now()
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
        'email_id', v_id, 'step', t.followups_sent + 1, 'total', t.total,
        'subject', t.subject, 'sender_name', t.sender_name,
        'language', t.language, 'play', t.play,
        'angle', coalesce((
          select left(q.steps -> t.followups_sent ->> 'angle', 600) from public.sequences q
          where q.id = t.sequence_id and q.workspace_id = p_workspace_id), ''),
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

-- As in 20261120171651, with the approval mode of the thread's sequence when
-- it has one (else the outbound agent's, as before).
create or replace function public.mail_followup_save(
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
  v_seq_mode text;
begin
  perform private.outbound_usage_add(p_workspace_id, p_cost_micros, 0, 0);
  if not v_ok then
    return 'retry';
  end if;
  select q.approval_mode into v_seq_mode
  from public.outbound_emails e
  join public.mail_threads t on t.id = e.thread_id and t.workspace_id = e.workspace_id
  join public.sequences q on q.id = t.sequence_id and q.workspace_id = t.workspace_id
  where e.id = p_email_id and e.workspace_id = p_workspace_id;
  if v_seq_mode is not null then
    v_auto := v_seq_mode = 'auto';
  else
    select coalesce((
      select a.approval_mode = 'auto' from public.agents a
      where a.workspace_id = p_workspace_id and a.role = 'outbound'
      order by (a.channel = 'email') desc, a.created_at limit 1), false) into v_auto;
  end if;
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

-- As in 20261120171651, counting follow-ups against each thread's sequence.
create or replace function public.mail_write_work_list()
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
    join public.workspace_sending s on s.workspace_id = t.workspace_id and s.sending_on
    where t.status = 'active' and t.next_followup_at <= now()
      and (t.sequence_id is not null or s.followups_enabled)
      and t.followups_sent < private.sequence_total(t.workspace_id, t.sequence_id)
  ) x;
$$;
