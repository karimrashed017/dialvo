-- Campaigns inside "Find leads": target-account lists, lookalike companies,
-- and one-click plays on the workspace's own leads (lead reactivation,
-- closed-lost check-in, trial users ready to buy, customer expansion).
--
-- Everything here is additive:
--   outbound_campaigns         one campaign: its kind, name and settings
--   outbound_campaign_targets  what is in it: a company to look up (target
--                              accounts, lookalike) or one of the workspace's
--                              own leads (the plays), with the "why now"
--   prospect_searches          + kind: 'campaign' marks the hidden search a
--                              company campaign's runs belong to, so it never
--                              shows among the team's saved searches
--   prospect_runs              + campaign_id: a run that works through a
--                              campaign's targets instead of searching
--   prospects                  + play and campaign_id: where it came from
--   outbound_drafts            + lead_id, campaign_id, target_id and play: a
--                              first email to one of the workspace's own
--                              leads has no prospect. prospect_id becomes
--                              optional; one of the two is always there.
--
-- A company campaign reuses the run engine: its run is a prospect_run
-- (source 'findymail', counted against the day's runs and spend), the
-- companies it finds are prospects, their sites are read by the usual
-- research step and their first emails are written and approved exactly
-- like Find leads'. Contact lookups are counted against the same daily
-- Findymail credit counter (outbound_usage.contact_credits) and cap.
--
-- Who writes what: only the server (secret key). Members read their own
-- workspace's rows under row-level security.

-- ---------------------------------------------------------------------------
-- outbound_campaigns
-- ---------------------------------------------------------------------------
create table public.outbound_campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  -- 'signals' is the one campaign per workspace that kept buying signals
  -- (the signals migration) become prospects of.
  -- The rest are plays on the workspace's own leads (see
  -- the plays migration for nurture, onboarding, event and speed_to_lead).
  kind text not null check (kind in (
    'accounts', 'lookalike', 'signals', 'reactivation', 'closed_lost', 'plg', 'expansion',
    'nurture', 'onboarding', 'event', 'speed_to_lead'
  )),
  name text not null check (char_length(name) between 1 and 120),
  -- active: still has work. done: nothing left. stopped: a person stopped it.
  status text not null default 'active' check (status in ('active', 'done', 'stopped')),
  -- accounts / lookalike: { "titles": [[...]], "seeds": [...], "same_country",
  -- "same_size" }. Plays: { "days": n }.
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  -- The hidden search a company campaign's runs and prospects belong to.
  search_id uuid,
  -- Lookalike: the seeds have been looked up (so it is never paid twice).
  seeds_done boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (search_id, workspace_id)
    references public.prospect_searches (id, workspace_id) on delete cascade
);
alter table public.outbound_campaigns enable row level security;
create index outbound_campaigns_workspace_idx on public.outbound_campaigns (workspace_id, created_at desc);
create index outbound_campaigns_search_idx on public.outbound_campaigns (search_id, workspace_id) where search_id is not null;
create index outbound_campaigns_created_by_idx on public.outbound_campaigns (created_by);

create trigger outbound_campaigns_set_updated_at
  before update on public.outbound_campaigns
  for each row execute function private.set_updated_at();

alter table public.prospect_searches
  add column kind text not null default 'search' check (kind in ('search', 'campaign'));

alter table public.prospect_runs
  add column campaign_id uuid,
  add foreign key (campaign_id, workspace_id)
    references public.outbound_campaigns (id, workspace_id) on delete cascade;
create index prospect_runs_campaign_idx on public.prospect_runs (campaign_id, workspace_id) where campaign_id is not null;

alter table public.prospects
  add column play text check (play is null or play in ('accounts', 'lookalike', 'signal')),
  add column campaign_id uuid,
  add foreign key (campaign_id, workspace_id)
    references public.outbound_campaigns (id, workspace_id) on delete set null (campaign_id);
create index prospects_campaign_idx on public.prospects (campaign_id, workspace_id) where campaign_id is not null;

-- ---------------------------------------------------------------------------
-- outbound_campaign_targets
-- ---------------------------------------------------------------------------
create table public.outbound_campaign_targets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  campaign_id uuid not null,
  position integer not null default 0,
  -- Company campaigns: what the team pasted (a website or a name).
  input text not null default '' check (char_length(input) <= 300),
  domain text check (domain is null or (domain = lower(domain) and char_length(domain) between 3 and 253)),
  company_name text not null default '' check (char_length(company_name) <= 200),
  size_range text not null default '' check (char_length(size_range) <= 40),
  country text not null default '' check (char_length(country) <= 60),
  -- Plays: the lead it is for.
  lead_id uuid,
  prospect_id uuid,
  -- Company: pending -> working -> found | no_contact | not_found | skipped | failed.
  -- Plays: selected (a first email is to be written, see outbound_drafts.target_id).
  status text not null default 'pending' check (status in (
    'pending', 'working', 'found', 'no_contact', 'not_found', 'skipped', 'failed', 'selected'
  )),
  reason text check (reason is null or char_length(reason) <= 60),
  -- Why this one, now: { "fact": "...", "source": "...", "at": "<time>" }
  why_now jsonb not null default '{}'::jsonb check (jsonb_typeof(why_now) = 'object'),
  attempts integer not null default 0,
  -- Estimated Findymail credits spent on this one.
  credits integer not null default 0 check (credits >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  check (lead_id is not null or char_length(input) > 0 or domain is not null),
  foreign key (campaign_id, workspace_id)
    references public.outbound_campaigns (id, workspace_id) on delete cascade,
  foreign key (lead_id, workspace_id)
    references public.leads (id, workspace_id) on delete cascade,
  foreign key (prospect_id, workspace_id)
    references public.prospects (id, workspace_id) on delete set null (prospect_id)
);
alter table public.outbound_campaign_targets enable row level security;
create index outbound_campaign_targets_workspace_idx on public.outbound_campaign_targets (workspace_id);
create index outbound_campaign_targets_campaign_idx
  on public.outbound_campaign_targets (campaign_id, workspace_id, status, position);
create unique index outbound_campaign_targets_domain_idx
  on public.outbound_campaign_targets (campaign_id, domain) where domain is not null;
create unique index outbound_campaign_targets_lead_idx
  on public.outbound_campaign_targets (campaign_id, lead_id) where lead_id is not null;
create index outbound_campaign_targets_lead_ref_idx
  on public.outbound_campaign_targets (lead_id, workspace_id) where lead_id is not null;
create index outbound_campaign_targets_prospect_idx
  on public.outbound_campaign_targets (prospect_id, workspace_id) where prospect_id is not null;

