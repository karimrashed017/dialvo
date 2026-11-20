-- Slice 3a: "Find leads". Dialvo looks for companies that match a workspace's
-- ideal customer, reads each company's own website, and drafts a first email
-- for the ones the team keeps. Nothing is sent in this slice.
--
-- Everything here is additive. Six new tables:
--   prospect_searches      who the workspace sells to, saved and reusable
--   prospect_runs          one "Find leads" run: its progress, counters and lease
--   prospects              the companies a run found, with research and sources
--   outbound_drafts        first emails waiting for a person's yes
--   outbound_suppressions  emails and domains never to contact
--   outbound_usage         what a workspace used today (for the daily caps)
--
-- Who writes what:
--   teammates (signed in, under row-level security): their saved searches,
--     Keep / Remove on a prospect, and the suppression list. Drafts and
--     "Add to leads" go through functions that check membership themselves.
--   the server (secret key only): everything a run does, and every counter.
--     The caps live in src/lib/prospects/config.ts and are passed in by the
--     server, so a signed-in person cannot start a run or raise a counter
--     through the API.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- "https://www.Example.com/about" -> "example.com". Null when there is no
-- host with a dot in it.
create function private.site_domain(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(
    substring(
      regexp_replace(lower(btrim(coalesce(p_value, ''))), '^[a-z][a-z0-9+.-]*://', '')
      from '^(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)'
    ),
    ''
  );
$$;
revoke all on function private.site_domain(text) from public;
grant execute on function private.site_domain(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- prospect_searches
-- ---------------------------------------------------------------------------
create table public.prospect_searches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  -- Who they sell to, in the team's own words.
  description text not null check (char_length(description) between 1 and 2000),
  location text not null default '' check (char_length(location) <= 200),
  company_size text not null default '' check (char_length(company_size) <= 200),
  -- Who to leave out.
  exclusions text not null default '' check (char_length(exclusions) <= 1000),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id)
);
alter table public.prospect_searches enable row level security;
create index prospect_searches_workspace_idx on public.prospect_searches (workspace_id, created_at desc);
create index prospect_searches_created_by_idx on public.prospect_searches (created_by);

create trigger prospect_searches_set_updated_at
  before update on public.prospect_searches
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- prospect_runs: one run of "Find leads". The server advances it in short
-- steps; locked_until is the lease that keeps two steps from overlapping and
-- lets a stalled run be picked up again once it expires.
-- ---------------------------------------------------------------------------
create table public.prospect_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  search_id uuid not null,
  status text not null default 'searching'
    check (status in ('searching', 'researching', 'done', 'stopped', 'failed')),
  -- Why it stopped early: daily_limit, too_many_steps, stopped_by_user,
  -- nothing_found, not_authorised, error.
  stop_reason text check (stop_reason is null or char_length(stop_reason) <= 60),
  -- The search as it was when the run started.
  brief jsonb not null check (jsonb_typeof(brief) = 'object'),
  target_count integer not null check (target_count between 1 and 100),
  search_rounds integer not null default 0,
  -- Rounds in a row that found nobody new.
  dry_rounds integer not null default 0,
  searches_used integer not null default 0,
  steps integer not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  -- Estimated spend in millionths of a US dollar.
  cost_micros bigint not null default 0,
  locked_until timestamptz,
  started_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (id, workspace_id),
  foreign key (search_id, workspace_id)
    references public.prospect_searches (id, workspace_id) on delete cascade
);
alter table public.prospect_runs enable row level security;
create index prospect_runs_workspace_idx on public.prospect_runs (workspace_id, created_at desc);
create index prospect_runs_search_idx on public.prospect_runs (search_id, workspace_id);
create index prospect_runs_started_by_idx on public.prospect_runs (started_by);
-- One run at a time per workspace.
create unique index prospect_runs_one_active_idx
  on public.prospect_runs (workspace_id) where status in ('searching', 'researching');

create trigger prospect_runs_set_updated_at
  before update on public.prospect_runs
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- prospects: a company a run found. One row per domain per workspace, so a
-- company is found once and a removed one doesn't come back.
-- ---------------------------------------------------------------------------
create table public.prospects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  run_id uuid not null,
  search_id uuid not null,
  domain text not null check (domain = lower(domain) and char_length(domain) between 3 and 253),
  company_name text not null default '' check (char_length(company_name) <= 200),
  website text not null check (website ~ '^https://' and char_length(website) <= 300),
  -- candidate: found by search, not read yet. researching: being read now.
  -- found: read and kept as a result. skipped: read and left out (see
  -- skip_reason). failed: the site couldn't be read.
  research_status text not null default 'candidate'
    check (research_status in ('candidate', 'researching', 'found', 'skipped', 'failed')),
  skip_reason text check (skip_reason is null or char_length(skip_reason) <= 60),
  attempts integer not null default 0,
  summary text not null default '' check (char_length(summary) <= 400),
  location text not null default '' check (char_length(location) <= 200),
  contact_name text not null default '' check (char_length(contact_name) <= 200),
  contact_role text not null default '' check (char_length(contact_role) <= 200),
  contact_source_url text check (contact_source_url is null or char_length(contact_source_url) <= 2000),
  email text check (email is null or (email = lower(email) and char_length(email) between 3 and 254)),
  email_source_url text check (email_source_url is null or char_length(email_source_url) <= 2000),
  -- business: on the company's own domain. free_mail: a free mailbox the
  -- company itself publishes as its contact address.
  email_kind text check (email_kind is null or email_kind in ('business', 'free_mail')),
  phone text check (phone is null or char_length(phone) between 3 and 40),
  phone_source_url text check (phone_source_url is null or char_length(phone_source_url) <= 2000),
  -- [{ "fact": "...", "quote": "...", "source_url": "https://..." }]
  facts jsonb not null default '[]'::jsonb check (jsonb_typeof(facts) = 'array'),
  -- The pages that were read: ["https://...", ...]
  pages jsonb not null default '[]'::jsonb check (jsonb_typeof(pages) = 'array'),
  decision text not null default 'undecided' check (decision in ('undecided', 'kept', 'removed')),
  lead_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (workspace_id, domain),
  -- An email address is never stored without the page it was found on.
  check (email is null or (email_source_url is not null and email_kind is not null)),
  foreign key (run_id, workspace_id)
    references public.prospect_runs (id, workspace_id) on delete cascade,
  foreign key (search_id, workspace_id)
    references public.prospect_searches (id, workspace_id) on delete cascade,
  foreign key (lead_id, workspace_id)
    references public.leads (id, workspace_id) on delete set null (lead_id)
);
alter table public.prospects enable row level security;
create index prospects_run_idx on public.prospects (run_id, workspace_id, research_status);
create index prospects_search_idx on public.prospects (search_id, workspace_id, created_at desc);
create index prospects_lead_idx on public.prospects (lead_id, workspace_id) where lead_id is not null;
create index prospects_email_idx on public.prospects (workspace_id, email) where email is not null;

