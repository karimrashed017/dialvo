-- Channels, part 2 of 2: LinkedIn, SMS and call-task steps in sequences,
-- and the scheduler that runs them (src/lib/channels).
--
-- A sequence is still what the email engine makes: a first email and its
-- follow-ups in one mail_threads row. This adds steps on other channels to
-- every sequence, in tables and functions of their own, so the email
-- engine's tables and functions are not changed:
--
--   sequence_channel_steps  the workspace's extra steps: channel, how many
--                           days after the first email, the message.
--                           applies_to 'sequences' (every sequence with
--                           follow-ups) or 'nurture' (lead nurture's email).
--   sequence_channel_runs   one per step per sequence: scheduled, due (a task
--                           waiting for a person), sending, done, skipped
--                           or stopped, with the reason.
--
-- The channels:
--   sms        sent by Dialvo through Twilio, only to leads with recorded
--              texting consent, inside the call window, under the daily cap
--              (private.sms_prepare in part 1 checks it all).
--   linkedin   never sent by Dialvo. LinkedIn's User Agreement does not
--              allow automated messages or connection requests, so a due
--              step is a task: the drafted message and the profile link,
--              for a person to send from their own profile and mark done.
--              At most 20 a day per workspace are handed out.
--   call_task  a task for a person to call the lead, with talking points.
--
-- STOP ON REPLY, ACROSS CHANNELS: a step that hasn't run is stopped when its
-- sequence ended (reply, bounce, unsubscribe, stopped), when the lead is
-- marked do not contact or unsubscribed, or when the lead wrote to the
-- workspace on any channel since the first email. A reply on SMS, a call,
-- or a LinkedIn reply a person reports also ends the email sequence, so no
-- more follow-ups go out.

create table public.sequence_channel_steps (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  applies_to text not null default 'sequences' check (applies_to in ('sequences', 'nurture')),
  channel text not null check (channel in ('linkedin', 'sms', 'call_task')),
  -- Days after the first email.
  day_offset integer not null check (day_offset between 0 and 60),
  -- The message, with {first_name} and {company} filled in per lead.
  message text not null default '' check (char_length(message) <= 1000),
  -- For a call task: what to talk about.
  note text not null default '' check (char_length(note) <= 500),
  active boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  check (channel <> 'sms' or char_length(btrim(message)) between 1 and 300),
  check (channel <> 'linkedin' or char_length(btrim(message)) between 1 and 1000)
);
alter table public.sequence_channel_steps enable row level security;
create index sequence_channel_steps_workspace_idx on public.sequence_channel_steps (workspace_id, active);
create index sequence_channel_steps_created_by_idx on public.sequence_channel_steps (created_by);
create trigger sequence_channel_steps_set_updated_at
  before update on public.sequence_channel_steps
  for each row execute function private.set_updated_at();

create table public.sequence_channel_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  step_id uuid not null,
  thread_id uuid not null,
  lead_id uuid not null,
  channel text not null check (channel in ('linkedin', 'sms', 'call_task')),
  due_at timestamptz not null,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'due', 'sending', 'done', 'skipped', 'stopped', 'failed')),
  -- The message as it is for this lead, once due.
  body text check (body is null or char_length(body) <= 1600),
  -- Where a person finds the lead on LinkedIn: their profile when known,
  -- otherwise a people search for their name and company.
  profile_url text check (profile_url is null or (profile_url ~ '^https://([a-z]+\.)?linkedin\.com/' and char_length(profile_url) <= 500)),
  skip_reason text check (skip_reason is null or char_length(skip_reason) <= 80),
  -- sent, replied, called, done.
  outcome text check (outcome is null or char_length(outcome) <= 30),
  sms_id uuid,
  promoted_at timestamptz,
  done_by uuid references auth.users (id) on delete set null,
  done_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (step_id, thread_id),
  foreign key (step_id, workspace_id)
    references public.sequence_channel_steps (id, workspace_id) on delete cascade,
  foreign key (thread_id, workspace_id)
    references public.mail_threads (id, workspace_id) on delete cascade,
  foreign key (lead_id, workspace_id)
    references public.leads (id, workspace_id) on delete cascade,
  foreign key (sms_id, workspace_id)
    references public.sms_log (id, workspace_id) on delete set null (sms_id)
);
alter table public.sequence_channel_runs enable row level security;
create index sequence_channel_runs_step_idx on public.sequence_channel_runs (step_id, workspace_id);
create index sequence_channel_runs_thread_idx on public.sequence_channel_runs (thread_id, workspace_id);
create index sequence_channel_runs_lead_idx on public.sequence_channel_runs (lead_id, workspace_id);
create index sequence_channel_runs_sms_idx on public.sequence_channel_runs (sms_id, workspace_id) where sms_id is not null;
create index sequence_channel_runs_due_idx on public.sequence_channel_runs (due_at) where status = 'scheduled';
create index sequence_channel_runs_tasks_idx on public.sequence_channel_runs (workspace_id, status, due_at);
create index sequence_channel_runs_done_by_idx on public.sequence_channel_runs (done_by);
create trigger sequence_channel_runs_set_updated_at
  before update on public.sequence_channel_runs
  for each row execute function private.set_updated_at();

