-- Buying signals inside "Find leads". A workspace sets up monitors for the
-- signals Findymail watches (new hires, job changes, keyword mentions, post
-- engagement), scoped to its ideal customer. Once a day per monitor the
-- scheduler pulls what Findymail found; each signal is shown with the person
-- and company, and "Keep" finds that person's email (one Findymail lookup)
-- and makes them a prospect whose first email opens with the signal.
--
-- Additive. Two new tables:
--   signal_monitors  a workspace's monitors, mirrored from the Findymail
--                    account (which every workspace shares: each monitor is
--                    only ever read by its own workspace's id)
--   signals          what the monitors found, deduplicated per workspace
-- and one column, outbound_usage.signals (signals pulled today, for the cap).
--
-- The scheduler: like sending's (20261120171920_mail_scheduler.sql), pg_cron
-- runs private.signal_cron_tick() every 15 minutes; it calls the app only
-- when a monitor is due (not pulled for 23 hours), with the same Vault token,
-- at POST /api/prospects/signals/step. Each call claims a few due monitors
-- under a lease, so a call that dies, repeats or overlaps is harmless.

-- ---------------------------------------------------------------------------
-- signal_monitors
-- ---------------------------------------------------------------------------
create table public.signal_monitors (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  -- The monitor's id in Findymail, once it exists there.
  external_id bigint check (external_id is null or external_id > 0),
  name text not null check (char_length(name) between 1 and 80),
  signal_type text not null check (signal_type in ('new_hire', 'job_change', 'keyword_mention', 'post_engagement')),
  keywords jsonb not null default '[]'::jsonb
    check (jsonb_typeof(keywords) = 'array' and jsonb_array_length(keywords) <= 5),
  -- { "countries": ["US"], "employee_count_ranges": ["11-50"], "job_title_keywords": [...] }
  filters jsonb not null default '{}'::jsonb check (jsonb_typeof(filters) = 'object'),
  target_companies jsonb not null default '[]'::jsonb
    check (jsonb_typeof(target_companies) = 'array' and jsonb_array_length(target_companies) <= 100),
  -- Findymail's lifetime cap on what this monitor delivers (and charges for).
  max_matches integer not null check (max_matches between 1 and 10000),
  -- creating: being made in Findymail. active. failed: Findymail refused it.
  -- removing / removed: taken off by a person.
  status text not null default 'creating'
    check (status in ('creating', 'active', 'failed', 'removing', 'removed')),
  error text check (error is null or char_length(error) <= 200),
  last_pulled_at timestamptz,
  locked_until timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id)
);
alter table public.signal_monitors enable row level security;
create index signal_monitors_workspace_idx on public.signal_monitors (workspace_id, created_at desc);
create index signal_monitors_due_idx on public.signal_monitors (last_pulled_at nulls first) where status = 'active';
create index signal_monitors_created_by_idx on public.signal_monitors (created_by);
create unique index signal_monitors_external_idx on public.signal_monitors (external_id) where external_id is not null;

create trigger signal_monitors_set_updated_at
  before update on public.signal_monitors
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- signals
-- ---------------------------------------------------------------------------
create table public.signals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  monitor_id uuid not null,
  external_id text not null check (external_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  signal_type text not null check (char_length(signal_type) between 1 and 40),
  detected_at timestamptz,
  -- One plain sentence: what happened, built from Findymail's fields.
  summary text not null check (char_length(summary) between 1 and 400),
  snippet text not null default '' check (char_length(snippet) <= 600),
  matched_keyword text not null default '' check (char_length(matched_keyword) <= 80),
  relevance_score integer check (relevance_score is null or relevance_score between 0 and 5),
  contact_name text not null default '' check (char_length(contact_name) <= 200),
  contact_title text not null default '' check (char_length(contact_title) <= 200),
  contact_linkedin_url text check (
    contact_linkedin_url is null
    or (contact_linkedin_url ~ '^https://([a-z]+\.)?linkedin\.com/' and char_length(contact_linkedin_url) <= 300)
  ),
  company_name text not null default '' check (char_length(company_name) <= 200),
  company_domain text check (company_domain is null or (company_domain = lower(company_domain) and char_length(company_domain) between 3 and 253)),
  company_industry text not null default '' check (char_length(company_industry) <= 120),
  company_size text not null default '' check (char_length(company_size) <= 40),
  company_country text not null default '' check (char_length(company_country) <= 60),
  -- new: to decide. finding: its email is being looked up. kept: a prospect
  -- now (see prospect_id). no_email: no email was found. dismissed. skipped:
  -- the workspace already has this company or person, or never wants them.
  status text not null default 'new'
    check (status in ('new', 'finding', 'kept', 'no_email', 'dismissed', 'skipped')),
  reason text check (reason is null or char_length(reason) <= 60),
  prospect_id uuid,
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (workspace_id, external_id),
  foreign key (monitor_id, workspace_id)
    references public.signal_monitors (id, workspace_id) on delete cascade,
  foreign key (prospect_id, workspace_id)
    references public.prospects (id, workspace_id) on delete set null (prospect_id)
);
alter table public.signals enable row level security;
create index signals_list_idx on public.signals (workspace_id, status, created_at desc);
create index signals_monitor_idx on public.signals (monitor_id, workspace_id);
create index signals_prospect_idx on public.signals (prospect_id, workspace_id) where prospect_id is not null;
create index signals_decided_by_idx on public.signals (decided_by) where decided_by is not null;

