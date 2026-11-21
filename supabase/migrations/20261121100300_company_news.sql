-- Company news on Find leads, Signals: once a week per tracked company, a
-- web search for funding, launches, leadership hires and expansions.
--
--   news_settings   one row per workspace: on or off (off until an admin
--                   switches it on), what to track (target accounts, and
--                   leads with a company website at chosen stages) and which
--                   kinds of news.
--   news_companies  the companies tracked, at most NEWS_COMPANIES_MAX (100)
--                   a workspace, each checked once a week.
--   company_news    what was found, with its source link, deduplicated per
--                   workspace (the same link, or the same headline for the
--                   same company and kind in 60 days, is kept once).
--
-- Keeping news: for a company that is already a lead, a note on the lead's
-- timeline and a fresh account brief; for a target account, the company
-- goes into a target-accounts campaign marked 'news' (the existing flow:
-- find a contact, research, a first email that waits for approval). A kept
-- item also starts "signal kept" workflows.
--
-- The scheduler: pg_cron runs private.news_cron_tick() hourly; it refreshes
-- the tracked companies and calls the app (/api/activation/step?job=news)
-- only when one is due.

create table public.news_settings (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  enabled boolean not null default false,
  track_accounts boolean not null default true,
  track_leads boolean not null default true,
  lead_statuses text[] not null default array['new', 'engaged', 'qualified', 'meeting_booked']
    check (lead_statuses <@ array['new', 'engaged', 'qualified', 'meeting_booked', 'won', 'lost']),
  kinds text[] not null default array['funding', 'launch', 'leadership', 'expansion']
    check (cardinality(kinds) >= 1 and kinds <@ array['funding', 'launch', 'leadership', 'expansion']),
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.news_settings enable row level security;
create index news_settings_updated_by_idx on public.news_settings (updated_by);
create trigger news_settings_set_updated_at
  before update on public.news_settings
  for each row execute function private.set_updated_at();

create table public.news_companies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  domain text not null check (domain = lower(domain) and char_length(domain) between 3 and 253),
  name text not null default '' check (char_length(name) <= 200),
  lead_id uuid,
  origin text not null check (origin in ('account', 'lead')),
  last_checked_at timestamptz,
  next_check_at timestamptz not null default now(),
  locked_until timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 200),
  created_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (workspace_id, domain),
  foreign key (lead_id, workspace_id)
    references public.leads (id, workspace_id) on delete set null (lead_id)
);
alter table public.news_companies enable row level security;
create index news_companies_due_idx on public.news_companies (next_check_at);
create index news_companies_lead_idx on public.news_companies (lead_id, workspace_id) where lead_id is not null;

create table public.company_news (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  company_id uuid,
  lead_id uuid,
  domain text not null check (domain = lower(domain) and char_length(domain) between 3 and 253),
  company_name text not null default '' check (char_length(company_name) <= 200),
  kind text not null check (kind in ('funding', 'launch', 'leadership', 'expansion')),
  headline text not null check (char_length(headline) between 1 and 300),
  summary text not null default '' check (char_length(summary) <= 600),
  source_url text not null check (source_url ~ '^https?://' and char_length(source_url) <= 600),
  source_title text not null default '' check (char_length(source_title) <= 300),
  published_on date,
  dedupe_key text not null check (char_length(dedupe_key) between 3 and 700),
  -- new. kept (a note and brief on the lead, or a campaign). dismissed.
  status text not null default 'new' check (status in ('new', 'kept', 'dismissed')),
  campaign_id uuid,
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (workspace_id, dedupe_key),
  foreign key (company_id, workspace_id)
    references public.news_companies (id, workspace_id) on delete set null (company_id),
  foreign key (lead_id, workspace_id)
    references public.leads (id, workspace_id) on delete set null (lead_id),
  foreign key (campaign_id, workspace_id)
    references public.outbound_campaigns (id, workspace_id) on delete set null (campaign_id)
);
alter table public.company_news enable row level security;
create index company_news_list_idx on public.company_news (workspace_id, status, created_at desc);
create index company_news_company_idx on public.company_news (company_id, workspace_id) where company_id is not null;
create index company_news_lead_idx on public.company_news (lead_id, workspace_id) where lead_id is not null;
create index company_news_campaign_idx on public.company_news (campaign_id, workspace_id) where campaign_id is not null;
create index company_news_decided_by_idx on public.company_news (decided_by);
create index company_news_domain_idx on public.company_news (workspace_id, domain, kind, created_at desc);
create trigger company_news_set_updated_at
  before update on public.company_news
  for each row execute function private.set_updated_at();