create trigger prospects_set_updated_at
  before update on public.prospects
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- outbound_drafts: the first email to a kept prospect. 'approved' means
-- "ready to send". Nothing in this slice sends: a later slice sends approved
-- drafts once a mailbox is connected, and must check the suppression list
-- again when it does.
-- ---------------------------------------------------------------------------
create table public.outbound_drafts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  prospect_id uuid not null,
  agent_id uuid,
  to_email text not null check (to_email = lower(to_email) and char_length(to_email) between 3 and 254),
  subject text not null default '' check (char_length(subject) <= 200),
  body text not null default '' check (char_length(body) <= 5000),
  -- drafting: being written now. draft: waiting for a person. approved:
  -- ready to send. discarded: a person (or the suppression list) said no.
  -- failed: the draft couldn't be written.
  status text not null default 'drafting'
    check (status in ('drafting', 'draft', 'approved', 'discarded', 'failed')),
  discard_reason text check (discard_reason is null or char_length(discard_reason) <= 60),
  attempts integer not null default 1,
  edited boolean not null default false,
  model text check (model is null or char_length(model) <= 80),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One first email per prospect.
  unique (prospect_id),
  check (status not in ('draft', 'approved') or (char_length(subject) > 0 and char_length(body) > 0)),
  foreign key (prospect_id, workspace_id)
    references public.prospects (id, workspace_id) on delete cascade,
  foreign key (agent_id, workspace_id)
    references public.agents (id, workspace_id) on delete set null (agent_id)
);
alter table public.outbound_drafts enable row level security;
create index outbound_drafts_prospect_idx on public.outbound_drafts (prospect_id, workspace_id);
create index outbound_drafts_queue_idx on public.outbound_drafts (workspace_id, status, created_at desc);
create index outbound_drafts_agent_idx on public.outbound_drafts (agent_id, workspace_id) where agent_id is not null;
create index outbound_drafts_decided_by_idx on public.outbound_drafts (decided_by) where decided_by is not null;

create trigger outbound_drafts_set_updated_at
  before update on public.outbound_drafts
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- outbound_suppressions: never contact these.
-- ---------------------------------------------------------------------------
create table public.outbound_suppressions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  kind text not null check (kind in ('email', 'domain')),
  value text not null check (value = lower(value) and char_length(value) between 3 and 254),
  note text not null default '' check (char_length(note) <= 200),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (workspace_id, kind, value),
  check (
    (kind = 'email' and value ~ '^[^\s@]+@[a-z0-9-]+(\.[a-z0-9-]+)+$')
    or (kind = 'domain' and value ~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$')
  )
);
alter table public.outbound_suppressions enable row level security;
create index outbound_suppressions_created_by_idx on public.outbound_suppressions (created_by);

-- Is this address, or this company's site, on the workspace's list? A listed
-- domain covers its subdomains and every address at it.
create function private.outbound_is_suppressed(p_workspace_id uuid, p_email text, p_domain text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.outbound_suppressions s
    where s.workspace_id = p_workspace_id
      and (
        (s.kind = 'email' and s.value = lower(p_email))
        or (s.kind = 'domain' and (
          lower(split_part(coalesce(p_email, ''), '@', 2)) = s.value
          or lower(split_part(coalesce(p_email, ''), '@', 2)) like '%.' || s.value
          or lower(coalesce(p_domain, '')) = s.value
          or lower(coalesce(p_domain, '')) like '%.' || s.value
        ))
      )
  );
$$;
revoke all on function private.outbound_is_suppressed(uuid, text, text) from public;
grant execute on function private.outbound_is_suppressed(uuid, text, text) to service_role;

-- Adding to the list takes effect at once: emails to that address or domain
-- that were waiting or ready to send are discarded.
create function private.outbound_suppression_added()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.outbound_drafts d
  set status = 'discarded', discard_reason = 'suppressed', decided_at = now()
  from public.prospects p
  where d.workspace_id = new.workspace_id
    and d.status in ('drafting', 'draft', 'approved', 'failed')
    and p.id = d.prospect_id and p.workspace_id = d.workspace_id
    and (select private.outbound_is_suppressed(d.workspace_id, d.to_email, p.domain));
  return new;
end;
$$;
revoke all on function private.outbound_suppression_added() from public;

create trigger outbound_suppressions_added
  after insert on public.outbound_suppressions
  for each row execute function private.outbound_suppression_added();

-- ---------------------------------------------------------------------------
-- outbound_usage: one row per workspace per day (UTC). The daily caps are
-- counted against it.
-- ---------------------------------------------------------------------------
create table public.outbound_usage (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  day date not null,
  runs integer not null default 0,
  searches integer not null default 0,
  suggestions integer not null default 0,
  drafts integer not null default 0,
  cost_micros bigint not null default 0,
  primary key (workspace_id, day)
);
alter table public.outbound_usage enable row level security;

