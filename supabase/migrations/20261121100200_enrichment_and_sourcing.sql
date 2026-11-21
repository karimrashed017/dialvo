-- Keeping lead data complete and current, and always-on market sourcing.
-- Additive. Builds on 20261121100000_data_lists and
-- 20261121100100_scores_accounts_audiences.
--
--   enrichment_settings  one row per workspace, off until an owner or admin
--                        switches it on: what to fill (work emails, titles,
--                        company details), whether to look for job changes
--                        and personal-email sign-ups, how often to refresh
--                        (monthly by default), the month's credit cap, and
--                        whether to write back to the connected CRM.
--   lead_enrichment      each lead's state: when it was last checked, when
--                        it is due again, what the contact database said
--                        (email check, title, company), under a lease.
--   enrichment_events    what changed and why (a field filled, a job
--                        change, an email that no longer works), shown on
--                        the page and written to the CRM as a note.
--   enrichment_usage     credits and leads per workspace per month (UTC).
--   sourcing_schedules   a saved Find leads search that runs on its own on a
--                        schedule (weekly by default) and adds the new
--                        companies it finds to a list, optionally answering
--                        a saved recipe for each. A Find leads run already
--                        leaves out companies in the leads, the CRM and the
--                        never-contact list; the list leaves out its own.
--   the scheduler        once a minute, only when there is work, the
--                        database calls POST <app>/api/data/step?job=cells
--                        (list cells), job=enrich and job=source, with the
--                        scheduler's token from Vault (as every other step).
--
-- Every email Dialvo fills in comes from the contact database's own lookup
-- (Findymail); none is ever made up from a name and a domain.

create table public.enrichment_settings (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  enabled boolean not null default false,
  fill_emails boolean not null default true,
  fill_titles boolean not null default true,
  fill_company boolean not null default true,
  job_changes boolean not null default true,
  personal_emails boolean not null default true,
  write_back boolean not null default true,
  refresh_days integer not null default 30 check (refresh_days between 7 and 365),
  monthly_credit_cap integer not null default 300 check (monthly_credit_cap between 0 and 100000),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.enrichment_settings enable row level security;
create index enrichment_settings_updated_by_idx on public.enrichment_settings (updated_by);

create table public.lead_enrichment (
  lead_id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  attempts integer not null default 0,
  locked_until timestamptz,
  last_checked_at timestamptz,
  next_due_at timestamptz,
  -- What the contact database said.
  email_status text check (email_status is null or email_status in ('valid', 'invalid', 'unknown')),
  work_email text check (work_email is null or (work_email = lower(work_email) and char_length(work_email) between 3 and 254)),
  profile_title text not null default '' check (char_length(profile_title) <= 200),
  profile_company text not null default '' check (char_length(profile_company) <= 200),
  profile_domain text check (profile_domain is null or char_length(profile_domain) <= 253),
  linkedin_url text check (linkedin_url is null or (linkedin_url ~ '^https://' and char_length(linkedin_url) <= 300)),
  last_error text check (last_error is null or char_length(last_error) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lead_id, workspace_id),
  foreign key (lead_id, workspace_id)
    references public.leads (id, workspace_id) on delete cascade
);
alter table public.lead_enrichment enable row level security;
create index lead_enrichment_workspace_idx on public.lead_enrichment (workspace_id, status);
create index lead_enrichment_due_idx on public.lead_enrichment (next_due_at) where status in ('done', 'failed');
create trigger lead_enrichment_set_updated_at
  before update on public.lead_enrichment
  for each row execute function private.set_updated_at();

create table public.enrichment_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  lead_id uuid not null,
  kind text not null check (kind in ('filled', 'job_change', 'email_invalid', 'work_email')),
  summary text not null check (char_length(summary) between 1 and 500),
  -- { "field": { "from": ..., "to": ... } }
  changes jsonb not null default '{}'::jsonb check (jsonb_typeof(changes) = 'object'),
  created_at timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (lead_id, workspace_id)
    references public.leads (id, workspace_id) on delete cascade
);
alter table public.enrichment_events enable row level security;
create index enrichment_events_workspace_idx on public.enrichment_events (workspace_id, created_at desc);
create index enrichment_events_lead_idx on public.enrichment_events (lead_id, workspace_id);

create table public.enrichment_usage (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  month date not null,
  credits integer not null default 0,
  leads integer not null default 0,
  primary key (workspace_id, month)
);
alter table public.enrichment_usage enable row level security;

