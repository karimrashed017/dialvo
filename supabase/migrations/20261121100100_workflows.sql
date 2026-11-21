-- Workflows: "when X, do Y" automations a workspace builds as a list of
-- steps.
--
--   workflows       a trigger (lead created, stage changed, reply received
--                   by classification, chat needs a person, meeting booked,
--                   signal kept, an inbound signed webhook, a schedule), the
--                   conditions a lead must meet, and up to 8 steps.
--   workflow_runs   one per event per workflow, with a log of why each step
--                   ran or was skipped. Kept 60 days.
--   workflow_tasks  "create a task for a person": what a teammate should do.
--
-- How it runs. Triggers on leads, mail_received, team_alerts, meetings,
-- signals and intent_signals only queue a run (private.workflow_enqueue),
-- for enabled workflows with that trigger, at most WORKFLOW_RUNS_PER_DAY a
-- workspace a day (the number is written in this file and in
-- src/lib/workflows/config.ts). The app claims runs, checks the trigger's
-- own filter and the conditions (src/lib/workflows/engine.ts), and carries
-- out each step through public.workflow_act, which does one action in the
-- database. Changes a workflow makes don't start other workflows (the
-- 'dialvo.workflow' setting, local to the action's transaction), so two
-- workflows can't set each other off in a loop.
--
-- Nothing here sends an email: "add to a play" puts the lead in a running
-- play, whose first email is written and waits for approval under that
-- play's own rules.
--
-- The scheduler: pg_cron runs private.workflow_cron_tick() every minute; it
-- queues scheduled workflows that are due and calls the app
-- (/api/activation/step?job=workflows) only when a run waits.

create table public.workflows (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  enabled boolean not null default false,
  trigger text not null check (trigger in (
    'lead_created', 'lead_stage_changed', 'reply_received', 'chat_needs_person',
    'meeting_booked', 'signal_kept', 'webhook', 'schedule')),
  -- The trigger's own filter: { "stages": [...] } for a stage change,
  -- { "classifications": [...] } for a reply, { "every": "day" | "week",
  -- "hour": 0-23, "weekday": 0-6 } for a schedule (UTC).
  trigger_config jsonb not null default '{}'::jsonb
    check (jsonb_typeof(trigger_config) = 'object' and octet_length(trigger_config::text) <= 2000),
  -- [{ "field", "op", "value" }], all must hold (src/lib/workflows/types.ts).
  conditions jsonb not null default '[]'::jsonb
    check (jsonb_typeof(conditions) = 'array' and jsonb_array_length(conditions) <= 10
           and octet_length(conditions::text) <= 4000),
  -- [{ "action", ... }], in order.
  steps jsonb not null default '[]'::jsonb
    check (jsonb_typeof(steps) = 'array' and jsonb_array_length(steps) between 1 and 8
           and octet_length(steps::text) <= 8000),
  -- The inbound webhook's address token: only its hash, and its first
  -- characters to tell addresses apart.
  hook_hash text unique check (hook_hash is null or hook_hash ~ '^[0-9a-f]{64}$'),
  hook_prefix text check (hook_prefix is null or hook_prefix ~ '^[A-Za-z0-9_-]{6,16}$'),
  next_run_at timestamptz,
  last_run_at timestamptz,
  runs_total integer not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id)
);
alter table public.workflows enable row level security;
create index workflows_workspace_idx on public.workflows (workspace_id, created_at);
create index workflows_trigger_idx on public.workflows (workspace_id, trigger) where enabled;
create index workflows_schedule_idx on public.workflows (next_run_at) where enabled and trigger = 'schedule';
create index workflows_created_by_idx on public.workflows (created_by);
create index workflows_updated_by_idx on public.workflows (updated_by);

create trigger workflows_set_updated_at
  before update on public.workflows
  for each row execute function private.set_updated_at();

create table public.workflow_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  workflow_id uuid not null,
  lead_id uuid,
  trigger text not null check (char_length(trigger) between 1 and 40),
  -- What happened: { "summary", "stage", "classification", ... }.
  event jsonb not null default '{}'::jsonb
    check (jsonb_typeof(event) = 'object' and octet_length(event::text) <= 8000),
  dedupe_key text not null check (char_length(dedupe_key) between 1 and 200),
  -- pending -> running -> done (some step ran) | skipped (the filter or a
  -- condition didn't hold, or every step was skipped) | failed.
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'skipped', 'failed')),
  -- [{ "step", "action", "outcome": "done" | "skipped" | "failed", "why" }]
  log jsonb not null default '[]'::jsonb check (jsonb_typeof(log) = 'array' and octet_length(log::text) <= 12000),
  attempts integer not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (id, workspace_id),
  unique (workflow_id, dedupe_key),
  foreign key (workflow_id, workspace_id)
    references public.workflows (id, workspace_id) on delete cascade,
  foreign key (lead_id, workspace_id)
    references public.leads (id, workspace_id) on delete set null (lead_id)
);
alter table public.workflow_runs enable row level security;
create index workflow_runs_workflow_idx on public.workflow_runs (workflow_id, workspace_id, created_at desc);
create index workflow_runs_lead_idx on public.workflow_runs (lead_id, workspace_id) where lead_id is not null;
create index workflow_runs_recent_idx on public.workflow_runs (workspace_id, created_at desc);
create index workflow_runs_due_idx on public.workflow_runs (created_at) where status in ('pending', 'running');