create trigger outbound_campaign_targets_set_updated_at
  before update on public.outbound_campaign_targets
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- outbound_drafts: a first email to one of the workspace's own leads
-- ---------------------------------------------------------------------------
alter table public.outbound_drafts
  alter column prospect_id drop not null,
  add column lead_id uuid,
  add column campaign_id uuid,
  add column target_id uuid,
  add column play text check (play is null or play in (
    'accounts', 'lookalike', 'signal', 'reactivation', 'closed_lost', 'plg', 'expansion',
    'nurture', 'onboarding', 'event_registration', 'event_followup', 'event_no_show',
    'speed_to_lead', 'takeout'
  )),
  add constraint outbound_drafts_has_recipient check (prospect_id is not null or lead_id is not null),
  add constraint outbound_drafts_one_per_target unique (target_id),
  add foreign key (lead_id, workspace_id)
    references public.leads (id, workspace_id) on delete cascade,
  add foreign key (campaign_id, workspace_id)
    references public.outbound_campaigns (id, workspace_id) on delete set null (campaign_id),
  add foreign key (target_id, workspace_id)
    references public.outbound_campaign_targets (id, workspace_id) on delete set null (target_id);
create index outbound_drafts_lead_idx on public.outbound_drafts (lead_id, workspace_id) where lead_id is not null;
create index outbound_drafts_campaign_idx on public.outbound_drafts (campaign_id, workspace_id) where campaign_id is not null;
create index outbound_drafts_target_idx on public.outbound_drafts (target_id, workspace_id) where target_id is not null;

-- ---------------------------------------------------------------------------
-- Grants and policies: members read, the server writes
-- ---------------------------------------------------------------------------
revoke all on public.outbound_campaigns, public.outbound_campaign_targets from anon, authenticated;
grant all on public.outbound_campaigns, public.outbound_campaign_targets to service_role;
grant select on public.outbound_campaigns, public.outbound_campaign_targets to authenticated;

create policy "Members read campaigns" on public.outbound_campaigns for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));
create policy "Members read campaign targets" on public.outbound_campaign_targets for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));

-- ---------------------------------------------------------------------------
-- Credits: the same daily counter and cap as Find leads' contact database
-- ---------------------------------------------------------------------------

