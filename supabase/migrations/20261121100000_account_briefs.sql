-- Account briefs, closed-lost notes and calendar feeds.
--
--   account_briefs   one brief about a lead's company: facts from its website
--                    and the web, the people, what was said with them, open
--                    questions and talking points, with sources. Made on
--                    demand, before each meeting (or each morning for the
--                    day's meetings), or by a workflow. kind 'closed_lost' is
--                    the short "why we likely lost and what might change"
--                    written when a lead is marked lost.
--   brief_settings   one row per workspace: when briefs are made and where
--                    they go (the app always; the meeting's owner by email;
--                    Slack when connected). No row means the defaults.
--   calendar_feeds   one per person per workspace: a secret iCal (ICS)
--                    address, kept in Vault ('calendar_feed:<id>'), read
--                    every 30 minutes. Events whose attendees include a lead
--                    become that lead's meetings (source 'calendar').
--
-- Additive: new tables; meetings + source, calendar_feed_id, external_uid,
-- attendees; outbound_usage + briefs, calendar_syncs; integration_deliveries
-- and slack posts widened to the new kinds of post (read from the live check
-- and added to, so values other migrations added are kept); the meetings
-- trigger of the integrations migration no longer posts a meeting imported
-- from a calendar (a first import would otherwise post every one).
--
-- The scheduler: pg_cron runs private.brief_cron_tick() every five minutes.
-- It queues the briefs that are due (in the database) and calls the app
-- (POST /api/activation/step?job=briefs, ?job=calendar) only when a brief
-- waits or a feed is due, with the Vault token, like the other schedulers.

-- ---------------------------------------------------------------------------
-- Wider checks on the outbox: new kinds of post
-- ---------------------------------------------------------------------------
do $do$
declare
  r record;
  v_def text;
  v_values text[];
  v_new text[];
begin
  for r in
    select * from (values
      ('public.integration_deliveries', 'integration_deliveries_event_check', 'event',
       array['account_brief', 'workflow_post', 'workflow.action', 'company_news'])
    ) as t(tbl, con, col, extra)
  loop
    select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
    where c.conrelid = r.tbl::regclass and c.conname = r.con;
    -- Never narrow a check that isn't where it is expected to be.
    if v_def is null then
      raise exception 'constraint % on % not found', r.con, r.tbl;
    end if;
    select coalesce(array_agg(m[1]), '{}') into v_values
    from regexp_matches(coalesce(v_def, ''), '''([a-z_.]+)''', 'g') as m;
    select array_agg(distinct x order by x) into v_new from unnest(v_values || r.extra) x;
    execute format('alter table %s drop constraint if exists %I', r.tbl, r.con);
    execute format('alter table %s add constraint %I check (%I = any (%L::text[]))',
                   r.tbl, r.con, r.col, v_new);
  end loop;
end;
$do$;

-- Queues a Slack post a person set up on purpose (a brief, a workflow's
-- "post to Slack"), whatever kinds the connection's settings pick. Still
-- only to an active connection and within 60 posts an hour. Internal.
create function private.slack_post_direct(p_workspace_id uuid, p_event text, p_source_key text, p_payload jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not exists (
    select 1 from public.slack_connections s where s.workspace_id = p_workspace_id and s.status = 'active'
  ) then
    return false;
  end if;
  if (select count(*) from public.integration_deliveries d
      where d.workspace_id = p_workspace_id and d.target = 'slack'
        and d.created_at > now() - interval '1 hour') >= 60 then
    return false;
  end if;
  insert into public.integration_deliveries (workspace_id, target, event, source_key, payload)
  values (p_workspace_id, 'slack', p_event, left(p_source_key, 200), coalesce(p_payload, '{}'::jsonb))
  on conflict do nothing
  returning id into v_id;
  return v_id is not null;
end;
$$;
revoke all on function private.slack_post_direct(uuid, text, text, jsonb) from public;

alter table public.outbound_usage
  add column briefs integer not null default 0,
  add column calendar_syncs integer not null default 0;

-- ---------------------------------------------------------------------------
-- calendar_feeds
-- ---------------------------------------------------------------------------
create table public.calendar_feeds (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null,
  -- The address's host ("calendar.google.com"), to show which calendar it is.
  host text not null check (char_length(host) between 3 and 253),
  -- active. error: the address stopped working (last_error says why).
  status text not null default 'active' check (status in ('active', 'error')),
  last_synced_at timestamptz,
  next_sync_at timestamptz not null default now(),
  locked_until timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 300),
  events_seen integer not null default 0,
  meetings_matched integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (workspace_id, user_id),
  -- A person who leaves the workspace takes their feed with them.
  foreign key (workspace_id, user_id)
    references public.workspace_members (workspace_id, user_id) on delete cascade
);
alter table public.calendar_feeds enable row level security;
create index calendar_feeds_due_idx on public.calendar_feeds (next_sync_at) where status = 'active';
create index calendar_feeds_user_idx on public.calendar_feeds (user_id);

create trigger calendar_feeds_set_updated_at
  before update on public.calendar_feeds
  for each row execute function private.set_updated_at();

alter table public.meetings
  add column source text not null default 'dialvo' check (source in ('dialvo', 'calendar')),
  add column calendar_feed_id uuid,
  add column external_uid text check (external_uid is null or char_length(external_uid) between 1 and 300),
  -- The other people invited, as the calendar lists them: [{ "email", "name" }].
  add column attendees jsonb not null default '[]'::jsonb
    check (jsonb_typeof(attendees) = 'array' and jsonb_array_length(attendees) <= 50),
  add foreign key (calendar_feed_id, workspace_id)
    references public.calendar_feeds (id, workspace_id) on delete set null (calendar_feed_id);
create index meetings_calendar_feed_idx on public.meetings (calendar_feed_id, workspace_id) where calendar_feed_id is not null;
create unique index meetings_calendar_uid_idx on public.meetings (workspace_id, lead_id, external_uid) where external_uid is not null;
create index meetings_upcoming_idx on public.meetings (starts_at) where status = 'scheduled';

-- ---------------------------------------------------------------------------
-- brief_settings
-- ---------------------------------------------------------------------------
create table public.brief_settings (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  -- before: each meeting's brief is made minutes_before it starts. digest:
  -- at digest_hour (the workspace's time zone), briefs for the day's
  -- meetings. off: only on demand.
  mode text not null default 'before' check (mode in ('before', 'digest', 'off')),
  minutes_before integer not null default 120 check (minutes_before between 30 and 1440),
  digest_hour integer not null default 7 check (digest_hour between 0 and 23),
  last_digest_on date,
  email_owner boolean not null default true,
  post_slack boolean not null default true,
  closed_lost boolean not null default true,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.brief_settings enable row level security;
create index brief_settings_updated_by_idx on public.brief_settings (updated_by);

create trigger brief_settings_set_updated_at
  before update on public.brief_settings
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- account_briefs
-- ---------------------------------------------------------------------------
create table public.account_briefs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  lead_id uuid not null,
  meeting_id uuid,
  kind text not null default 'brief' check (kind in ('brief', 'closed_lost')),
  -- What asked for it.
  reason text not null default 'manual' check (reason in ('manual', 'meeting', 'digest', 'workflow', 'lost', 'mcp')),
  -- pending -> running -> ready | failed | skipped (over a cap; error says).
  status text not null default 'pending' check (status in ('pending', 'running', 'ready', 'failed', 'skipped')),
  requested_by uuid references auth.users (id) on delete set null,
  -- The brief itself, as the app shows it (src/lib/briefs/types.ts).
  content jsonb not null default '{}'::jsonb
    check (jsonb_typeof(content) = 'object' and octet_length(content::text) <= 60000),
  -- Two or three sentences, for the timeline, Slack and the email.
  summary text not null default '' check (char_length(summary) <= 1200),
  -- [{ "n", "title", "url" }]: the pages and messages the brief cites.
  sources jsonb not null default '[]'::jsonb check (jsonb_typeof(sources) = 'array' and jsonb_array_length(sources) <= 40),
  error text check (error is null or char_length(error) <= 300),
  attempts integer not null default 0,
  locked_until timestamptz,
  cost_micros bigint not null default 0 check (cost_micros >= 0),
  emailed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ready_at timestamptz,
  unique (id, workspace_id),
  foreign key (lead_id, workspace_id)
    references public.leads (id, workspace_id) on delete cascade,
  foreign key (meeting_id, workspace_id)
    references public.meetings (id, workspace_id) on delete set null (meeting_id)
);
alter table public.account_briefs enable row level security;
create index account_briefs_lead_idx on public.account_briefs (lead_id, workspace_id, created_at desc);
create index account_briefs_meeting_idx on public.account_briefs (meeting_id, workspace_id) where meeting_id is not null;
-- One brief per meeting.
create unique index account_briefs_one_per_meeting_idx on public.account_briefs (meeting_id) where meeting_id is not null;
create index account_briefs_recent_idx on public.account_briefs (workspace_id, created_at desc);
create index account_briefs_due_idx on public.account_briefs (created_at) where status in ('pending', 'running');
create index account_briefs_requested_by_idx on public.account_briefs (requested_by);

create trigger account_briefs_set_updated_at
  before update on public.account_briefs
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Grants and policies. Members read; every write goes through a function.
-- ---------------------------------------------------------------------------
revoke all on public.calendar_feeds, public.brief_settings, public.account_briefs from anon, authenticated;
grant all on public.calendar_feeds, public.brief_settings, public.account_briefs to service_role;
grant select on public.brief_settings, public.account_briefs to authenticated;
-- A feed's row says whose it is and how it is doing; the address is in Vault.
grant select on public.calendar_feeds to authenticated;

create policy "Members read brief settings" on public.brief_settings for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));
create policy "Members read briefs" on public.account_briefs for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));
create policy "Members read calendar feeds" on public.calendar_feeds for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));