create table public.sourcing_schedules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  search_id uuid not null,
  list_id uuid not null,
  recipe_id uuid,
  every_days integer not null default 7 check (every_days between 1 and 90),
  enabled boolean not null default true,
  -- idle: waiting for next_run_at. running: a Find leads run is under way.
  status text not null default 'idle' check (status in ('idle', 'running')),
  next_run_at timestamptz not null default now(),
  run_id uuid,
  locked_until timestamptz,
  last_run_at timestamptz,
  last_added integer not null default 0,
  last_note text not null default '' check (char_length(last_note) <= 300),
  -- Runs started this month (UTC), for the cap.
  month date,
  month_runs integer not null default 0,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (search_id, workspace_id)
    references public.prospect_searches (id, workspace_id) on delete cascade,
  foreign key (list_id, workspace_id)
    references public.data_lists (id, workspace_id) on delete cascade,
  foreign key (recipe_id, workspace_id)
    references public.data_recipes (id, workspace_id) on delete set null (recipe_id),
  foreign key (run_id, workspace_id)
    references public.prospect_runs (id, workspace_id) on delete set null (run_id),
  -- The person it runs as: if they leave the workspace, it stops.
  foreign key (workspace_id, created_by)
    references public.workspace_members (workspace_id, user_id) on delete cascade
);
alter table public.sourcing_schedules enable row level security;
create index sourcing_schedules_workspace_idx on public.sourcing_schedules (workspace_id, created_at);
create index sourcing_schedules_search_idx on public.sourcing_schedules (search_id, workspace_id);
create index sourcing_schedules_list_idx on public.sourcing_schedules (list_id, workspace_id);
create index sourcing_schedules_recipe_idx on public.sourcing_schedules (recipe_id, workspace_id) where recipe_id is not null;
create index sourcing_schedules_run_idx on public.sourcing_schedules (run_id, workspace_id) where run_id is not null;
create index sourcing_schedules_member_idx on public.sourcing_schedules (workspace_id, created_by);
create index sourcing_schedules_due_idx on public.sourcing_schedules (next_run_at) where enabled;
create trigger sourcing_schedules_set_updated_at
  before update on public.sourcing_schedules
  for each row execute function private.set_updated_at();

revoke all on public.enrichment_settings, public.lead_enrichment, public.enrichment_events,
  public.enrichment_usage, public.sourcing_schedules from anon, authenticated;
grant all on public.enrichment_settings, public.lead_enrichment, public.enrichment_events,
  public.enrichment_usage, public.sourcing_schedules to service_role;
grant select on public.enrichment_settings, public.lead_enrichment, public.enrichment_events,
  public.enrichment_usage, public.sourcing_schedules to authenticated;
create policy "Members read enrichment settings" on public.enrichment_settings for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));
create policy "Members read lead enrichment" on public.lead_enrichment for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));
create policy "Members read enrichment events" on public.enrichment_events for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));
create policy "Members read enrichment usage" on public.enrichment_usage for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));
create policy "Members read sourcing schedules" on public.sourcing_schedules for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));

-- ---------------------------------------------------------------------------
-- Enrichment
-- ---------------------------------------------------------------------------

-- Saves the settings, for an owner or admin. The credit cap can't go over
-- p_max_cap (src/lib/data/config.ts).
create function public.enrichment_save(
  p_workspace_id uuid, p_enabled boolean, p_fill_emails boolean, p_fill_titles boolean,
  p_fill_company boolean, p_job_changes boolean, p_personal_emails boolean, p_write_back boolean,
  p_refresh_days integer, p_monthly_cap integer, p_max_cap integer
)
returns void
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
  if not (select private.is_workspace_admin(p_workspace_id)) then
    raise exception 'only an owner or admin can change this' using errcode = '42501';
  end if;
  if coalesce(p_refresh_days, 0) not between 7 and 365
     or coalesce(p_monthly_cap, -1) not between 0 and least(p_max_cap, 100000) then
    raise exception 'those settings are out of range' using errcode = '22023';
  end if;
  insert into public.enrichment_settings as s (workspace_id, enabled, fill_emails, fill_titles, fill_company,
    job_changes, personal_emails, write_back, refresh_days, monthly_credit_cap, updated_by, updated_at)
  values (p_workspace_id, coalesce(p_enabled, false), coalesce(p_fill_emails, false), coalesce(p_fill_titles, false),
          coalesce(p_fill_company, false), coalesce(p_job_changes, false), coalesce(p_personal_emails, false),
          coalesce(p_write_back, false), p_refresh_days, p_monthly_cap, v_user, now())
  on conflict (workspace_id) do update
  set enabled = excluded.enabled, fill_emails = excluded.fill_emails, fill_titles = excluded.fill_titles,
      fill_company = excluded.fill_company, job_changes = excluded.job_changes,
      personal_emails = excluded.personal_emails, write_back = excluded.write_back,
      refresh_days = excluded.refresh_days, monthly_credit_cap = excluded.monthly_credit_cap,
      updated_by = v_user, updated_at = now();
end;
$$;
revoke all on function public.enrichment_save(uuid, boolean, boolean, boolean, boolean, boolean, boolean, boolean, integer, integer, integer) from public, anon;
grant execute on function public.enrichment_save(uuid, boolean, boolean, boolean, boolean, boolean, boolean, boolean, integer, integer, integer) to authenticated;

