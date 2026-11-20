-- "Find leads" with a contact database (Findymail). When the server has a
-- Findymail key, a run asks Findymail's Intellimatch for companies that match
-- the saved search, each with a named decision-maker and the work email
-- Findymail found and verified. Each company's own website is still read
-- afterwards, for the facts a first email can mention. Without the key,
-- runs search the web exactly as before.
--
-- Everything here is additive:
--   prospect_searches  + the Intellimatch query and job titles made from the
--                        search, which the team can see and edit
--   prospect_runs      + which source the run uses, and its Intellimatch
--                        progress (the export's hash, the page being read,
--                        when to ask again) and the credits it was allowed
--   prospects          + where it came from, the contact database's details
--                        (size, industries, country, match score, LinkedIn
--                        address) and whether the email was verified there
--   outbound_usage     + contact-database credits used today, for the cap
--   prospect_contact_settings (new): the workspace's Findymail exclusion
--                        list, so companies it already has aren't paid for
--                        again
--
-- One existing function is replaced: prospect_save_research learns that a
-- prospect from the contact database keeps that database's contact and
-- email. Its behaviour for web prospects is unchanged, line for line.

-- ---------------------------------------------------------------------------
-- prospect_searches: the query and titles, as the team will see them
-- ---------------------------------------------------------------------------
alter table public.prospect_searches
  add column contact_query text not null default ''
    check (char_length(contact_query) <= 1000),
  -- [["Owner", "Founder"], ["General Manager"]]: up to three tiers, tried in order.
  add column contact_titles jsonb not null default '[]'::jsonb
    check (jsonb_typeof(contact_titles) = 'array' and jsonb_array_length(contact_titles) <= 3),
  -- A fingerprint of the description, place, size and exclusions the query
  -- was written from, so the app can tell when it is out of date.
  add column contact_query_for text not null default ''
    check (char_length(contact_query_for) <= 80),
  -- True when a person wrote or changed the query: it is then never
  -- replaced without them asking.
  add column contact_query_edited boolean not null default false;

grant update (contact_query, contact_titles, contact_query_for, contact_query_edited)
  on public.prospect_searches to authenticated;

-- ---------------------------------------------------------------------------
-- prospect_runs: which source, and the contact database's progress
-- ---------------------------------------------------------------------------
alter table public.prospect_runs
  add column source text not null default 'web' check (source in ('web', 'findymail')),
  add column contact_query text check (contact_query is null or char_length(contact_query) <= 1000),
  add column contact_titles jsonb check (contact_titles is null or jsonb_typeof(contact_titles) = 'array'),
  -- start: nothing asked yet. wait: the export is being made. read: reading
  -- its pages. Null for web runs, and once the companies are stored.
  add column contact_phase text check (contact_phase is null or contact_phase in ('start', 'wait', 'read')),
  add column contact_hash text check (contact_hash is null or contact_hash ~ '^[A-Za-z0-9_-]{1,100}$'),
  add column contact_page integer not null default 1 check (contact_page between 1 and 1000),
  -- Don't ask Findymail again before this (polling, or its retry_after).
  add column contact_next_at timestamptz,
  add column contact_polls integer not null default 0,
  -- How many companies this run was allowed to ask for, after the caps.
  add column contact_limit integer check (contact_limit is null or contact_limit between 0 and 100),
  -- Rows the export returned, and the estimated credits they cost.
  add column contact_returned integer not null default 0,
  add column contact_credits integer not null default 0;

-- ---------------------------------------------------------------------------
-- prospects: where it came from, and the contact database's details
-- ---------------------------------------------------------------------------
alter table public.prospects
  add column source text not null default 'web' check (source in ('web', 'findymail')),
  add column external_id text check (external_id is null or char_length(external_id) <= 40),
  add column size_range text not null default '' check (char_length(size_range) <= 40),
  add column industries jsonb not null default '[]'::jsonb check (jsonb_typeof(industries) = 'array'),
  add column country text not null default '' check (char_length(country) <= 60),
  add column match_score integer check (match_score is null or match_score between 0 and 100),
  -- Stored as data only. Dialvo never reads LinkedIn.
  add column contact_linkedin_url text check (
    contact_linkedin_url is null
    or (contact_linkedin_url ~ '^https://([a-z]+\.)?linkedin\.com/' and char_length(contact_linkedin_url) <= 300)
  ),
  -- True when the address came from the contact database, which verifies
  -- the addresses it returns.
  add column email_verified boolean not null default false;