create trigger signals_set_updated_at
  before update on public.signals
  for each row execute function private.set_updated_at();

alter table public.outbound_usage add column signals integer not null default 0;

revoke all on public.signal_monitors, public.signals from anon, authenticated;
grant all on public.signal_monitors, public.signals to service_role;
grant select on public.signal_monitors, public.signals to authenticated;
create policy "Members read signal monitors" on public.signal_monitors for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));
create policy "Members read signals" on public.signals for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));

-- ---------------------------------------------------------------------------
-- Monitors (the server, on behalf of a member)
-- ---------------------------------------------------------------------------

-- Reserves a new monitor before it is made in Findymail, so it can never
-- exist there without a row here. At most p_max_monitors that aren't
-- removed or failed.
--   { "status": "created", "id" } | { "status": "capped" | "not_found" | "invalid" }
create function public.signal_monitor_begin(
  p_workspace_id uuid, p_user_id uuid, p_name text, p_type text, p_keywords jsonb,
  p_filters jsonb, p_target_companies jsonb, p_max_matches integer, p_max_monitors integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace_id and m.user_id = p_user_id
  ) then
    return jsonb_build_object('status', 'not_found');
  end if;
  perform 1 from public.workspaces w where w.id = p_workspace_id for update;
  if (select count(*) from public.signal_monitors s
      where s.workspace_id = p_workspace_id and s.status in ('creating', 'active', 'removing'))
     >= greatest(p_max_monitors, 0) then
    return jsonb_build_object('status', 'capped');
  end if;
  begin
    insert into public.signal_monitors (
      workspace_id, name, signal_type, keywords, filters, target_companies, max_matches, created_by
    ) values (
      p_workspace_id, left(btrim(coalesce(p_name, '')), 80), p_type, coalesce(p_keywords, '[]'::jsonb),
      coalesce(p_filters, '{}'::jsonb), coalesce(p_target_companies, '[]'::jsonb), p_max_matches, p_user_id
    )
    returning id into v_id;
  exception
    when check_violation or not_null_violation then
      return jsonb_build_object('status', 'invalid');
  end;
  return jsonb_build_object('status', 'created', 'id', v_id);
end;
$$;