alter table public.outbound_usage add column news_checks integer not null default 0;

revoke all on public.news_settings, public.news_companies, public.company_news from anon, authenticated;
grant all on public.news_settings, public.news_companies, public.company_news to service_role;
grant select on public.news_settings, public.news_companies, public.company_news to authenticated;
create policy "Members read news settings" on public.news_settings for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));
create policy "Members read tracked companies" on public.news_companies for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));
create policy "Members read company news" on public.company_news for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));

-- ---------------------------------------------------------------------------
-- Settings (owners and admins, signed in)
-- ---------------------------------------------------------------------------
create function public.news_settings_save(
  p_workspace_id uuid, p_enabled boolean, p_track_accounts boolean, p_track_leads boolean,
  p_lead_statuses text[], p_kinds text[]
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kinds text[] := (select array_agg(distinct k) from unnest(p_kinds) k
                     where k = any (array['funding', 'launch', 'leadership', 'expansion']));
  v_statuses text[] := coalesce((select array_agg(distinct s) from unnest(p_lead_statuses) s
                        where s = any (array['new', 'engaged', 'qualified', 'meeting_booked', 'won', 'lost'])), '{}');
begin
  if not (select private.is_workspace_admin(p_workspace_id)) then
    return false;
  end if;
  if v_kinds is null then
    return false;
  end if;
  insert into public.news_settings as n (workspace_id, enabled, track_accounts, track_leads, lead_statuses, kinds, updated_by)
  values (p_workspace_id, coalesce(p_enabled, false), coalesce(p_track_accounts, true), coalesce(p_track_leads, true),
          v_statuses, v_kinds, (select auth.uid()))
  on conflict (workspace_id) do update
  set enabled = excluded.enabled, track_accounts = excluded.track_accounts, track_leads = excluded.track_leads,
      lead_statuses = excluded.lead_statuses, kinds = excluded.kinds, updated_by = excluded.updated_by;
  return true;
end;
$$;

create function public.news_dismiss(p_id uuid)
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
  update public.company_news n
  set status = 'dismissed', decided_by = v_user, decided_at = now()
  where n.id = p_id and n.status = 'new' and (select private.is_workspace_member(n.workspace_id));
  return found;
end;
$$;

-- ---------------------------------------------------------------------------
-- The tracked companies
-- ---------------------------------------------------------------------------

-- Brings a workspace's tracked companies up to date with its settings: its
-- target accounts' companies and its leads' company websites, at most
-- p_max in all. A lead's own company comes first. Internal.
create function private.news_refresh(p_workspace_id uuid, p_max integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s public.news_settings%rowtype;
  v_have integer;
  v_added integer := 0;
  r record;
begin
  select * into v_s from public.news_settings n where n.workspace_id = p_workspace_id;
  if not found or not v_s.enabled then
    return 0;
  end if;
  select count(*) into v_have from public.news_companies c where c.workspace_id = p_workspace_id;
  for r in
    select x.domain, x.name, x.lead_id, x.origin from (
      select distinct on (d.domain) d.domain, d.name, d.lead_id, d.origin, d.rank, d.at from (
        select private.site_domain(l.website) as domain, coalesce(l.company, '') as name, l.id as lead_id,
               'lead' as origin, 0 as rank, l.updated_at as at
        from public.leads l
        where v_s.track_leads and l.workspace_id = p_workspace_id and l.status = any (v_s.lead_statuses)
          and not l.do_not_contact and l.website is not null
        union all
        select t.domain, t.company_name, null, 'account', 1, t.created_at
        from public.outbound_campaign_targets t
        join public.outbound_campaigns c on c.id = t.campaign_id and c.workspace_id = t.workspace_id
        where v_s.track_accounts and t.workspace_id = p_workspace_id and c.kind = 'accounts'
          and t.domain is not null
      ) d
      where d.domain is not null and char_length(d.domain) between 3 and 253
      order by d.domain, d.rank, d.at desc
    ) x
    where not exists (select 1 from public.news_companies c where c.workspace_id = p_workspace_id and c.domain = x.domain)
    order by x.origin desc, x.domain
  loop
    exit when v_have + v_added >= p_max;
    insert into public.news_companies (workspace_id, domain, name, lead_id, origin)
    values (p_workspace_id, r.domain, left(r.name, 200), r.lead_id, r.origin)
    on conflict do nothing;
    v_added := v_added + 1;
  end loop;
  return v_added;
end;
$$;
revoke all on function private.news_refresh(uuid, integer) from public;

-- Claims due companies of workspaces that have news on, under a lease. A
-- workspace whose model spend for today has reached p_max_cost_micros waits.
create function public.news_claim(p_limit integer, p_lease_seconds integer, p_max_cost_micros bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_out jsonb := '[]'::jsonb;
  c record;
begin
  for c in
    select x.id, x.workspace_id, x.domain, x.name, x.lead_id, s.kinds
    from public.news_companies x
    join public.news_settings s on s.workspace_id = x.workspace_id and s.enabled
    where x.next_check_at <= now() and (x.locked_until is null or x.locked_until < now())
      and (private.outbound_usage_json(x.workspace_id) ->> 'cost_micros')::bigint < p_max_cost_micros
    order by x.next_check_at
    limit greatest(least(p_limit, 20), 0)
    for update of x skip locked
  loop
    update public.news_companies x
    set locked_until = now() + make_interval(secs => greatest(p_lease_seconds, 30))
    where x.id = c.id;
    v_out := v_out || jsonb_build_object('id', c.id, 'workspace_id', c.workspace_id, 'domain', c.domain,
                                         'name', c.name, 'lead_id', c.lead_id, 'kinds', to_jsonb(c.kinds));
  end loop;
  return v_out;
end;
$$;

-- What one company's search found. Each item:
--   { "kind", "headline", "summary", "source_url", "source_title", "published_on" }
-- (the app keeps only links the search itself returned). Deduplicated by
-- link, and by headline for the same company and kind within 60 days.
--   { "added", "duplicates" }
create function public.news_ingest(p_workspace_id uuid, p_company_id uuid, p_items jsonb, p_cost_micros bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.news_companies%rowtype;
  i jsonb;
  v_added integer := 0;
  v_dupes integer := 0;
  v_url text;
  v_head text;
  v_kind text;
  v_on date;
begin
  select * into v_c from public.news_companies x where x.id = p_company_id and x.workspace_id = p_workspace_id for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  for i in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) limit 10
  loop
    v_url := left(btrim(coalesce(i ->> 'source_url', '')), 600);
    v_head := left(btrim(coalesce(i ->> 'headline', '')), 300);
    v_kind := i ->> 'kind';
    continue when v_url !~ '^https?://' or v_head = '' or v_kind not in ('funding', 'launch', 'leadership', 'expansion');
    begin
      v_on := nullif(i ->> 'published_on', '')::date;
    exception when others then
      v_on := null;
    end;
    if exists (select 1 from public.company_news n
               where n.workspace_id = p_workspace_id and n.domain = v_c.domain and n.kind = v_kind
                 and lower(n.headline) = lower(v_head) and n.created_at > now() - interval '60 days') then
      v_dupes := v_dupes + 1;
      continue;
    end if;
    insert into public.company_news (workspace_id, company_id, lead_id, domain, company_name, kind, headline,
                                     summary, source_url, source_title, published_on, dedupe_key)
    values (p_workspace_id, v_c.id, v_c.lead_id, v_c.domain, v_c.name, v_kind, v_head,
            left(coalesce(i ->> 'summary', ''), 600), v_url, left(coalesce(i ->> 'source_title', ''), 300), v_on,
            left(v_c.domain || '|' || lower(regexp_replace(v_url, '[?#].*$', '')), 700))
    on conflict (workspace_id, dedupe_key) do nothing;
    if found then
      v_added := v_added + 1;
    else
      v_dupes := v_dupes + 1;
    end if;
  end loop;
  update public.news_companies x
  set last_checked_at = now(), next_check_at = now() + interval '7 days', locked_until = null, last_error = null
  where x.id = v_c.id;
  perform private.outbound_usage_add(p_workspace_id, greatest(coalesce(p_cost_micros, 0), 0), 0, 0);
  insert into public.outbound_usage as u (workspace_id, day, news_checks)
  values (p_workspace_id, (now() at time zone 'utc')::date, 1)
  on conflict (workspace_id, day) do update set news_checks = u.news_checks + 1;
  return jsonb_build_object('status', 'ok', 'added', v_added, 'duplicates', v_dupes);
end;
$$;

-- A search that failed: tried again tomorrow.
create function public.news_fail(p_workspace_id uuid, p_company_id uuid, p_error text, p_cost_micros bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.news_companies x
  set locked_until = null, last_error = left(coalesce(p_error, 'The search failed.'), 200),
      next_check_at = now() + interval '1 day'
  where x.id = p_company_id and x.workspace_id = p_workspace_id;
  perform private.outbound_usage_add(p_workspace_id, greatest(coalesce(p_cost_micros, 0), 0), 0, 0);
end;
$$;

-- Keeping news, for a member (the server checked who). Items about a lead:
-- a note on the lead and a fresh brief. Items about other companies: one
-- target-accounts campaign marked 'news', which the server then starts.
--   { "status": "kept", "leads", "campaign_id" | null } | { "status": "invalid" | "not_found" }
create function public.news_keep(
  p_workspace_id uuid, p_user_id uuid, p_ids uuid[], p_name text, p_titles jsonb, p_max integer, p_max_briefs integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  n record;
  v_leads integer := 0;
  v_targets jsonb;
  v_made jsonb;
  v_campaign uuid;
begin
  if not exists (
    select 1 from public.workspace_members m where m.workspace_id = p_workspace_id and m.user_id = p_user_id
  ) then
    return jsonb_build_object('status', 'not_found');
  end if;
  for n in
    select x.* from public.company_news x
    where x.workspace_id = p_workspace_id and x.id = any (p_ids) and x.status = 'new' and x.lead_id is not null
    for update of x
  loop
    insert into public.activity_events (workspace_id, lead_id, actor_id, kind, summary, metadata)
    values (p_workspace_id, n.lead_id, p_user_id, 'company_news',
            left('In the news: ' || n.headline || ' (' || n.source_url || ')', 5000),
            jsonb_build_object('news_id', n.id, 'kind', n.kind, 'source_url', n.source_url));
    perform private.brief_queue(p_workspace_id, p_user_id, n.lead_id, 'brief', 'manual', null, p_max_briefs);
    update public.company_news x set status = 'kept', decided_by = p_user_id, decided_at = now() where x.id = n.id;
    perform private.workflow_enqueue(p_workspace_id, 'signal_kept', n.lead_id,
      jsonb_build_object('summary', n.headline, 'kind', 'company_news', 'news_kind', n.kind,
                         'company', n.company_name, 'domain', n.domain, 'source_url', n.source_url),
      'news:' || n.id);
    v_leads := v_leads + 1;
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object('input', x.domain, 'domain', x.domain, 'company_name', x.company_name)), '[]'::jsonb)
  into v_targets
  from (select distinct on (c.domain) c.domain, c.company_name
        from public.company_news c
        where c.workspace_id = p_workspace_id and c.id = any (p_ids) and c.status = 'new' and c.lead_id is null
          and private.campaign_company_known(p_workspace_id, c.domain, null) is null
        order by c.domain, c.created_at desc) x;
  if jsonb_array_length(v_targets) > 0 then
    v_made := public.campaign_create_company(
      p_workspace_id, p_user_id, 'accounts', p_name,
      jsonb_build_object('titles', coalesce(p_titles, '[]'::jsonb), 'source', 'news'), v_targets, p_max);
    if v_made ->> 'status' = 'created' then
      v_campaign := (v_made ->> 'campaign_id')::uuid;
      for n in
        select x.* from public.company_news x
        where x.workspace_id = p_workspace_id and x.status = 'new' and x.lead_id is null
          and x.id = any (p_ids)
          and x.domain in (select t ->> 'domain' from jsonb_array_elements(v_targets) t)
      loop
        update public.company_news x set status = 'kept', campaign_id = v_campaign, decided_by = p_user_id, decided_at = now()
        where x.id = n.id;
        perform private.workflow_enqueue(p_workspace_id, 'signal_kept', null,
          jsonb_build_object('summary', n.headline, 'kind', 'company_news', 'news_kind', n.kind,
                             'company', n.company_name, 'domain', n.domain, 'source_url', n.source_url),
          'news:' || n.id);
      end loop;
    end if;
  end if;
  -- What's left (a company already a lead elsewhere, or never contact) is
  -- dismissed with nothing done, so it doesn't wait forever.
  update public.company_news x set status = 'dismissed', decided_by = p_user_id, decided_at = now()
  where x.workspace_id = p_workspace_id and x.id = any (p_ids) and x.status = 'new';
  if v_leads = 0 and v_campaign is null then
    return jsonb_build_object('status', 'invalid');
  end if;
  return jsonb_build_object('status', 'kept', 'leads', v_leads, 'campaign_id', v_campaign);
end;
$$;

-- ---------------------------------------------------------------------------
-- The scheduler. 100 is NEWS_COMPANIES_MAX in src/lib/news/config.ts.
-- ---------------------------------------------------------------------------
create function private.news_cron_tick()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s record;
begin
  for s in select n.workspace_id from public.news_settings n where n.enabled
  loop
    perform private.news_refresh(s.workspace_id, 100);
  end loop;
  if exists (select 1 from public.news_companies x
             join public.news_settings s on s.workspace_id = x.workspace_id and s.enabled
             where x.next_check_at <= now() and (x.locked_until is null or x.locked_until < now())) then
    perform private.activation_post('news');
  end if;
end;
$$;
revoke all on function private.news_cron_tick() from public;

revoke all on function public.news_settings_save(uuid, boolean, boolean, boolean, text[], text[]) from public, anon;
revoke all on function public.news_dismiss(uuid) from public, anon;
grant execute on function public.news_settings_save(uuid, boolean, boolean, boolean, text[], text[]) to authenticated;
grant execute on function public.news_dismiss(uuid) to authenticated;
revoke all on function public.news_claim(integer, integer, bigint) from public, anon, authenticated;
revoke all on function public.news_ingest(uuid, uuid, jsonb, bigint) from public, anon, authenticated;
revoke all on function public.news_fail(uuid, uuid, text, bigint) from public, anon, authenticated;
revoke all on function public.news_keep(uuid, uuid, uuid[], text, jsonb, integer, integer) from public, anon, authenticated;
grant execute on function public.news_claim(integer, integer, bigint) to service_role;
grant execute on function public.news_ingest(uuid, uuid, jsonb, bigint) to service_role;
grant execute on function public.news_fail(uuid, uuid, text, bigint) to service_role;
grant execute on function public.news_keep(uuid, uuid, uuid[], text, jsonb, integer, integer) to service_role;

do $do$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    execute 'create extension if not exists pg_cron with schema pg_catalog';
    execute 'create extension if not exists pg_net with schema extensions';
    execute $job$
      select cron.schedule('dialvo-news-steps', '41 * * * *', 'select private.news_cron_tick()')
    $job$;
  end if;
end;
$do$;