-- 'person' joins the kinds of address: a named contact's own work address.
-- And an address from the contact database has no web page to point to, so
-- "never without the page it was found on" becomes "never without its
-- source": the page for web prospects, the database for the others.
do $$
declare
  c record;
begin
  for c in
    select con.conname, pg_get_constraintdef(con.oid) as def
    from pg_constraint con
    where con.conrelid = 'public.prospects'::regclass and con.contype = 'c'
  loop
    if c.def like '%email_kind%' and c.def like '%free_mail%' and c.def not like '%email_source_url%' then
      execute format('alter table public.prospects drop constraint %I', c.conname);
    elsif c.def like '%email_source_url IS NOT NULL%' and c.def like '%email_kind IS NOT NULL%' then
      execute format('alter table public.prospects drop constraint %I', c.conname);
    end if;
  end loop;
end;
$$;
alter table public.prospects
  add constraint prospects_email_kind_known
    check (email_kind is null or email_kind in ('business', 'free_mail', 'person')),
  add constraint prospects_email_has_source
    check (email is null or (email_kind is not null and (email_source_url is not null or source = 'findymail'))),
  add constraint prospects_verified_only_from_database
    check (not email_verified or (source = 'findymail' and email is not null));

-- ---------------------------------------------------------------------------
-- outbound_usage: contact-database credits today
-- ---------------------------------------------------------------------------
alter table public.outbound_usage
  add column contact_credits integer not null default 0;

-- ---------------------------------------------------------------------------
-- prospect_contact_settings: one row per workspace, written by the server
-- ---------------------------------------------------------------------------
create table public.prospect_contact_settings (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  -- The workspace's own exclusion list in the Findymail account. Never the
  -- account's global list, which every workspace shares.
  exclusion_list_id bigint check (exclusion_list_id is null or exclusion_list_id > 0),
  -- Domains added since this moment haven't been sent to the list yet.
  exclusions_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.prospect_contact_settings enable row level security;

create trigger prospect_contact_settings_set_updated_at
  before update on public.prospect_contact_settings
  for each row execute function private.set_updated_at();

revoke all on public.prospect_contact_settings from anon, authenticated;
grant all on public.prospect_contact_settings to service_role;
grant select on public.prospect_contact_settings to authenticated;
create policy "Members read contact settings" on public.prospect_contact_settings
  for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));

-- ---------------------------------------------------------------------------
-- The server's side (secret key only)
-- ---------------------------------------------------------------------------

-- Today's contact-database credits for a workspace. Internal.
create function private.contact_credits_today(p_workspace_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select u.contact_credits from public.outbound_usage u
    where u.workspace_id = p_workspace_id and u.day = (now() at time zone 'utc')::date
  ), 0);
$$;
revoke all on function private.contact_credits_today(uuid) from public;

-- Starts a run that uses the contact database. The same checks and caps as
-- prospect_run_start (it is called inside the same transaction), and if a
-- run starts, it is marked as a contact-database run with the query and
-- titles it will use, before any step can see it.
create function public.prospect_contact_run_start(
  p_workspace_id uuid, p_search_id uuid, p_user_id uuid,
  p_target integer, p_max_runs_per_day integer, p_max_cost_micros_per_day bigint,
  p_query text, p_titles jsonb, p_max_credits_per_day integer, p_credits_per_company integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_started jsonb;
begin
  if char_length(btrim(coalesce(p_query, ''))) not between 3 and 1000
    or jsonb_typeof(coalesce(p_titles, 'null'::jsonb)) <> 'array'
    or jsonb_array_length(p_titles) > 3 then
    return jsonb_build_object('status', 'invalid');
  end if;
  -- Not even one company's worth of credits left today: don't start.
  if exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace_id and m.user_id = p_user_id
  ) and p_max_credits_per_day - private.contact_credits_today(p_workspace_id)
        < greatest(p_credits_per_company, 1) then
    return jsonb_build_object('status', 'capped');
  end if;
  v_started := public.prospect_run_start(
    p_workspace_id, p_search_id, p_user_id, p_target, p_max_runs_per_day, p_max_cost_micros_per_day
  );
  if v_started ->> 'status' = 'started' then
    update public.prospect_runs r
    set source = 'findymail', contact_query = btrim(p_query), contact_titles = p_titles,
        contact_phase = 'start'
    where r.id = (v_started ->> 'run_id')::uuid and r.workspace_id = p_workspace_id;
  end if;
  return v_started;