create trigger workflow_runs_set_updated_at
  before update on public.workflow_runs
  for each row execute function private.set_updated_at();

create table public.workflow_tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  lead_id uuid,
  assignee_id uuid,
  run_id uuid,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  due_at timestamptz,
  status text not null default 'open' check (status in ('open', 'done')),
  done_by uuid references auth.users (id) on delete set null,
  done_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (lead_id, workspace_id)
    references public.leads (id, workspace_id) on delete cascade,
  foreign key (workspace_id, assignee_id)
    references public.workspace_members (workspace_id, user_id) on delete set null (assignee_id),
  foreign key (run_id, workspace_id)
    references public.workflow_runs (id, workspace_id) on delete set null (run_id)
);
alter table public.workflow_tasks enable row level security;
create index workflow_tasks_open_idx on public.workflow_tasks (workspace_id, status, due_at nulls last);
create index workflow_tasks_lead_idx on public.workflow_tasks (lead_id, workspace_id) where lead_id is not null;
create index workflow_tasks_assignee_idx on public.workflow_tasks (workspace_id, assignee_id) where assignee_id is not null;
create index workflow_tasks_run_idx on public.workflow_tasks (run_id, workspace_id) where run_id is not null;
create index workflow_tasks_done_by_idx on public.workflow_tasks (done_by);

create trigger workflow_tasks_set_updated_at
  before update on public.workflow_tasks
  for each row execute function private.set_updated_at();

alter table public.outbound_usage
  add column workflow_runs integer not null default 0,
  add column workflow_actions integer not null default 0;

revoke all on public.workflows, public.workflow_runs, public.workflow_tasks from anon, authenticated;
grant all on public.workflows, public.workflow_runs, public.workflow_tasks to service_role;
-- Everything but the webhook token's hash.
grant select (id, workspace_id, name, enabled, trigger, trigger_config, conditions, steps, hook_prefix,
              next_run_at, last_run_at, runs_total, created_by, updated_by, created_at, updated_at)
  on public.workflows to authenticated;
grant select on public.workflow_runs, public.workflow_tasks to authenticated;

create policy "Members read workflows" on public.workflows for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));
create policy "Members read workflow runs" on public.workflow_runs for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));
create policy "Members read tasks" on public.workflow_tasks for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));

-- ---------------------------------------------------------------------------
-- Saving (owners and admins, signed in). The app checks each step's shape
-- (src/lib/workflows/types.ts); the table's checks bound the sizes.
-- ---------------------------------------------------------------------------

-- The next time a schedule fires after now: { "every": "day" | "week",
-- "hour", "weekday" (0 = Sunday) }, UTC.
create function private.workflow_next_run(p_config jsonb, p_after timestamptz)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  v_hour integer := least(greatest(coalesce((p_config ->> 'hour')::integer, 8), 0), 23);
  v_day integer := least(greatest(coalesce((p_config ->> 'weekday')::integer, 1), 0), 6);
  v_base timestamp := date_trunc('day', p_after at time zone 'utc') + make_interval(hours => v_hour);
  v_at timestamp;
begin
  if coalesce(p_config ->> 'every', 'day') = 'week' then
    v_at := v_base + make_interval(days => ((v_day - extract(dow from v_base)::integer) + 7) % 7);
    if v_at <= (p_after at time zone 'utc') then
      v_at := v_at + interval '7 days';
    end if;
  else
    v_at := v_base;
    if v_at <= (p_after at time zone 'utc') then
      v_at := v_at + interval '1 day';
    end if;
  end if;
  return v_at at time zone 'utc';
end;
$$;
revoke all on function private.workflow_next_run(jsonb, timestamptz) from public;

--   { "status": "saved", "id" } | { "status": "not_found" | "invalid" | "capped" }
create function public.workflow_save(
  p_workspace_id uuid, p_id uuid, p_name text, p_trigger text, p_trigger_config jsonb,
  p_conditions jsonb, p_steps jsonb, p_enabled boolean, p_max integer
)
returns jsonb
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
    return jsonb_build_object('status', 'not_found');
  end if;
  if p_trigger not in ('lead_created', 'lead_stage_changed', 'reply_received', 'chat_needs_person',
                       'meeting_booked', 'signal_kept', 'webhook', 'schedule')
     or jsonb_typeof(coalesce(p_steps, 'null'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_conditions, 'null'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_trigger_config, 'null'::jsonb)) <> 'object' then
    return jsonb_build_object('status', 'invalid');
  end if;
  begin
    if p_id is null then
      perform 1 from public.workspaces w where w.id = p_workspace_id for update;
      if (select count(*) from public.workflows f where f.workspace_id = p_workspace_id) >= p_max then
        return jsonb_build_object('status', 'capped');
      end if;
      insert into public.workflows (workspace_id, name, enabled, trigger, trigger_config, conditions, steps,
                                    next_run_at, created_by, updated_by)
      values (p_workspace_id, btrim(p_name), coalesce(p_enabled, false), p_trigger, p_trigger_config,
              p_conditions, p_steps,
              case when p_trigger = 'schedule' then private.workflow_next_run(p_trigger_config, now()) end,
              v_user, v_user)
      returning id into v_id;
    else
      update public.workflows f
      set name = btrim(p_name), enabled = coalesce(p_enabled, f.enabled), trigger = p_trigger,
          trigger_config = p_trigger_config, conditions = p_conditions, steps = p_steps,
          next_run_at = case when p_trigger = 'schedule' then private.workflow_next_run(p_trigger_config, now()) end,
          hook_hash = case when p_trigger = 'webhook' then f.hook_hash end,
          hook_prefix = case when p_trigger = 'webhook' then f.hook_prefix end,
          updated_by = v_user
      where f.id = p_id and f.workspace_id = p_workspace_id
      returning f.id into v_id;
      if v_id is null then
        return jsonb_build_object('status', 'not_found');
      end if;
    end if;
  exception when check_violation then
    return jsonb_build_object('status', 'invalid');
  end;
  return jsonb_build_object('status', 'saved', 'id', v_id);