-- Takes p_credits of today's Findymail allowance, if the cap leaves room.
-- True when taken. The day's row is locked, so two steps can't both take
-- the last credits. Internal.
create function private.contact_credits_take(p_workspace_id uuid, p_credits integer, p_max_per_day integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_used integer;
begin
  if coalesce(p_credits, 0) <= 0 then
    return true;
  end if;
  insert into public.outbound_usage (workspace_id, day)
  values (p_workspace_id, (now() at time zone 'utc')::date)
  on conflict (workspace_id, day) do nothing;
  select u.contact_credits into v_used from public.outbound_usage u
  where u.workspace_id = p_workspace_id and u.day = (now() at time zone 'utc')::date
  for update;
  if v_used + p_credits > coalesce(p_max_per_day, 0) then
    return false;
  end if;
  update public.outbound_usage u
  set contact_credits = u.contact_credits + p_credits
  where u.workspace_id = p_workspace_id and u.day = (now() at time zone 'utc')::date;
  return true;
end;
$$;
revoke all on function private.contact_credits_take(uuid, integer, integer) from public;

-- Gives back credits taken today that weren't spent. Internal.
create function private.contact_credits_give_back(p_workspace_id uuid, p_credits integer)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.outbound_usage u
  set contact_credits = greatest(u.contact_credits - greatest(coalesce(p_credits, 0), 0), 0)
  where u.workspace_id = p_workspace_id and u.day = (now() at time zone 'utc')::date;
$$;
revoke all on function private.contact_credits_give_back(uuid, integer) from public;

-- Why a company can't go into a campaign, or null when it can: the
-- workspace already has it (prospect or lead, by website, email domain or
-- address) or never wants it. Internal.
create function private.campaign_company_known(p_workspace_id uuid, p_domain text, p_email text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when private.outbound_is_suppressed(p_workspace_id, p_email, p_domain) then 'suppressed'
    when exists (
      select 1 from public.leads l
      where l.workspace_id = p_workspace_id
        and (private.site_domain(l.website) = p_domain
             or split_part(coalesce(l.email, ''), '@', 2) = p_domain
             or (p_email is not null and l.email = lower(p_email)))
    ) then 'already_a_lead'
    when exists (
      select 1 from public.prospects p
      where p.workspace_id = p_workspace_id
        and (p.domain = p_domain or (p_email is not null and p.email = lower(p_email)))
    ) then 'already_found'
  end;
$$;
revoke all on function private.campaign_company_known(uuid, text, text) from public;

-- ---------------------------------------------------------------------------
-- Company campaigns (target accounts, lookalike)
-- ---------------------------------------------------------------------------

-- Creates a company campaign for a member, with its hidden search.
-- p_targets: [{ "input", "domain" (or null), "company_name" }, ...], at most
-- p_max_targets, deduplicated by domain (and input) here.
--   { "status": "created", "campaign_id", "targets": n }
--   { "status": "not_found" }   not a member
--   { "status": "invalid" }     nothing usable, or too many
create function public.campaign_create_company(
  p_workspace_id uuid, p_user_id uuid, p_kind text, p_name text,
  p_settings jsonb, p_targets jsonb, p_max_targets integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_search uuid;
  v_campaign uuid;
  v_count integer := 0;
  v_pos integer := 0;
  t record;
  v_domain text;
  v_input text;
begin
  if not exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace_id and m.user_id = p_user_id
  ) then
    return jsonb_build_object('status', 'not_found');
  end if;
  if p_kind not in ('accounts', 'lookalike')
    or char_length(btrim(coalesce(p_name, ''))) not between 1 and 120
    or jsonb_typeof(coalesce(p_settings, 'null'::jsonb)) <> 'object'
    or jsonb_typeof(coalesce(p_targets, '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(p_targets, '[]'::jsonb)) > greatest(p_max_targets, 0)
    or (p_kind = 'accounts' and jsonb_array_length(coalesce(p_targets, '[]'::jsonb)) = 0)
    or (p_kind = 'lookalike' and jsonb_array_length(coalesce(p_settings -> 'seeds', '[]'::jsonb)) = 0) then
    return jsonb_build_object('status', 'invalid');
  end if;

  insert into public.prospect_searches (workspace_id, name, description, kind, created_by)
  values (
    p_workspace_id, left(btrim(p_name), 120),
    left(case p_kind
      when 'accounts' then 'Companies the team chose by name as target accounts. Read each site for facts; do not judge whether it fits.'
      else 'Companies similar to the team''s chosen examples: ' || coalesce((
        select string_agg(s, ', ') from jsonb_array_elements_text(p_settings -> 'seeds') s), '')
    end, 2000),
    'campaign', p_user_id
  )
  returning id into v_search;
  insert into public.outbound_campaigns (workspace_id, kind, name, settings, search_id, created_by)
  values (p_workspace_id, p_kind, left(btrim(p_name), 120), p_settings, v_search, p_user_id)
  returning id into v_campaign;

  for t in
    select * from jsonb_to_recordset(coalesce(p_targets, '[]'::jsonb))
      as x(input text, domain text, company_name text)
  loop
    v_input := left(btrim(regexp_replace(coalesce(t.input, ''), '[\u0000-\u001f\u007f<>]', ' ', 'g')), 300);
    v_domain := private.site_domain(t.domain);
    continue when v_domain is null and v_input = '';
    continue when v_domain is null and exists (
      select 1 from public.outbound_campaign_targets c
      where c.campaign_id = v_campaign and lower(c.input) = lower(v_input));
    v_pos := v_pos + 1;
    insert into public.outbound_campaign_targets (workspace_id, campaign_id, position, input, domain, company_name)
    values (p_workspace_id, v_campaign, v_pos, v_input, v_domain, left(btrim(coalesce(t.company_name, '')), 200))
    on conflict (campaign_id, domain) where domain is not null do nothing;
    if found then
      v_count := v_count + 1;
    end if;
  end loop;
  if p_kind = 'accounts' and v_count = 0 then
    raise exception 'no usable company' using errcode = '22023';
  end if;
  return jsonb_build_object('status', 'created', 'campaign_id', v_campaign, 'targets', v_count);
exception
  when sqlstate '22023' then
    return jsonb_build_object('status', 'invalid');
end;
$$;

-- Starts (or continues) a company campaign's run: the same checks and daily
-- caps as any "Find leads" run (one at a time, runs and spend per day).
--   { "status": "started" | "busy", "run_id" } | { "status": "capped" | "not_found" | "nothing_left" }
create function public.campaign_run_start(
  p_workspace_id uuid, p_campaign_id uuid, p_user_id uuid,
  p_max_runs_per_day integer, p_max_cost_micros_per_day bigint,
  p_max_credits_per_day integer, p_min_credits integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.outbound_campaigns%rowtype;
  v_started jsonb;
begin
  select c.* into v_c from public.outbound_campaigns c
  where c.id = p_campaign_id and c.workspace_id = p_workspace_id and c.kind in ('accounts', 'lookalike');
  if not found or not exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace_id and m.user_id = p_user_id
  ) then
    return jsonb_build_object('status', 'not_found');
  end if;
  -- Nothing left to look up (a lookalike campaign before its seeds are
  -- looked up always has work).
  if (v_c.kind = 'accounts' or v_c.seeds_done) and not exists (
    select 1 from public.outbound_campaign_targets t
    where t.campaign_id = v_c.id and t.status in ('pending', 'working')
  ) then
    return jsonb_build_object('status', 'nothing_left');
  end if;
  if coalesce(p_max_credits_per_day, 0) - private.contact_credits_today(p_workspace_id)
     < greatest(coalesce(p_min_credits, 1), 1) then
    return jsonb_build_object('status', 'capped');
  end if;
  v_started := public.prospect_run_start(
    p_workspace_id, v_c.search_id, p_user_id, 100, p_max_runs_per_day, p_max_cost_micros_per_day
  );
  if v_started ->> 'status' = 'started' then
    update public.prospect_runs r
    set source = 'findymail', campaign_id = v_c.id
    where r.id = (v_started ->> 'run_id')::uuid and r.workspace_id = p_workspace_id;
    update public.outbound_campaigns c set status = 'active' where c.id = v_c.id;
  end if;
  return v_started;
end;
$$;

-- Takes the run's lease for one step of a company campaign, and hands out
-- what the step should do.
--   { "status": "not_campaign" }  not a campaign run, or past this phase:
--                                 use the usual steps (reading sites)
--   { "status": "busy" }
--   { "status": "seeds", "campaign", "usage" }      lookalike: look up the seeds
--   { "status": "targets", "campaign", "work": [...] }  look up these companies
-- Targets left 'working' by a step that died are handed out again, up to
-- p_max_attempts times, then failed. With nothing left, the run moves on to
-- reading the sites of what was found (or ends, if nothing was).
create function public.campaign_run_claim(
  p_run_id uuid, p_workspace_id uuid, p_lease_seconds integer, p_batch integer, p_max_attempts integer,
  p_max_per_run integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.prospect_runs%rowtype;
  v_c public.outbound_campaigns%rowtype;
  v_work jsonb;
  v_found integer;
begin
  select r.* into v_run from public.prospect_runs r
  where r.id = p_run_id and r.workspace_id = p_workspace_id
  for update;
  if not found then
    return null;
  end if;
  if v_run.campaign_id is null or v_run.status <> 'searching' then
    return jsonb_build_object('status', 'not_campaign');
  end if;
  if v_run.locked_until is not null and v_run.locked_until > now() then
    return jsonb_build_object('status', 'busy');
  end if;
  select c.* into v_c from public.outbound_campaigns c
  where c.id = v_run.campaign_id and c.workspace_id = p_workspace_id;

  if v_c.status = 'stopped' then
    update public.prospect_runs r
    set status = 'stopped', stop_reason = 'stopped_by_user', finished_at = now(), locked_until = null
    where r.id = v_run.id;
    return jsonb_build_object('status', 'stopped', 'stop_reason', 'stopped_by_user');
  end if;

  update public.prospect_runs r
  set locked_until = now() + make_interval(secs => greatest(p_lease_seconds, 1))
  where r.id = v_run.id;

  if v_c.kind = 'lookalike' and not v_c.seeds_done then
    return jsonb_build_object(
      'status', 'seeds',
      'campaign', jsonb_build_object('id', v_c.id, 'kind', v_c.kind, 'settings', v_c.settings),
      'have', (select count(*) from public.outbound_campaign_targets t where t.campaign_id = v_c.id)
    );
  end if;

  -- This step holds the lease: anything still 'working' belongs to one that died.
  update public.outbound_campaign_targets t
  set status = 'failed', reason = 'lookup_failed'
  where t.campaign_id = v_c.id and t.status in ('pending', 'working') and t.attempts >= p_max_attempts;
  with done_here as (
    -- Companies this run has already finished with: one run takes at most
    -- p_max_per_run; the rest wait for the next run.
    select count(*) as n from public.outbound_campaign_targets t
    where t.campaign_id = v_c.id and t.status not in ('pending', 'working')
      and t.attempts > 0 and t.updated_at >= v_run.created_at
  ), picked as (
    select t.id from public.outbound_campaign_targets t
    where t.campaign_id = v_c.id and t.status in ('pending', 'working')
    order by t.position, t.id
    limit greatest(least(p_batch, p_max_per_run - (select n from done_here)), 0)
    for update
  ), marked as (
    update public.outbound_campaign_targets t
    set status = 'working', attempts = t.attempts + 1
    from picked where t.id = picked.id
    returning t.id, t.input, t.domain, t.company_name
  )
  select jsonb_agg(jsonb_build_object(
    'id', m.id, 'input', m.input, 'domain', m.domain, 'company_name', m.company_name
  )) into v_work from marked m;

  if v_work is null then
    select count(*) into v_found from public.prospects p
    where p.run_id = v_run.id and p.workspace_id = p_workspace_id;
    update public.prospect_runs r
    set status = case when v_found > 0 then 'researching' else 'done' end,
        stop_reason = case when v_found > 0 then r.stop_reason else 'nothing_found' end,
        finished_at = case when v_found > 0 then null else now() end,
        search_rounds = r.search_rounds + 1,
        locked_until = null
    where r.id = v_run.id;
    if not exists (
      select 1 from public.outbound_campaign_targets t
      where t.campaign_id = v_c.id and t.status in ('pending', 'working')
    ) then
      update public.outbound_campaigns c set status = 'done' where c.id = v_c.id and c.status = 'active';
    end if;
    return jsonb_build_object('status', 'not_campaign');
  end if;

  return jsonb_build_object(
    'status', 'targets',
    'campaign', jsonb_build_object('id', v_c.id, 'kind', v_c.kind, 'settings', v_c.settings),
    'work', v_work
  );
end;
$$;

-- Takes (p_credits > 0) or gives back (p_credits < 0) Findymail credits for
-- one target of a running campaign step, and counts them on the target and
-- the run. False when the day's cap has no room (nothing is taken).
create function public.campaign_credits(
  p_run_id uuid, p_workspace_id uuid, p_target_id uuid, p_credits integer, p_max_per_day integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ok boolean := true;
  v_back integer;
begin
  if not exists (
    select 1 from public.prospect_runs r
    where r.id = p_run_id and r.workspace_id = p_workspace_id and r.campaign_id is not null
  ) then
    return false;
  end if;
  if coalesce(p_credits, 0) > 0 then
    v_ok := private.contact_credits_take(p_workspace_id, p_credits, p_max_per_day);
    if not v_ok then
      return false;
    end if;
    update public.outbound_campaign_targets t set credits = t.credits + p_credits
    where t.id = p_target_id and t.workspace_id = p_workspace_id;
    update public.prospect_runs r set contact_credits = r.contact_credits + p_credits
    where r.id = p_run_id;
  elsif coalesce(p_credits, 0) < 0 then
    select least(-p_credits, coalesce((
      select t.credits from public.outbound_campaign_targets t
      where t.id = p_target_id and t.workspace_id = p_workspace_id), 0)) into v_back;
    if v_back > 0 then
      perform private.contact_credits_give_back(p_workspace_id, v_back);
      update public.outbound_campaign_targets t set credits = t.credits - v_back
      where t.id = p_target_id and t.workspace_id = p_workspace_id;
      update public.prospect_runs r set contact_credits = greatest(r.contact_credits - v_back, 0)
      where r.id = p_run_id;
    end if;
  end if;
  return true;
end;
$$;

-- Takes (or gives back) credits for the run itself (the lookalike search).
create function public.campaign_run_credits(
  p_run_id uuid, p_workspace_id uuid, p_credits integer, p_max_per_day integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_back integer;
begin
  if not exists (
    select 1 from public.prospect_runs r
    where r.id = p_run_id and r.workspace_id = p_workspace_id and r.campaign_id is not null
  ) then
    return false;
  end if;
  if coalesce(p_credits, 0) > 0 then
    if not private.contact_credits_take(p_workspace_id, p_credits, p_max_per_day) then
      return false;
    end if;
    update public.prospect_runs r set contact_credits = r.contact_credits + p_credits where r.id = p_run_id;
  elsif coalesce(p_credits, 0) < 0 then
    select least(-p_credits, r.contact_credits) into v_back from public.prospect_runs r where r.id = p_run_id;
    perform private.contact_credits_give_back(p_workspace_id, v_back);
    update public.prospect_runs r set contact_credits = r.contact_credits - v_back where r.id = p_run_id;
  end if;
  return true;
end;
$$;

-- Lookalike: stores the companies found from the seeds, as targets (the
-- workspace's known and never-contact companies, and the seeds themselves,
-- left out), at most p_max in all, marks the seeds done and releases the
-- lease. p_rows: [{ "domain", "company_name", "size_range", "country" }]
create function public.campaign_add_lookalikes(
  p_run_id uuid, p_workspace_id uuid, p_rows jsonb, p_max integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.prospect_runs%rowtype;
  v_c public.outbound_campaigns%rowtype;
  v_have integer;
  v_added integer := 0;
  c record;
  v_domain text;
begin
  select r.* into v_run from public.prospect_runs r
  where r.id = p_run_id and r.workspace_id = p_workspace_id and r.status = 'searching'
  for update;
  if not found or v_run.campaign_id is null then
    return 0;
  end if;
  select oc.* into v_c from public.outbound_campaigns oc where oc.id = v_run.campaign_id for update;
  if v_c.seeds_done then
    update public.prospect_runs r set locked_until = null where r.id = v_run.id;
    return 0;
  end if;
  select count(*) into v_have from public.outbound_campaign_targets t where t.campaign_id = v_c.id;
  for c in
    select * from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb))
      as x(domain text, company_name text, size_range text, country text)
  loop
    exit when v_have + v_added >= greatest(p_max, 0);
    v_domain := private.site_domain(c.domain);
    continue when v_domain is null or char_length(v_domain) > 253;
    continue when exists (
      select 1 from jsonb_array_elements_text(coalesce(v_c.settings -> 'seeds', '[]'::jsonb)) s
      where private.site_domain(s) = v_domain);
    continue when private.campaign_company_known(p_workspace_id, v_domain, null) is not null;
    insert into public.outbound_campaign_targets (
      workspace_id, campaign_id, position, input, domain, company_name, size_range, country
    ) values (
      p_workspace_id, v_c.id, v_have + v_added + 1, v_domain, v_domain,
      left(btrim(coalesce(c.company_name, '')), 200), left(btrim(coalesce(c.size_range, '')), 40),
      left(btrim(coalesce(c.country, '')), 60)
    )
    on conflict (campaign_id, domain) where domain is not null do nothing;
    if found then
      v_added := v_added + 1;
    end if;
  end loop;
  update public.outbound_campaigns oc set seeds_done = true where oc.id = v_c.id;
  update public.prospect_runs r set locked_until = null where r.id = v_run.id;
  return v_added;
end;
$$;

-- A target's domain once it is known (from the team's input, or looked up
-- from a name). Says whether to go on and find a contact:
--   'ok'                     go on
--   'skipped' (reason set)   the workspace already has it or never wants it,
--                            or it is already in this campaign
--   'ignored'                not this step's target any more
create function public.campaign_target_resolve(
  p_run_id uuid, p_workspace_id uuid, p_target_id uuid, p_domain text, p_company_name text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t public.outbound_campaign_targets%rowtype;
  v_domain text := private.site_domain(p_domain);
  v_reason text;
begin
  select t.* into v_t from public.outbound_campaign_targets t
  join public.prospect_runs r on r.campaign_id = t.campaign_id and r.workspace_id = t.workspace_id
  where t.id = p_target_id and t.workspace_id = p_workspace_id and t.status = 'working'
    and r.id = p_run_id and r.status = 'searching'
  for update of t;
  if not found then
    return 'ignored';
  end if;
  if v_domain is null then
    update public.outbound_campaign_targets t set status = 'not_found', reason = 'no_website' where t.id = v_t.id;
    return 'skipped';
  end if;
  if exists (
    select 1 from public.outbound_campaign_targets o
    where o.campaign_id = v_t.campaign_id and o.domain = v_domain and o.id <> v_t.id
  ) then
    update public.outbound_campaign_targets t set status = 'skipped', reason = 'duplicate' where t.id = v_t.id;
    return 'skipped';
  end if;
  v_reason := private.campaign_company_known(p_workspace_id, v_domain, null);
  update public.outbound_campaign_targets t
  set domain = v_domain,
      company_name = coalesce(nullif(left(btrim(coalesce(p_company_name, '')), 200), ''), t.company_name),
      status = case when v_reason is null then t.status else 'skipped' end,
      reason = v_reason
  where t.id = v_t.id;
  return case when v_reason is null then 'ok' else 'skipped' end;
end;
$$;

-- What looking a target up came to. Only a target this run is working on
-- changes. p_result:
--   { "status": "found", "contact_name", "contact_role", "email",
--     "linkedin_url", "company_name" }   a prospect is made (kept, for
--                                        target accounts: the team chose it)
--   { "status": "no_contact" | "not_found" | "skipped", "reason" }
--   { "status": "retry" }                handed out again on a later step
create function public.campaign_target_save(
  p_run_id uuid, p_workspace_id uuid, p_target_id uuid, p_result jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t public.outbound_campaign_targets%rowtype;
  v_run public.prospect_runs%rowtype;
  v_c public.outbound_campaigns%rowtype;
  v_status text := p_result ->> 'status';
  v_email text := nullif(lower(btrim(coalesce(p_result ->> 'email', ''))), '');
  v_name text := left(btrim(coalesce(p_result ->> 'contact_name', '')), 200);
  v_reason text;
  v_prospect uuid;
begin
  select t.* into v_t from public.outbound_campaign_targets t
  where t.id = p_target_id and t.workspace_id = p_workspace_id and t.status = 'working'
  for update;
  if not found then
    return 'ignored';
  end if;
  select r.* into v_run from public.prospect_runs r
  where r.id = p_run_id and r.workspace_id = p_workspace_id and r.campaign_id = v_t.campaign_id
    and r.status = 'searching';
  if not found then
    return 'ignored';
  end if;
  select c.* into v_c from public.outbound_campaigns c where c.id = v_t.campaign_id;

  if v_status = 'retry' then
    update public.outbound_campaign_targets t set status = 'pending' where t.id = v_t.id;
    return 'retry';
  end if;
  if v_status in ('no_contact', 'not_found', 'skipped', 'failed') then
    update public.outbound_campaign_targets t
    set status = v_status, reason = left(coalesce(nullif(p_result ->> 'reason', ''), v_status), 60)
    where t.id = v_t.id;
    return v_status;
  end if;
  if v_status <> 'found' or v_t.domain is null then
    return 'ignored';
  end if;

  if v_email is not null and (
    v_email !~ '^[^\s@]+@[a-z0-9-]+(\.[a-z0-9-]+)+$' or char_length(v_email) > 254
  ) then
    v_email := null;
  end if;
  if v_email is null or v_name = '' then
    update public.outbound_campaign_targets t set status = 'no_contact', reason = 'no_email' where t.id = v_t.id;
    return 'no_contact';
  end if;
  v_reason := private.campaign_company_known(p_workspace_id, v_t.domain, v_email);
  if v_reason is not null then
    update public.outbound_campaign_targets t set status = 'skipped', reason = v_reason where t.id = v_t.id;
    return 'skipped';
  end if;

  insert into public.prospects (
    workspace_id, run_id, search_id, domain, website, company_name, created_at,
    source, contact_name, contact_role, contact_linkedin_url, email, email_kind, email_verified,
    size_range, country, decision, play, campaign_id
  ) values (
    p_workspace_id, v_run.id, v_run.search_id, v_t.domain, 'https://' || v_t.domain || '/',
    coalesce(nullif(left(btrim(coalesce(p_result ->> 'company_name', '')), 200), ''), v_t.company_name),
    clock_timestamp(), 'findymail', v_name, left(btrim(coalesce(p_result ->> 'contact_role', '')), 200),
    case when p_result ->> 'linkedin_url' ~ '^https://([a-z]+\.)?linkedin\.com/'
      then left(p_result ->> 'linkedin_url', 300) end,
    v_email, 'person',
    -- Findymail's finder doesn't say in its documentation that these are verified.
    false,
    v_t.size_range, v_t.country,
    case when v_c.kind = 'accounts' then 'kept' else 'undecided' end,
    v_c.kind, v_c.id
  )
  on conflict (workspace_id, domain) do nothing
  returning id into v_prospect;
  if v_prospect is null then
    update public.outbound_campaign_targets t set status = 'skipped', reason = 'already_found' where t.id = v_t.id;
    return 'skipped';
  end if;
  update public.outbound_campaign_targets t
  set status = 'found', reason = null, prospect_id = v_prospect
  where t.id = v_t.id;
  return 'found';
end;
$$;

-- Ends the step: releases the run's lease.
create function public.campaign_step_release(p_run_id uuid, p_workspace_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.prospect_runs r set locked_until = null
  where r.id = p_run_id and r.workspace_id = p_workspace_id and r.campaign_id is not null;
$$;

-- A member stops a campaign: its running step ends at the next claim, and
-- for a play, first emails not yet written are no longer written.
create function public.campaign_stop(p_workspace_id uuid, p_campaign_id uuid, p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace_id and m.user_id = p_user_id
  ) then
    return false;
  end if;
  update public.outbound_campaigns c set status = 'stopped'
  where c.id = p_campaign_id and c.workspace_id = p_workspace_id and c.status = 'active';
  return found;
end;
$$;

-- ---------------------------------------------------------------------------
-- Plays on the workspace's own leads
-- ---------------------------------------------------------------------------

-- The last time anything happened with a lead: its creation, its timeline,
-- a message either way, an email sent or received. Internal.
create function private.lead_last_activity(p_workspace_id uuid, p_lead_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(
    (select l.created_at from public.leads l where l.id = p_lead_id and l.workspace_id = p_workspace_id),
    (select max(a.created_at) from public.activity_events a
     where a.lead_id = p_lead_id and a.workspace_id = p_workspace_id),
    (select max(m.sent_at) from public.messages m
     join public.conversations c on c.id = m.conversation_id and c.workspace_id = m.workspace_id
     where c.lead_id = p_lead_id and c.workspace_id = p_workspace_id),
    (select max(e.sent_at) from public.outbound_emails e
     where e.lead_id = p_lead_id and e.workspace_id = p_workspace_id),
    (select max(r.received_at) from public.mail_received r
     join public.mail_threads t on t.id = r.thread_id and t.workspace_id = r.workspace_id
     where t.lead_id = p_lead_id and t.workspace_id = p_workspace_id)
  );
$$;
revoke all on function private.lead_last_activity(uuid, uuid) from public;

-- When a lead was marked lost: the latest status change to lost on its
-- timeline, or (imported as lost) when the lead last changed. Internal.
create function private.lead_lost_at(p_workspace_id uuid, p_lead_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select max(a.created_at) from public.activity_events a
     where a.lead_id = p_lead_id and a.workspace_id = p_workspace_id
       and a.kind = 'lead_status_changed' and a.metadata ->> 'to' = 'lost'),
    (select l.updated_at from public.leads l where l.id = p_lead_id and l.workspace_id = p_workspace_id)
  );
$$;
revoke all on function private.lead_lost_at(uuid, uuid) from public;

-- When a lead became a customer: the latest status change to won on its
-- timeline, or (imported as won) when the lead last changed. Internal.
create function private.lead_won_at(p_workspace_id uuid, p_lead_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select max(a.created_at) from public.activity_events a
     where a.lead_id = p_lead_id and a.workspace_id = p_workspace_id
       and a.kind = 'lead_status_changed' and a.metadata ->> 'to' = 'won'),
    (select l.updated_at from public.leads l where l.id = p_lead_id and l.workspace_id = p_workspace_id)
  );
$$;
revoke all on function private.lead_won_at(uuid, uuid) from public;

-- Which of a workspace's leads a play would write to, and why, now. The
-- rules (each also proved in supabase/tests/plays.test.ts):
--   every play: has an email; not do not contact, not unsubscribed, not on
--     the never-contact list; nothing waiting, scheduled or sending to them;
--     no first email from this same play in the last p_repeat_days days;
--     never answered "not interested", "unsubscribe" or "wrong person".
--   reactivation: new, engaged or qualified, and nothing has happened with
--     them for p_days days.
--   closed_lost:  marked lost more than p_days days ago.
--   plg:          a trial user (a trial_started event, or custom_fields.trial
--                 true) who isn't won, lost or unsubscribed, and is "ready":
--                 limit_reached in the last p_days days, or trial_ending with
--                 an ends_at in the next 3 days (or, without ends_at, sent in
--                 the last 3 days).
--   expansion:    a customer (won, or custom_fields.customer true) who
--                 agreed to hear by email (consent_email) or has written to
--                 the team before (a message from them).
--   nurture:      new, engaged or qualified; their latest sequence finished
--                 more than p_days days ago with no reply, they never
--                 replied, and fewer than two nurture emails went before.
--   onboarding:   a customer, as for expansion, who became one in the last
--                 p_days days.
-- Returns [{ "lead_id", "fact", "at" }] in the order to write them, at most
-- p_limit.
create function private.play_candidates(
  p_workspace_id uuid, p_kind text, p_days integer, p_repeat_days integer, p_limit integer
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with base as (
    select l.* from public.leads l
    where l.workspace_id = p_workspace_id
      and l.email is not null
      and not l.do_not_contact
      and l.status <> 'unsubscribed'
      and not private.outbound_is_suppressed(l.workspace_id, l.email, private.site_domain(l.website))
      and not exists (
        select 1 from public.mail_threads t
        where t.workspace_id = l.workspace_id and (t.lead_id = l.id or t.to_email = l.email)
          and (t.reply_class in ('not_interested', 'unsubscribe', 'wrong_person')
               or t.status = 'unsubscribed'))
      and not exists (
        select 1 from public.outbound_emails e
        where e.workspace_id = l.workspace_id and e.to_email = l.email
          and e.status in ('queued', 'scheduled', 'sending', 'needs_check'))
      and not exists (
        select 1 from public.outbound_drafts d
        where d.workspace_id = l.workspace_id and d.to_email = l.email
          and (d.status in ('drafting', 'draft')
               or (d.status = 'approved' and not exists (
                     select 1 from public.outbound_emails e2 where e2.draft_id = d.id))
               or (d.play = p_kind and d.created_at > now() - make_interval(days => greatest(p_repeat_days, 0)))))
      and not exists (
        select 1 from public.outbound_campaign_targets ct
        join public.outbound_campaigns c on c.id = ct.campaign_id and c.workspace_id = ct.workspace_id
        where ct.workspace_id = l.workspace_id and ct.lead_id = l.id and c.kind = p_kind
          and ct.created_at > now() - make_interval(days => greatest(p_repeat_days, 0)))
  ),
  picked as (
    select b.id as lead_id, x.fact, x.at
    from base b
    cross join lateral (
      select
        case p_kind
          when 'reactivation' then private.lead_last_activity(b.workspace_id, b.id)
          when 'closed_lost' then private.lead_lost_at(b.workspace_id, b.id)
        end as at_time
    ) t0
    cross join lateral (
      select * from (
        select
          'No activity since ' || to_char(t0.at_time at time zone 'utc', 'FMDD Mon YYYY')
            || ' (' || extract(day from now() - t0.at_time)::int || ' days)' as fact,
          t0.at_time as at
        where p_kind = 'reactivation'
          and b.status in ('new', 'engaged', 'qualified')
          and t0.at_time < now() - make_interval(days => greatest(p_days, 1))
        union all
        select
          'Marked lost on ' || to_char(t0.at_time at time zone 'utc', 'FMDD Mon YYYY')
            || ' (' || extract(day from now() - t0.at_time)::int || ' days ago)',
          t0.at_time
        where p_kind = 'closed_lost'
          and b.status = 'lost'
          and t0.at_time < now() - make_interval(days => greatest(p_days, 1))
        union all
        select * from (
          select
            case e.event
              when 'limit_reached' then 'Reached a limit of their trial on '
              else 'Their trial ends ' end
              || to_char(coalesce(
                   case when e.event = 'trial_ending' and e.properties ->> 'ends_at' ~ '^\d{4}-\d{2}-\d{2}'
                     then (e.properties ->> 'ends_at')::timestamptz end,
                   e.occurred_at) at time zone 'utc', 'FMDD Mon YYYY')
              || coalesce(' (' || nullif(left(e.properties ->> 'limit', 60), '') || ')', ''),
            e.occurred_at
          from public.lead_product_events e
          where p_kind = 'plg'
            and e.lead_id = b.id and e.workspace_id = b.workspace_id
            and b.status not in ('won', 'lost')
            and (exists (select 1 from public.lead_product_events s
                         where s.lead_id = b.id and s.workspace_id = b.workspace_id and s.event = 'trial_started')
                 or lower(coalesce(b.custom_fields ->> 'trial', '')) in ('true', 'yes', '1'))
            and (
              (e.event = 'limit_reached' and e.occurred_at > now() - make_interval(days => greatest(p_days, 1)))
              or (e.event = 'trial_ending' and (
                case when e.properties ->> 'ends_at' ~ '^\d{4}-\d{2}-\d{2}'
                  then (e.properties ->> 'ends_at')::timestamptz between now() and now() + interval '3 days'
                  else e.occurred_at > now() - interval '3 days' end))
            )
          order by e.occurred_at desc
          limit 1
        ) plg
        union all
        select
          case when b.consent_email then 'A customer who agreed to hear from you by email'
            else 'A customer who has written to you before' end,
          coalesce(b.consent_email_at, b.updated_at)
        where p_kind = 'expansion'
          and (b.status = 'won' or lower(coalesce(b.custom_fields ->> 'customer', '')) in ('true', 'yes', '1'))
          and (b.consent_email or exists (
            select 1 from public.messages m
            join public.conversations c on c.id = m.conversation_id and c.workspace_id = m.workspace_id
            where c.lead_id = b.id and c.workspace_id = b.workspace_id and m.direction = 'in'))
        union all
        -- Nurture: their latest sequence ran to the end without a reply,
        -- more than p_days ago, they never replied at all, and fewer than
        -- two nurture emails have gone to them before.
        select
          'Their last email from you went on ' || to_char(q.last_sent_at at time zone 'utc', 'FMDD Mon YYYY')
            || ', with no reply (' || extract(day from now() - q.last_sent_at)::int || ' days)',
          q.last_sent_at
        from (
          select t.status, coalesce(t.last_sent_at, t.first_sent_at) as last_sent_at
          from public.mail_threads t
          where t.workspace_id = b.workspace_id and (t.lead_id = b.id or t.to_email = b.email)
          order by coalesce(t.last_sent_at, t.first_sent_at) desc
          limit 1
        ) q
        where p_kind = 'nurture'
          and b.status in ('new', 'engaged', 'qualified')
          and q.status = 'finished'
          and q.last_sent_at < now() - make_interval(days => greatest(p_days, 1))
          and not exists (
            select 1 from public.mail_threads t2
            where t2.workspace_id = b.workspace_id and (t2.lead_id = b.id or t2.to_email = b.email)
              and t2.last_reply_at is not null)
          and (select count(*) from public.outbound_drafts d3
               where d3.workspace_id = b.workspace_id and d3.lead_id = b.id and d3.play = 'nurture'
                 and d3.status not in ('discarded', 'failed')) < 2
        union all
        -- Onboarding: a customer since the last p_days days who agreed to
        -- hear by email or has written to the team before.
        select
          'Became a customer on ' || to_char(private.lead_won_at(b.workspace_id, b.id) at time zone 'utc', 'FMDD Mon YYYY'),
          private.lead_won_at(b.workspace_id, b.id)
        where p_kind = 'onboarding'
          and (b.status = 'won' or lower(coalesce(b.custom_fields ->> 'customer', '')) in ('true', 'yes', '1'))
          and private.lead_won_at(b.workspace_id, b.id) > now() - make_interval(days => greatest(p_days, 1))
          and (b.consent_email or exists (
            select 1 from public.messages m
            join public.conversations c on c.id = m.conversation_id and c.workspace_id = m.workspace_id
            where c.lead_id = b.id and c.workspace_id = b.workspace_id and m.direction = 'in'))
      ) y
      limit 1
    ) x
  )
  select coalesce(jsonb_agg(jsonb_build_object('lead_id', p.lead_id, 'fact', p.fact, 'at', p.at) order by p.at, p.lead_id), '[]'::jsonb)
  from (select * from picked order by at, lead_id limit greatest(p_limit, 0)) p;
$$;
revoke all on function private.play_candidates(uuid, text, integer, integer, integer) from public;

-- How many leads a play would write to right now, without starting it.
create function public.play_preview(
  p_workspace_id uuid, p_user_id uuid, p_kind text, p_days integer, p_repeat_days integer, p_limit integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_list jsonb;
begin
  if not exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace_id and m.user_id = p_user_id
  ) or p_kind not in ('reactivation', 'closed_lost', 'plg', 'expansion', 'nurture', 'onboarding') then
    return null;
  end if;
  v_list := private.play_candidates(p_workspace_id, p_kind, p_days, p_repeat_days, p_limit);
  return jsonb_build_object('count', jsonb_array_length(v_list), 'leads', v_list);
end;
$$;

-- Starts a play: a campaign with the leads it applies to right now, each
-- with its "why now". Their first emails are written by the usual
-- "Write first emails" step (campaign_draft_claim) and wait for approval.
--   { "status": "created", "campaign_id", "selected": n } | { "status": "empty" | "not_found" }
create function public.play_start(
  p_workspace_id uuid, p_user_id uuid, p_kind text, p_name text,
  p_days integer, p_repeat_days integer, p_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_list jsonb;
  v_campaign uuid;
begin
  if not exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace_id and m.user_id = p_user_id
  ) or p_kind not in ('reactivation', 'closed_lost', 'plg', 'expansion', 'nurture', 'onboarding')
    or char_length(btrim(coalesce(p_name, ''))) not between 1 and 120 then
    return jsonb_build_object('status', 'not_found');
  end if;
  -- One start at a time per workspace, so two clicks can't pick the same leads.
  perform 1 from public.workspaces w where w.id = p_workspace_id for update;
  v_list := private.play_candidates(p_workspace_id, p_kind, p_days, p_repeat_days, p_limit);
  if jsonb_array_length(v_list) = 0 then
    return jsonb_build_object('status', 'empty');
  end if;
  insert into public.outbound_campaigns (workspace_id, kind, name, settings, created_by)
  values (p_workspace_id, p_kind, left(btrim(p_name), 120),
          jsonb_build_object('days', p_days), p_user_id)
  returning id into v_campaign;
  insert into public.outbound_campaign_targets (workspace_id, campaign_id, position, lead_id, status, why_now)
  select p_workspace_id, v_campaign, x.ord, (x.item ->> 'lead_id')::uuid, 'selected',
         jsonb_build_object('fact', x.item ->> 'fact', 'at', x.item ->> 'at', 'source', 'your leads')
  from jsonb_array_elements(v_list) with ordinality as x(item, ord);
  return jsonb_build_object('status', 'created', 'campaign_id', v_campaign,
                            'selected', jsonb_array_length(v_list));
end;
$$;

-- Picks the next leads of the workspace's running plays that need a first
-- email, and reserves a draft for each (like outbound_draft_claim, under
-- the same daily draft and spend caps). Each is checked again now: still
-- not do not contact, unsubscribed or never-contact.
--   { "capped", "remaining", "context": {...}, "drafts": [{ "draft_id", "play", "lead": {...} }] }
create function public.campaign_draft_claim(
  p_workspace_id uuid, p_user_id uuid, p_limit integer,
  p_max_drafts_per_day integer, p_max_cost_micros_per_day bigint, p_max_attempts integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usage jsonb;
  v_room integer;
  v_agent public.agents%rowtype;
  v_ws public.workspaces%rowtype;
  v_drafts jsonb := '[]'::jsonb;
  v_remaining integer;
  v_id uuid;
  t record;
begin
  if not exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace_id and m.user_id = p_user_id
  ) then
    return null;
  end if;
  select w.* into v_ws from public.workspaces w where w.id = p_workspace_id for update;
  v_usage := private.outbound_usage_json(p_workspace_id);
  v_room := least(greatest(p_limit, 0), p_max_drafts_per_day - (v_usage ->> 'drafts')::integer);
  if (v_usage ->> 'cost_micros')::bigint >= p_max_cost_micros_per_day then
    v_room := 0;
  end if;
  select a.* into v_agent from public.agents a
  where a.workspace_id = p_workspace_id and a.role = 'outbound'
  order by (a.channel = 'email') desc, a.created_at
  limit 1;

  for t in
    select ct.id as target_id, ct.campaign_id, ct.why_now, c.kind, c.settings as campaign_settings,
           coalesce(nullif(ct.why_now ->> 'play', ''), c.kind) as play,
           l.id as lead_id, l.name, l.email,
           l.company, l.website, l.status as lead_status, d.id as draft_id,
           (select th.subject from public.mail_threads th
            where th.workspace_id = l.workspace_id and th.lead_id = l.id
            order by th.first_sent_at desc limit 1) as last_subject
    from public.outbound_campaign_targets ct
    join public.outbound_campaigns c on c.id = ct.campaign_id and c.workspace_id = ct.workspace_id
    join public.leads l on l.id = ct.lead_id and l.workspace_id = ct.workspace_id
    left join public.outbound_drafts d on d.target_id = ct.id and d.workspace_id = ct.workspace_id
    where ct.workspace_id = p_workspace_id and ct.status = 'selected' and c.status = 'active'
      and l.email is not null and not l.do_not_contact and l.status <> 'unsubscribed'
      and not (select private.outbound_is_suppressed(l.workspace_id, l.email, private.site_domain(l.website)))
      and (
        d.id is null
        or (d.status = 'failed' and d.attempts < p_max_attempts)
        or (d.status = 'drafting' and d.updated_at < now() - interval '2 minutes' and d.attempts < p_max_attempts)
      )
    order by ct.created_at, ct.position, ct.id
    limit greatest(v_room, 0)
    for update of ct
  loop
    if t.draft_id is null then
      insert into public.outbound_drafts (workspace_id, lead_id, campaign_id, target_id, play, agent_id, to_email)
      values (p_workspace_id, t.lead_id, t.campaign_id, t.target_id, t.play, v_agent.id, t.email)
      returning id into v_id;
    else
      update public.outbound_drafts d
      set status = 'drafting', attempts = d.attempts + 1, to_email = t.email
      where d.id = t.draft_id
      returning d.id into v_id;
    end if;
    v_drafts := v_drafts || jsonb_build_object(
      'draft_id', v_id,
      'play', t.play,
      'lead', jsonb_build_object(
        'name', t.name, 'company', coalesce(t.company, ''), 'website', coalesce(t.website, ''),
        'why_now', coalesce(t.why_now ->> 'fact', ''), 'last_subject', coalesce(t.last_subject, ''),
        -- What they last wrote to the team (a form or the chat), for speed
        -- to lead. Their own words: the writer treats them as material.
        'their_message', coalesce((
          select left(m.body, 600) from public.messages m
          join public.conversations c2 on c2.id = m.conversation_id and c2.workspace_id = m.workspace_id
          where c2.lead_id = t.lead_id and c2.workspace_id = p_workspace_id and m.direction = 'in'
          order by m.sent_at desc limit 1), '')
      ),
      -- An event play: the event's name and the link the team chose.
      'event', case when t.kind = 'event' then jsonb_build_object(
        'name', coalesce(t.campaign_settings ->> 'event', ''),
        'link', coalesce(t.campaign_settings ->> 'link', ''),
        'date', coalesce(t.campaign_settings ->> 'date', '')) end
    );
  end loop;
  perform private.outbound_usage_add(p_workspace_id, 0, 0, jsonb_array_length(v_drafts));

  select count(*) into v_remaining
  from public.outbound_campaign_targets ct
  join public.outbound_campaigns c on c.id = ct.campaign_id and c.workspace_id = ct.workspace_id
  join public.leads l on l.id = ct.lead_id and l.workspace_id = ct.workspace_id
  left join public.outbound_drafts d on d.target_id = ct.id and d.workspace_id = ct.workspace_id
  where ct.workspace_id = p_workspace_id and ct.status = 'selected' and c.status = 'active'
    and l.email is not null and not l.do_not_contact and l.status <> 'unsubscribed'
    and not (select private.outbound_is_suppressed(l.workspace_id, l.email, private.site_domain(l.website)))
    and (d.id is null or (d.status = 'failed' and d.attempts < p_max_attempts));

  return jsonb_build_object(
    'capped', v_room <= 0,
    'remaining', v_remaining,
    'drafts', v_drafts,
    'context', jsonb_build_object(
      'workspace', jsonb_build_object('name', v_ws.name, 'website', v_ws.website),
      'sender_name', coalesce((select pf.name from public.profiles pf where pf.id = p_user_id), ''),
      'booking_url', (select ws.booking_url from public.workspace_sending ws where ws.workspace_id = p_workspace_id),
      'instructions', coalesce(v_agent.instructions, ''),
      'knowledge', coalesce((
        select jsonb_agg(
          jsonb_build_object('title', k.title, 'content', k.content, 'source_url', k.source_url)
          order by k.created_at desc
        )
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

-- ---------------------------------------------------------------------------
-- Who may call what: the server only
-- ---------------------------------------------------------------------------
revoke all on function public.campaign_create_company(uuid, uuid, text, text, jsonb, jsonb, integer) from public, anon, authenticated;
revoke all on function public.campaign_run_start(uuid, uuid, uuid, integer, bigint, integer, integer) from public, anon, authenticated;
revoke all on function public.campaign_run_claim(uuid, uuid, integer, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.campaign_credits(uuid, uuid, uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.campaign_run_credits(uuid, uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.campaign_add_lookalikes(uuid, uuid, jsonb, integer) from public, anon, authenticated;
revoke all on function public.campaign_target_resolve(uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.campaign_target_save(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.campaign_step_release(uuid, uuid) from public, anon, authenticated;
revoke all on function public.campaign_stop(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.play_preview(uuid, uuid, text, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.play_start(uuid, uuid, text, text, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.campaign_draft_claim(uuid, uuid, integer, integer, bigint, integer) from public, anon, authenticated;
grant execute on function public.campaign_create_company(uuid, uuid, text, text, jsonb, jsonb, integer) to service_role;
grant execute on function public.campaign_run_start(uuid, uuid, uuid, integer, bigint, integer, integer) to service_role;
grant execute on function public.campaign_run_claim(uuid, uuid, integer, integer, integer, integer) to service_role;
grant execute on function public.campaign_credits(uuid, uuid, uuid, integer, integer) to service_role;
grant execute on function public.campaign_run_credits(uuid, uuid, integer, integer) to service_role;
grant execute on function public.campaign_add_lookalikes(uuid, uuid, jsonb, integer) to service_role;
grant execute on function public.campaign_target_resolve(uuid, uuid, uuid, text, text) to service_role;
grant execute on function public.campaign_target_save(uuid, uuid, uuid, jsonb) to service_role;
grant execute on function public.campaign_step_release(uuid, uuid) to service_role;
grant execute on function public.campaign_stop(uuid, uuid, uuid) to service_role;
grant execute on function public.play_preview(uuid, uuid, text, integer, integer, integer) to service_role;
grant execute on function public.play_start(uuid, uuid, text, text, integer, integer, integer) to service_role;
grant execute on function public.campaign_draft_claim(uuid, uuid, integer, integer, bigint, integer) to service_role;