-- ---------------------------------------------------------------------------
-- Grants and policies
-- ---------------------------------------------------------------------------
revoke all on public.prospect_searches, public.prospect_runs, public.prospects,
  public.outbound_drafts, public.outbound_suppressions, public.outbound_usage
  from anon, authenticated;
grant all on public.prospect_searches, public.prospect_runs, public.prospects,
  public.outbound_drafts, public.outbound_suppressions, public.outbound_usage
  to service_role;

grant select on public.prospect_searches to authenticated;
grant insert (workspace_id, name, description, location, company_size, exclusions, created_by)
  on public.prospect_searches to authenticated;
grant update (name, description, location, company_size, exclusions)
  on public.prospect_searches to authenticated;

-- Runs, drafts and usage are written by the server only.
grant select on public.prospect_runs to authenticated;
grant select on public.outbound_drafts to authenticated;
grant select on public.outbound_usage to authenticated;

-- People decide Keep or Remove; the research itself is the server's.
grant select on public.prospects to authenticated;
grant update (decision) on public.prospects to authenticated;

grant select, delete on public.outbound_suppressions to authenticated;
grant insert (workspace_id, kind, value, note, created_by)
  on public.outbound_suppressions to authenticated;

create policy "Members read searches" on public.prospect_searches for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));
create policy "Members add searches" on public.prospect_searches for insert to authenticated
  with check ((select private.is_workspace_member(workspace_id)) and created_by = (select auth.uid()));
create policy "Members edit searches" on public.prospect_searches for update to authenticated
  using ((select private.is_workspace_member(workspace_id)))
  with check ((select private.is_workspace_member(workspace_id)));

create policy "Members read runs" on public.prospect_runs for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));

create policy "Members read prospects" on public.prospects for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));
create policy "Members keep or remove prospects" on public.prospects for update to authenticated
  using ((select private.is_workspace_member(workspace_id)))
  with check ((select private.is_workspace_member(workspace_id)));

create policy "Members read first-email drafts" on public.outbound_drafts for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));

create policy "Members read the suppression list" on public.outbound_suppressions for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));
create policy "Members add to the suppression list" on public.outbound_suppressions for insert to authenticated
  with check ((select private.is_workspace_member(workspace_id)) and created_by = (select auth.uid()));
-- Taking someone off the list lets them be contacted again: admins only.
create policy "Admins remove from the suppression list" on public.outbound_suppressions for delete to authenticated
  using ((select private.is_workspace_admin(workspace_id)));

create policy "Members read usage" on public.outbound_usage for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));

-- ---------------------------------------------------------------------------
-- The server's side (secret key only)
-- ---------------------------------------------------------------------------

-- Adds to today's counters and returns nothing. Internal.
create function private.outbound_usage_add(
  p_workspace_id uuid, p_cost_micros bigint, p_searches integer, p_drafts integer
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.outbound_usage as u (workspace_id, day, cost_micros, searches, drafts)
  values (
    p_workspace_id, (now() at time zone 'utc')::date,
    greatest(coalesce(p_cost_micros, 0), 0), greatest(coalesce(p_searches, 0), 0),
    greatest(coalesce(p_drafts, 0), 0)
  )
  on conflict (workspace_id, day) do update
  set cost_micros = u.cost_micros + excluded.cost_micros,
      searches = u.searches + excluded.searches,
      drafts = u.drafts + excluded.drafts;
$$;
revoke all on function private.outbound_usage_add(uuid, bigint, integer, integer) from public;

create function private.outbound_usage_json(p_workspace_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object(
       'runs', u.runs, 'searches', u.searches, 'suggestions', u.suggestions,
       'drafts', u.drafts, 'cost_micros', u.cost_micros)
     from public.outbound_usage u
     where u.workspace_id = p_workspace_id and u.day = (now() at time zone 'utc')::date),
    jsonb_build_object('runs', 0, 'searches', 0, 'suggestions', 0, 'drafts', 0, 'cost_micros', 0)
  );
$$;
revoke all on function private.outbound_usage_json(uuid) from public;

-- Counts one "suggest my ideal customer" call against today's cap. False
-- when the cap is used up (and nothing is counted).
create function public.outbound_take_suggestion(p_workspace_id uuid, p_user_id uuid, p_max integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_taken integer;
begin
  if not exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace_id and m.user_id = p_user_id
  ) then
    return false;
  end if;
  insert into public.outbound_usage as u (workspace_id, day, suggestions)
  values (p_workspace_id, (now() at time zone 'utc')::date, 1)
  on conflict (workspace_id, day) do update
  set suggestions = u.suggestions + 1
  where u.suggestions < p_max
  returning 1 into v_taken;
  return v_taken is not null and p_max > 0;
end;
$$;

-- Records what a model call outside a run cost (the suggestion).
create function public.outbound_record_spend(p_workspace_id uuid, p_cost_micros bigint)
returns void
language sql
security definer
set search_path = ''
as $$
  select private.outbound_usage_add(p_workspace_id, p_cost_micros, 0, 0);
$$;