end;
$$;

create function public.workflow_set_enabled(p_workspace_id uuid, p_id uuid, p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.is_workspace_admin(p_workspace_id)) then
    return false;
  end if;
  update public.workflows f
  set enabled = coalesce(p_enabled, false), updated_by = (select auth.uid()),
      next_run_at = case when f.trigger = 'schedule' then private.workflow_next_run(f.trigger_config, now()) end
  where f.id = p_id and f.workspace_id = p_workspace_id;
  return found;
end;
$$;

create function public.workflow_delete(p_workspace_id uuid, p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.is_workspace_admin(p_workspace_id)) then
    return false;
  end if;
  delete from public.workflows f where f.id = p_id and f.workspace_id = p_workspace_id;
  return found;
end;
$$;

-- A new inbound address for a webhook workflow: the app makes the token,
-- shows it once and sends its hash here.
create function public.workflow_hook_set(p_workspace_id uuid, p_id uuid, p_hash text, p_prefix text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.is_workspace_admin(p_workspace_id)) then
    return false;
  end if;
  update public.workflows f set hook_hash = lower(p_hash), hook_prefix = p_prefix, updated_by = (select auth.uid())
  where f.id = p_id and f.workspace_id = p_workspace_id and f.trigger = 'webhook';
  return found;
end;
$$;

