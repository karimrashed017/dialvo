-- Lead routing: rules that give a lead (and its conversations) to a
-- teammate, and tell that person. Additive.
--
--   routing_rules           in order, the first rule a lead matches wins.
--                           What it matches (all of what is set): country,
--                           company size, where the lead came from, the play
--                           that wrote to them. Who gets it: one teammate, or
--                           several in turn (round robin). Members read;
--                           owners and admins save.
--   routing_rule_assignees  the teammates of a rule, each a member of the
--                           workspace (a composite key to workspace_members,
--                           so a rule can't name someone from elsewhere, and
--                           a person who leaves is taken off every rule).
--   routing                 a new lead with no owner is routed when it is
--                           added; one still without an owner is routed again
--                           when its first email thread starts (then the play
--                           is known). A new conversation with a lead that
--                           has an owner is assigned to that owner.
--   team_alerts             + lead_id, recipient_user_id: an alert for one
--                           person ("a lead was routed to you"), and the
--                           kinds lead_assigned, meeting_booked and
--                           mailbox_health. mail_claim_team_alerts sends a
--                           personal alert only to that person.
--
-- Country and size come from what Dialvo knows about the lead's company:
-- the research of the company it was found as (Find leads), or the lead's
-- own fields (custom_fields.country, custom_fields.company_size or
-- custom_fields.employees, e.g. from an import).

create table public.routing_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  position integer not null default 0 check (position between 0 and 1000),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  enabled boolean not null default true,
  -- { "countries": [...], "size_min": n | null, "size_max": n | null,
  --   "sources": [...], "plays": [...] }. Missing or empty: any.
  match jsonb not null default '{}'::jsonb check (jsonb_typeof(match) = 'object'),
  -- one: always the first teammate listed. round_robin: each in turn.
  mode text not null default 'one' check (mode in ('one', 'round_robin')),
  rr_next integer not null default 0 check (rr_next >= 0),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id)
);
alter table public.routing_rules enable row level security;
create index routing_rules_workspace_idx on public.routing_rules (workspace_id, position);
create index routing_rules_created_by_idx on public.routing_rules (created_by);
create index routing_rules_updated_by_idx on public.routing_rules (updated_by);
create trigger routing_rules_set_updated_at
  before update on public.routing_rules
  for each row execute function private.set_updated_at();

create table public.routing_rule_assignees (
  rule_id uuid not null,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (rule_id, user_id),
  foreign key (rule_id, workspace_id)
    references public.routing_rules (id, workspace_id) on delete cascade,
  foreign key (workspace_id, user_id)
    references public.workspace_members (workspace_id, user_id) on delete cascade
);
alter table public.routing_rule_assignees enable row level security;
create index routing_rule_assignees_rule_idx on public.routing_rule_assignees (rule_id, workspace_id, position);
create index routing_rule_assignees_member_idx on public.routing_rule_assignees (workspace_id, user_id);

revoke all on public.routing_rules, public.routing_rule_assignees from anon, authenticated;
grant all on public.routing_rules, public.routing_rule_assignees to service_role;
grant select on public.routing_rules, public.routing_rule_assignees to authenticated;
create policy "Members read routing rules" on public.routing_rules for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));
create policy "Members read routing assignees" on public.routing_rule_assignees for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));