-- Starts a run for a saved search, on behalf of a member.
--   { "status": "started", "run_id": ... }
--   { "status": "busy", "run_id": ... }   a run is already going
--   { "status": "capped" }                today's runs or spend are used up
--   { "status": "not_found" }             no such search, or not a member
create function public.prospect_run_start(
  p_workspace_id uuid, p_search_id uuid, p_user_id uuid,
  p_target integer, p_max_runs_per_day integer, p_max_cost_micros_per_day bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_search public.prospect_searches%rowtype;
  v_active uuid;
  v_run uuid;
  v_taken integer;
begin
  if not exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace_id and m.user_id = p_user_id
  ) then
    return jsonb_build_object('status', 'not_found');
  end if;
  select s.* into v_search from public.prospect_searches s
  where s.id = p_search_id and s.workspace_id = p_workspace_id;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  -- One at a time: starting twice returns the run that is already going.
  perform 1 from public.workspaces w where w.id = p_workspace_id for update;
  select r.id into v_active from public.prospect_runs r
  where r.workspace_id = p_workspace_id and r.status in ('searching', 'researching');
  if found then
    return jsonb_build_object('status', 'busy', 'run_id', v_active);
  end if;
  if (private.outbound_usage_json(p_workspace_id) ->> 'cost_micros')::bigint >= p_max_cost_micros_per_day then
    return jsonb_build_object('status', 'capped');
  end if;
  insert into public.outbound_usage as u (workspace_id, day, runs)
  values (p_workspace_id, (now() at time zone 'utc')::date, 1)
  on conflict (workspace_id, day) do update
  set runs = u.runs + 1
  where u.runs < p_max_runs_per_day
  returning 1 into v_taken;
  if v_taken is null or p_max_runs_per_day <= 0 then
    return jsonb_build_object('status', 'capped');
  end if;
  insert into public.prospect_runs (workspace_id, search_id, brief, target_count, started_by)
  values (
    p_workspace_id, p_search_id,
    jsonb_build_object(
      'description', v_search.description, 'location', v_search.location,
      'company_size', v_search.company_size, 'exclusions', v_search.exclusions
    ),
    least(greatest(p_target, 1), 100), p_user_id
  )
  returning id into v_run;
  return jsonb_build_object('status', 'started', 'run_id', v_run);
end;
$$;