-- Tasks: any member marks one done (or open again).
create function public.workflow_task_set(p_task_id uuid, p_done boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  update public.workflow_tasks t
  set status = case when p_done then 'done' else 'open' end,
      done_by = case when p_done then v_user end, done_at = case when p_done then now() end
  where t.id = p_task_id and (select private.is_workspace_member(t.workspace_id));
  return found;
end;
$$;

-- ---------------------------------------------------------------------------
-- Queueing runs (internal)
-- ---------------------------------------------------------------------------

-- One run per enabled workflow with this trigger, unless the change came
-- from a workflow itself, or the workspace has had its runs for today
-- (500, the same number as WORKFLOW_RUNS_PER_DAY in
-- src/lib/workflows/config.ts). Never raises.
create function private.workflow_enqueue(
  p_workspace_id uuid, p_trigger text, p_lead_id uuid, p_event jsonb, p_key text, p_workflow_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  f record;
  v_n integer := 0;
  v_taken integer;
begin
  if coalesce(current_setting('dialvo.workflow', true), '') = 'on' then
    return 0;
  end if;
  for f in
    select w.id from public.workflows w
    where w.workspace_id = p_workspace_id and w.enabled and w.trigger = p_trigger
      and (p_workflow_id is null or w.id = p_workflow_id)
    order by w.created_at
  loop
    insert into public.outbound_usage as u (workspace_id, day, workflow_runs)
    values (p_workspace_id, (now() at time zone 'utc')::date, 1)
    on conflict (workspace_id, day) do update
    set workflow_runs = u.workflow_runs + 1
    where u.workflow_runs < 500
    returning u.workflow_runs into v_taken;
    exit when v_taken is null;
    insert into public.workflow_runs (workspace_id, workflow_id, lead_id, trigger, event, dedupe_key)
    values (p_workspace_id, f.id, p_lead_id, p_trigger,
            case when octet_length(coalesce(p_event, '{}'::jsonb)::text) <= 8000 then coalesce(p_event, '{}'::jsonb)
                 else jsonb_build_object('summary', left(p_event ->> 'summary', 1000)) end,
            left(p_key, 200))
    on conflict (workflow_id, dedupe_key) do nothing;
    if found then
      v_n := v_n + 1;
    end if;
    v_taken := null;
  end loop;
  return v_n;
exception when others then
  return v_n;
end;
$$;
revoke all on function private.workflow_enqueue(uuid, text, uuid, jsonb, text, uuid) from public;

create function private.workflows_on_lead_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.workflow_enqueue(new.workspace_id, 'lead_created', new.id,
    jsonb_build_object('summary', 'A lead was added from ' || new.source || '.', 'source', new.source),
    'lead:' || new.id);
  return null;
end;
$$;
revoke all on function private.workflows_on_lead_insert() from public;
create trigger leads_workflows_insert
  after insert on public.leads
  for each row execute function private.workflows_on_lead_insert();

create function private.workflows_on_lead_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    perform private.workflow_enqueue(new.workspace_id, 'lead_stage_changed', new.id,
      jsonb_build_object('summary', 'Stage changed from ' || old.status || ' to ' || new.status || '.',
                         'from', old.status, 'stage', new.status),
      'stage:' || new.id || ':' || new.status || ':' || floor(extract(epoch from now()))::bigint);
  end if;
  return null;
end;
$$;
revoke all on function private.workflows_on_lead_status() from public;
create trigger leads_workflows_status
  after update of status on public.leads
  for each row execute function private.workflows_on_lead_status();

-- A reply, once the model has sorted it.
create function private.workflows_on_reply_classified()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead uuid;
begin
  if new.kind = 'reply' and new.classification is not null and old.classification is null then
    select t.lead_id into v_lead from public.mail_threads t
    where t.id = new.thread_id and t.workspace_id = new.workspace_id;
    perform private.workflow_enqueue(new.workspace_id, 'reply_received', v_lead,
      jsonb_build_object('summary', coalesce(nullif(new.class_summary, ''), 'A reply was received.'),
                         'classification', new.classification, 'channel', 'email',
                         'subject', left(new.subject, 200)),
      'reply:' || new.id);
  end if;
  return null;
end;
$$;
revoke all on function private.workflows_on_reply_classified() from public;
create trigger mail_received_workflows
  after update of classification on public.mail_received
  for each row execute function private.workflows_on_reply_classified();

create function private.workflows_on_team_alert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead uuid;
begin
  if new.kind = 'needs_human' then
    select c.lead_id into v_lead from public.conversations c
    where c.id = new.conversation_id and c.workspace_id = new.workspace_id;
    perform private.workflow_enqueue(new.workspace_id, 'chat_needs_person', v_lead,
      jsonb_build_object('summary', left(coalesce(nullif(new.summary, ''), 'A chat needs a person.'), 600),
                         'conversation_id', new.conversation_id),
      'alert:' || new.id);
  end if;
  return null;
end;
$$;
revoke all on function private.workflows_on_team_alert() from public;
create trigger team_alerts_workflows
  after insert on public.team_alerts
  for each row execute function private.workflows_on_team_alert();

create function private.workflows_on_meeting()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'scheduled' and new.source <> 'calendar' then
    perform private.workflow_enqueue(new.workspace_id, 'meeting_booked', new.lead_id,
      jsonb_build_object('summary', 'A meeting was booked' || coalesce(': ' || nullif(new.title, ''), '') || '.',
                         'meeting_id', new.id, 'starts_at', new.starts_at),
      'meeting:' || new.id);
  end if;
  return null;
end;
$$;
revoke all on function private.workflows_on_meeting() from public;
create trigger meetings_workflows
  after insert on public.meetings
  for each row execute function private.workflows_on_meeting();

-- A contact signal kept (it becomes a prospect, so there is no lead yet).
create function private.workflows_on_signal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'kept' and old.status is distinct from 'kept' then
    perform private.workflow_enqueue(new.workspace_id, 'signal_kept', null,
      jsonb_build_object('summary', new.summary, 'kind', 'buying_signal',
                         'company', new.company_name, 'domain', new.company_domain),
      'signal:' || new.id);
  end if;
  return null;
end;
$$;
revoke all on function private.workflows_on_signal() from public;
create trigger signals_workflows
  after update of status on public.signals
  for each row execute function private.workflows_on_signal();

create function private.workflows_on_intent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'queued' and old.status is distinct from 'queued' then
    perform private.workflow_enqueue(new.workspace_id, 'signal_kept', null,
      jsonb_build_object('summary', 'Review-site intent kept for ' || coalesce(nullif(new.company_name, ''), new.company_domain) || '.',
                         'kind', 'review_intent', 'company', new.company_name, 'domain', new.company_domain),
      'intent:' || new.id);
  end if;
  return null;
end;
$$;
revoke all on function private.workflows_on_intent() from public;
create trigger intent_signals_workflows
  after update of status on public.intent_signals
  for each row execute function private.workflows_on_intent();

-- The inbound webhook (secret key only): the workflow whose token's hash
-- this is. A lead is matched by the payload's email, when it has one.
--   { "status": "queued" | "duplicate" | "not_found" | "off" | "capped" }
create function public.workflow_hook_receive(p_hash text, p_event jsonb, p_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_f public.workflows%rowtype;
  v_lead uuid;
  v_email text := lower(btrim(coalesce(p_event ->> 'email', '')));
  v_n integer;
begin
  select * into v_f from public.workflows f where f.hook_hash = lower(coalesce(p_hash, '')) and f.trigger = 'webhook';
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if not v_f.enabled then
    return jsonb_build_object('status', 'off');
  end if;
  if v_email <> '' then
    select l.id into v_lead from public.leads l where l.workspace_id = v_f.workspace_id and l.email = v_email;
  end if;
  if exists (select 1 from public.workflow_runs r where r.workflow_id = v_f.id and r.dedupe_key = left('hook:' || p_key, 200)) then
    return jsonb_build_object('status', 'duplicate');
  end if;
  v_n := private.workflow_enqueue(v_f.workspace_id, 'webhook', v_lead, p_event, 'hook:' || p_key, v_f.id);
  return jsonb_build_object('status', case when v_n > 0 then 'queued' else 'capped' end);
end;
$$;

-- Scheduled workflows that are due: one run each, whose step picks the
-- leads (src/lib/workflows/engine.ts).
create function private.workflow_queue_schedules()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  f record;
  v_n integer := 0;
begin
  for f in
    select w.id, w.workspace_id, w.trigger_config, w.next_run_at from public.workflows w
    where w.enabled and w.trigger = 'schedule' and w.next_run_at <= now()
    for update of w skip locked
  loop
    v_n := v_n + private.workflow_enqueue(f.workspace_id, 'schedule', null,
      jsonb_build_object('summary', 'The schedule came round.', 'at', f.next_run_at),
      'schedule:' || floor(extract(epoch from f.next_run_at))::bigint, f.id);
    update public.workflows w set next_run_at = private.workflow_next_run(f.trigger_config, now()) where w.id = f.id;
  end loop;
  return v_n;
end;
$$;
revoke all on function private.workflow_queue_schedules() from public;

-- ---------------------------------------------------------------------------
-- Running (secret key only)
-- ---------------------------------------------------------------------------

-- What the conditions are checked against: what Dialvo knows about the
-- lead, the way lead routing reads it (country and size from the research
-- of the company it was found as, or the lead's own fields).
create function private.workflow_lead_facts(p_workspace_id uuid, p_lead_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_l public.leads%rowtype;
  v_country text;
  v_size text;
  v_lo bigint;
  v_hi bigint;
begin
  select l.* into v_l from public.leads l where l.id = p_lead_id and l.workspace_id = p_workspace_id;
  if not found then
    return null;
  end if;
  select nullif(btrim(coalesce(nullif(p.country, ''), nullif(p.location, ''))), ''), nullif(btrim(p.size_range), '')
  into v_country, v_size
  from public.prospects p
  where p.workspace_id = p_workspace_id and p.lead_id = p_lead_id
  limit 1;
  v_country := coalesce(v_country, nullif(btrim(v_l.custom_fields ->> 'country'), ''),
                        nullif(btrim(v_l.custom_fields #>> '{research,location}'), ''));
  v_size := coalesce(v_size, nullif(btrim(v_l.custom_fields ->> 'company_size'), ''),
                     nullif(btrim(v_l.custom_fields ->> 'employees'), ''));
  select b.lo, b.hi into v_lo, v_hi from private.size_bounds(v_size) b;
  return jsonb_build_object(
    'id', v_l.id, 'name', v_l.name, 'email', v_l.email, 'company', v_l.company, 'website', v_l.website,
    'status', v_l.status, 'source', v_l.source, 'owner_id', v_l.owner_id,
    'do_not_contact', v_l.do_not_contact, 'country', v_country, 'size', v_size,
    'size_lo', v_lo, 'size_hi', v_hi);
end;
$$;
revoke all on function private.workflow_lead_facts(uuid, uuid) from public;

-- Claims runs that wait, under a lease, with their workflow and lead.
create function public.workflow_claim(p_limit integer, p_lease_seconds integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_out jsonb := '[]'::jsonb;
  r record;
begin
  update public.workflow_runs x
  set status = 'failed', locked_until = null, finished_at = now(),
      log = x.log || jsonb_build_array(jsonb_build_object('step', 0, 'action', 'run', 'outcome', 'failed',
                                                          'why', 'It stopped part way three times.'))
  where x.status = 'running' and x.locked_until < now() and x.attempts >= 3;

  for r in
    select x.id, x.workspace_id, x.workflow_id, x.lead_id, x.trigger, x.event, x.created_at
    from public.workflow_runs x
    where x.status = 'pending' or (x.status = 'running' and x.locked_until < now())
    order by x.created_at
    limit greatest(least(p_limit, 100), 0)
    for update of x skip locked
  loop
    update public.workflow_runs x
    set status = 'running', attempts = x.attempts + 1,
        locked_until = now() + make_interval(secs => greatest(p_lease_seconds, 30))
    where x.id = r.id;
    v_out := v_out || jsonb_build_object(
      'id', r.id, 'workspace_id', r.workspace_id, 'trigger', r.trigger, 'event', r.event,
      'created_at', r.created_at,
      'workflow', (select jsonb_build_object('id', f.id, 'name', f.name, 'enabled', f.enabled,
                                             'trigger_config', f.trigger_config, 'conditions', f.conditions,
                                             'steps', f.steps)
                   from public.workflows f where f.id = r.workflow_id),
      'lead', case when r.lead_id is null then null else private.workflow_lead_facts(r.workspace_id, r.lead_id) end);
  end loop;
  return v_out;
end;
$$;

-- What one run did. p_status: done | skipped | failed.
create function public.workflow_finish(p_workspace_id uuid, p_run_id uuid, p_status text, p_log jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workflow uuid;
begin
  update public.workflow_runs x
  set status = case when p_status in ('done', 'skipped', 'failed') then p_status else 'failed' end,
      log = case when jsonb_typeof(p_log) = 'array' and octet_length(p_log::text) <= 12000 then p_log
                 else '[]'::jsonb end,
      locked_until = null, finished_at = now()
  where x.id = p_run_id and x.workspace_id = p_workspace_id and x.status = 'running'
  returning x.workflow_id into v_workflow;
  if v_workflow is null then
    return false;
  end if;
  update public.workflows f set last_run_at = now(), runs_total = f.runs_total + 1
  where f.id = v_workflow and f.workspace_id = p_workspace_id;
  return true;
end;
$$;

-- For a scheduled run: the workspace's leads a schedule may pick, newest
-- first, leaving out leads this workflow ran on in the last p_repeat_days.
create function public.workflow_schedule_leads(p_workspace_id uuid, p_workflow_id uuid, p_limit integer, p_repeat_days integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(private.workflow_lead_facts(p_workspace_id, l.id)), '[]'::jsonb)
  from (select l.id from public.leads l
        where l.workspace_id = p_workspace_id and not l.do_not_contact and l.status <> 'unsubscribed'
          and not exists (select 1 from public.workflow_runs r
                          where r.workflow_id = p_workflow_id and r.workspace_id = p_workspace_id
                            and r.lead_id = l.id and r.created_at > now() - make_interval(days => greatest(p_repeat_days, 1)))
        order by l.updated_at desc
        limit greatest(least(p_limit, 500), 0)) l;
$$;

-- A scheduled run's leads, each as a run of its own (counted like any run).
create function public.workflow_spawn(p_workspace_id uuid, p_workflow_id uuid, p_lead_ids uuid[], p_key text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead uuid;
  v_n integer := 0;
begin
  foreach v_lead in array coalesce(p_lead_ids, '{}'::uuid[])
  loop
    v_n := v_n + private.workflow_enqueue(p_workspace_id, 'schedule', v_lead,
      jsonb_build_object('summary', 'Picked by the schedule.'),
      'schedule:' || p_key || ':' || v_lead, p_workflow_id);
  end loop;
  return v_n;
end;
$$;

-- Does one step's action, inside the database, for one claimed run. The
-- action's own changes don't start other workflows. At most p_max_actions
-- actions a workspace a day.
--   { "outcome": "done" | "skipped" | "failed", "why" }
create function public.workflow_act(
  p_workspace_id uuid, p_run_id uuid, p_index integer, p_step jsonb, p_text text,
  p_max_actions integer, p_max_briefs integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.workflow_runs%rowtype;
  v_wf public.workflows%rowtype;
  v_lead public.leads%rowtype;
  v_action text := coalesce(p_step ->> 'action', '');
  v_taken integer;
  v_r jsonb;
  v_user uuid;
  v_stage text;
  v_text text := left(btrim(coalesce(p_text, '')), 1000);
  v_endpoint uuid;
begin
  perform set_config('dialvo.workflow', 'on', true);
  select * into v_run from public.workflow_runs r
  where r.id = p_run_id and r.workspace_id = p_workspace_id and r.status = 'running';
  if not found then
    return jsonb_build_object('outcome', 'failed', 'why', 'The run is no longer running.');
  end if;
  select * into v_wf from public.workflows f where f.id = v_run.workflow_id;
  if v_run.lead_id is not null then
    select * into v_lead from public.leads l where l.id = v_run.lead_id and l.workspace_id = p_workspace_id;
  end if;
  if v_action in ('research', 'add_to_play', 'assign', 'set_stage', 'note') and v_lead.id is null then
    return jsonb_build_object('outcome', 'skipped', 'why', 'This event has no lead to act on.');
  end if;

  insert into public.outbound_usage as u (workspace_id, day, workflow_actions)
  values (p_workspace_id, (now() at time zone 'utc')::date, 1)
  on conflict (workspace_id, day) do update
  set workflow_actions = u.workflow_actions + 1
  where u.workflow_actions < p_max_actions
  returning u.workflow_actions into v_taken;
  if v_taken is null then
    return jsonb_build_object('outcome', 'skipped', 'why', 'Today''s limit of workflow actions was reached.');
  end if;

  case v_action
  when 'research' then
    v_r := private.brief_queue(p_workspace_id, null, v_lead.id, 'brief', 'workflow', null, p_max_briefs);
    return case v_r ->> 'status'
      when 'queued' then jsonb_build_object('outcome', 'done', 'why', 'Research asked for; the summary goes on the lead when it is ready.')
      when 'waiting' then jsonb_build_object('outcome', 'skipped', 'why', 'Research for this lead is already being made.')
      else jsonb_build_object('outcome', 'skipped', 'why', 'Today''s limit of research briefs was reached.') end;

  when 'add_to_play' then
    if coalesce(p_step ->> 'campaign_id', '') !~ '^[0-9a-f-]{36}$' then
      return jsonb_build_object('outcome', 'failed', 'why', 'No play was chosen.');
    end if;
    v_r := public.api_play_add_lead(p_workspace_id, (p_step ->> 'campaign_id')::uuid, v_lead.id,
                                    'Added by the workflow "' || v_wf.name || '".');
    return case v_r ->> 'status'
      when 'added' then jsonb_build_object('outcome', 'done', 'why', 'Added to the play. Its email waits for approval under the play''s own rules.')
      when 'already_added' then jsonb_build_object('outcome', 'skipped', 'why', 'Already in that play.')
      when 'no_email' then jsonb_build_object('outcome', 'skipped', 'why', 'The lead has no email address.')
      when 'not_allowed' then jsonb_build_object('outcome', 'skipped', 'why', 'The lead is do not contact, unsubscribed or on your never-contact list.')
      when 'stopped' then jsonb_build_object('outcome', 'skipped', 'why', 'That play isn''t running.')
      when 'not_a_lead_play' then jsonb_build_object('outcome', 'failed', 'why', 'That play works on companies, not leads.')
      else jsonb_build_object('outcome', 'failed', 'why', 'That play no longer exists.') end;

  when 'assign' then
    if p_step ->> 'to' = 'rules' then
      if v_lead.owner_id is not null then
        return jsonb_build_object('outcome', 'skipped', 'why', 'The lead already has an owner.');
      end if;
      v_user := private.route_lead(p_workspace_id, v_lead.id, null);
      return case when v_user is null
        then jsonb_build_object('outcome', 'skipped', 'why', 'No routing rule matched this lead.')
        else jsonb_build_object('outcome', 'done', 'why', 'Routed by your routing rules.') end;
    end if;
    if coalesce(p_step ->> 'user_id', '') !~ '^[0-9a-f-]{36}$' or not exists (
      select 1 from public.workspace_members m
      where m.workspace_id = p_workspace_id and m.user_id = (p_step ->> 'user_id')::uuid) then
      return jsonb_build_object('outcome', 'failed', 'why', 'That teammate isn''t in the workspace any more.');
    end if;
    v_user := (p_step ->> 'user_id')::uuid;
    if v_lead.owner_id = v_user then
      return jsonb_build_object('outcome', 'skipped', 'why', 'The lead already belongs to them.');
    end if;
    update public.leads l set owner_id = v_user where l.id = v_lead.id;
    update public.conversations c set assigned_to = v_user
    where c.workspace_id = p_workspace_id and c.lead_id = v_lead.id and c.status <> 'closed'
      and (c.assigned_to is null or c.assigned_to = v_lead.owner_id);
    insert into public.activity_events (workspace_id, lead_id, kind, summary, metadata)
    values (p_workspace_id, v_lead.id, 'lead_routed',
            'Given to ' || coalesce(nullif((select pf.name from public.profiles pf where pf.id = v_user), ''), 'a teammate')
              || ' by the workflow "' || v_wf.name || '".',
            jsonb_build_object('workflow_id', v_wf.id, 'user_id', v_user));
    insert into public.team_alerts (workspace_id, lead_id, recipient_user_id, kind, summary)
    values (p_workspace_id, v_lead.id, v_user, 'lead_assigned',
            left('Given to you by the workflow "' || v_wf.name || '"'
                 || coalesce('. ' || nullif(btrim(coalesce(v_lead.company, '')), ''), '') || '.', 1000));
    return jsonb_build_object('outcome', 'done', 'why', 'Given to the teammate chosen.');

  when 'set_stage' then
    v_stage := p_step ->> 'stage';
    if v_stage not in ('new', 'engaged', 'qualified', 'meeting_booked', 'won', 'lost') then
      return jsonb_build_object('outcome', 'failed', 'why', 'That stage isn''t one Dialvo has.');
    end if;
    if v_lead.status = 'unsubscribed' then
      return jsonb_build_object('outcome', 'skipped', 'why', 'The lead unsubscribed; their stage stays.');
    end if;
    if v_lead.status = v_stage then
      return jsonb_build_object('outcome', 'skipped', 'why', 'The lead is already at that stage.');
    end if;
    update public.leads l set status = v_stage where l.id = v_lead.id;
    insert into public.activity_events (workspace_id, lead_id, kind, summary, metadata)
    values (p_workspace_id, v_lead.id, 'lead_status_changed',
            'Stage changed to ' || replace(v_stage, '_', ' ') || ' by the workflow "' || v_wf.name || '".',
            jsonb_build_object('workflow_id', v_wf.id, 'from', v_lead.status, 'to', v_stage));
    return jsonb_build_object('outcome', 'done', 'why', 'Stage changed.');

  when 'note' then
    if v_text = '' then
      return jsonb_build_object('outcome', 'failed', 'why', 'The note is empty.');
    end if;
    insert into public.activity_events (workspace_id, lead_id, kind, summary, metadata)
    values (p_workspace_id, v_lead.id, 'workflow_note', v_text, jsonb_build_object('workflow_id', v_wf.id));
    return jsonb_build_object('outcome', 'done', 'why', 'Note added to the lead.');

  when 'task' then
    if v_text = '' then
      return jsonb_build_object('outcome', 'failed', 'why', 'The task has no title.');
    end if;
    v_user := case
      when p_step ->> 'assignee' = 'owner' then v_lead.owner_id
      when coalesce(p_step ->> 'assignee', '') ~ '^[0-9a-f-]{36}$' then (p_step ->> 'assignee')::uuid end;
    if v_user is not null and not exists (
      select 1 from public.workspace_members m where m.workspace_id = p_workspace_id and m.user_id = v_user) then
      v_user := null;
    end if;
    insert into public.workflow_tasks (workspace_id, lead_id, assignee_id, run_id, title, due_at)
    values (p_workspace_id, v_lead.id, v_user, v_run.id, left(v_text, 200),
            case when coalesce(p_step ->> 'due_days', '') ~ '^\d{1,2}$'
                 then now() + make_interval(days => (p_step ->> 'due_days')::integer) end);
    return jsonb_build_object('outcome', 'done',
      'why', case when v_user is null then 'Task created for the team (no one named).' else 'Task created.' end);

  when 'slack' then
    if v_text = '' then
      return jsonb_build_object('outcome', 'failed', 'why', 'The message is empty.');
    end if;
    if private.slack_post_direct(p_workspace_id, 'workflow_post', 'wf:' || v_run.id || ':' || p_index,
         jsonb_build_object('text', v_text, 'workflow', v_wf.name, 'lead_id', v_lead.id)) then
      return jsonb_build_object('outcome', 'done', 'why', 'Queued for Slack.');
    end if;
    return jsonb_build_object('outcome', 'skipped', 'why', 'Slack isn''t connected, or 60 posts this hour were reached.');

  when 'webhook' then
    if coalesce(p_step ->> 'endpoint_id', '') !~ '^[0-9a-f-]{36}$' then
      return jsonb_build_object('outcome', 'failed', 'why', 'No endpoint was chosen.');
    end if;
    select e.id into v_endpoint from public.webhook_endpoints e
    where e.id = (p_step ->> 'endpoint_id')::uuid and e.workspace_id = p_workspace_id and e.status = 'active';
    if v_endpoint is null then
      return jsonb_build_object('outcome', 'skipped', 'why', 'That endpoint is paused, switched off or deleted.');
    end if;
    insert into public.integration_deliveries (workspace_id, target, endpoint_id, event, source_key, payload)
    values (p_workspace_id, 'webhook', v_endpoint, 'workflow.action', 'wf:' || v_run.id || ':' || p_index,
            jsonb_build_object('workflow', jsonb_build_object('id', v_wf.id, 'name', v_wf.name),
                               'run_id', v_run.id, 'trigger', v_run.trigger, 'event', v_run.event,
                               'lead', case when v_lead.id is null then null else private.lead_public_json(v_lead) end))
    on conflict do nothing;
    return jsonb_build_object('outcome', 'done', 'why', 'Queued for your endpoint.');

  else
    return jsonb_build_object('outcome', 'failed', 'why', 'Dialvo doesn''t know that action.');
  end case;
end;
$$;

-- "Run now" on a workflow, by an admin (signed in): one run of a
-- scheduled workflow, or a test run on one lead for the others.
create function public.workflow_run_now(p_workspace_id uuid, p_id uuid, p_lead_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_f public.workflows%rowtype;
  v_n integer;
begin
  if not (select private.is_workspace_admin(p_workspace_id)) then
    return jsonb_build_object('status', 'not_found');
  end if;
  select * into v_f from public.workflows f where f.id = p_id and f.workspace_id = p_workspace_id;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if not v_f.enabled then
    return jsonb_build_object('status', 'off');
  end if;
  if p_lead_id is not null and not exists (
    select 1 from public.leads l where l.id = p_lead_id and l.workspace_id = p_workspace_id) then
    return jsonb_build_object('status', 'not_found');
  end if;
  v_n := private.workflow_enqueue(p_workspace_id, v_f.trigger, p_lead_id,
    jsonb_build_object('summary', 'Run by hand.', 'manual', true),
    'manual:' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint, v_f.id);
  return jsonb_build_object('status', case when v_n > 0 then 'queued' else 'capped' end);
end;
$$;

-- ---------------------------------------------------------------------------
-- The scheduler
-- ---------------------------------------------------------------------------
create function private.workflow_cron_tick()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.workflow_queue_schedules();
  delete from public.workflow_runs r
  where r.status in ('done', 'skipped', 'failed') and r.created_at < now() - interval '60 days';
  if exists (select 1 from public.workflow_runs r
             where r.status = 'pending' or (r.status = 'running' and r.locked_until < now())) then
    perform private.activation_post('workflows');
  end if;
end;
$$;
revoke all on function private.workflow_cron_tick() from public;

revoke all on function public.workflow_save(uuid, uuid, text, text, jsonb, jsonb, jsonb, boolean, integer) from public, anon;
revoke all on function public.workflow_set_enabled(uuid, uuid, boolean) from public, anon;
revoke all on function public.workflow_delete(uuid, uuid) from public, anon;
revoke all on function public.workflow_hook_set(uuid, uuid, text, text) from public, anon;
revoke all on function public.workflow_task_set(uuid, boolean) from public, anon;
revoke all on function public.workflow_run_now(uuid, uuid, uuid) from public, anon;
grant execute on function public.workflow_save(uuid, uuid, text, text, jsonb, jsonb, jsonb, boolean, integer) to authenticated;
grant execute on function public.workflow_set_enabled(uuid, uuid, boolean) to authenticated;
grant execute on function public.workflow_delete(uuid, uuid) to authenticated;
grant execute on function public.workflow_hook_set(uuid, uuid, text, text) to authenticated;
grant execute on function public.workflow_task_set(uuid, boolean) to authenticated;
grant execute on function public.workflow_run_now(uuid, uuid, uuid) to authenticated;

revoke all on function public.workflow_hook_receive(text, jsonb, text) from public, anon, authenticated;
revoke all on function public.workflow_claim(integer, integer) from public, anon, authenticated;
revoke all on function public.workflow_finish(uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.workflow_schedule_leads(uuid, uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.workflow_spawn(uuid, uuid, uuid[], text) from public, anon, authenticated;
revoke all on function public.workflow_act(uuid, uuid, integer, jsonb, text, integer, integer) from public, anon, authenticated;
grant execute on function public.workflow_hook_receive(text, jsonb, text) to service_role;
grant execute on function public.workflow_claim(integer, integer) to service_role;
grant execute on function public.workflow_finish(uuid, uuid, text, jsonb) to service_role;
grant execute on function public.workflow_schedule_leads(uuid, uuid, integer, integer) to service_role;
grant execute on function public.workflow_spawn(uuid, uuid, uuid[], text) to service_role;
grant execute on function public.workflow_act(uuid, uuid, integer, jsonb, text, integer, integer) to service_role;

do $do$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    execute 'create extension if not exists pg_cron with schema pg_catalog';
    execute 'create extension if not exists pg_net with schema extensions';
    execute $job$
      select cron.schedule('dialvo-workflow-steps', '* * * * *', 'select private.workflow_cron_tick()')
    $job$;
  end if;
end;
$do$;