-- Whether a rule's match is well formed. Internal; used by the save.
create function private.routing_match_ok(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p) = 'object'
    and not exists (
      select 1 from unnest(array['countries', 'sources', 'plays']) k
      where p ? k and (
        jsonb_typeof(p -> k) <> 'array' or jsonb_array_length(p -> k) > 30
        or exists (select 1 from jsonb_array_elements(p -> k) v
                   where jsonb_typeof(v) <> 'string' or char_length(v #>> '{}') not between 1 and 80)))
    and not exists (
      select 1 from unnest(array['size_min', 'size_max']) k
      where p ? k and jsonb_typeof(p -> k) <> 'null' and (
        jsonb_typeof(p -> k) <> 'number' or (p ->> k)::numeric not between 1 and 10000000))
    and (jsonb_typeof(p -> 'size_min') is distinct from 'number'
         or jsonb_typeof(p -> 'size_max') is distinct from 'number'
         or (p ->> 'size_min')::numeric <= (p ->> 'size_max')::numeric);
$$;
revoke all on function private.routing_match_ok(jsonb) from public;

-- Saves a rule and its teammates, for an owner or admin, signed in. p_id
-- null makes a new one (at most 30). Every teammate must be a member.
create function public.routing_rule_save(
  p_workspace_id uuid, p_id uuid, p_name text, p_enabled boolean, p_position integer,
  p_match jsonb, p_mode text, p_assignees uuid[]
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
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 80
     or not private.routing_match_ok(coalesce(p_match, 'null'::jsonb))
     or coalesce(p_mode, '') not in ('one', 'round_robin')
     or coalesce(p_position, -1) not between 0 and 1000
     or coalesce(cardinality(p_assignees), 0) not between 1 and 20 then
    raise exception 'those settings are out of range' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(p_assignees) a(u)
    where not exists (select 1 from public.workspace_members m
                      where m.workspace_id = p_workspace_id and m.user_id = a.u)) then
    raise exception 'everyone on a rule must be in the workspace' using errcode = '22023';
  end if;
  if p_id is null then
    perform 1 from public.workspaces w where w.id = p_workspace_id for update;
    if (select count(*) from public.routing_rules r where r.workspace_id = p_workspace_id) >= 30 then
      raise exception 'too many rules' using errcode = 'P0001';
    end if;
    insert into public.routing_rules (workspace_id, position, name, enabled, match, mode, created_by, updated_by)
    values (p_workspace_id, p_position, btrim(p_name), coalesce(p_enabled, true), p_match, p_mode, v_user, v_user)
    returning id into v_id;
  else
    update public.routing_rules r
    set position = p_position, name = btrim(p_name), enabled = coalesce(p_enabled, true),
        match = p_match, mode = p_mode, updated_by = v_user
    where r.id = p_id and r.workspace_id = p_workspace_id
    returning r.id into v_id;
    if v_id is null then
      raise exception 'rule not found' using errcode = 'P0002';
    end if;
    delete from public.routing_rule_assignees a where a.rule_id = v_id and a.workspace_id = p_workspace_id;
  end if;
  insert into public.routing_rule_assignees (rule_id, workspace_id, user_id, position)
  select v_id, p_workspace_id, a.u, min(a.ord)::integer
  from unnest(p_assignees) with ordinality a(u, ord)
  group by a.u;
  return v_id;
end;
$$;
revoke all on function public.routing_rule_save(uuid, uuid, text, boolean, integer, jsonb, text, uuid[]) from public, anon;
grant execute on function public.routing_rule_save(uuid, uuid, text, boolean, integer, jsonb, text, uuid[]) to authenticated;

create function public.routing_rule_delete(p_workspace_id uuid, p_id uuid)
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
  delete from public.routing_rules r where r.id = p_id and r.workspace_id = p_workspace_id;
  if not found then
    raise exception 'rule not found' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.routing_rule_delete(uuid, uuid) from public, anon;
grant execute on function public.routing_rule_delete(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Alerts for one person
-- ---------------------------------------------------------------------------
alter table public.team_alerts
  add column lead_id uuid,
  add column recipient_user_id uuid,
  add foreign key (lead_id, workspace_id)
    references public.leads (id, workspace_id) on delete cascade,
  add foreign key (workspace_id, recipient_user_id)
    references public.workspace_members (workspace_id, user_id) on delete cascade;
create index team_alerts_lead_idx on public.team_alerts (lead_id, workspace_id) where lead_id is not null;
create index team_alerts_recipient_idx on public.team_alerts (workspace_id, recipient_user_id) where recipient_user_id is not null;
alter table public.team_alerts drop constraint team_alerts_kind_check;
alter table public.team_alerts add constraint team_alerts_kind_check check (kind in (
  'qualified', 'needs_human', 'draft_waiting', 'reply_interested', 'mailbox_paused',
  'lead_assigned', 'meeting_booked', 'mailbox_health'
));

-- ---------------------------------------------------------------------------
-- Routing itself
-- ---------------------------------------------------------------------------

-- The first number in a size ("51-200", "11 to 50", "1,000+") and the
-- second (or, for "1000+", no upper end). Internal.
create function private.size_bounds(p_text text, out lo bigint, out hi bigint)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_nums text[];
begin
  select array_agg(replace(m[1], ',', '')) into v_nums
  from regexp_matches(coalesce(p_text, ''), '(\d[\d,]{0,11})', 'g') as m;
  if v_nums is null then
    return;
  end if;
  lo := v_nums[1]::bigint;
  hi := case when cardinality(v_nums) >= 2 then v_nums[2]::bigint
             when p_text ~ '\+' then 1000000000 else lo end;
end;
$$;
revoke all on function private.size_bounds(text) from public;

-- Routes one lead with no owner: the first enabled rule it matches gives it
-- to a teammate, its open conversations without anyone go to them too, the
-- lead's timeline says so, and that person gets an alert. Returns who, or
-- null. Internal; never raises (routing must not get in the way of a lead
-- being added).
create function private.route_lead(p_workspace_id uuid, p_lead_id uuid, p_play text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_l public.leads%rowtype;
  v_country text;
  v_size text;
  v_lo bigint;
  v_hi bigint;
  v_rule public.routing_rules%rowtype;
  v_people uuid[];
  v_user uuid;
  v_prospect uuid;
begin
  select l.* into v_l from public.leads l
  where l.id = p_lead_id and l.workspace_id = p_workspace_id for update;
  if not found or v_l.owner_id is not null then
    return null;
  end if;
  if not exists (select 1 from public.routing_rules r where r.workspace_id = p_workspace_id and r.enabled) then
    return null;
  end if;
  if coalesce(v_l.custom_fields #>> '{research,prospect_id}', '') ~ '^[0-9a-f-]{36}$' then
    v_prospect := (v_l.custom_fields #>> '{research,prospect_id}')::uuid;
  end if;
  select nullif(btrim(coalesce(nullif(p.country, ''), nullif(p.location, ''))), ''),
         nullif(btrim(p.size_range), '')
  into v_country, v_size
  from public.prospects p
  where p.workspace_id = p_workspace_id and (p.lead_id = p_lead_id or p.id = v_prospect)
  limit 1;
  v_country := lower(coalesce(v_country, nullif(btrim(v_l.custom_fields ->> 'country'), ''),
                              nullif(btrim(v_l.custom_fields #>> '{research,location}'), '')));
  v_size := coalesce(v_size, nullif(btrim(v_l.custom_fields ->> 'company_size'), ''),
                     nullif(btrim(v_l.custom_fields ->> 'employees'), ''));
  select b.lo, b.hi into v_lo, v_hi from private.size_bounds(v_size) b;

  for v_rule in
    select r.* from public.routing_rules r
    where r.workspace_id = p_workspace_id and r.enabled
    order by r.position, r.created_at, r.id
  loop
    -- Country: a code or name as it is written ("GB", "United Kingdom");
    -- longer names also match inside a place ("London, United Kingdom").
    continue when coalesce(jsonb_array_length(v_rule.match -> 'countries'), 0) > 0 and (
      v_country is null or not exists (
        select 1 from jsonb_array_elements_text(v_rule.match -> 'countries') c(v)
        where lower(btrim(c.v)) = v_country
           or (char_length(btrim(c.v)) >= 4 and position(lower(btrim(c.v)) in v_country) > 0)
           or (char_length(btrim(c.v)) between 2 and 3 and v_country ~ ('(^|[ ,(])' || lower(btrim(c.v)) || '([ ,)]|$)'))));
    continue when jsonb_typeof(v_rule.match -> 'size_min') = 'number'
      and (v_hi is null or v_hi < (v_rule.match ->> 'size_min')::numeric);
    continue when jsonb_typeof(v_rule.match -> 'size_max') = 'number'
      and (v_lo is null or v_lo > (v_rule.match ->> 'size_max')::numeric);
    continue when coalesce(jsonb_array_length(v_rule.match -> 'sources'), 0) > 0 and not exists (
      select 1 from jsonb_array_elements_text(v_rule.match -> 'sources') s(v)
      where lower(btrim(s.v)) = lower(v_l.source));
    continue when coalesce(jsonb_array_length(v_rule.match -> 'plays'), 0) > 0 and (
      p_play is null or not exists (
        select 1 from jsonb_array_elements_text(v_rule.match -> 'plays') x(v) where x.v = p_play));

    select array_agg(a.user_id order by a.position, a.user_id) into v_people
    from public.routing_rule_assignees a
    join public.workspace_members m on m.workspace_id = a.workspace_id and m.user_id = a.user_id
    where a.rule_id = v_rule.id and a.workspace_id = p_workspace_id;
    continue when v_people is null;

    if v_rule.mode = 'round_robin' then
      select r.rr_next into v_rule.rr_next from public.routing_rules r where r.id = v_rule.id for update;
      v_user := v_people[(v_rule.rr_next % cardinality(v_people)) + 1];
      update public.routing_rules r set rr_next = (r.rr_next + 1) % 1000000 where r.id = v_rule.id;
    else
      v_user := v_people[1];
    end if;

    update public.leads l set owner_id = v_user where l.id = p_lead_id;
    update public.conversations c set assigned_to = v_user
    where c.workspace_id = p_workspace_id and c.lead_id = p_lead_id and c.assigned_to is null
      and c.status <> 'closed';
    insert into public.activity_events (workspace_id, lead_id, kind, summary, metadata)
    values (p_workspace_id, p_lead_id, 'lead_routed',
            'Routed to ' || coalesce(nullif((select pf.name from public.profiles pf where pf.id = v_user), ''), 'a teammate')
              || ' by the rule "' || v_rule.name || '".',
            jsonb_build_object('rule_id', v_rule.id, 'user_id', v_user));
    insert into public.team_alerts (workspace_id, lead_id, recipient_user_id, kind, summary)
    values (p_workspace_id, p_lead_id, v_user, 'lead_assigned',
            left('Routed to you by the rule "' || v_rule.name || '"'
                 || coalesce('. ' || nullif(btrim(coalesce(v_l.company, '')), ''), '') || '.', 1000));
    return v_user;
  end loop;
  return null;
exception when others then
  return null;
end;
$$;
revoke all on function private.route_lead(uuid, uuid, text) from public;

create function private.leads_route()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.owner_id is null then
    perform private.route_lead(new.workspace_id, new.id, null);
  end if;
  return null;
end;
$$;
revoke all on function private.leads_route() from public;
create trigger leads_route
  after insert on public.leads
  for each row execute function private.leads_route();

create function private.mail_threads_route()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.route_lead(new.workspace_id, new.lead_id, new.play);
  return null;
end;
$$;
revoke all on function private.mail_threads_route() from public;
create trigger mail_threads_route
  after insert on public.mail_threads
  for each row execute function private.mail_threads_route();

-- A new conversation with a lead who has an owner goes to that owner.
create function private.conversations_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.assigned_to is null then
    select l.owner_id into new.assigned_to from public.leads l
    where l.id = new.lead_id and l.workspace_id = new.workspace_id;
  end if;
  return new;
end;
$$;
revoke all on function private.conversations_owner() from public;
create trigger conversations_owner
  before insert on public.conversations
  for each row execute function private.conversations_owner();

-- ---------------------------------------------------------------------------
-- Sending the alerts
-- ---------------------------------------------------------------------------

-- As in 20261120171651, for the new kinds too, and with a personal alert
-- (recipient_user_id) going only to that person, if they have alerts on.
-- Each alert now carries its own "to".
create or replace function public.mail_claim_team_alerts(p_workspace_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws public.workspaces%rowtype;
  v_recipients text[];
  v_to text[];
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
    select t.id, t.kind, t.summary, t.conversation_id, t.lead_id, t.recipient_user_id,
           coalesce(
             (select l.name from public.conversations c
              join public.leads l on l.id = c.lead_id and l.workspace_id = c.workspace_id
              where c.id = t.conversation_id),
             (select l.name from public.leads l where l.id = t.lead_id and l.workspace_id = t.workspace_id)) as lead
    from public.team_alerts t
    where t.workspace_id = v_ws.id
      and t.kind in ('reply_interested', 'mailbox_paused', 'lead_assigned', 'meeting_booked', 'mailbox_health')
      and t.status = 'pending' and t.created_at > now() - interval '15 minutes'
    order by t.created_at
    for update
  loop
    if v_alert.recipient_user_id is not null then
      select array_agg(p.email) into v_to
      from public.profiles p
      join public.workspace_members m on m.user_id = p.id and m.workspace_id = v_ws.id
      where p.id = v_alert.recipient_user_id and p.alert_emails and p.email <> '';
    else
      v_to := v_recipients;
    end if;
    if v_to is null or v_sent >= 20 then
      update public.team_alerts t set status = 'skipped' where t.id = v_alert.id;
    else
      update public.team_alerts t set status = 'sending' where t.id = v_alert.id;
      v_sent := v_sent + 1;
      v_alerts := v_alerts || jsonb_build_object(
        'id', v_alert.id, 'kind', v_alert.kind, 'summary', v_alert.summary,
        'conversation_id', v_alert.conversation_id, 'lead_id', v_alert.lead_id,
        'lead', coalesce(v_alert.lead, ''), 'to', to_jsonb(v_to));
    end if;
  end loop;
  return jsonb_build_object(
    'workspace', v_ws.name,
    'recipients', to_jsonb(coalesce(v_recipients, array[]::text[])),
    'alerts', v_alerts
  );
end;
$$;

create or replace function public.mail_alert_work_list()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct t.workspace_id), '{}'::uuid[])
  from public.team_alerts t
  where t.status = 'pending'
    and t.kind in ('reply_interested', 'mailbox_paused', 'lead_assigned', 'meeting_booked', 'mailbox_health')
    and t.created_at > now() - interval '15 minutes';
$$;

-- As in 20261120171920, waking for the new alert kinds too, so a lead routed
-- in a workspace with no mailbox still tells its person.
create or replace function private.mail_cron_tick()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_token text;
  v_headers jsonb;
  v_job text;
begin
  if not exists (select 1 from public.mailboxes m where m.status = 'active')
     and not exists (select 1 from public.mail_received r where r.kind = 'reply' and r.classification is null)
     and not exists (select 1 from public.team_alerts t
                     where t.status = 'pending'
                       and t.kind in ('reply_interested', 'mailbox_paused', 'lead_assigned', 'meeting_booked', 'mailbox_health')
                       and t.created_at > now() - interval '15 minutes') then
    return;
  end if;
  select s.decrypted_secret into v_url from vault.decrypted_secrets s where s.name = 'dialvo_app_url';
  select s.decrypted_secret into v_token from vault.decrypted_secrets s where s.name = 'dialvo_cron_token';
  if v_url is null or v_token is null then
    return;
  end if;
  v_headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_token);
  foreach v_job in array array['send', 'poll', 'write'] loop
    perform net.http_post(
      url := rtrim(v_url, '/') || '/api/mail/step?job=' || v_job,
      body := '{}'::jsonb,
      headers := v_headers,
      timeout_milliseconds := 58000
    );
  end loop;
end;
$$;