-- Queues the leads that are due: never checked, due again after the
-- refresh period, or whose email bounced since the last check. Only in
-- workspaces that switched it on and have credits left this month. At most
-- p_limit per workspace per call. Internal; also used by "Check now".
-- A lead is worth checking only if something could be filled or changed:
-- it has an email (to check, or to look up a profile), or a name and a
-- company domain (to find a work email).
create function private.enrichment_queue_due(p_limit integer, p_workspace_id uuid default null, p_force boolean default false)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s public.enrichment_settings%rowtype;
  v_month date := date_trunc('month', now() at time zone 'utc')::date;
  v_count integer := 0;
  v_n integer;
begin
  for v_s in
    select s.* from public.enrichment_settings s
    where s.enabled and (p_workspace_id is null or s.workspace_id = p_workspace_id)
      and coalesce((select u.credits from public.enrichment_usage u
                    where u.workspace_id = s.workspace_id and u.month = v_month), 0) < s.monthly_credit_cap
  loop
    insert into public.lead_enrichment as e (lead_id, workspace_id, status, attempts)
    select l.id, l.workspace_id, 'queued', 0
    from public.leads l
    left join public.lead_enrichment e2 on e2.lead_id = l.id
    where l.workspace_id = v_s.workspace_id
      and not l.do_not_contact and l.status <> 'unsubscribed'
      and (l.email is not null or (l.name <> '' and private.lead_domain(l.website, l.email) is not null))
      and (e2.lead_id is null
           or (e2.status in ('done', 'failed') and (p_force or e2.next_due_at <= now()))
           or (e2.status in ('done', 'failed') and exists (
                 select 1 from public.outbound_emails oe
                 where oe.workspace_id = l.workspace_id and oe.lead_id = l.id and oe.status = 'bounced'
                   and oe.updated_at > coalesce(e2.last_checked_at, '-infinity'::timestamptz))))
    order by e2.last_checked_at nulls first, l.created_at
    limit greatest(least(p_limit, 1000), 0)
    on conflict (lead_id) do update set status = 'queued', attempts = 0, locked_until = null
    where e.status in ('done', 'failed');
    get diagnostics v_n = row_count;
    v_count := v_count + v_n;
  end loop;
  return v_count;
end;
$$;
revoke all on function private.enrichment_queue_due(integer, uuid, boolean) from public;

-- "Check now", for an owner or admin: queues every lead due, and the rest
-- too with p_all. Returns how many.
create function public.enrichment_check_now(p_workspace_id uuid, p_all boolean, p_limit integer)
returns integer
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
  return private.enrichment_queue_due(p_limit, p_workspace_id, coalesce(p_all, false));
end;
$$;
revoke all on function public.enrichment_check_now(uuid, boolean, integer) from public, anon;
grant execute on function public.enrichment_check_now(uuid, boolean, integer) to authenticated;