revoke all on public.sequence_channel_steps, public.sequence_channel_runs from anon, authenticated;
grant all on public.sequence_channel_steps, public.sequence_channel_runs to service_role;
grant select on public.sequence_channel_steps, public.sequence_channel_runs to authenticated;
create policy "Members read sequence steps" on public.sequence_channel_steps for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));
create policy "Members read sequence step runs" on public.sequence_channel_runs for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));

-- ---------------------------------------------------------------------------
-- Steps (signed in, owners and admins)
-- ---------------------------------------------------------------------------

-- Adds a step, or edits one (p_step_id). New steps apply to sequences that
-- start from now on. Returns the step's id.
create function public.channel_step_save(
  p_workspace_id uuid, p_step_id uuid, p_applies_to text, p_channel text,
  p_day_offset integer, p_message text, p_note text, p_max_steps integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_id uuid;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if not (select private.is_workspace_admin(p_workspace_id)) then
    raise exception 'only an owner or admin can change this' using errcode = '42501';
  end if;
  if p_step_id is null then
    if (select count(*) from public.sequence_channel_steps s
        where s.workspace_id = p_workspace_id and s.active) >= p_max_steps then
      raise exception 'too many steps' using errcode = 'DV429';
    end if;
    insert into public.sequence_channel_steps (workspace_id, applies_to, channel, day_offset, message, note, created_by)
    values (p_workspace_id, p_applies_to, p_channel, p_day_offset, btrim(coalesce(p_message, '')),
            btrim(coalesce(p_note, '')), v_user)
    returning id into v_id;
  else
    update public.sequence_channel_steps s set
      applies_to = p_applies_to, channel = p_channel, day_offset = p_day_offset,
      message = btrim(coalesce(p_message, '')), note = btrim(coalesce(p_note, ''))
    where s.id = p_step_id and s.workspace_id = p_workspace_id and s.active
    returning s.id into v_id;
  end if;
  return v_id;
end;
$$;
revoke all on function public.channel_step_save(uuid, uuid, text, text, integer, text, text, integer) from public, anon;
grant execute on function public.channel_step_save(uuid, uuid, text, text, integer, text, text, integer) to authenticated;

-- Removes a step: it stops for every sequence where it hasn't run yet.
create function public.channel_step_remove(p_step_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid;
begin
  select s.workspace_id into v_ws from public.sequence_channel_steps s where s.id = p_step_id and s.active;
  if v_ws is null or not (select private.is_workspace_admin(v_ws)) then
    return false;
  end if;
  update public.sequence_channel_steps s set active = false where s.id = p_step_id;
  update public.sequence_channel_runs r set status = 'stopped', skip_reason = 'The step was removed'
  where r.step_id = p_step_id and r.workspace_id = v_ws and r.status in ('scheduled', 'due');
  return true;
end;
$$;
revoke all on function public.channel_step_remove(uuid) from public, anon;
grant execute on function public.channel_step_remove(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The engine
-- ---------------------------------------------------------------------------

-- A step's message for one lead.
create function private.channel_fill(p_template text, p_lead public.leads)
returns text
language sql
stable
set search_path = ''
as $$
  select replace(replace(coalesce(p_template, ''),
    '{first_name}', coalesce(nullif(split_part(btrim(coalesce(p_lead.name, '')), ' ', 1), ''), 'there')),
    '{company}', coalesce(nullif(btrim(coalesce(p_lead.company, '')), ''), 'your team'));
$$;
revoke all on function private.channel_fill(text, public.leads) from public;

-- Ends a sequence because the lead answered on another channel: no more
-- email follow-ups, and every step not yet run is stopped.
create function private.channel_end_sequence(p_thread_id uuid, p_workspace_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.mail_threads t
  set status = 'replied', stop_reason = left(p_reason, 60), next_followup_at = null, last_reply_at = now()
  where t.id = p_thread_id and t.workspace_id = p_workspace_id and t.status = 'active';
  update public.sequence_channel_runs r set status = 'stopped', skip_reason = left(p_reason, 80)
  where r.thread_id = p_thread_id and r.workspace_id = p_workspace_id and r.status in ('scheduled', 'due');
end;
$$;
revoke all on function private.channel_end_sequence(uuid, uuid, text) from public;

-- One pass of the engine, run every minute by the scheduler:
--   1. schedules each active step for sequences that started after it was
--      added (in the last 60 days), or records why it can't run for that lead;
--   2. stops steps whose sequence or lead says stop, and ends sequences
--      where the lead wrote back on another channel;
--   3. hands out due LinkedIn and call tasks (LinkedIn: at most
--      p_linkedin_daily a day per workspace, the rest wait for tomorrow).
-- Texts that are due are sent by the app (channel_sms_claim).
create function public.channel_tick(p_linkedin_daily integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new integer;
  v_stopped integer;
  v_promoted integer := 0;
  v_run record;
  v_lead public.leads%rowtype;
  v_profile text;
begin
  -- 1. Schedule.
  with candidates as (
    select s.id as step_id, s.workspace_id, s.channel, s.day_offset, t.id as thread_id, t.lead_id, t.first_sent_at,
           l.consent_sms, l.consent_sms_source, l.phone
    from public.sequence_channel_steps s
    join public.mail_threads t on t.workspace_id = s.workspace_id
      and t.created_at >= s.created_at and t.created_at > now() - interval '60 days'
    join public.leads l on l.id = t.lead_id and l.workspace_id = t.workspace_id
    left join lateral (
      select d.play from public.outbound_emails e
      join public.outbound_drafts d on d.id = e.draft_id and d.workspace_id = e.workspace_id
      where e.thread_id = t.id and e.workspace_id = t.workspace_id and e.kind = 'first'
      limit 1
    ) p on true
    where s.active
      and not exists (select 1 from public.sequence_channel_runs r where r.step_id = s.id and r.thread_id = t.id)
      and (
        (s.applies_to = 'sequences' and t.status = 'active'
         and coalesce(p.play, '') not in ('onboarding', 'expansion', 'nurture', 'event_registration', 'event_followup', 'event_no_show'))
        or (s.applies_to = 'nurture' and p.play = 'nurture'
            and (t.status = 'active' or (t.status = 'finished' and t.stop_reason = 'single_touch_play')))
      )
  )
  insert into public.sequence_channel_runs (workspace_id, step_id, thread_id, lead_id, channel, due_at, status, skip_reason)
  select c.workspace_id, c.step_id, c.thread_id, c.lead_id, c.channel,
         c.first_sent_at + make_interval(days => c.day_offset),
         case
           when c.channel = 'sms' and (not c.consent_sms or nullif(btrim(coalesce(c.consent_sms_source, '')), '') is null) then 'skipped'
           when c.channel in ('sms', 'call_task') and private.e164(c.phone) is null then 'skipped'
           else 'scheduled' end,
         case
           when c.channel = 'sms' and (not c.consent_sms or nullif(btrim(coalesce(c.consent_sms_source, '')), '') is null) then 'No recorded consent to be texted'
           when c.channel in ('sms', 'call_task') and private.e164(c.phone) is null then 'No phone number in international form (+1...)'
         end
  from candidates c
  on conflict (step_id, thread_id) do nothing;
  get diagnostics v_new = row_count;

  -- 2a. The sequence or the lead says stop.
  update public.sequence_channel_runs r set status = 'stopped', skip_reason = case
      when t.status = 'replied' then 'They replied'
      when t.status = 'bounced' then 'The email bounced'
      when t.status = 'unsubscribed' or l.status = 'unsubscribed' then 'Unsubscribed'
      when l.do_not_contact then 'Marked do not contact'
      else 'The sequence was stopped' end
  from public.mail_threads t, public.leads l
  where t.id = r.thread_id and t.workspace_id = r.workspace_id
    and l.id = r.lead_id and l.workspace_id = r.workspace_id
    and r.status in ('scheduled', 'due')
    and (t.status in ('replied', 'bounced', 'unsubscribed', 'stopped') or l.do_not_contact or l.status = 'unsubscribed');
  get diagnostics v_stopped = row_count;

  -- 2b. The lead wrote back on any channel since the first email.
  for v_run in
    select distinct r.thread_id, r.workspace_id, cv.channel
    from public.sequence_channel_runs r
    join public.mail_threads t on t.id = r.thread_id and t.workspace_id = r.workspace_id
    join lateral (
      select c.channel from public.messages m
      join public.conversations c on c.id = m.conversation_id and c.workspace_id = m.workspace_id
      where c.workspace_id = r.workspace_id and c.lead_id = r.lead_id
        and m.direction = 'in' and m.sent_at > t.first_sent_at
        and coalesce(m.metadata ->> 'keyword', '') <> 'start'
      order by m.sent_at
      limit 1
    ) cv on true
    where r.status in ('scheduled', 'due')
  loop
    perform private.channel_end_sequence(v_run.thread_id, v_run.workspace_id,
      'Replied by ' || case v_run.channel when 'voice' then 'phone' when 'sms' then 'text' else v_run.channel end);
    v_stopped := v_stopped + 1;
  end loop;

  -- 3. Due tasks.
  for v_run in
    select r.id, r.workspace_id, r.lead_id, r.thread_id, r.channel, s.message, s.note
    from public.sequence_channel_runs r
    join public.sequence_channel_steps s on s.id = r.step_id and s.workspace_id = r.workspace_id
    where r.status = 'scheduled' and r.channel in ('linkedin', 'call_task') and r.due_at <= now()
    order by r.due_at
    limit 500
    for update of r skip locked
  loop
    if v_run.channel = 'linkedin' and (
      select count(*) from public.sequence_channel_runs x
      where x.workspace_id = v_run.workspace_id and x.channel = 'linkedin'
        and x.promoted_at > now() - interval '1 day') >= p_linkedin_daily then
      update public.sequence_channel_runs r set due_at = now() + interval '1 hour' where r.id = v_run.id;
      continue;
    end if;
    select * into v_lead from public.leads l where l.id = v_run.lead_id and l.workspace_id = v_run.workspace_id;
    v_profile := null;
    if v_run.channel = 'linkedin' then
      select p.contact_linkedin_url into v_profile
      from public.outbound_emails e
      join public.prospects p on p.id = e.prospect_id and p.workspace_id = e.workspace_id
      where e.thread_id = v_run.thread_id and e.workspace_id = v_run.workspace_id and e.kind = 'first'
        and p.contact_linkedin_url is not null
      limit 1;
      if v_profile is null and btrim(coalesce(v_lead.name, '')) <> '' then
        v_profile := left('https://www.linkedin.com/search/results/people/?keywords='
          || replace(replace(replace(btrim(v_lead.name || ' ' || coalesce(v_lead.company, '')), '%', '%25'), '&', '%26'), ' ', '%20'), 500);
      end if;
    end if;
    update public.sequence_channel_runs r set
      status = 'due', promoted_at = now(),
      body = left(case when v_run.channel = 'linkedin' then private.channel_fill(v_run.message, v_lead)
                       else private.channel_fill(nullif(v_run.note, ''), v_lead) end, 1600),
      profile_url = v_profile
    where r.id = v_run.id;
    v_promoted := v_promoted + 1;
  end loop;

  return jsonb_build_object('scheduled', v_new, 'stopped', v_stopped, 'tasks', v_promoted);
end;
$$;
revoke all on function public.channel_tick(integer) from public, anon, authenticated;
grant execute on function public.channel_tick(integer) to service_role;

-- Hands the server the texts that are due (at most p_limit), each already
-- checked and recorded as 'sending' (private.sms_prepare). The first text
-- to a lead ends with how to opt out. Steps that can't send are skipped or
-- moved to when they can.
create function public.channel_sms_claim(p_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run record;
  v_lead public.leads%rowtype;
  v_body text;
  v_prep jsonb;
  v_out jsonb := '[]'::jsonb;
  v_n integer := 0;
  v_name text;
begin
  for v_run in
    select r.id, r.workspace_id, r.lead_id, s.message
    from public.sequence_channel_runs r
    join public.sequence_channel_steps s on s.id = r.step_id and s.workspace_id = r.workspace_id
    where r.status = 'scheduled' and r.channel = 'sms' and r.due_at <= now()
    order by r.due_at
    limit greatest(p_limit, 0) * 3
    for update of r skip locked
  loop
    exit when v_n >= p_limit;
    select * into v_lead from public.leads l where l.id = v_run.lead_id and l.workspace_id = v_run.workspace_id;
    select w.name into v_name from public.workspaces w where w.id = v_run.workspace_id;
    v_body := private.channel_fill(v_run.message, v_lead);
    -- Say who it's from, and how to stop, the first time.
    if not exists (select 1 from public.sms_log x
                   where x.workspace_id = v_run.workspace_id and x.lead_id = v_lead.id and x.direction = 'out'
                     and x.status in ('sent', 'delivered')) then
      v_body := v_name || ': ' || v_body || ' Reply STOP to opt out.';
    end if;
    v_prep := private.sms_prepare(v_run.workspace_id, v_lead.id, v_body, 'sequence', true);
    if v_prep ->> 'status' = 'ok' then
      update public.sequence_channel_runs r
      set status = 'sending', body = left(v_body, 1600), sms_id = (v_prep ->> 'sms_id')::uuid
      where r.id = v_run.id;
      v_out := v_out || (v_prep || jsonb_build_object('run_id', v_run.id, 'workspace_id', v_run.workspace_id, 'body', v_body));
      v_n := v_n + 1;
    elsif v_prep ->> 'status' = 'later' then
      update public.sequence_channel_runs r set due_at = (v_prep ->> 'retry_at')::timestamptz where r.id = v_run.id;
    else
      update public.sequence_channel_runs r set status = 'skipped', skip_reason = left(v_prep ->> 'reason', 80)
      where r.id = v_run.id;
    end if;
  end loop;
  return v_out;
end;
$$;
revoke all on function public.channel_sms_claim(integer) from public, anon, authenticated;
grant execute on function public.channel_sms_claim(integer) to service_role;

-- What happened to a step's text once Twilio answered.
create function public.channel_sms_finished(p_run_id uuid, p_workspace_id uuid, p_sent boolean)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.sequence_channel_runs r
  set status = case when p_sent then 'done' else 'failed' end,
      outcome = case when p_sent then 'sent' end, done_at = now()
  where r.id = p_run_id and r.workspace_id = p_workspace_id and r.status = 'sending';
$$;
revoke all on function public.channel_sms_finished(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.channel_sms_finished(uuid, uuid, boolean) to service_role;

-- A person finished a task: 'done' (sent the LinkedIn message, or made the
-- call), 'replied' (they answered: the sequence ends) or 'skipped'.
create function public.channel_task_done(p_run_id uuid, p_outcome text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_run public.sequence_channel_runs%rowtype;
begin
  select * into v_run from public.sequence_channel_runs r where r.id = p_run_id for update;
  if not found or v_user is null or not (select private.is_workspace_member(v_run.workspace_id))
     or v_run.status <> 'due' or p_outcome not in ('done', 'replied', 'skipped') then
    return false;
  end if;
  update public.sequence_channel_runs r set
    status = case when p_outcome = 'skipped' then 'skipped' else 'done' end,
    outcome = case p_outcome when 'skipped' then null when 'replied' then 'replied'
                when 'done' then case when v_run.channel = 'linkedin' then 'sent' else 'called' end end,
    skip_reason = case when p_outcome = 'skipped' then 'Skipped by a person' end,
    done_by = v_user, done_at = now()
  where r.id = v_run.id;
  insert into public.activity_events (workspace_id, lead_id, actor_id, kind, summary, channel, metadata)
  values (v_run.workspace_id, v_run.lead_id, v_user,
          case v_run.channel when 'linkedin' then 'linkedin_task' else 'call_task' end,
          case
            when p_outcome = 'skipped' then case v_run.channel when 'linkedin' then 'LinkedIn step skipped' else 'Call task skipped' end
            when p_outcome = 'replied' then case v_run.channel when 'linkedin' then 'Replied on LinkedIn' else 'Answered the call' end
            else case v_run.channel when 'linkedin' then 'LinkedIn message sent by hand' else 'Called by hand' end end,
          case v_run.channel when 'linkedin' then 'social' else 'voice' end,
          jsonb_build_object('run_id', v_run.id));
  if p_outcome = 'replied' then
    perform private.channel_end_sequence(v_run.thread_id, v_run.workspace_id,
      case v_run.channel when 'linkedin' then 'Replied on LinkedIn' else 'Answered a call' end);
    update public.leads l set status = 'engaged'
    where l.id = v_run.lead_id and l.workspace_id = v_run.workspace_id and l.status = 'new';
  end if;
  return true;
end;
$$;
revoke all on function public.channel_task_done(uuid, text) from public, anon;
grant execute on function public.channel_task_done(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The scheduler: once a minute the database runs the engine and, only when
-- there is something to dial or text, calls the app
--   POST <app>/api/channels/step
-- with the same Vault token and address as the mail and CRM schedulers
-- (dialvo_cron_token, dialvo_app_url, checked by crm_cron_token_ok).
-- ---------------------------------------------------------------------------

-- Whether the app has work: texts due, or approved calls whose time has come.
create function public.channel_has_work()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.sequence_channel_runs r
    where r.status = 'scheduled' and r.channel = 'sms' and r.due_at <= now()
  ) or exists (
    select 1 from public.call_batch_leads i
    join public.call_batches b on b.id = i.batch_id and b.workspace_id = i.workspace_id and b.status = 'approved'
    join public.workspace_phone p on p.workspace_id = i.workspace_id and p.outbound_on
    where i.status = 'waiting' and i.next_try_at <= now()
  );
$$;
revoke all on function public.channel_has_work() from public, anon, authenticated;
grant execute on function public.channel_has_work() to service_role;

create function private.channel_cron_tick()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_token text;
begin
  -- 20 = LINKEDIN_DAILY_TASKS in src/lib/channels/config.ts.
  perform public.channel_tick(20);
  if not public.channel_has_work() then
    return;
  end if;
  select s.decrypted_secret into v_url from vault.decrypted_secrets s where s.name = 'dialvo_app_url';
  select s.decrypted_secret into v_token from vault.decrypted_secrets s where s.name = 'dialvo_cron_token';
  if v_url is null or v_token is null then
    return;
  end if;
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := $4)'
  using rtrim(v_url, '/') || '/api/channels/step', '{}'::jsonb,
        jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_token),
        58000;
end;
$$;
revoke all on function private.channel_cron_tick() from public;

do $do$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    execute 'create extension if not exists pg_cron with schema pg_catalog';
    execute 'create extension if not exists pg_net with schema extensions';
    execute $job$
      select cron.schedule('dialvo-channel-steps', '* * * * *', 'select private.channel_cron_tick()')
    $job$;
  end if;
end;
$do$;