-- ---------------------------------------------------------------------------
-- Settings (owners and admins, signed in)
-- ---------------------------------------------------------------------------
create function public.brief_settings_save(
  p_workspace_id uuid, p_mode text, p_minutes_before integer, p_digest_hour integer,
  p_email_owner boolean, p_post_slack boolean, p_closed_lost boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.is_workspace_admin(p_workspace_id)) then
    return false;
  end if;
  if p_mode not in ('before', 'digest', 'off') then
    return false;
  end if;
  insert into public.brief_settings as b (workspace_id, mode, minutes_before, digest_hour,
                                          email_owner, post_slack, closed_lost, updated_by)
  values (p_workspace_id, p_mode, least(greatest(coalesce(p_minutes_before, 120), 30), 1440),
          least(greatest(coalesce(p_digest_hour, 7), 0), 23), coalesce(p_email_owner, true),
          coalesce(p_post_slack, true), coalesce(p_closed_lost, true), (select auth.uid()))
  on conflict (workspace_id) do update
  set mode = excluded.mode, minutes_before = excluded.minutes_before, digest_hour = excluded.digest_hour,
      email_owner = excluded.email_owner, post_slack = excluded.post_slack,
      closed_lost = excluded.closed_lost, updated_by = excluded.updated_by;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Asking for a brief