-- What Findymail said when the monitor was made: its id, or that it refused.
create function public.signal_monitor_made(
  p_workspace_id uuid, p_monitor_id uuid, p_external_id bigint, p_error text
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.signal_monitors s
  set external_id = p_external_id,
      status = case when p_external_id is not null then 'active' else 'failed' end,
      error = case when p_external_id is null then left(coalesce(p_error, 'refused'), 200) end
  where s.id = p_monitor_id and s.workspace_id = p_workspace_id and s.status = 'creating';
$$;

-- A member takes a monitor off. Returns its Findymail id, to delete it there
-- (null if it never got one); signal_monitor_removed() then finishes.
create function public.signal_monitor_remove(p_workspace_id uuid, p_user_id uuid, p_monitor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m public.signal_monitors%rowtype;
begin
  if not exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace_id and m.user_id = p_user_id
  ) then
    return null;
  end if;
  update public.signal_monitors s set status = 'removing'
  where s.id = p_monitor_id and s.workspace_id = p_workspace_id
    and s.status in ('active', 'removing', 'failed', 'creating')
  returning s.* into v_m;
  if not found then
    return null;
  end if;
  return jsonb_build_object('id', v_m.id, 'external_id', v_m.external_id);
end;
$$;

create function public.signal_monitor_removed(p_workspace_id uuid, p_monitor_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.signal_monitors s set status = 'removed', locked_until = null
  where s.id = p_monitor_id and s.workspace_id = p_workspace_id and s.status = 'removing';
$$;

-- ---------------------------------------------------------------------------
-- The daily pull (the scheduler's step)
-- ---------------------------------------------------------------------------

-- Hands out up to p_limit active monitors not pulled for p_every_hours, each
-- under a lease, with how many signals its workspace may still take today.
--   [{ "monitor_id", "workspace_id", "external_id", "since", "room" }]
create function public.signal_pull_claim(
  p_limit integer, p_lease_seconds integer, p_every_hours integer, p_max_per_day integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_out jsonb := '[]'::jsonb;
  m record;
begin
  for m in
    select s.* from public.signal_monitors s
    where s.status = 'active' and s.external_id is not null
      and (s.last_pulled_at is null or s.last_pulled_at < now() - make_interval(hours => greatest(p_every_hours, 1)))
      and (s.locked_until is null or s.locked_until < now())
    order by s.last_pulled_at nulls first, s.id
    limit greatest(p_limit, 0)
    for update skip locked
  loop
    update public.signal_monitors s
    set locked_until = now() + make_interval(secs => greatest(p_lease_seconds, 1))
    where s.id = m.id;
    v_out := v_out || jsonb_build_object(
      'monitor_id', m.id, 'workspace_id', m.workspace_id, 'external_id', m.external_id,
      'since', coalesce(m.last_pulled_at, m.created_at),
      'room', greatest(p_max_per_day - coalesce((
        select u.signals from public.outbound_usage u
        where u.workspace_id = m.workspace_id and u.day = (now() at time zone 'utc')::date), 0), 0)
    );
  end loop;
  return v_out;
end;
$$;

-- Stores what one monitor's pull found (already checked by the server):
-- [{ "external_id", "signal_type", "detected_at", "summary", "snippet",
--    "matched_keyword", "relevance_score", "contact_name", "contact_title",
--    "contact_linkedin_url", "company_name", "company_domain",
--    "company_industry", "company_size", "company_country" }]
-- A signal seen before is left as it is. One about a company or person the
-- workspace already has, or never wants, is kept as 'skipped' (so it isn't
-- pulled again). At most the day's room is stored as new; each new one is
-- counted against today's signals, and its estimated Findymail credits
-- (Findymail charges for every signal a monitor delivers) on today's
-- contact credits. Then the monitor is marked pulled (if p_done) and its
-- lease released.
--   { "added": n, "skipped": n, "over": n }
create function public.signal_ingest(
  p_workspace_id uuid, p_monitor_id uuid, p_rows jsonb, p_max_per_day integer,
  p_credits_per_signal integer, p_done boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m public.signal_monitors%rowtype;
  v_room integer;
  v_added integer := 0;
  v_skipped integer := 0;
  v_over integer := 0;
  r record;
  v_domain text;
  v_reason text;
  v_id uuid;
begin
  select s.* into v_m from public.signal_monitors s
  where s.id = p_monitor_id and s.workspace_id = p_workspace_id
  for update;
  if not found then
    return null;
  end if;
  insert into public.outbound_usage (workspace_id, day)
  values (p_workspace_id, (now() at time zone 'utc')::date)
  on conflict (workspace_id, day) do nothing;
  select greatest(p_max_per_day - u.signals, 0) into v_room from public.outbound_usage u
  where u.workspace_id = p_workspace_id and u.day = (now() at time zone 'utc')::date
  for update;

  for r in
    select * from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as x(
      external_id text, signal_type text, detected_at timestamptz, summary text, snippet text,
      matched_keyword text, relevance_score integer, contact_name text, contact_title text,
      contact_linkedin_url text, company_name text, company_domain text, company_industry text,
      company_size text, company_country text
    )
  loop
    continue when r.external_id is null or r.external_id !~ '^[A-Za-z0-9_-]{1,40}$';
    continue when exists (
      select 1 from public.signals g where g.workspace_id = p_workspace_id and g.external_id = r.external_id);
    if v_added >= v_room then
      v_over := v_over + 1;
      continue;
    end if;
    v_domain := private.site_domain(r.company_domain);
    v_reason := case when v_domain is null then 'no_company_website'
      else private.campaign_company_known(p_workspace_id, v_domain, null) end;
    insert into public.signals (
      workspace_id, monitor_id, external_id, signal_type, detected_at, summary, snippet,
      matched_keyword, relevance_score, contact_name, contact_title, contact_linkedin_url,
      company_name, company_domain, company_industry, company_size, company_country, status, reason
    ) values (
      p_workspace_id, v_m.id, r.external_id, left(coalesce(r.signal_type, v_m.signal_type), 40),
      r.detected_at, left(coalesce(nullif(btrim(r.summary), ''), 'A buying signal'), 400),
      left(coalesce(r.snippet, ''), 600), left(coalesce(r.matched_keyword, ''), 80),
      case when r.relevance_score between 0 and 5 then r.relevance_score end,
      left(coalesce(r.contact_name, ''), 200), left(coalesce(r.contact_title, ''), 200),
      case when r.contact_linkedin_url ~ '^https://([a-z]+\.)?linkedin\.com/' then left(r.contact_linkedin_url, 300) end,
      left(coalesce(r.company_name, ''), 200), v_domain, left(coalesce(r.company_industry, ''), 120),
      left(coalesce(r.company_size, ''), 40), left(coalesce(r.company_country, ''), 60),
      case when v_reason is null then 'new' else 'skipped' end, v_reason
    )
    on conflict (workspace_id, external_id) do nothing
    returning id into v_id;
    if v_id is null then
      continue;
    end if;
    if v_reason is null then
      v_added := v_added + 1;
    else
      v_skipped := v_skipped + 1;
    end if;
  end loop;

  update public.outbound_usage u
  set signals = u.signals + v_added + v_skipped,
      contact_credits = u.contact_credits + (v_added + v_skipped) * greatest(coalesce(p_credits_per_signal, 0), 0)
  where u.workspace_id = p_workspace_id and u.day = (now() at time zone 'utc')::date;
  update public.signal_monitors s
  set last_pulled_at = case when coalesce(p_done, true) then now() else s.last_pulled_at end,
      locked_until = null
  where s.id = v_m.id;
  return jsonb_build_object('added', v_added, 'skipped', v_skipped, 'over', v_over);
end;
$$;

-- Releases a monitor whose pull failed, to be tried again on a later tick.
create function public.signal_pull_release(p_workspace_id uuid, p_monitor_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.signal_monitors s set locked_until = null
  where s.id = p_monitor_id and s.workspace_id = p_workspace_id;
$$;

-- ---------------------------------------------------------------------------
-- Keep or dismiss a signal
-- ---------------------------------------------------------------------------

-- "Keep": checks the signal can still be used, takes one Findymail credit
-- from today's cap for the email lookup, and marks it 'finding'.
--   { "status": "ok", "contact_name", "domain" }
--   { "status": "skipped", "reason" } | { "status": "capped" } | { "status": "not_found" }
create function public.signal_keep_begin(
  p_workspace_id uuid, p_user_id uuid, p_signal_id uuid, p_max_credits_per_day integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s public.signals%rowtype;
  v_reason text;
begin
  if not exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace_id and m.user_id = p_user_id
  ) then
    return jsonb_build_object('status', 'not_found');
  end if;
  select g.* into v_s from public.signals g
  where g.id = p_signal_id and g.workspace_id = p_workspace_id
    and (g.status = 'new' or (g.status = 'finding' and g.updated_at < now() - interval '2 minutes'))
  for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if v_s.company_domain is null or btrim(v_s.contact_name) = '' then
    v_reason := 'no_person';
  else
    v_reason := private.campaign_company_known(p_workspace_id, v_s.company_domain, null);
  end if;
  if v_reason is not null then
    update public.signals g
    set status = 'skipped', reason = v_reason, decided_by = p_user_id, decided_at = now()
    where g.id = v_s.id;
    return jsonb_build_object('status', 'skipped', 'reason', v_reason);
  end if;
  if not private.contact_credits_take(p_workspace_id, 1, p_max_credits_per_day) then
    return jsonb_build_object('status', 'capped');
  end if;
  update public.signals g set status = 'finding', decided_by = p_user_id where g.id = v_s.id;
  return jsonb_build_object('status', 'ok', 'contact_name', v_s.contact_name, 'domain', v_s.company_domain);
end;
$$;

-- What the email lookup found. With an email (already checked by the
-- server), the person becomes a kept prospect of the workspace's "Buying
-- signals" campaign, with the signal as the fact their first email opens
-- with; without one, the credit goes back to the day.
--   'kept' | 'no_email' | 'skipped' | 'ignored'
create function public.signal_keep_finish(
  p_workspace_id uuid, p_signal_id uuid, p_email text, p_charged boolean
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s public.signals%rowtype;
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_campaign public.outbound_campaigns%rowtype;
  v_search uuid;
  v_run uuid;
  v_reason text;
  v_prospect uuid;
begin
  select g.* into v_s from public.signals g
  where g.id = p_signal_id and g.workspace_id = p_workspace_id and g.status = 'finding'
  for update;
  if not found then
    return 'ignored';
  end if;
  if not coalesce(p_charged, false) then
    perform private.contact_credits_give_back(p_workspace_id, 1);
  end if;
  if v_email is not null and (
    v_email !~ '^[^\s@]+@[a-z0-9-]+(\.[a-z0-9-]+)+$' or char_length(v_email) > 254) then
    v_email := null;
  end if;
  if v_email is null then
    update public.signals g set status = 'no_email', decided_at = now() where g.id = v_s.id;
    return 'no_email';
  end if;
  v_reason := private.campaign_company_known(p_workspace_id, v_s.company_domain, v_email);
  if v_reason is not null then
    update public.signals g set status = 'skipped', reason = v_reason, decided_at = now() where g.id = v_s.id;
    return 'skipped';
  end if;

  -- The workspace's one "Buying signals" campaign, its hidden search and its
  -- one run (finished: nothing is searched, the prospects come from here).
  select c.* into v_campaign from public.outbound_campaigns c
  where c.workspace_id = p_workspace_id and c.kind = 'signals'
  order by c.created_at limit 1;
  if not found then
    insert into public.prospect_searches (workspace_id, name, description, kind, created_by)
    values (p_workspace_id, 'Buying signals',
            'People whose company showed a buying signal the team chose to act on.', 'campaign', v_s.decided_by)
    returning id into v_search;
    insert into public.outbound_campaigns (workspace_id, kind, name, search_id, created_by, seeds_done)
    values (p_workspace_id, 'signals', 'Buying signals', v_search, v_s.decided_by, true)
    returning * into v_campaign;
  end if;
  select r.id into v_run from public.prospect_runs r
  where r.campaign_id = v_campaign.id and r.workspace_id = p_workspace_id
  order by r.created_at limit 1;
  if v_run is null then
    insert into public.prospect_runs (
      workspace_id, search_id, status, brief, target_count, started_by, finished_at, source, campaign_id
    ) values (
      p_workspace_id, v_campaign.search_id, 'done',
      jsonb_build_object('description', 'Buying signals', 'location', '', 'company_size', '', 'exclusions', ''),
      100, v_s.decided_by, now(), 'findymail', v_campaign.id
    )
    returning id into v_run;
  end if;

  insert into public.prospects (
    workspace_id, run_id, search_id, domain, website, company_name, research_status,
    source, summary, size_range, industries, country, contact_name, contact_role,
    contact_linkedin_url, email, email_kind, email_verified, facts, decision, play, campaign_id
  ) values (
    p_workspace_id, v_run, v_campaign.search_id, v_s.company_domain, 'https://' || v_s.company_domain || '/',
    v_s.company_name, 'found', 'findymail', '', v_s.company_size,
    case when v_s.company_industry <> '' then jsonb_build_array(v_s.company_industry) else '[]'::jsonb end,
    v_s.company_country, v_s.contact_name, v_s.contact_title, v_s.contact_linkedin_url,
    v_email, 'person', false,
    jsonb_build_array(jsonb_build_object(
      'fact', v_s.summary,
      'quote', coalesce(nullif(v_s.snippet, ''), v_s.summary),
      -- Where the signal was seen, when Findymail says (their profile).
      'source_url', coalesce(v_s.contact_linkedin_url, ''),
      'kind', 'signal'
    )),
    'kept', 'signal', v_campaign.id
  )
  on conflict (workspace_id, domain) do nothing
  returning id into v_prospect;
  if v_prospect is null then
    update public.signals g set status = 'skipped', reason = 'already_found', decided_at = now() where g.id = v_s.id;
    return 'skipped';
  end if;
  update public.signals g
  set status = 'kept', prospect_id = v_prospect, decided_at = now()
  where g.id = v_s.id;
  return 'kept';
end;
$$;

-- "Dismiss", by a member, signed in.
create function public.signal_dismiss(p_signal_id uuid)
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
  update public.signals g
  set status = 'dismissed', decided_by = v_user, decided_at = now()
  where g.id = p_signal_id and g.status = 'new'
    and (select private.is_workspace_member(g.workspace_id));
  return found;
end;
$$;

-- ---------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------
revoke all on function public.signal_monitor_begin(uuid, uuid, text, text, jsonb, jsonb, jsonb, integer, integer) from public, anon, authenticated;
revoke all on function public.signal_monitor_made(uuid, uuid, bigint, text) from public, anon, authenticated;
revoke all on function public.signal_monitor_remove(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.signal_monitor_removed(uuid, uuid) from public, anon, authenticated;
revoke all on function public.signal_pull_claim(integer, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.signal_ingest(uuid, uuid, jsonb, integer, integer, boolean) from public, anon, authenticated;
revoke all on function public.signal_pull_release(uuid, uuid) from public, anon, authenticated;
revoke all on function public.signal_keep_begin(uuid, uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.signal_keep_finish(uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.signal_monitor_begin(uuid, uuid, text, text, jsonb, jsonb, jsonb, integer, integer) to service_role;
grant execute on function public.signal_monitor_made(uuid, uuid, bigint, text) to service_role;
grant execute on function public.signal_monitor_remove(uuid, uuid, uuid) to service_role;
grant execute on function public.signal_monitor_removed(uuid, uuid) to service_role;
grant execute on function public.signal_pull_claim(integer, integer, integer, integer) to service_role;
grant execute on function public.signal_ingest(uuid, uuid, jsonb, integer, integer, boolean) to service_role;
grant execute on function public.signal_pull_release(uuid, uuid) to service_role;
grant execute on function public.signal_keep_begin(uuid, uuid, uuid, integer) to service_role;
grant execute on function public.signal_keep_finish(uuid, uuid, text, boolean) to service_role;
revoke all on function public.signal_dismiss(uuid) from public, anon;
grant execute on function public.signal_dismiss(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The scheduler
-- ---------------------------------------------------------------------------

-- Calls the app only when a monitor is due.
create function private.signal_cron_tick()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_token text;
begin
  if not exists (
    select 1 from public.signal_monitors s
    where s.status = 'active' and s.external_id is not null
      and (s.last_pulled_at is null or s.last_pulled_at < now() - interval '23 hours')
      and (s.locked_until is null or s.locked_until < now())
  ) then
    return;
  end if;
  select s.decrypted_secret into v_url from vault.decrypted_secrets s where s.name = 'dialvo_app_url';
  select s.decrypted_secret into v_token from vault.decrypted_secrets s where s.name = 'dialvo_cron_token';
  if v_url is null or v_token is null then
    return;
  end if;
  perform net.http_post(
    url := rtrim(v_url, '/') || '/api/prospects/signals/step',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_token),
    timeout_milliseconds := 58000
  );
end;
$$;
revoke all on function private.signal_cron_tick() from public;

do $do$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    execute 'create extension if not exists pg_cron with schema pg_catalog';
    execute 'create extension if not exists pg_net with schema extensions';
    execute $job$
      select cron.schedule('dialvo-signal-steps', '*/15 * * * *', 'select private.signal_cron_tick()')
    $job$;
  end if;
end;
$do$;