-- Takes the run's lease for one step and says what the step should do.
--   null                      no such run in this workspace
--   { "status": "busy" }      another step holds the lease
--   { "status": "done" | "stopped" | "failed" }   nothing left to do
--   { "status": "searching", run, usage, known }  look for more companies
--   { "status": "researching", run, usage, work } read these companies' sites
-- A prospect left 'researching' by a step that died is handed out again,
-- up to p_max_attempts times, then marked failed.
create function public.prospect_run_claim(
  p_run_id uuid, p_workspace_id uuid, p_lease_seconds integer,
  p_batch integer, p_max_attempts integer, p_max_steps integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.prospect_runs%rowtype;
  v_work jsonb;
begin
  select r.* into v_run from public.prospect_runs r
  where r.id = p_run_id and r.workspace_id = p_workspace_id
  for update;
  if not found then
    return null;
  end if;
  if v_run.status not in ('searching', 'researching') then
    return jsonb_build_object('status', v_run.status, 'stop_reason', v_run.stop_reason);
  end if;
  if v_run.locked_until is not null and v_run.locked_until > now() then
    return jsonb_build_object('status', 'busy');
  end if;
  if v_run.steps >= p_max_steps then
    update public.prospect_runs r
    set status = 'stopped', stop_reason = 'too_many_steps', finished_at = now(), locked_until = null
    where r.id = v_run.id;
    return jsonb_build_object('status', 'stopped', 'stop_reason', 'too_many_steps');
  end if;

  if v_run.status = 'researching' then
    -- Whatever is still marked 'researching' belongs to a step that died:
    -- this step holds the lease, so nobody else is working on it.
    update public.prospects p
    set research_status = 'failed', skip_reason = 'unreadable'
    where p.run_id = v_run.id and p.workspace_id = v_run.workspace_id
      and p.research_status in ('candidate', 'researching') and p.attempts >= p_max_attempts;
    with picked as (
      select p.id from public.prospects p
      where p.run_id = v_run.id and p.workspace_id = v_run.workspace_id
        and p.research_status in ('candidate', 'researching')
      order by p.created_at, p.id
      limit greatest(p_batch, 1)
      for update
    ), marked as (
      update public.prospects p
      set research_status = 'researching', attempts = p.attempts + 1
      from picked where p.id = picked.id
      returning p.id, p.domain, p.website, p.company_name
    )
    select jsonb_agg(jsonb_build_object(
      'id', m.id, 'domain', m.domain, 'website', m.website, 'company_name', m.company_name
    )) into v_work from marked m;
    if v_work is null then
      update public.prospect_runs r
      set status = 'done', finished_at = now(), locked_until = null
      where r.id = v_run.id;
      return jsonb_build_object('status', 'done');
    end if;
  end if;

  update public.prospect_runs r
  set locked_until = now() + make_interval(secs => greatest(p_lease_seconds, 1)),
      steps = r.steps + 1
  where r.id = v_run.id;

  return jsonb_build_object(
    'status', v_run.status,
    'run', jsonb_build_object(
      'id', v_run.id, 'search_id', v_run.search_id, 'brief', v_run.brief,
      'target_count', v_run.target_count, 'search_rounds', v_run.search_rounds,
      'searches_used', v_run.searches_used, 'cost_micros', v_run.cost_micros,
      'found', (select count(*) from public.prospects p
                where p.run_id = v_run.id and p.workspace_id = v_run.workspace_id)
    ),
    'usage', private.outbound_usage_json(v_run.workspace_id),
    'work', coalesce(v_work, '[]'::jsonb),
    -- Companies this workspace already has, so the search asks for others.
    'known', coalesce((
      select jsonb_agg(k.domain) from (
        select p.domain from public.prospects p
        where p.workspace_id = v_run.workspace_id
        order by p.created_at desc
        limit 150
      ) k
    ), '[]'::jsonb)
  );
end;
$$;

-- Stores what one search round found and releases the lease.
-- p_candidates: [{ "domain", "website", "company_name" }, ...]
-- Left out: companies the workspace already has as a prospect or a lead
-- (by website or by email domain), and suppressed domains. Never more than
-- the run's target. Moves the run on to reading sites when it has enough,
-- has searched p_max_rounds times, or p_max_dry_rounds rounds in a row found
-- nobody new.
create function public.prospect_run_add_candidates(
  p_run_id uuid, p_workspace_id uuid, p_candidates jsonb,
  p_searches integer, p_input_tokens bigint, p_output_tokens bigint, p_cost_micros bigint,
  p_max_rounds integer, p_max_dry_rounds integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.prospect_runs%rowtype;
  v_have integer;
  v_added integer := 0;
  v_status text;
  c record;
  v_domain text;
begin
  select r.* into v_run from public.prospect_runs r
  where r.id = p_run_id and r.workspace_id = p_workspace_id
  for update;
  if not found or v_run.status <> 'searching' then
    return null;
  end if;
  select count(*) into v_have from public.prospects p
  where p.run_id = v_run.id and p.workspace_id = v_run.workspace_id;

  for c in
    select * from jsonb_to_recordset(coalesce(p_candidates, '[]'::jsonb))
      as x(domain text, website text, company_name text)
  loop
    exit when v_have + v_added >= v_run.target_count;
    v_domain := private.site_domain(c.domain);
    continue when v_domain is null or char_length(v_domain) > 253;
    continue when private.outbound_is_suppressed(v_run.workspace_id, null, v_domain);
    continue when exists (
      select 1 from public.leads l
      where l.workspace_id = v_run.workspace_id
        and (private.site_domain(l.website) = v_domain
             or split_part(coalesce(l.email, ''), '@', 2) = v_domain)
    );
    -- clock_timestamp(), not now(): rows of one call keep the order the
    -- search listed them in, which is the order they are read and shown in.
    insert into public.prospects (workspace_id, run_id, search_id, domain, website, company_name, created_at)
    values (
      v_run.workspace_id, v_run.id, v_run.search_id, v_domain,
      'https://' || v_domain || '/', left(btrim(coalesce(c.company_name, '')), 200),
      clock_timestamp()
    )
    -- A company an earlier run found but never got to read (that run was
    -- stopped first) is taken over by this run. Anything else stays as it is.
    on conflict (workspace_id, domain) do update
    set run_id = excluded.run_id, search_id = excluded.search_id, attempts = 0,
        created_at = excluded.created_at
    where prospects.research_status = 'candidate' and prospects.run_id <> excluded.run_id;
    if found then
      v_added := v_added + 1;
    end if;
  end loop;

  v_status := case
    when v_have + v_added >= v_run.target_count
      or v_run.search_rounds + 1 >= p_max_rounds
      or (v_added = 0 and v_run.dry_rounds + 1 >= p_max_dry_rounds)
    then case when v_have + v_added = 0 then 'done' else 'researching' end
    else 'searching'
  end;

  update public.prospect_runs r
  set search_rounds = r.search_rounds + 1,
      dry_rounds = case when v_added = 0 then r.dry_rounds + 1 else 0 end,
      searches_used = r.searches_used + greatest(coalesce(p_searches, 0), 0),
      input_tokens = r.input_tokens + greatest(coalesce(p_input_tokens, 0), 0),
      output_tokens = r.output_tokens + greatest(coalesce(p_output_tokens, 0), 0),
      cost_micros = r.cost_micros + greatest(coalesce(p_cost_micros, 0), 0),
      status = v_status,
      stop_reason = case when v_status = 'done' then 'nothing_found' else r.stop_reason end,
      finished_at = case when v_status = 'done' then now() else null end,
      locked_until = null
  where r.id = v_run.id;
  perform private.outbound_usage_add(v_run.workspace_id, p_cost_micros, p_searches, 0);
  return jsonb_build_object('status', v_status, 'added', v_added);
end;
$$;

-- Stores what was read about one company. Only a prospect this run marked
-- 'researching' can be written, once: a late or repeated call changes
-- nothing. p_result:
--   { "status": "found", "company_name", "website", "summary", "location",
--     "contact_name", "contact_role", "contact_source_url",
--     "email", "email_source_url", "email_kind",
--     "phone", "phone_source_url", "facts": [...], "pages": [...] }
--   { "status": "skipped", "reason": "..." }
--   { "status": "retry" }   the site couldn't be read this time
-- A found company whose address is on the suppression list, or is already a
-- lead's address, is stored as skipped instead.
create function public.prospect_save_research(
  p_run_id uuid, p_workspace_id uuid, p_prospect_id uuid, p_result jsonb,
  p_input_tokens bigint, p_output_tokens bigint, p_cost_micros bigint
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.prospects%rowtype;
  v_status text := p_result ->> 'status';
  v_email text := nullif(lower(btrim(coalesce(p_result ->> 'email', ''))), '');
  v_reason text;
begin
  update public.prospect_runs r
  set input_tokens = r.input_tokens + greatest(coalesce(p_input_tokens, 0), 0),
      output_tokens = r.output_tokens + greatest(coalesce(p_output_tokens, 0), 0),
      cost_micros = r.cost_micros + greatest(coalesce(p_cost_micros, 0), 0)
  where r.id = p_run_id and r.workspace_id = p_workspace_id;
  if not found then
    return null;
  end if;
  perform private.outbound_usage_add(p_workspace_id, p_cost_micros, 0, 0);

  select p.* into v_p from public.prospects p
  where p.id = p_prospect_id and p.run_id = p_run_id and p.workspace_id = p_workspace_id
    and p.research_status = 'researching'
  for update;
  if not found then
    return 'ignored';
  end if;

  if v_status = 'retry' then
    update public.prospects p set research_status = 'candidate' where p.id = v_p.id;
    return 'retry';
  end if;

  if v_status = 'found' then
    if private.outbound_is_suppressed(p_workspace_id, v_email, v_p.domain) then
      v_reason := 'suppressed';
    elsif v_email is not null and exists (
      select 1 from public.leads l where l.workspace_id = p_workspace_id and l.email = v_email
    ) then
      v_reason := 'already_a_lead';
    elsif v_email is not null
      and nullif(btrim(coalesce(p_result ->> 'email_source_url', '')), '') is null then
      -- No source, no address.
      v_email := null;
    end if;
  elsif v_status = 'skipped' then
    v_reason := left(coalesce(nullif(p_result ->> 'reason', ''), 'not_a_match'), 60);
  else
    return 'ignored';
  end if;

  if v_reason is not null then
    update public.prospects p
    set research_status = 'skipped', skip_reason = v_reason,
        company_name = coalesce(nullif(left(btrim(coalesce(p_result ->> 'company_name', '')), 200), ''), p.company_name)
    where p.id = v_p.id;
    return 'skipped';
  end if;

  update public.prospects p
  set research_status = 'found',
      company_name = coalesce(nullif(left(btrim(coalesce(p_result ->> 'company_name', '')), 200), ''), p.company_name),
      website = case when coalesce(p_result ->> 'website', '') ~ '^https://'
        then left(p_result ->> 'website', 300) else p.website end,
      summary = left(coalesce(p_result ->> 'summary', ''), 400),
      location = left(coalesce(p_result ->> 'location', ''), 200),
      contact_name = left(coalesce(p_result ->> 'contact_name', ''), 200),
      contact_role = left(coalesce(p_result ->> 'contact_role', ''), 200),
      contact_source_url = nullif(left(coalesce(p_result ->> 'contact_source_url', ''), 2000), ''),
      email = v_email,
      email_source_url = case when v_email is null then null
        else left(p_result ->> 'email_source_url', 2000) end,
      email_kind = case when v_email is null then null
        when p_result ->> 'email_kind' = 'free_mail' then 'free_mail' else 'business' end,
      phone = nullif(left(coalesce(p_result ->> 'phone', ''), 40), ''),
      phone_source_url = case when nullif(p_result ->> 'phone', '') is null then null
        else nullif(left(coalesce(p_result ->> 'phone_source_url', ''), 2000), '') end,
      facts = case when jsonb_typeof(p_result -> 'facts') = 'array' then p_result -> 'facts' else '[]'::jsonb end,
      pages = case when jsonb_typeof(p_result -> 'pages') = 'array' then p_result -> 'pages' else '[]'::jsonb end
  where p.id = v_p.id;
  return 'found';
end;
$$;

-- Ends a step: releases the lease and, with p_status, ends the run
-- ('stopped' or 'failed', with a reason).
create function public.prospect_run_release(
  p_run_id uuid, p_workspace_id uuid, p_status text default null, p_reason text default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.prospect_runs r
  set locked_until = null,
      status = case when p_status in ('stopped', 'failed') then p_status else r.status end,
      stop_reason = case when p_status in ('stopped', 'failed') then left(p_reason, 60) else r.stop_reason end,
      finished_at = case when p_status in ('stopped', 'failed') then now() else r.finished_at end
  where r.id = p_run_id and r.workspace_id = p_workspace_id
    and r.status in ('searching', 'researching');
$$;

-- Picks the next kept prospects that need a first email, and reserves a
-- draft row for each so two callers never write the same one. Returns what
-- the writer needs: the workspace, the outbound agent's instructions, the
-- knowledge, and each prospect's research.
--   { "capped": bool, "remaining": n, "context": {...}, "drafts": [...] }
-- Left out: prospects with no email, suppressed addresses, and prospects
-- whose lead is marked do not contact.
create function public.outbound_draft_claim(
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
  p record;
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

  for p in
    select pr.*, d.id as draft_id
    from public.prospects pr
    left join public.outbound_drafts d
      on d.prospect_id = pr.id and d.workspace_id = pr.workspace_id
    left join public.leads l on l.id = pr.lead_id and l.workspace_id = pr.workspace_id
    where pr.workspace_id = p_workspace_id
      and pr.decision = 'kept' and pr.research_status = 'found' and pr.email is not null
      and not coalesce(l.do_not_contact, false)
      and not (select private.outbound_is_suppressed(pr.workspace_id, pr.email, pr.domain))
      and (
        d.id is null
        or (d.status = 'failed' and d.attempts < p_max_attempts)
        -- A draft left 'drafting' by a call that died.
        or (d.status = 'drafting' and d.updated_at < now() - interval '2 minutes'
            and d.attempts < p_max_attempts)
      )
    order by pr.created_at, pr.id
    limit greatest(v_room, 0)
    for update of pr
  loop
    if p.draft_id is null then
      insert into public.outbound_drafts (workspace_id, prospect_id, agent_id, to_email)
      values (p_workspace_id, p.id, v_agent.id, p.email)
      returning id into v_id;
    else
      update public.outbound_drafts d
      set status = 'drafting', attempts = d.attempts + 1, to_email = p.email
      where d.id = p.draft_id
      returning d.id into v_id;
    end if;
    v_drafts := v_drafts || jsonb_build_object(
      'draft_id', v_id,
      'prospect', jsonb_build_object(
        'company_name', p.company_name, 'website', p.website, 'summary', p.summary,
        'location', p.location, 'contact_name', p.contact_name,
        'contact_role', p.contact_role, 'facts', p.facts
      )
    );
  end loop;
  perform private.outbound_usage_add(p_workspace_id, 0, 0, jsonb_array_length(v_drafts));

  select count(*) into v_remaining
  from public.prospects pr
  left join public.outbound_drafts d
    on d.prospect_id = pr.id and d.workspace_id = pr.workspace_id
  left join public.leads l on l.id = pr.lead_id and l.workspace_id = pr.workspace_id
  where pr.workspace_id = p_workspace_id
    and pr.decision = 'kept' and pr.research_status = 'found' and pr.email is not null
    and not coalesce(l.do_not_contact, false)
    and not (select private.outbound_is_suppressed(pr.workspace_id, pr.email, pr.domain))
    and (d.id is null or (d.status = 'failed' and d.attempts < p_max_attempts));

  return jsonb_build_object(
    'capped', v_room <= 0,
    'remaining', v_remaining,
    'drafts', v_drafts,
    'context', jsonb_build_object(
      'workspace', jsonb_build_object('name', v_ws.name, 'website', v_ws.website),
      -- Whose name goes under the email: the teammate who asked for the drafts.
      'sender_name', coalesce((select pf.name from public.profiles pf where pf.id = p_user_id), ''),
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

-- Stores a written draft (or that writing it failed) on a row reserved by
-- outbound_draft_claim. Only a row still 'drafting' changes.
create function public.outbound_draft_save(
  p_workspace_id uuid, p_draft_id uuid, p_ok boolean,
  p_subject text, p_body text, p_model text, p_cost_micros bigint
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ok boolean := coalesce(p_ok, false)
    and char_length(btrim(coalesce(p_subject, ''))) between 1 and 200
    and char_length(btrim(coalesce(p_body, ''))) between 1 and 5000;
begin
  perform private.outbound_usage_add(p_workspace_id, p_cost_micros, 0, 0);
  update public.outbound_drafts d
  set status = case when v_ok then 'draft' else 'failed' end,
      subject = case when v_ok then btrim(p_subject) else d.subject end,
      body = case when v_ok then btrim(p_body) else d.body end,
      model = left(p_model, 80)
  where d.id = p_draft_id and d.workspace_id = p_workspace_id and d.status = 'drafting';
  if not found then
    return 'ignored';
  end if;
  return case when v_ok then 'draft' else 'failed' end;
end;
$$;

-- ---------------------------------------------------------------------------
-- Teammates' side (signed in). Each function checks membership itself.
-- ---------------------------------------------------------------------------

-- Approve, edit or discard a first email.
--   'approve': a waiting draft becomes ready to send, with the edits if any.
--   'save':    keep the edits, don't change whether it is approved.
--   'discard': a waiting or approved draft is dropped.
--   'reopen':  an approved draft goes back to waiting.
-- Approving is refused when the address is on the suppression list or the
-- lead is marked do not contact.
create function public.outbound_draft_decide(
  p_draft_id uuid, p_action text, p_subject text default null, p_body text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_d public.outbound_drafts%rowtype;
  v_p public.prospects%rowtype;
  v_subject text;
  v_body text;
  v_edited boolean;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  select d.* into v_d from public.outbound_drafts d
  where d.id = p_draft_id and d.status in ('draft', 'approved')
    and (select private.is_workspace_member(d.workspace_id))
  for update;
  if not found then
    raise exception 'draft not found' using errcode = 'P0002';
  end if;
  select p.* into v_p from public.prospects p
  where p.id = v_d.prospect_id and p.workspace_id = v_d.workspace_id;

  if p_action = 'discard' then
    update public.outbound_drafts d
    set status = 'discarded', discard_reason = 'by_person', decided_by = v_user, decided_at = now()
    where d.id = v_d.id;
    return 'discarded';
  end if;
  if p_action = 'reopen' then
    update public.outbound_drafts d
    set status = 'draft', decided_by = null, decided_at = null
    where d.id = v_d.id and d.status = 'approved';
    return 'draft';
  end if;
  if p_action not in ('approve', 'save') then
    raise exception 'unknown action' using errcode = '22023';
  end if;

  -- One line for the subject; plain text for the body.
  v_subject := coalesce(
    nullif(btrim(regexp_replace(coalesce(p_subject, ''), '\s+', ' ', 'g')), ''), v_d.subject);
  v_body := coalesce(nullif(btrim(coalesce(p_body, '')), ''), v_d.body);
  if char_length(v_subject) > 200 or char_length(v_body) > 5000 then
    raise exception 'the subject or the email is too long' using errcode = '22023';
  end if;
  v_edited := v_d.edited or v_subject is distinct from v_d.subject or v_body is distinct from v_d.body;

  if p_action = 'approve' then
    if private.outbound_is_suppressed(v_d.workspace_id, v_d.to_email, v_p.domain) then
      raise exception 'that address is on the suppression list' using errcode = 'P0001';
    end if;
    if exists (
      select 1 from public.leads l
      where l.workspace_id = v_d.workspace_id and l.do_not_contact
        and (l.id = v_p.lead_id or l.email = v_d.to_email)
    ) then
      raise exception 'that lead is marked do not contact' using errcode = 'P0001';
    end if;
  end if;

  update public.outbound_drafts d
  set subject = v_subject, body = v_body, edited = v_edited,
      status = case when p_action = 'approve' then 'approved' else d.status end,
      decided_by = case when p_action = 'approve' then v_user else d.decided_by end,
      decided_at = case when p_action = 'approve' then now() else d.decided_at end
  where d.id = v_d.id;
  return case when p_action = 'approve' then 'approved' else v_d.status end;
end;
$$;

-- Approves every waiting draft in the list that may be approved, and says
-- how many. Suppressed and do-not-contact ones are left as they are.
create function public.outbound_drafts_approve(p_draft_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_count integer;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  update public.outbound_drafts d
  set status = 'approved', decided_by = v_user, decided_at = now()
  from public.prospects p
  where d.id = any (coalesce(p_draft_ids, '{}'::uuid[])) and d.status = 'draft'
    and (select private.is_workspace_member(d.workspace_id))
    and p.id = d.prospect_id and p.workspace_id = d.workspace_id
    and not (select private.outbound_is_suppressed(d.workspace_id, d.to_email, p.domain))
    and not exists (
      select 1 from public.leads l
      where l.workspace_id = d.workspace_id and l.do_not_contact
        and (l.id = p.lead_id or l.email = d.to_email)
    );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- "Add to leads": every kept, researched prospect of the workspace (or of
-- one search) that isn't a lead yet becomes one, with source "found by
-- Dialvo" and the research on the lead and its timeline. A prospect whose
-- address already belongs to a lead is linked to that lead instead. Prospects
-- with neither an email nor a phone number stay where they are.
--   { "added": n, "linked": n, "no_contact": n }
create function public.prospects_add_to_leads(p_workspace_id uuid, p_search_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_added integer := 0;
  v_linked integer := 0;
  v_no_contact integer := 0;
  v_lead uuid;
  v_facts text;
  p public.prospects%rowtype;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if not (select private.is_workspace_member(p_workspace_id)) then
    raise exception 'workspace not found' using errcode = 'P0002';
  end if;
  for p in
    select pr.* from public.prospects pr
    where pr.workspace_id = p_workspace_id
      and (p_search_id is null or pr.search_id = p_search_id)
      and pr.decision = 'kept' and pr.research_status = 'found' and pr.lead_id is null
    order by pr.created_at, pr.id
    for update
  loop
    if p.email is null and p.phone is null then
      v_no_contact := v_no_contact + 1;
      continue;
    end if;
    v_lead := null;
    if p.email is not null then
      select l.id into v_lead from public.leads l
      where l.workspace_id = p_workspace_id and l.email = p.email;
    end if;
    if v_lead is not null then
      update public.prospects pr set lead_id = v_lead where pr.id = p.id;
      v_linked := v_linked + 1;
      continue;
    end if;
    insert into public.leads (workspace_id, name, email, phone, company, website, source, custom_fields)
    values (
      p_workspace_id, p.contact_name, p.email, p.phone,
      nullif(p.company_name, ''), p.website, 'found by Dialvo',
      jsonb_build_object('research', jsonb_build_object(
        'summary', p.summary, 'location', p.location, 'contact_role', p.contact_role,
        'email_source_url', p.email_source_url, 'phone_source_url', p.phone_source_url,
        'facts', p.facts, 'pages', p.pages, 'prospect_id', p.id
      ))
    )
    returning id into v_lead;
    update public.prospects pr set lead_id = v_lead where pr.id = p.id;
    select string_agg('- ' || (f ->> 'fact') || ' (' || (f ->> 'source_url') || ')', E'\n')
      into v_facts from jsonb_array_elements(p.facts) f;
    insert into public.activity_events (workspace_id, lead_id, actor_id, kind, summary, channel, metadata)
    values (
      p_workspace_id, v_lead, v_user, 'lead_created',
      left(
        'Found by Dialvo on the web and added to leads.'
        || case when p.summary <> '' then E'\nWhat they do: ' || p.summary else '' end
        || case when p.location <> '' then E'\nWhere: ' || p.location else '' end
        || case when p.contact_role <> '' then E'\nContact''s role: ' || p.contact_role else '' end
        || case when p.email_source_url is not null then E'\nEmail found on: ' || p.email_source_url else '' end
        || case when v_facts is not null then E'\nFrom their website:\n' || v_facts else '' end,
        5000
      ),
      null, jsonb_build_object('prospect_id', p.id, 'via', 'find_leads')
    );
    v_added := v_added + 1;
  end loop;
  return jsonb_build_object('added', v_added, 'linked', v_linked, 'no_contact', v_no_contact);
end;
$$;

-- ---------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------
revoke all on function public.outbound_take_suggestion(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.outbound_record_spend(uuid, bigint) from public, anon, authenticated;
revoke all on function public.prospect_run_start(uuid, uuid, uuid, integer, integer, bigint) from public, anon, authenticated;
revoke all on function public.prospect_run_claim(uuid, uuid, integer, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.prospect_run_add_candidates(uuid, uuid, jsonb, integer, bigint, bigint, bigint, integer, integer) from public, anon, authenticated;
revoke all on function public.prospect_save_research(uuid, uuid, uuid, jsonb, bigint, bigint, bigint) from public, anon, authenticated;
revoke all on function public.prospect_run_release(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.outbound_draft_claim(uuid, uuid, integer, integer, bigint, integer) from public, anon, authenticated;
revoke all on function public.outbound_draft_save(uuid, uuid, boolean, text, text, text, bigint) from public, anon, authenticated;
grant execute on function public.outbound_take_suggestion(uuid, uuid, integer) to service_role;
grant execute on function public.outbound_record_spend(uuid, bigint) to service_role;
grant execute on function public.prospect_run_start(uuid, uuid, uuid, integer, integer, bigint) to service_role;
grant execute on function public.prospect_run_claim(uuid, uuid, integer, integer, integer, integer) to service_role;
grant execute on function public.prospect_run_add_candidates(uuid, uuid, jsonb, integer, bigint, bigint, bigint, integer, integer) to service_role;
grant execute on function public.prospect_save_research(uuid, uuid, uuid, jsonb, bigint, bigint, bigint) to service_role;
grant execute on function public.prospect_run_release(uuid, uuid, text, text) to service_role;
grant execute on function public.outbound_draft_claim(uuid, uuid, integer, integer, bigint, integer) to service_role;
grant execute on function public.outbound_draft_save(uuid, uuid, boolean, text, text, text, bigint) to service_role;

revoke all on function public.outbound_draft_decide(uuid, text, text, text) from public, anon;
revoke all on function public.outbound_drafts_approve(uuid[]) from public, anon;
revoke all on function public.prospects_add_to_leads(uuid, uuid) from public, anon;
grant execute on function public.outbound_draft_decide(uuid, text, text, text) to authenticated;
grant execute on function public.outbound_drafts_approve(uuid[]) to authenticated;
grant execute on function public.prospects_add_to_leads(uuid, uuid) to authenticated;