-- ---------------------------------------------------------------------------

-- Queues one brief, counted against the day's cap. A brief of the same kind
-- for the same lead that is already waiting is returned instead of a second.
-- p_user_id: the member who asked (checked here), or null for the scheduler,
-- a workflow or a key the caller already checked.
--   { "status": "queued" | "waiting", "id" } | { "status": "capped" | "not_found" }
create function private.brief_queue(
  p_workspace_id uuid, p_user_id uuid, p_lead_id uuid, p_kind text, p_reason text,
  p_meeting_id uuid, p_max_per_day integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_taken integer;
begin
  if not exists (select 1 from public.leads l where l.id = p_lead_id and l.workspace_id = p_workspace_id) then
    return jsonb_build_object('status', 'not_found');
  end if;
  if p_meeting_id is not null and not exists (
    select 1 from public.meetings m where m.id = p_meeting_id and m.workspace_id = p_workspace_id and m.lead_id = p_lead_id
  ) then
    return jsonb_build_object('status', 'not_found');
  end if;
  select b.id into v_id from public.account_briefs b
  where b.workspace_id = p_workspace_id and b.lead_id = p_lead_id and b.kind = p_kind
    and b.status in ('pending', 'running')
  limit 1;
  if v_id is not null then
    return jsonb_build_object('status', 'waiting', 'id', v_id);
  end if;
  if p_meeting_id is not null then
    select b.id into v_id from public.account_briefs b where b.meeting_id = p_meeting_id;
    if v_id is not null then
      return jsonb_build_object('status', 'waiting', 'id', v_id);
    end if;
  end if;
  insert into public.outbound_usage as u (workspace_id, day, briefs)
  values (p_workspace_id, (now() at time zone 'utc')::date, 1)
  on conflict (workspace_id, day) do update
  set briefs = u.briefs + 1
  where u.briefs < p_max_per_day
  returning u.briefs into v_taken;
  if v_taken is null or coalesce(p_max_per_day, 0) <= 0 then
    return jsonb_build_object('status', 'capped');
  end if;
  insert into public.account_briefs (workspace_id, lead_id, meeting_id, kind, reason, requested_by)
  values (p_workspace_id, p_lead_id, p_meeting_id, p_kind, p_reason, p_user_id)
  returning id into v_id;
  return jsonb_build_object('status', 'queued', 'id', v_id);
end;
$$;
revoke all on function private.brief_queue(uuid, uuid, uuid, text, text, uuid, integer) from public;

-- The server, for a member who pressed "Make a brief" (or a key's request).
create function public.brief_request(
  p_workspace_id uuid, p_user_id uuid, p_lead_id uuid, p_kind text, p_reason text, p_max_per_day integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is not null and not exists (
    select 1 from public.workspace_members m where m.workspace_id = p_workspace_id and m.user_id = p_user_id
  ) then
    return jsonb_build_object('status', 'not_found');
  end if;
  if p_kind not in ('brief', 'closed_lost') or p_reason not in ('manual', 'workflow', 'mcp') then
    return jsonb_build_object('status', 'not_found');
  end if;
  return private.brief_queue(p_workspace_id, p_user_id, p_lead_id, p_kind, p_reason, null, p_max_per_day);
end;
$$;

-- When a lead is marked lost, a closed-lost note is queued, if the
-- workspace wants them and there is a conversation or call to read. Never
-- gets in the way of the change itself.
create function private.briefs_on_lead_lost()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'lost' and old.status is distinct from 'lost'
     and coalesce((select b.closed_lost from public.brief_settings b where b.workspace_id = new.workspace_id), true)
     and (exists (select 1 from public.conversations c
                  join public.messages m on m.conversation_id = c.id and m.workspace_id = c.workspace_id
                  where c.lead_id = new.id and c.workspace_id = new.workspace_id)
          or exists (select 1 from public.calls k where k.lead_id = new.id and k.workspace_id = new.workspace_id)) then
    perform private.brief_queue(new.workspace_id, null, new.id, 'closed_lost', 'lost', null, 40);
  end if;
  return null;
exception when others then
  return null;
end;
$$;
revoke all on function private.briefs_on_lead_lost() from public;

create trigger leads_closed_lost_brief
  after update of status on public.leads
  for each row execute function private.briefs_on_lead_lost();

-- Queues the briefs meetings need now: in 'before' mode each scheduled
-- meeting starting within minutes_before; in 'digest' mode, once a day at
-- digest_hour in the workspace's time zone, the rest of that day's meetings.
create function private.brief_queue_due(p_max_per_day integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  m record;
  w record;
  v_count integer := 0;
  v_today date;
begin
  for m in
    select mt.id, mt.workspace_id, mt.lead_id
    from public.meetings mt
    left join public.brief_settings b on b.workspace_id = mt.workspace_id
    where mt.status = 'scheduled' and coalesce(b.mode, 'before') = 'before'
      and mt.starts_at > now()
      and mt.starts_at <= now() + make_interval(mins => coalesce(b.minutes_before, 120))
      and not exists (select 1 from public.account_briefs x where x.meeting_id = mt.id)
    order by mt.starts_at
    limit 200
  loop
    if (private.brief_queue(m.workspace_id, null, m.lead_id, 'brief', 'meeting', m.id, p_max_per_day) ->> 'status') = 'queued' then
      v_count := v_count + 1;
    end if;
  end loop;

  for w in
    select b.workspace_id, b.digest_hour, ws.timezone
    from public.brief_settings b
    join public.workspaces ws on ws.id = b.workspace_id
    where b.mode = 'digest'
    for update of b skip locked
  loop
    begin
      v_today := (now() at time zone w.timezone)::date;
      continue when extract(hour from now() at time zone w.timezone) < w.digest_hour;
    exception when others then
      v_today := (now() at time zone 'utc')::date;
      continue when extract(hour from now() at time zone 'utc') < w.digest_hour;
    end;
    continue when exists (select 1 from public.brief_settings b
                          where b.workspace_id = w.workspace_id and b.last_digest_on >= v_today);
    update public.brief_settings b set last_digest_on = v_today where b.workspace_id = w.workspace_id;
    for m in
      select mt.id, mt.lead_id from public.meetings mt
      where mt.workspace_id = w.workspace_id and mt.status = 'scheduled'
        and mt.starts_at > now() and mt.starts_at < now() + interval '24 hours'
        and (mt.starts_at at time zone coalesce(nullif(w.timezone, ''), 'UTC'))::date = v_today
        and not exists (select 1 from public.account_briefs x where x.meeting_id = mt.id)
      order by mt.starts_at
      limit 50
    loop
      if (private.brief_queue(w.workspace_id, null, m.lead_id, 'brief', 'digest', m.id, p_max_per_day) ->> 'status') = 'queued' then
        v_count := v_count + 1;
      end if;
    end loop;
  end loop;
  return v_count;
end;
$$;
revoke all on function private.brief_queue_due(integer) from public;

-- ---------------------------------------------------------------------------
-- Making briefs (secret key only)
-- ---------------------------------------------------------------------------

-- Claims briefs that wait, under a lease. A workspace whose model spend for
-- today has reached p_max_cost_micros has its waiting briefs skipped, with
-- the reason, rather than left to wait.
create function public.brief_claim(p_limit integer, p_lease_seconds integer, p_max_cost_micros bigint, p_max_attempts integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_out jsonb := '[]'::jsonb;
  b record;
begin
  update public.account_briefs x
  set status = 'skipped', error = 'Today''s spending limit for research was reached. Ask again tomorrow.', locked_until = null
  where x.status = 'pending'
    and (private.outbound_usage_json(x.workspace_id) ->> 'cost_micros')::bigint >= p_max_cost_micros;
  update public.account_briefs x
  set status = 'failed', error = coalesce(x.error, 'It couldn''t be made.'), locked_until = null
  where x.status = 'running' and x.locked_until < now() and x.attempts >= p_max_attempts;

  for b in
    select x.id, x.workspace_id from public.account_briefs x
    where (x.status = 'pending' or (x.status = 'running' and x.locked_until < now()))
    order by x.created_at
    limit greatest(least(p_limit, 20), 0)
    for update of x skip locked
  loop
    update public.account_briefs x
    set status = 'running', attempts = x.attempts + 1,
        locked_until = now() + make_interval(secs => greatest(p_lease_seconds, 30))
    where x.id = b.id;
    v_out := v_out || jsonb_build_object('id', b.id, 'workspace_id', b.workspace_id);
  end loop;
  return v_out;
end;
$$;

-- Everything a brief is written from, for one claimed brief: the
-- workspace, the lead and its company research, the meeting, the last 60
-- messages on every channel, calls, meetings and notes. Nothing of another
-- workspace can be reached: every read names the brief's own workspace.
create function public.brief_context(p_workspace_id uuid, p_brief_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'brief', jsonb_build_object('id', b.id, 'kind', b.kind, 'reason', b.reason),
    'workspace', jsonb_build_object('name', w.name, 'website', w.website, 'timezone', w.timezone),
    'knowledge', coalesce((
      select string_agg(left(k.title || E'\n' || k.content, 1500), E'\n\n')
      from (select k.title, k.content from public.knowledge_items k
            where k.workspace_id = p_workspace_id order by k.created_at limit 6) k), ''),
    'lead', jsonb_build_object(
      'id', l.id, 'name', l.name, 'email', l.email, 'phone', l.phone, 'company', l.company,
      'website', l.website, 'source', l.source, 'status', l.status, 'created_at', l.created_at,
      'custom_fields', l.custom_fields,
      'owner', (select jsonb_build_object('id', p.id, 'name', p.name) from public.profiles p where p.id = l.owner_id)),
    'research', (
      select jsonb_build_object('summary', pr.summary, 'contact_role', pr.contact_role, 'facts', pr.facts,
                                'website', pr.website, 'country', pr.country, 'size_range', pr.size_range)
      from public.prospects pr
      where pr.workspace_id = p_workspace_id and pr.lead_id = l.id
      order by pr.created_at desc limit 1),
    'meeting', (
      select jsonb_build_object('id', m.id, 'title', m.title, 'starts_at', m.starts_at, 'ends_at', m.ends_at,
                                'attendees', m.attendees,
                                'host', (select jsonb_build_object('id', p.id, 'name', p.name) from public.profiles p where p.id = m.host_id))
      from public.meetings m where m.id = b.meeting_id and m.workspace_id = p_workspace_id),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object('name', o.name, 'email', o.email, 'company', o.company, 'status', o.status))
      from (select o.name, o.email, o.company, o.status from public.leads o
            where o.workspace_id = p_workspace_id and o.id <> l.id
              and ((private.site_domain(l.website) is not null and private.site_domain(o.website) = private.site_domain(l.website))
                   or (l.email is not null and o.email is not null
                       and split_part(o.email, '@', 2) = split_part(l.email, '@', 2)
                       and split_part(l.email, '@', 2) not in ('gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com', 'proton.me')))
            order by o.created_at limit 10) o), '[]'::jsonb),
    'messages', coalesce((
      select jsonb_agg(x order by x ->> 'at')
      from (select jsonb_build_object('at', m.sent_at, 'channel', c.channel, 'from', m.author,
                                      'body', left(m.body, 1200)) as x
            from public.messages m
            join public.conversations c on c.id = m.conversation_id and c.workspace_id = m.workspace_id
            where c.workspace_id = p_workspace_id and c.lead_id = l.id
            order by m.sent_at desc limit 60) t), '[]'::jsonb),
    'calls', coalesce((
      select jsonb_agg(jsonb_build_object('at', k.started_at, 'direction', k.direction, 'status', k.status,
                                          'summary', left(coalesce(k.summary, ''), 1500)))
      from (select * from public.calls k where k.workspace_id = p_workspace_id and k.lead_id = l.id
            order by k.created_at desc limit 10) k), '[]'::jsonb),
    'meetings', coalesce((
      select jsonb_agg(jsonb_build_object('title', m.title, 'starts_at', m.starts_at, 'status', m.status))
      from (select * from public.meetings m where m.workspace_id = p_workspace_id and m.lead_id = l.id
            order by m.starts_at desc limit 10) m), '[]'::jsonb),
    'notes', coalesce((
      select jsonb_agg(jsonb_build_object('at', e.created_at, 'kind', e.kind, 'text', left(e.summary, 800)))
      from (select * from public.activity_events e
            where e.workspace_id = p_workspace_id and e.lead_id = l.id
              and e.kind in ('note', 'lead_status_changed', 'lead_created', 'lead_captured', 'company_news', 'workflow_note')
            order by e.created_at desc limit 20) e), '[]'::jsonb)
  )
  from public.account_briefs b
  join public.workspaces w on w.id = b.workspace_id
  join public.leads l on l.id = b.lead_id and l.workspace_id = b.workspace_id
  where b.id = p_brief_id and b.workspace_id = p_workspace_id;
$$;

-- What happened to one claimed brief. A ready brief goes on the lead's
-- timeline, is posted to Slack when the workspace wants that, and the
-- answer says who to email it to (the meeting's host, else the lead's
-- owner, else whoever asked), when the workspace wants that.
--   { "status": "ready" | "failed" | "pending", "email": { "to", "name" } | null }
create function public.brief_finish(
  p_workspace_id uuid, p_brief_id uuid, p_ok boolean, p_content jsonb, p_summary text,
  p_sources jsonb, p_error text, p_cost_micros bigint, p_max_attempts integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b public.account_briefs%rowtype;
  v_l public.leads%rowtype;
  v_s public.brief_settings%rowtype;
  v_to uuid;
  v_email jsonb;
  v_status text;
begin
  select * into v_b from public.account_briefs x
  where x.id = p_brief_id and x.workspace_id = p_workspace_id and x.status = 'running' for update;
  if not found then
    return jsonb_build_object('status', 'ignored');
  end if;
  perform private.outbound_usage_add(p_workspace_id, greatest(coalesce(p_cost_micros, 0), 0), 0, 0);
  if not coalesce(p_ok, false) then
    v_status := case when v_b.attempts < p_max_attempts then 'pending' else 'failed' end;
    update public.account_briefs x
    set status = v_status, error = left(coalesce(p_error, 'It couldn''t be made.'), 300), locked_until = null,
        cost_micros = x.cost_micros + greatest(coalesce(p_cost_micros, 0), 0)
    where x.id = v_b.id;
    return jsonb_build_object('status', v_status, 'email', null);
  end if;
  update public.account_briefs x
  set status = 'ready', content = coalesce(p_content, '{}'::jsonb), summary = left(coalesce(p_summary, ''), 1200),
      sources = coalesce(p_sources, '[]'::jsonb), error = null, locked_until = null, ready_at = now(),
      cost_micros = x.cost_micros + greatest(coalesce(p_cost_micros, 0), 0)
  where x.id = v_b.id;
  select * into v_l from public.leads l where l.id = v_b.lead_id and l.workspace_id = p_workspace_id;
  select * into v_s from public.brief_settings s where s.workspace_id = p_workspace_id;

  insert into public.activity_events (workspace_id, lead_id, kind, summary, metadata)
  values (p_workspace_id, v_b.lead_id,
          case v_b.kind when 'closed_lost' then 'closed_lost_note' else 'account_brief' end,
          left(case v_b.kind when 'closed_lost' then 'Why this was likely lost: ' else 'Account brief: ' end
               || coalesce(nullif(btrim(p_summary), ''), 'ready.'), 5000),
          jsonb_build_object('brief_id', v_b.id));

  if coalesce(v_s.post_slack, true) then
    perform private.slack_post_direct(p_workspace_id, 'account_brief', 'brief:' || v_b.id,
      jsonb_build_object('brief_id', v_b.id, 'kind', v_b.kind, 'summary', left(coalesce(p_summary, ''), 600),
                         'lead_id', v_l.id,
                         'lead', jsonb_build_object('name', v_l.name, 'email', v_l.email, 'company', v_l.company),
                         'starts_at', (select m.starts_at from public.meetings m where m.id = v_b.meeting_id)));
  end if;

  if coalesce(v_s.email_owner, true) then
    select coalesce(
      (select m.host_id from public.meetings m where m.id = v_b.meeting_id and m.workspace_id = p_workspace_id),
      v_l.owner_id, v_b.requested_by) into v_to;
    select jsonb_build_object('to', p.email, 'name', p.name) into v_email
    from public.profiles p
    join public.workspace_members wm on wm.user_id = p.id and wm.workspace_id = p_workspace_id
    where p.id = v_to and p.email is not null;
  end if;
  return jsonb_build_object('status', 'ready', 'email', v_email);
end;
$$;

create function public.brief_mark_emailed(p_workspace_id uuid, p_brief_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.account_briefs x set emailed_at = now()
  where x.id = p_brief_id and x.workspace_id = p_workspace_id;
$$;

-- ---------------------------------------------------------------------------
-- Calendar feeds
-- ---------------------------------------------------------------------------

-- Saves a person's feed (the server checked the address answers with a
-- calendar first). The address goes to Vault; the row keeps its host.
--   { "status": "saved", "id" } | { "status": "not_found" | "invalid" }
create function public.calendar_feed_save(p_workspace_id uuid, p_user_id uuid, p_url text, p_host text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_secret uuid;
begin
  if not exists (
    select 1 from public.workspace_members m where m.workspace_id = p_workspace_id and m.user_id = p_user_id
  ) then
    return jsonb_build_object('status', 'not_found');
  end if;
  if coalesce(p_url, '') !~ '^https://[^\s/?#@]+(/[^\s]*)?$' or char_length(p_url) > 1000
     or coalesce(p_host, '') !~ '^[a-z0-9.-]{3,253}$' then
    return jsonb_build_object('status', 'invalid');
  end if;
  insert into public.calendar_feeds as f (workspace_id, user_id, host)
  values (p_workspace_id, p_user_id, p_host)
  on conflict (workspace_id, user_id) do update
  set host = excluded.host, status = 'active', last_error = null, next_sync_at = now(), locked_until = null
  returning f.id into v_id;
  select s.id into v_secret from vault.secrets s where s.name = 'calendar_feed:' || v_id;
  if v_secret is null then
    perform vault.create_secret(p_url, 'calendar_feed:' || v_id, 'A Dialvo user''s secret calendar (ICS) address.');
  else
    perform vault.update_secret(v_secret, p_url);
  end if;
  return jsonb_build_object('status', 'saved', 'id', v_id);
end;
$$;

-- A person removes their own feed (signed in). Meetings already imported stay.
create function public.calendar_feed_remove(p_workspace_id uuid)
returns boolean
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
  delete from public.calendar_feeds f
  where f.workspace_id = p_workspace_id and f.user_id = v_user
  returning f.id into v_id;
  if v_id is null then
    return false;
  end if;
  delete from vault.secrets s where s.name = 'calendar_feed:' || v_id;
  return true;
end;
$$;

-- Claims feeds that are due, with their addresses.
create function public.calendar_claim(p_limit integer, p_lease_seconds integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_out jsonb := '[]'::jsonb;
  f record;
begin
  for f in
    select x.id, x.workspace_id, x.user_id from public.calendar_feeds x
    where x.status = 'active' and x.next_sync_at <= now()
      and (x.locked_until is null or x.locked_until < now())
    order by x.next_sync_at
    limit greatest(least(p_limit, 50), 0)
    for update of x skip locked
  loop
    update public.calendar_feeds x
    set locked_until = now() + make_interval(secs => greatest(p_lease_seconds, 30))
    where x.id = f.id;
    v_out := v_out || jsonb_build_object(
      'id', f.id, 'workspace_id', f.workspace_id, 'user_id', f.user_id,
      'url', (select s.decrypted_secret from vault.decrypted_secrets s where s.name = 'calendar_feed:' || f.id),
      'own_emails', coalesce((
        select jsonb_agg(p.email) from public.workspace_members m
        join public.profiles p on p.id = m.user_id
        where m.workspace_id = f.workspace_id and p.email is not null), '[]'::jsonb));
  end loop;
  return v_out;
end;
$$;

-- What one read of a feed found. Each event:
--   { "uid", "title", "starts_at", "ends_at", "cancelled", "attendees": [{ "email", "name" }] }
-- An event becomes (or updates) a meeting for each lead of the workspace
-- among its attendees, hosted by the feed's owner; nothing is made for an
-- event with no lead. At most p_max_meetings new meetings a read.
--   { "seen", "matched", "added", "updated" }
create function public.calendar_ingest(
  p_feed_id uuid, p_workspace_id uuid, p_events jsonb, p_max_meetings integer, p_next_minutes integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_f public.calendar_feeds%rowtype;
  e jsonb;
  v_lead uuid;
  v_seen integer := 0;
  v_matched integer := 0;
  v_added integer := 0;
  v_updated integer := 0;
  v_start timestamptz;
  v_end timestamptz;
  v_status text;
  v_uid text;
  v_existing uuid;
begin
  select * into v_f from public.calendar_feeds x where x.id = p_feed_id and x.workspace_id = p_workspace_id for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  for e in select * from jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) limit 1000
  loop
    v_seen := v_seen + 1;
    begin
      v_start := (e ->> 'starts_at')::timestamptz;
      v_end := (e ->> 'ends_at')::timestamptz;
    exception when others then
      continue;
    end;
    continue when v_start is null or v_end is null or v_end <= v_start;
    v_uid := left(coalesce(e ->> 'uid', ''), 300);
    continue when v_uid = '';
    v_status := case when coalesce((e ->> 'cancelled')::boolean, false) then 'cancelled' else 'scheduled' end;
    for v_lead in
      select distinct l.id from public.leads l
      where l.workspace_id = p_workspace_id and l.email is not null
        and l.email in (select lower(btrim(a ->> 'email')) from jsonb_array_elements(coalesce(e -> 'attendees', '[]'::jsonb)) a)
      limit 5
    loop
      v_matched := v_matched + 1;
      select m.id into v_existing from public.meetings m
      where m.workspace_id = p_workspace_id and m.lead_id = v_lead and m.external_uid = v_uid;
      if v_existing is not null then
        update public.meetings m
        set title = left(coalesce(e ->> 'title', m.title), 200), starts_at = v_start, ends_at = v_end,
            status = case when m.status in ('completed', 'no_show') then m.status else v_status end,
            attendees = coalesce((select jsonb_agg(jsonb_build_object('email', left(a ->> 'email', 254), 'name', left(coalesce(a ->> 'name', ''), 120)))
                                  from (select a from jsonb_array_elements(coalesce(e -> 'attendees', '[]'::jsonb)) a limit 50) t), '[]'::jsonb)
        where m.id = v_existing
          and (m.starts_at, m.ends_at, m.title, m.status) is distinct from (v_start, v_end, left(coalesce(e ->> 'title', m.title), 200), v_status);
        if found then
          v_updated := v_updated + 1;
        end if;
      elsif v_status = 'scheduled' and v_added < p_max_meetings then
        insert into public.meetings (workspace_id, lead_id, title, starts_at, ends_at, booked_by, host_id,
                                     status, source, calendar_feed_id, external_uid, attendees)
        values (p_workspace_id, v_lead, left(coalesce(e ->> 'title', ''), 200), v_start, v_end, 'user', v_f.user_id,
                'scheduled', 'calendar', v_f.id, v_uid,
                coalesce((select jsonb_agg(jsonb_build_object('email', left(a ->> 'email', 254), 'name', left(coalesce(a ->> 'name', ''), 120)))
                          from (select a from jsonb_array_elements(coalesce(e -> 'attendees', '[]'::jsonb)) a limit 50) t), '[]'::jsonb))
        on conflict do nothing;
        if found then
          v_added := v_added + 1;
        end if;
      end if;
      v_existing := null;
    end loop;
  end loop;
  update public.calendar_feeds x
  set last_synced_at = now(), locked_until = null, last_error = null, status = 'active',
      next_sync_at = now() + make_interval(mins => greatest(coalesce(p_next_minutes, 30), 10)),
      events_seen = v_seen, meetings_matched = v_matched
  where x.id = v_f.id;
  insert into public.outbound_usage as u (workspace_id, day, calendar_syncs)
  values (p_workspace_id, (now() at time zone 'utc')::date, 1)
  on conflict (workspace_id, day) do update set calendar_syncs = u.calendar_syncs + 1;
  return jsonb_build_object('status', 'ok', 'seen', v_seen, 'matched', v_matched, 'added', v_added, 'updated', v_updated);
end;
$$;

-- A read that failed. p_gone: the address answered 401, 403, 404 or 410,
-- so it stops being read until the person saves it again.
create function public.calendar_fail(p_feed_id uuid, p_workspace_id uuid, p_error text, p_gone boolean, p_next_minutes integer)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.calendar_feeds x
  set locked_until = null, last_error = left(coalesce(p_error, 'It couldn''t be read.'), 300),
      status = case when coalesce(p_gone, false) then 'error' else x.status end,
      next_sync_at = now() + make_interval(mins => greatest(coalesce(p_next_minutes, 30), 10))
  where x.id = p_feed_id and x.workspace_id = p_workspace_id;
$$;

-- Meetings imported from a calendar are not posted as "meeting booked"
-- (the first import of a calendar would post every one). Otherwise exactly
-- as the integrations migration wrote it.
create or replace function private.integrations_on_meeting()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead record;
  v_data jsonb;
begin
  if new.status <> 'scheduled' or new.source = 'calendar' then
    return new;
  end if;
  select l.id, l.name, l.email, l.company into v_lead from public.leads l
  where l.id = new.lead_id and l.workspace_id = new.workspace_id;
  v_data := jsonb_build_object(
    'id', new.id, 'title', new.title, 'starts_at', new.starts_at, 'ends_at', new.ends_at,
    'booked_by', new.booked_by, 'channel', new.channel, 'lead_id', new.lead_id,
    'lead', jsonb_build_object('name', v_lead.name, 'email', v_lead.email, 'company', v_lead.company)
  );
  perform private.webhook_enqueue(new.workspace_id, 'meeting.booked', 'meeting:' || new.id, v_data);
  perform private.slack_enqueue(new.workspace_id, 'meeting_booked', 'meeting:' || new.id, v_data);
  return new;
exception when others then
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- The scheduler
-- ---------------------------------------------------------------------------
create function private.activation_post(p_job text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_token text;
begin
  select s.decrypted_secret into v_url from vault.decrypted_secrets s where s.name = 'dialvo_app_url';
  select s.decrypted_secret into v_token from vault.decrypted_secrets s where s.name = 'dialvo_cron_token';
  if v_url is null or v_token is null then
    return;
  end if;
  -- By name through execute, so this can be created where pg_net doesn't
  -- exist (the in-memory Postgres the tests run on).
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := $4)'
  using rtrim(v_url, '/') || '/api/activation/step?job=' || p_job, '{}'::jsonb,
        jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_token),
        58000;
end;
$$;
revoke all on function private.activation_post(text) from public;

-- What a tick asks the app to do. The cap here is the same number as
-- BRIEFS_PER_DAY in src/lib/briefs/config.ts.
create function private.brief_due_work()
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_jobs text[] := '{}';
begin
  perform private.brief_queue_due(40);
  if exists (select 1 from public.account_briefs b
             where b.status = 'pending' or (b.status = 'running' and b.locked_until < now())) then
    v_jobs := array_append(v_jobs, 'briefs');
  end if;
  if exists (select 1 from public.calendar_feeds f
             where f.status = 'active' and f.next_sync_at <= now()
               and (f.locked_until is null or f.locked_until < now())) then
    v_jobs := array_append(v_jobs, 'calendar');
  end if;
  return v_jobs;
end;
$$;
revoke all on function private.brief_due_work() from public;

create function private.brief_cron_tick()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job text;
begin
  foreach v_job in array private.brief_due_work()
  loop
    perform private.activation_post(v_job);
  end loop;
end;
$$;
revoke all on function private.brief_cron_tick() from public;

-- ---------------------------------------------------------------------------
-- Function grants
-- ---------------------------------------------------------------------------
revoke all on function public.brief_settings_save(uuid, text, integer, integer, boolean, boolean, boolean) from public, anon;
grant execute on function public.brief_settings_save(uuid, text, integer, integer, boolean, boolean, boolean) to authenticated;
revoke all on function public.calendar_feed_remove(uuid) from public, anon;
grant execute on function public.calendar_feed_remove(uuid) to authenticated;

revoke all on function public.brief_request(uuid, uuid, uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public.brief_claim(integer, integer, bigint, integer) from public, anon, authenticated;
revoke all on function public.brief_context(uuid, uuid) from public, anon, authenticated;
revoke all on function public.brief_finish(uuid, uuid, boolean, jsonb, text, jsonb, text, bigint, integer) from public, anon, authenticated;
revoke all on function public.brief_mark_emailed(uuid, uuid) from public, anon, authenticated;
revoke all on function public.calendar_feed_save(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.calendar_claim(integer, integer) from public, anon, authenticated;
revoke all on function public.calendar_ingest(uuid, uuid, jsonb, integer, integer) from public, anon, authenticated;
revoke all on function public.calendar_fail(uuid, uuid, text, boolean, integer) from public, anon, authenticated;
grant execute on function public.brief_request(uuid, uuid, uuid, text, text, integer) to service_role;
grant execute on function public.brief_claim(integer, integer, bigint, integer) to service_role;
grant execute on function public.brief_context(uuid, uuid) to service_role;
grant execute on function public.brief_finish(uuid, uuid, boolean, jsonb, text, jsonb, text, bigint, integer) to service_role;
grant execute on function public.brief_mark_emailed(uuid, uuid) to service_role;
grant execute on function public.calendar_feed_save(uuid, uuid, text, text) to service_role;
grant execute on function public.calendar_claim(integer, integer) to service_role;
grant execute on function public.calendar_ingest(uuid, uuid, jsonb, integer, integer) to service_role;
grant execute on function public.calendar_fail(uuid, uuid, text, boolean, integer) to service_role;

-- The job itself. Skipped where pg_cron doesn't exist.
do $do$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    execute 'create extension if not exists pg_cron with schema pg_catalog';
    execute 'create extension if not exists pg_net with schema extensions';
    execute $job$
      select cron.schedule('dialvo-brief-steps', '*/5 * * * *', 'select private.brief_cron_tick()')
    $job$;
  end if;
end;
$do$;