-- Claims up to p_limit queued leads under a lease, in workspaces with at
-- least p_min_credits left this month, and reserves p_reserve credits per
-- lead (corrected when it finishes). Server only.
create function public.enrichment_claim(p_limit integer, p_lease_seconds integer, p_max_attempts integer,
                                        p_reserve integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month date := date_trunc('month', now() at time zone 'utc')::date;
  v_out jsonb := '[]'::jsonb;
  v_e record;
  v_left integer;
begin
  update public.lead_enrichment e
  set status = 'failed', locked_until = null, next_due_at = now() + interval '7 days',
      last_error = 'It stopped part-way too many times.'
  where e.status = 'running' and e.locked_until < now() and e.attempts >= p_max_attempts;

  for v_e in
    select e.lead_id, e.workspace_id from public.lead_enrichment e
    join public.enrichment_settings s on s.workspace_id = e.workspace_id and s.enabled
    where e.status = 'queued' or (e.status = 'running' and e.locked_until < now())
    order by e.created_at
    limit greatest(least(p_limit, 50), 1)
    for update of e skip locked
  loop
    insert into public.enrichment_usage (workspace_id, month) values (v_e.workspace_id, v_month)
    on conflict (workspace_id, month) do nothing;
    select s.monthly_credit_cap - u.credits into v_left
    from public.enrichment_usage u
    join public.enrichment_settings s on s.workspace_id = u.workspace_id
    where u.workspace_id = v_e.workspace_id and u.month = v_month
    for update of u;
    if v_left < p_reserve then
      -- Out of credits for the month: tried again next month.
      update public.lead_enrichment e set status = 'done', locked_until = null,
             next_due_at = (v_month + interval '1 month'), last_error = 'The month''s credit cap was reached.'
      where e.lead_id = v_e.lead_id;
      continue;
    end if;
    update public.enrichment_usage u set credits = u.credits + p_reserve, leads = u.leads + 1
    where u.workspace_id = v_e.workspace_id and u.month = v_month;
    update public.lead_enrichment e
    set status = 'running', attempts = e.attempts + 1,
        locked_until = now() + make_interval(secs => greatest(p_lease_seconds, 1))
    where e.lead_id = v_e.lead_id;
    v_out := v_out || (
      select jsonb_build_object(
        'workspace_id', l.workspace_id, 'lead_id', l.id, 'reserved', p_reserve,
        'lead', jsonb_build_object('name', l.name, 'email', l.email, 'company', l.company, 'website', l.website,
                                   'title', coalesce(l.custom_fields ->> 'title', l.custom_fields #>> '{research,contact_role}', ''),
                                   'company_size', coalesce(l.custom_fields ->> 'company_size', ''),
                                   'industry', coalesce(l.custom_fields ->> 'industry', ''),
                                   'domain', private.lead_domain(l.website, l.email)),
        'state', jsonb_build_object('email_status', e.email_status, 'work_email', e.work_email,
                                    'profile_title', e.profile_title, 'profile_company', e.profile_company,
                                    'profile_domain', e.profile_domain, 'linkedin_url', e.linkedin_url,
                                    'last_checked_at', e.last_checked_at),
        'bounced', exists (select 1 from public.outbound_emails oe
                           where oe.workspace_id = l.workspace_id and oe.lead_id = l.id and oe.status = 'bounced'),
        'settings', jsonb_build_object('fill_emails', s.fill_emails, 'fill_titles', s.fill_titles,
                                       'fill_company', s.fill_company, 'job_changes', s.job_changes,
                                       'personal_emails', s.personal_emails))
      from public.leads l
      join public.lead_enrichment e on e.lead_id = l.id
      join public.enrichment_settings s on s.workspace_id = l.workspace_id
      where l.id = v_e.lead_id);
  end loop;
  return v_out;
end;
$$;
revoke all on function public.enrichment_claim(integer, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.enrichment_claim(integer, integer, integer, integer) to service_role;

-- Records one checked lead. Only a running one can be finished. p_fill only
-- fills what is empty on the lead (title, company, website, size, industry;
-- a work email goes on the lead only when it has no email at all, otherwise
-- in custom_fields.work_email). p_state is what the contact database said.
-- p_events: [{ kind, summary, changes }]. p_credits: what was really used
-- (the reservation is corrected). With write-back on and a CRM connected,
-- each event is queued as a note for the CRM.
create function public.enrichment_finish(
  p_workspace_id uuid, p_lead_id uuid, p_outcome text, p_fill jsonb, p_state jsonb, p_events jsonb,
  p_credits integer, p_reserved integer, p_refresh_days integer, p_error text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_e public.lead_enrichment%rowtype;
  v_l public.leads%rowtype;
  v_s public.enrichment_settings%rowtype;
  v_month date := date_trunc('month', now() at time zone 'utc')::date;
  v_cf jsonb;
  v_email text;
  v_work text;
  v_ev jsonb;
  v_ev_id uuid;
  v_domain text;
begin
  if p_outcome not in ('done', 'failed', 'retry') then
    raise exception 'unknown outcome' using errcode = '22023';
  end if;
  select e.* into v_e from public.lead_enrichment e
  where e.lead_id = p_lead_id and e.workspace_id = p_workspace_id and e.status = 'running' for update;
  if not found then
    return 'ignored';
  end if;
  update public.enrichment_usage u
  set credits = greatest(u.credits + greatest(coalesce(p_credits, 0), 0) - greatest(coalesce(p_reserved, 0), 0), 0)
  where u.workspace_id = p_workspace_id and u.month = v_month;
  if p_outcome = 'retry' then
    update public.lead_enrichment e set status = 'queued', locked_until = null, last_error = left(p_error, 300)
    where e.lead_id = p_lead_id;
    return 'retry';
  end if;
  select s.* into v_s from public.enrichment_settings s where s.workspace_id = p_workspace_id;
  select l.* into v_l from public.leads l where l.id = p_lead_id and l.workspace_id = p_workspace_id for update;

  if p_outcome = 'done' and jsonb_typeof(p_fill) = 'object' then
    v_cf := v_l.custom_fields;
    if nullif(btrim(coalesce(p_fill ->> 'title', '')), '') is not null and coalesce(v_cf ->> 'title', '') = '' then
      v_cf := v_cf || jsonb_build_object('title', left(btrim(p_fill ->> 'title'), 200));
    end if;
    if p_fill ? 'title_now' then
      -- A job change: the new title replaces the old one.
      v_cf := v_cf || jsonb_build_object('title', left(btrim(p_fill ->> 'title_now'), 200));
    end if;
    if nullif(btrim(coalesce(p_fill ->> 'company_size', '')), '') is not null and coalesce(v_cf ->> 'company_size', '') = '' then
      v_cf := v_cf || jsonb_build_object('company_size', left(btrim(p_fill ->> 'company_size'), 40));
    end if;
    if nullif(btrim(coalesce(p_fill ->> 'industry', '')), '') is not null and coalesce(v_cf ->> 'industry', '') = '' then
      v_cf := v_cf || jsonb_build_object('industry', left(btrim(p_fill ->> 'industry'), 120));
    end if;
    if nullif(btrim(coalesce(p_fill ->> 'linkedin_url', '')), '') ~ '^https://([a-z]+\.)?linkedin\.com/'
       and coalesce(v_cf ->> 'linkedin_url', '') = '' then
      v_cf := v_cf || jsonb_build_object('linkedin_url', left(btrim(p_fill ->> 'linkedin_url'), 300));
    end if;
    v_work := lower(btrim(coalesce(p_fill ->> 'work_email', '')));
    if v_work !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' or char_length(v_work) > 254
       or private.is_free_mail(split_part(v_work, '@', 2)) then
      v_work := null;
    end if;
    v_email := v_l.email;
    if v_work is not null then
      if v_email is null and not exists (select 1 from public.leads x
                                         where x.workspace_id = p_workspace_id and x.email = v_work) then
        v_email := v_work;
      else
        v_cf := v_cf || jsonb_build_object('work_email', v_work);
      end if;
    end if;
    if p_fill ? 'email_status' and p_fill ->> 'email_status' in ('valid', 'invalid', 'unknown') then
      v_cf := v_cf || jsonb_build_object('email_status', p_fill ->> 'email_status');
    end if;
    v_domain := private.site_domain(p_fill ->> 'website');
    update public.leads l
    set custom_fields = case when octet_length(v_cf::text) <= 50000 then v_cf else l.custom_fields end,
        email = v_email,
        company = coalesce(nullif(l.company, ''), nullif(left(btrim(coalesce(p_fill ->> 'company', '')), 200), '')),
        website = coalesce(l.website, case when v_domain is not null then 'https://' || v_domain end),
        scored_at = null
    where l.id = p_lead_id;
  end if;

  update public.lead_enrichment e
  set status = p_outcome, locked_until = null, last_checked_at = now(),
      next_due_at = now() + make_interval(days => greatest(coalesce(p_refresh_days, v_s.refresh_days, 30), 1)),
      last_error = case when p_outcome = 'failed' then left(p_error, 300) end,
      email_status = case when p_state ->> 'email_status' in ('valid', 'invalid', 'unknown') then p_state ->> 'email_status' else e.email_status end,
      work_email = coalesce(case when lower(p_state ->> 'work_email') ~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' then left(lower(p_state ->> 'work_email'), 254) end, e.work_email),
      profile_title = coalesce(left(p_state ->> 'profile_title', 200), e.profile_title),
      profile_company = coalesce(left(p_state ->> 'profile_company', 200), e.profile_company),
      profile_domain = coalesce(left(p_state ->> 'profile_domain', 253), e.profile_domain),
      linkedin_url = coalesce(case when p_state ->> 'linkedin_url' ~ '^https://([a-z]+\.)?linkedin\.com/' then left(p_state ->> 'linkedin_url', 300) end, e.linkedin_url)
  where e.lead_id = p_lead_id;

  if p_outcome = 'done' and jsonb_typeof(p_events) = 'array' then
    for v_ev in select * from jsonb_array_elements(p_events) loop
      continue when jsonb_typeof(v_ev) <> 'object'
        or coalesce(v_ev ->> 'kind', '') not in ('filled', 'job_change', 'email_invalid', 'work_email')
        or char_length(btrim(coalesce(v_ev ->> 'summary', ''))) not between 1 and 500;
      insert into public.enrichment_events (workspace_id, lead_id, kind, summary, changes)
      values (p_workspace_id, p_lead_id, v_ev ->> 'kind', btrim(v_ev ->> 'summary'),
              case when jsonb_typeof(v_ev -> 'changes') = 'object' and octet_length((v_ev -> 'changes')::text) <= 4000
                   then v_ev -> 'changes' else '{}'::jsonb end)
      returning id into v_ev_id;
      insert into public.activity_events (workspace_id, lead_id, kind, summary, metadata)
      values (p_workspace_id, p_lead_id,
              case v_ev ->> 'kind' when 'job_change' then 'job_change' when 'email_invalid' then 'email_invalid' else 'enriched' end,
              btrim(v_ev ->> 'summary'), jsonb_build_object('enrichment_event_id', v_ev_id));
      if coalesce(v_s.write_back, false) then
        perform private.crm_enqueue(p_workspace_id, p_lead_id, 'enrichment', 'enrich:' || v_ev_id, v_ev_id, false);
      end if;
    end loop;
  end if;
  perform private.score_lead(p_workspace_id, p_lead_id);
  return p_outcome;
end;
$$;
revoke all on function public.enrichment_finish(uuid, uuid, text, jsonb, jsonb, jsonb, integer, integer, integer, text) from public, anon, authenticated;
grant execute on function public.enrichment_finish(uuid, uuid, text, jsonb, jsonb, jsonb, integer, integer, integer, text) to service_role;

-- ---------------------------------------------------------------------------
-- Always-on sourcing
-- ---------------------------------------------------------------------------

create function public.sourcing_save(
  p_workspace_id uuid, p_id uuid, p_search_id uuid, p_list_id uuid, p_recipe_id uuid,
  p_every_days integer, p_enabled boolean, p_max integer
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
  if coalesce(p_every_days, 0) not between 1 and 90 then
    raise exception 'those settings are out of range' using errcode = '22023';
  end if;
  if not exists (select 1 from public.prospect_searches s where s.id = p_search_id and s.workspace_id = p_workspace_id)
     or not exists (select 1 from public.data_lists l where l.id = p_list_id and l.workspace_id = p_workspace_id
                    and l.archived_at is null and l.kind = 'companies')
     or (p_recipe_id is not null and not exists (
           select 1 from public.data_recipes r where r.id = p_recipe_id and r.workspace_id = p_workspace_id
             and r.archived_at is null)) then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if p_id is null then
    perform 1 from public.workspaces w where w.id = p_workspace_id for update;
    if (select count(*) from public.sourcing_schedules s where s.workspace_id = p_workspace_id) >= p_max then
      raise exception 'too many schedules' using errcode = 'P0001';
    end if;
    insert into public.sourcing_schedules (workspace_id, search_id, list_id, recipe_id, every_days, enabled, created_by)
    values (p_workspace_id, p_search_id, p_list_id, p_recipe_id, p_every_days, coalesce(p_enabled, true), v_user)
    returning id into v_id;
  else
    update public.sourcing_schedules s
    set search_id = p_search_id, list_id = p_list_id, recipe_id = p_recipe_id, every_days = p_every_days,
        enabled = coalesce(p_enabled, true), created_by = v_user
    where s.id = p_id and s.workspace_id = p_workspace_id
    returning s.id into v_id;
    if v_id is null then
      raise exception 'not found' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end;
$$;
revoke all on function public.sourcing_save(uuid, uuid, uuid, uuid, uuid, integer, boolean, integer) from public, anon;
grant execute on function public.sourcing_save(uuid, uuid, uuid, uuid, uuid, integer, boolean, integer) to authenticated;

create function public.sourcing_delete(p_workspace_id uuid, p_id uuid)
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
  delete from public.sourcing_schedules s where s.id = p_id and s.workspace_id = p_workspace_id;
  if not found then
    raise exception 'not found' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.sourcing_delete(uuid, uuid) from public, anon;
grant execute on function public.sourcing_delete(uuid, uuid) to authenticated;

-- Claims up to p_limit schedules that are due, or whose run is under way,
-- under a lease. Server only.
create function public.sourcing_claim(p_limit integer, p_lease_seconds integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_out jsonb;
begin
  with picked as (
    select s.id from public.sourcing_schedules s
    where s.enabled and (s.locked_until is null or s.locked_until < now())
      and (s.status = 'running' or s.next_run_at <= now())
    order by s.next_run_at
    limit greatest(least(p_limit, 20), 1)
    for update skip locked
  ), marked as (
    update public.sourcing_schedules s
    set locked_until = now() + make_interval(secs => greatest(p_lease_seconds, 1))
    from picked where s.id = picked.id
    returning s.*
  )
  select jsonb_agg(jsonb_build_object(
    'id', m.id, 'workspace_id', m.workspace_id, 'search_id', m.search_id, 'list_id', m.list_id,
    'recipe_id', m.recipe_id, 'every_days', m.every_days, 'status', m.status, 'run_id', m.run_id,
    'user_id', m.created_by,
    'month_runs', case when m.month = date_trunc('month', now() at time zone 'utc')::date then m.month_runs else 0 end,
    'run_status', (select r.status from public.prospect_runs r where r.id = m.run_id)
  )) into v_out
  from marked m;
  return coalesce(v_out, '[]'::jsonb);
end;
$$;
revoke all on function public.sourcing_claim(integer, integer) from public, anon, authenticated;
grant execute on function public.sourcing_claim(integer, integer) to service_role;

-- Records what one step did. p_event:
--   started   a run began (p_run_id): counted against the month
--   waiting   still under way, or couldn't start now (p_retry_minutes)
--   finished  the run ended: its new companies go into the list
-- Returns { "added": n } for finished, else {}.
create function public.sourcing_step_done(
  p_workspace_id uuid, p_id uuid, p_event text, p_run_id uuid, p_retry_minutes integer, p_note text, p_max_rows integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s public.sourcing_schedules%rowtype;
  v_month date := date_trunc('month', now() at time zone 'utc')::date;
  v_rows jsonb;
  v_result jsonb;
begin
  select s.* into v_s from public.sourcing_schedules s
  where s.id = p_id and s.workspace_id = p_workspace_id for update;
  if not found then
    return '{}'::jsonb;
  end if;
  if p_event = 'started' then
    update public.sourcing_schedules s
    set status = 'running', run_id = p_run_id, locked_until = null, last_run_at = now(),
        month_runs = case when s.month = v_month then s.month_runs + 1 else 1 end, month = v_month,
        last_note = left(coalesce(p_note, ''), 300)
    where s.id = p_id;
    return '{}'::jsonb;
  elsif p_event = 'waiting' then
    update public.sourcing_schedules s
    set locked_until = null, last_note = left(coalesce(p_note, s.last_note), 300),
        next_run_at = case when s.status = 'idle' and p_retry_minutes is not null
                           then now() + make_interval(mins => greatest(p_retry_minutes, 1)) else s.next_run_at end
    where s.id = p_id;
    return '{}'::jsonb;
  elsif p_event = 'finished' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'name', p.contact_name, 'title', p.contact_role, 'company', p.company_name, 'domain', p.domain,
      'email', p.email, 'country', coalesce(nullif(p.country, ''), p.location), 'size_range', p.size_range,
      'lead_id', p.lead_id, 'fields', jsonb_build_object('summary', left(p.summary, 400), 'found', to_char(now(), 'YYYY-MM-DD'))
    ) order by p.created_at), '[]'::jsonb) into v_rows
    from public.prospects p
    where p.workspace_id = p_workspace_id and p.run_id = v_s.run_id and p.research_status = 'found';
    v_result := private.data_rows_insert(p_workspace_id, v_s.list_id, v_rows, p_max_rows);
    update public.sourcing_schedules s
    set status = 'idle', run_id = null, locked_until = null,
        next_run_at = now() + make_interval(days => s.every_days),
        last_added = coalesce((v_result ->> 'added')::integer, 0),
        last_note = left(coalesce(p_note, ''), 300)
    where s.id = p_id;
    return v_result;
  end if;
  raise exception 'unknown event' using errcode = '22023';
end;
$$;
revoke all on function public.sourcing_step_done(uuid, uuid, text, uuid, integer, text, integer) from public, anon, authenticated;
grant execute on function public.sourcing_step_done(uuid, uuid, text, uuid, integer, text, integer) to service_role;

-- ---------------------------------------------------------------------------
-- The CRM: enrichment written back as a note
-- ---------------------------------------------------------------------------
alter table public.crm_sync_jobs drop constraint crm_sync_jobs_kind_check;
alter table public.crm_sync_jobs add constraint crm_sync_jobs_kind_check
  check (kind in ('contact', 'note', 'meeting', 'deal', 'opt_out', 'enrichment'));

-- As in 20261120230000_crm_sync, with what an enrichment job writes.
create or replace function public.crm_jobs_claim(
  p_limit integer, p_lease_seconds integer, p_max_attempts integer, p_workspace_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_out jsonb;
begin
  update public.crm_sync_jobs j
  set status = 'failed', locked_until = null,
      last_error = coalesce(j.last_error, 'It stopped part-way too many times.')
  where j.status = 'running' and j.locked_until < now() and j.attempts >= p_max_attempts
    and (p_workspace_id is null or j.workspace_id = p_workspace_id);

  with picked as (
    select j.id from public.crm_sync_jobs j
    join public.crm_connections c on c.workspace_id = j.workspace_id and c.status = 'active'
    where (p_workspace_id is null or j.workspace_id = p_workspace_id)
      and ((j.status = 'pending' and j.next_attempt_at <= now())
           or (j.status = 'running' and j.locked_until < now()))
    order by j.next_attempt_at, j.created_at
    limit greatest(least(p_limit, 200), 1)
    for update of j skip locked
  ), marked as (
    update public.crm_sync_jobs j
    set status = 'running', attempts = j.attempts + 1,
        locked_until = now() + make_interval(secs => greatest(p_lease_seconds, 1))
    from picked where j.id = picked.id
    returning j.*
  )
  select jsonb_agg(jsonb_build_object(
    'id', m.id, 'workspace_id', m.workspace_id, 'kind', m.kind, 'source_key', m.source_key,
    'attempts', m.attempts, 'external_id', m.external_id,
    'connection', jsonb_build_object(
      'provider', c.provider, 'can_opt_out', c.can_opt_out, 'can_deals', c.can_deals,
      'deal_pipeline_id', c.deal_pipeline_id, 'deal_stage_id', c.deal_stage_id
    ),
    'lead', jsonb_build_object(
      'id', l.id, 'name', l.name, 'email', l.email, 'phone', l.phone, 'company', l.company,
      'website', l.website, 'status', l.status, 'source', l.source,
      'do_not_contact', l.do_not_contact, 'created_at', l.created_at
    ),
    'link', (
      select jsonb_build_object(
        'contact_id', ll.contact_id, 'company_id', ll.company_id, 'deal_id', ll.deal_id,
        'contact_created', ll.contact_created, 'company_created', ll.company_created
      ) from public.crm_lead_links ll
      where ll.lead_id = m.lead_id and ll.workspace_id = m.workspace_id and ll.provider = c.provider
    ),
    'detail', case
      when m.kind = 'note' and m.source_key like 'chat:%' then (
        select jsonb_build_object(
          'type', 'chat', 'outcome', cv.outcome, 'outcome_summary', cv.outcome_summary,
          'started_at', cv.created_at,
          'transcript', (
            select left(string_agg(
              case t.author when 'lead' then 'Visitor' when 'agent' then 'Assistant' else 'Team' end
                || ': ' || left(t.body, 600), E'\n' order by t.sent_at), 6000)
            from (
              select x.author, x.body, x.sent_at from public.messages x
              where x.conversation_id = cv.id and x.workspace_id = cv.workspace_id
              order by x.sent_at desc limit 40
            ) t
          )
        ) from public.conversations cv
        where cv.id = m.ref_id and cv.workspace_id = m.workspace_id
      )
      when m.kind = 'note' and m.source_key like 'msg:%' then (
        select jsonb_build_object(
          'type', 'email', 'direction', x.direction, 'subject', left(coalesce(x.metadata ->> 'subject', ''), 200),
          'body', left(x.body, 4000), 'sent_at', x.sent_at
        ) from public.messages x
        where x.id = m.ref_id and x.workspace_id = m.workspace_id
      )
      when m.kind = 'meeting' then (
        select jsonb_build_object(
          'type', 'meeting', 'title', mt.title, 'starts_at', mt.starts_at, 'ends_at', mt.ends_at,
          'status', mt.status, 'booked_by', mt.booked_by
        ) from public.meetings mt
        where mt.id = m.ref_id and mt.workspace_id = m.workspace_id
      )
      when m.kind = 'enrichment' then (
        select jsonb_build_object(
          'type', 'enrichment', 'kind', ev.kind, 'summary', ev.summary, 'changes', ev.changes,
          'at', ev.created_at
        ) from public.enrichment_events ev
        where ev.id = m.ref_id and ev.workspace_id = m.workspace_id
      )
      else '{}'::jsonb
    end
  ) order by m.next_attempt_at, m.created_at) into v_out
  from marked m
  join public.crm_connections c on c.workspace_id = m.workspace_id
  join public.leads l on l.id = m.lead_id and l.workspace_id = m.workspace_id;
  return coalesce(v_out, '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- The scheduler
-- ---------------------------------------------------------------------------

-- What a tick would ask the app to do. Also queues the leads due for
-- enrichment. Separate from the HTTP call so the tests can check it.
create function private.data_due_work()
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_jobs text[] := '{}';
begin
  if exists (select 1 from public.data_cells x
             where x.status = 'queued' or (x.status = 'running' and x.locked_until < now())) then
    v_jobs := v_jobs || 'cells'::text;
  end if;
  perform private.enrichment_queue_due(200);
  if exists (select 1 from public.lead_enrichment e
             join public.enrichment_settings s on s.workspace_id = e.workspace_id and s.enabled
             where e.status = 'queued' or (e.status = 'running' and e.locked_until < now())) then
    v_jobs := v_jobs || 'enrich'::text;
  end if;
  if exists (select 1 from public.sourcing_schedules s
             where s.enabled and (s.locked_until is null or s.locked_until < now())
               and (s.status = 'running' or s.next_run_at <= now())) then
    v_jobs := v_jobs || 'source'::text;
  end if;
  return v_jobs;
end;
$$;
revoke all on function private.data_due_work() from public;

create function private.data_cron_tick()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_jobs text[] := private.data_due_work();
  v_url text;
  v_token text;
  v_job text;
begin
  if cardinality(v_jobs) = 0 then
    return;
  end if;
  select s.decrypted_secret into v_url from vault.decrypted_secrets s where s.name = 'dialvo_app_url';
  select s.decrypted_secret into v_token from vault.decrypted_secrets s where s.name = 'dialvo_cron_token';
  if v_url is null or v_token is null then
    return;
  end if;
  foreach v_job in array v_jobs loop
    -- By name through execute, so this can be created where pg_net doesn't
    -- exist (the in-memory Postgres the tests run on).
    execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := $4)'
    using rtrim(v_url, '/') || '/api/data/step?job=' || v_job, '{}'::jsonb,
          jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_token),
          58000;
  end loop;
end;
$$;
revoke all on function private.data_cron_tick() from public;

do $do$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    execute 'create extension if not exists pg_cron with schema pg_catalog';
    execute 'create extension if not exists pg_net with schema extensions';
    execute $job$
      select cron.schedule('dialvo-data-steps', '* * * * *', 'select private.data_cron_tick()')
    $job$;
  end if;
end;
$do$;