end;
$$;

-- Takes the lease for one contact-database step of a run that is still
-- looking for companies.
--   null                         no such run in this workspace
--   { "status": "not_contact" }  use prospect_run_claim (a web run, or a
--                                contact run that is past its search)
--   { "status": "busy" }         another step holds the lease
--   { "status": "waiting" }      too early to ask Findymail again
--   { "status": "stopped", "stop_reason": "contact_timeout" }
--   { "status": "searching", "phase", "hash", "page", "limit", "query",
--     "titles", "target_count", "credits_today", "exclusion_list_id",
--     "exclusions_synced_at" }
create function public.prospect_contact_claim(
  p_run_id uuid, p_workspace_id uuid, p_lease_seconds integer, p_max_polls integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.prospect_runs%rowtype;
  v_settings public.prospect_contact_settings%rowtype;
begin
  select r.* into v_run from public.prospect_runs r
  where r.id = p_run_id and r.workspace_id = p_workspace_id
  for update;
  if not found then
    return null;
  end if;
  if v_run.source <> 'findymail' or v_run.status <> 'searching' or v_run.contact_phase is null then
    return jsonb_build_object('status', 'not_contact');
  end if;
  if v_run.locked_until is not null and v_run.locked_until > now() then
    return jsonb_build_object('status', 'busy');
  end if;
  if v_run.contact_next_at is not null and v_run.contact_next_at > now() then
    return jsonb_build_object('status', 'waiting');
  end if;
  if v_run.contact_polls >= p_max_polls then
    update public.prospect_runs r
    set status = 'stopped', stop_reason = 'contact_timeout', finished_at = now(), locked_until = null
    where r.id = v_run.id;
    return jsonb_build_object('status', 'stopped', 'stop_reason', 'contact_timeout');
  end if;
  update public.prospect_runs r
  set locked_until = now() + make_interval(secs => greatest(p_lease_seconds, 1)),
      contact_polls = r.contact_polls + 1
  where r.id = v_run.id;
  select s.* into v_settings from public.prospect_contact_settings s
  where s.workspace_id = p_workspace_id;
  return jsonb_build_object(
    'status', 'searching',
    'phase', v_run.contact_phase,
    'hash', v_run.contact_hash,
    'page', v_run.contact_page,
    'limit', v_run.contact_limit,
    'query', v_run.contact_query,
    'titles', coalesce(v_run.contact_titles, '[]'::jsonb),
    'target_count', v_run.target_count,
    'credits_today', private.contact_credits_today(p_workspace_id),
    'exclusion_list_id', v_settings.exclusion_list_id,
    'exclusions_synced_at', v_settings.exclusions_synced_at
  );
end;
$$;

-- Reserves today's credits for the companies a run is about to ask for,
-- before anything is paid for. Grants as many companies as the day's cap
-- still allows (at most p_wanted), counts their credits at once, and returns
-- how many were granted. 0 means nothing may be asked for. Only once per
-- run: a second call returns what the first granted.
create function public.prospect_contact_reserve(
  p_run_id uuid, p_workspace_id uuid, p_wanted integer,
  p_credits_per_company integer, p_max_credits_per_day integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.prospect_runs%rowtype;
  v_used integer;
  v_granted integer;
  v_per integer := greatest(coalesce(p_credits_per_company, 1), 1);
begin
  select r.* into v_run from public.prospect_runs r
  where r.id = p_run_id and r.workspace_id = p_workspace_id and r.source = 'findymail'
  for update;
  if not found or v_run.status <> 'searching' or v_run.contact_phase <> 'start' then
    return 0;
  end if;
  if v_run.contact_limit is not null then
    return v_run.contact_limit;
  end if;
  -- The day's row, locked, so two runs can't both take the last credits.
  insert into public.outbound_usage (workspace_id, day)
  values (p_workspace_id, (now() at time zone 'utc')::date)
  on conflict (workspace_id, day) do nothing;
  select u.contact_credits into v_used from public.outbound_usage u
  where u.workspace_id = p_workspace_id and u.day = (now() at time zone 'utc')::date
  for update;
  v_granted := least(
    greatest(coalesce(p_wanted, 0), 0),
    v_run.target_count,
    greatest((coalesce(p_max_credits_per_day, 0) - v_used) / v_per, 0)
  );
  if v_granted <= 0 then
    return 0;
  end if;
  update public.outbound_usage u
  set contact_credits = u.contact_credits + v_granted * v_per
  where u.workspace_id = p_workspace_id and u.day = (now() at time zone 'utc')::date;
  update public.prospect_runs r
  set contact_limit = v_granted, contact_credits = v_granted * v_per
  where r.id = v_run.id;
  return v_granted;
end;
$$;

-- Records a contact-database step and releases the lease.
--   p_phase / p_hash / p_page   where the run is now (null keeps it)
--   p_wait_seconds              don't ask Findymail again for this long
--   p_refund_credits            credits reserved but not spent (the search
--                               was refused before anything was charged)
create function public.prospect_contact_step(
  p_run_id uuid, p_workspace_id uuid, p_phase text, p_hash text, p_page integer,
  p_wait_seconds integer, p_refund_credits integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.prospect_runs%rowtype;
  v_refund integer;
begin
  select r.* into v_run from public.prospect_runs r
  where r.id = p_run_id and r.workspace_id = p_workspace_id and r.source = 'findymail'
  for update;
  if not found then
    return;
  end if;
  v_refund := least(greatest(coalesce(p_refund_credits, 0), 0), v_run.contact_credits);
  if v_refund > 0 then
    update public.outbound_usage u
    set contact_credits = greatest(u.contact_credits - v_refund, 0)
    where u.workspace_id = p_workspace_id and u.day = (v_run.created_at at time zone 'utc')::date;
  end if;
  update public.prospect_runs r
  set contact_phase = case when r.status = 'searching' and p_phase in ('start', 'wait', 'read')
        then p_phase else r.contact_phase end,
      contact_hash = coalesce(p_hash, r.contact_hash),
      contact_page = coalesce(least(greatest(p_page, 1), 1000), r.contact_page),
      contact_next_at = case when p_wait_seconds is null then null
        else now() + make_interval(secs => least(greatest(p_wait_seconds, 0), 3600)) end,
      contact_credits = r.contact_credits - v_refund,
      locked_until = null
  where r.id = v_run.id;
end;
$$;

-- Stores one page of the contact database's results and releases the lease.
-- p_rows: [{ "domain", "company_name", "description", "size_range",
--   "industries": [...], "country", "match_score", "contact_name",
--   "contact_role", "email", "linkedin_url", "external_id" }, ...]
-- (already checked by the server). Left out, as for web runs: companies the
-- workspace already has as a prospect or a lead (by website, email domain or
-- address), and suppressed domains and addresses. A company an earlier run
-- found but never read is taken over, with these details.
-- p_returned is how many rows this page held before any were left out: the
-- contact database charges for every one. With p_last, the run's estimated
-- credits are settled (what wasn't returned is given back to the day) and
-- the run moves on to reading the companies' sites.
--   { "status": "searching" | "researching" | "done", "added": n }
create function public.prospect_contact_add(
  p_run_id uuid, p_workspace_id uuid, p_rows jsonb, p_returned integer,
  p_last boolean, p_credits_per_company integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.prospect_runs%rowtype;
  v_added integer := 0;
  v_have integer;
  v_status text;
  v_returned integer;
  v_spent integer;
  v_refund integer := 0;
  c record;
  v_domain text;
  v_email text;
  v_name text;
begin
  select r.* into v_run from public.prospect_runs r
  where r.id = p_run_id and r.workspace_id = p_workspace_id and r.source = 'findymail'
  for update;
  if not found or v_run.status <> 'searching' then
    return null;
  end if;
  select count(*) into v_have from public.prospects p
  where p.run_id = v_run.id and p.workspace_id = v_run.workspace_id;

  for c in
    select * from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as x(
      domain text, company_name text, description text, size_range text, industries jsonb,
      country text, match_score integer, contact_name text, contact_role text, email text,
      linkedin_url text, external_id text
    )
  loop
    exit when v_have + v_added >= v_run.target_count;
    v_domain := private.site_domain(c.domain);
    continue when v_domain is null or char_length(v_domain) > 253;
    v_email := nullif(lower(btrim(coalesce(c.email, ''))), '');
    continue when v_email is not null and v_email !~ '^[^\s@]+@[a-z0-9-]+(\.[a-z0-9-]+)+$';
    v_name := left(btrim(coalesce(c.contact_name, '')), 200);
    continue when private.outbound_is_suppressed(v_run.workspace_id, v_email, v_domain);
    continue when exists (
      select 1 from public.leads l
      where l.workspace_id = v_run.workspace_id
        and (private.site_domain(l.website) = v_domain
             or split_part(coalesce(l.email, ''), '@', 2) = v_domain
             or (v_email is not null and l.email = v_email))
    );
    continue when v_email is not null and exists (
      select 1 from public.prospects p
      where p.workspace_id = v_run.workspace_id and p.email = v_email and p.domain <> v_domain
    );
    insert into public.prospects (
      workspace_id, run_id, search_id, domain, website, company_name, created_at,
      source, external_id, summary, size_range, industries, country, match_score,
      contact_name, contact_role, contact_linkedin_url, email, email_kind, email_verified
    )
    values (
      v_run.workspace_id, v_run.id, v_run.search_id, v_domain, 'https://' || v_domain || '/',
      left(btrim(coalesce(c.company_name, '')), 200), clock_timestamp(),
      'findymail', left(c.external_id, 40), left(btrim(coalesce(c.description, '')), 400),
      left(btrim(coalesce(c.size_range, '')), 40),
      case when jsonb_typeof(c.industries) = 'array' then c.industries else '[]'::jsonb end,
      left(btrim(coalesce(c.country, '')), 60),
      case when c.match_score between 0 and 100 then c.match_score end,
      v_name, case when v_name = '' then '' else left(btrim(coalesce(c.contact_role, '')), 200) end,
      case when c.linkedin_url ~ '^https://([a-z]+\.)?linkedin\.com/' then left(c.linkedin_url, 300) end,
      v_email,
      case when v_email is null then null when v_name <> '' then 'person' else 'business' end,
      v_email is not null
    )
    on conflict (workspace_id, domain) do update
    set run_id = excluded.run_id, search_id = excluded.search_id, attempts = 0,
        created_at = excluded.created_at, source = excluded.source,
        external_id = excluded.external_id,
        company_name = coalesce(nullif(excluded.company_name, ''), prospects.company_name),
        summary = excluded.summary, size_range = excluded.size_range,
        industries = excluded.industries, country = excluded.country,
        match_score = excluded.match_score, contact_name = excluded.contact_name,
        contact_role = excluded.contact_role, contact_source_url = null,
        contact_linkedin_url = excluded.contact_linkedin_url, email = excluded.email,
        email_source_url = null, email_kind = excluded.email_kind,
        email_verified = excluded.email_verified
    where prospects.research_status = 'candidate' and prospects.run_id <> excluded.run_id;
    if found then
      v_added := v_added + 1;
    end if;
  end loop;

  v_returned := v_run.contact_returned + greatest(coalesce(p_returned, 0), 0);
  if coalesce(p_last, false) then
    v_spent := least(v_returned * greatest(coalesce(p_credits_per_company, 1), 1), v_run.contact_credits);
    v_refund := v_run.contact_credits - v_spent;
    if v_refund > 0 then
      update public.outbound_usage u
      set contact_credits = greatest(u.contact_credits - v_refund, 0)
      where u.workspace_id = p_workspace_id and u.day = (v_run.created_at at time zone 'utc')::date;
    end if;
    v_status := case when v_have + v_added = 0 then 'done' else 'researching' end;
  else
    v_status := 'searching';
  end if;

  update public.prospect_runs r
  set contact_returned = v_returned,
      contact_credits = r.contact_credits - v_refund,
      contact_page = case when coalesce(p_last, false) then r.contact_page else least(r.contact_page + 1, 1000) end,
      contact_phase = case when coalesce(p_last, false) then null else 'read' end,
      contact_next_at = null,
      search_rounds = r.search_rounds + case when coalesce(p_last, false) then 1 else 0 end,
      status = v_status,
      stop_reason = case when v_status = 'done' then 'nothing_found' else r.stop_reason end,
      finished_at = case when v_status = 'done' then now() else null end,
      locked_until = null
  where r.id = v_run.id;
  return jsonb_build_object('status', v_status, 'added', v_added);
end;
$$;

-- The domains to add to the workspace's Findymail exclusion list: suppressed
-- domains, every company it already has as a prospect, and its leads'
-- websites, added since the last sync (all of them the first time), at most
-- p_limit. Also returns the list's id and the moment this was read, to pass
-- to prospect_contact_synced once they have been sent.
create function public.prospect_contact_exclusions(p_workspace_id uuid, p_limit integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_settings public.prospect_contact_settings%rowtype;
  v_since timestamptz;
  v_domains jsonb;
begin
  select s.* into v_settings from public.prospect_contact_settings s
  where s.workspace_id = p_workspace_id;
  v_since := coalesce(v_settings.exclusions_synced_at, '-infinity'::timestamptz);
  select coalesce(jsonb_agg(d.domain), '[]'::jsonb) into v_domains from (
    select distinct k.domain from (
      select s.value as domain from public.outbound_suppressions s
      where s.workspace_id = p_workspace_id and s.kind = 'domain' and s.created_at > v_since
      union
      select p.domain from public.prospects p
      where p.workspace_id = p_workspace_id and p.updated_at > v_since
      union
      select private.site_domain(l.website) from public.leads l
      where l.workspace_id = p_workspace_id and l.website is not null and l.updated_at > v_since
    ) k
    where k.domain is not null
    order by k.domain
    limit greatest(coalesce(p_limit, 0), 0)
  ) d;
  return jsonb_build_object(
    'list_id', v_settings.exclusion_list_id,
    'read_at', now(),
    'domains', v_domains
  );
end;
$$;

-- Remembers the workspace's exclusion list.
create function public.prospect_contact_set_list(p_workspace_id uuid, p_list_id bigint)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.prospect_contact_settings (workspace_id, exclusion_list_id)
  values (p_workspace_id, p_list_id)
  on conflict (workspace_id) do update set exclusion_list_id = excluded.exclusion_list_id;
$$;

-- Everything read before p_at has been sent to the exclusion list.
create function public.prospect_contact_synced(p_workspace_id uuid, p_at timestamptz)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.prospect_contact_settings (workspace_id, exclusions_synced_at)
  values (p_workspace_id, p_at)
  on conflict (workspace_id) do update
  set exclusions_synced_at = greatest(
    coalesce(public.prospect_contact_settings.exclusions_synced_at, excluded.exclusions_synced_at),
    excluded.exclusions_synced_at
  );
$$;

-- ---------------------------------------------------------------------------
-- prospect_save_research, replaced. For a prospect from the contact
-- database, the site is read for facts only:
--   * its contact, title and email stay as the database returned them. An
--     address printed on the site is used only when the database returned
--     none (the server has already checked it against the usual rules);
--   * a site that can't be read, asks not to be read, or doesn't look like a
--     match on its own pages still leaves a found prospect (with the reason
--     kept in skip_reason as a note), because the database matched it and
--     its contact was paid for. Only a competitor or something that isn't a
--     business is left out.
-- For a web prospect, everything below the first block is the function as
-- it was.
-- ---------------------------------------------------------------------------
create or replace function public.prospect_save_research(
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
  v_note text;
  v_keep_contact boolean;
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

  -- From the contact database.
  if v_p.source = 'findymail' then
    if v_status = 'skipped'
      and coalesce(p_result ->> 'reason', '') in ('competitor', 'not_a_business') then
      update public.prospects p
      set research_status = 'skipped', skip_reason = left(p_result ->> 'reason', 60)
      where p.id = v_p.id;
      return 'skipped';
    end if;
    if v_status = 'retry' then
      v_note := 'unreadable';
    elsif v_status = 'skipped' then
      v_note := left(coalesce(nullif(p_result ->> 'reason', ''), 'not_a_match'), 60);
    elsif v_status <> 'found' then
      return 'ignored';
    end if;
    v_keep_contact := v_p.email is not null or v_p.contact_name <> '';
    -- The site's address only when the database had none.
    if v_status <> 'found' or v_p.email is not null
      or nullif(btrim(coalesce(p_result ->> 'email_source_url', '')), '') is null then
      v_email := null;
    end if;
    if private.outbound_is_suppressed(p_workspace_id, coalesce(v_p.email, v_email), v_p.domain) then
      v_reason := 'suppressed';
    elsif coalesce(v_p.email, v_email) is not null and exists (
      select 1 from public.leads l
      where l.workspace_id = p_workspace_id and l.email = coalesce(v_p.email, v_email)
    ) then
      v_reason := 'already_a_lead';
    end if;
    if v_reason is not null then
      update public.prospects p
      set research_status = 'skipped', skip_reason = v_reason
      where p.id = v_p.id;
      return 'skipped';
    end if;
    if v_status <> 'found' then
      update public.prospects p
      set research_status = 'found', skip_reason = v_note
      where p.id = v_p.id;
      return 'found';
    end if;
    update public.prospects p
    set research_status = 'found',
        skip_reason = null,
        company_name = coalesce(nullif(p.company_name, ''),
          nullif(left(btrim(coalesce(p_result ->> 'company_name', '')), 200), ''), p.company_name),
        website = case when coalesce(p_result ->> 'website', '') ~ '^https://'
          then left(p_result ->> 'website', 300) else p.website end,
        summary = coalesce(nullif(left(coalesce(p_result ->> 'summary', ''), 400), ''), p.summary),
        location = coalesce(nullif(left(coalesce(p_result ->> 'location', ''), 200), ''), p.location),
        contact_name = case when v_keep_contact then p.contact_name
          else left(coalesce(p_result ->> 'contact_name', ''), 200) end,
        contact_role = case when v_keep_contact then p.contact_role
          else left(coalesce(p_result ->> 'contact_role', ''), 200) end,
        contact_source_url = case when v_keep_contact then p.contact_source_url
          else nullif(left(coalesce(p_result ->> 'contact_source_url', ''), 2000), '') end,
        email = coalesce(p.email, v_email),
        email_source_url = case when p.email is not null then p.email_source_url
          when v_email is null then null else left(p_result ->> 'email_source_url', 2000) end,
        email_kind = case when p.email is not null then p.email_kind
          when v_email is null then null
          when p_result ->> 'email_kind' = 'free_mail' then 'free_mail' else 'business' end,
        phone = nullif(left(coalesce(p_result ->> 'phone', ''), 40), ''),
        phone_source_url = case when nullif(p_result ->> 'phone', '') is null then null
          else nullif(left(coalesce(p_result ->> 'phone_source_url', ''), 2000), '') end,
        facts = case when jsonb_typeof(p_result -> 'facts') = 'array' then p_result -> 'facts' else '[]'::jsonb end,
        pages = case when jsonb_typeof(p_result -> 'pages') = 'array' then p_result -> 'pages' else '[]'::jsonb end
    where p.id = v_p.id;
    return 'found';
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

-- ---------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------
revoke all on function public.prospect_contact_run_start(uuid, uuid, uuid, integer, integer, bigint, text, jsonb, integer, integer) from public, anon, authenticated;
revoke all on function public.prospect_contact_claim(uuid, uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.prospect_contact_reserve(uuid, uuid, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.prospect_contact_step(uuid, uuid, text, text, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.prospect_contact_add(uuid, uuid, jsonb, integer, boolean, integer) from public, anon, authenticated;
revoke all on function public.prospect_contact_exclusions(uuid, integer) from public, anon, authenticated;
revoke all on function public.prospect_contact_set_list(uuid, bigint) from public, anon, authenticated;
revoke all on function public.prospect_contact_synced(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.prospect_save_research(uuid, uuid, uuid, jsonb, bigint, bigint, bigint) from public, anon, authenticated;
grant execute on function public.prospect_contact_run_start(uuid, uuid, uuid, integer, integer, bigint, text, jsonb, integer, integer) to service_role;
grant execute on function public.prospect_contact_claim(uuid, uuid, integer, integer) to service_role;
grant execute on function public.prospect_contact_reserve(uuid, uuid, integer, integer, integer) to service_role;
grant execute on function public.prospect_contact_step(uuid, uuid, text, text, integer, integer, integer) to service_role;
grant execute on function public.prospect_contact_add(uuid, uuid, jsonb, integer, boolean, integer) to service_role;
grant execute on function public.prospect_contact_exclusions(uuid, integer) to service_role;
grant execute on function public.prospect_contact_set_list(uuid, bigint) to service_role;
grant execute on function public.prospect_contact_synced(uuid, timestamptz) to service_role;
grant execute on function public.prospect_save_research(uuid, uuid, uuid, jsonb, bigint, bigint, bigint) to service_role;
