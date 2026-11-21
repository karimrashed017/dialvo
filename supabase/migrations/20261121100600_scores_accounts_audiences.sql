-- Lead scoring and tiers, target accounts, territories and saved audiences.
-- Additive. Builds on the lists migration (20261121100000_data_lists).
--
--   leads              + fit_score, engagement_score (0-100), tier (1-3),
--                      score_detail (why), scored_at, account_id.
--   scoring_settings   one row per workspace: the fit rules (countries,
--                      company size, titles, words describing the company,
--                      sources, and optionally a saved score recipe), the
--                      tier thresholds and how much engagement counts.
--                      Engagement is from replies, chats, form fills,
--                      website visits, product events and meetings in the
--                      last 90 days. Email opens are not tracked, so they
--                      never count. Owners and admins save.
--   accounts           companies the team targets, by domain: who owns it,
--                      its territory, and its firmographics. Leads at that
--                      domain are linked to it (leads.account_id), and list
--                      rows too (data_list_rows.account_id).
--   territories        regions, countries or states and company size bands,
--   territory_reps     each with its reps. Accounts are assigned to the first
--                      territory they match and balanced across its reps by
--                      count or by score. Owners and admins save.
--   audiences          saved, self-updating segments over the leads
--                      (stage, tier, scores, source, country, size, list,
--                      last activity, a recipe's answer).
--   routing            a new lead goes first to its account's owner, then
--                      to a territory's rep (the one with the fewest open
--                      leads), then to the routing rules as before. Rules
--                      can now also match tiers.
--   playbooks          filters may also use tiers, scores, a saved
--                      audience, a list and a recipe's answer; a playbook
--                      can be started on chosen leads (from a list or an
--                      account) with every rule a playbook keeps.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.territories (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  position integer not null default 0 check (position between 0 and 1000),
  -- Country codes or names ("GB", "Germany"), and states or regions
  -- ("California", "Bavaria"). Empty: any.
  countries jsonb not null default '[]'::jsonb check (jsonb_typeof(countries) = 'array'),
  regions jsonb not null default '[]'::jsonb check (jsonb_typeof(regions) = 'array'),
  size_min integer check (size_min is null or size_min between 1 and 10000000),
  size_max integer check (size_max is null or size_max between 1 and 10000000),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  check (size_min is null or size_max is null or size_min <= size_max)
);
alter table public.territories enable row level security;
create index territories_workspace_idx on public.territories (workspace_id, position);
create index territories_created_by_idx on public.territories (created_by);
create trigger territories_set_updated_at
  before update on public.territories
  for each row execute function private.set_updated_at();

create table public.territory_reps (
  territory_id uuid not null,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (territory_id, user_id),
  foreign key (territory_id, workspace_id)
    references public.territories (id, workspace_id) on delete cascade,
  foreign key (workspace_id, user_id)
    references public.workspace_members (workspace_id, user_id) on delete cascade
);
alter table public.territory_reps enable row level security;
create index territory_reps_territory_idx on public.territory_reps (territory_id, workspace_id);
create index territory_reps_member_idx on public.territory_reps (workspace_id, user_id);

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  domain text not null check (domain = lower(domain) and char_length(domain) between 3 and 253),
  name text not null default '' check (char_length(name) <= 200),
  country text not null default '' check (char_length(country) <= 80),
  region text not null default '' check (char_length(region) <= 80),
  size_range text not null default '' check (char_length(size_range) <= 40),
  industry text not null default '' check (char_length(industry) <= 120),
  owner_id uuid,
  territory_id uuid,
  fit_score smallint check (fit_score is null or fit_score between 0 and 100),
  -- The titles last used to find its buying committee.
  committee_titles jsonb not null default '[]'::jsonb check (jsonb_typeof(committee_titles) = 'array'),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (workspace_id, domain),
  foreign key (workspace_id, owner_id)
    references public.workspace_members (workspace_id, user_id) on delete set null (owner_id),
  foreign key (territory_id, workspace_id)
    references public.territories (id, workspace_id) on delete set null (territory_id)
);
alter table public.accounts enable row level security;
create index accounts_owner_idx on public.accounts (workspace_id, owner_id) where owner_id is not null;
create index accounts_territory_idx on public.accounts (territory_id, workspace_id) where territory_id is not null;
create index accounts_created_by_idx on public.accounts (created_by);
create trigger accounts_set_updated_at
  before update on public.accounts
  for each row execute function private.set_updated_at();

create table public.scoring_settings (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  -- { "countries": [...], "size_min": n, "size_max": n, "titles": [...],
  --   "keywords": [...], "sources": [...] }. Missing or empty: not used.
  fit jsonb not null default '{}'::jsonb check (jsonb_typeof(fit) = 'object'),
  -- A saved score (or yes/no) recipe whose latest answer counts toward fit.
  recipe_id uuid,
  recipe_weight smallint not null default 1 check (recipe_weight between 1 and 3),
  tier1_min smallint not null default 70 check (tier1_min between 1 and 100),
  tier2_min smallint not null default 40 check (tier2_min between 0 and 99),
  -- How much of the combined score is engagement (the rest is fit).
  engagement_weight smallint not null default 40 check (engagement_weight between 0 and 100),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  check (tier2_min < tier1_min),
  foreign key (recipe_id, workspace_id)
    references public.data_recipes (id, workspace_id) on delete set null (recipe_id)
);
alter table public.scoring_settings enable row level security;
create index scoring_settings_recipe_idx on public.scoring_settings (recipe_id, workspace_id) where recipe_id is not null;
create index scoring_settings_updated_by_idx on public.scoring_settings (updated_by);

create table public.audiences (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  filters jsonb not null default '{}'::jsonb check (jsonb_typeof(filters) = 'object'),
  archived_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id)
);
alter table public.audiences enable row level security;
create index audiences_workspace_idx on public.audiences (workspace_id, created_at);
create index audiences_created_by_idx on public.audiences (created_by);
create trigger audiences_set_updated_at
  before update on public.audiences
  for each row execute function private.set_updated_at();

alter table public.leads
  add column fit_score smallint check (fit_score is null or fit_score between 0 and 100),
  add column engagement_score smallint check (engagement_score is null or engagement_score between 0 and 100),
  add column tier smallint check (tier is null or tier between 1 and 3),
  add column score_detail jsonb not null default '{}'::jsonb check (jsonb_typeof(score_detail) = 'object'),
  add column scored_at timestamptz,
  add column account_id uuid,
  add foreign key (account_id, workspace_id)
    references public.accounts (id, workspace_id) on delete set null (account_id);
create index leads_account_idx on public.leads (account_id, workspace_id) where account_id is not null;
create index leads_workspace_tier_idx on public.leads (workspace_id, tier);
create index leads_scored_idx on public.leads (scored_at nulls first);

alter table public.data_list_rows
  add column account_id uuid,
  add foreign key (account_id, workspace_id)
    references public.accounts (id, workspace_id) on delete set null (account_id);
create index data_list_rows_account_idx on public.data_list_rows (account_id, workspace_id) where account_id is not null;

revoke all on public.territories, public.territory_reps, public.accounts, public.scoring_settings,
  public.audiences from anon, authenticated;
grant all on public.territories, public.territory_reps, public.accounts, public.scoring_settings,
  public.audiences to service_role;
grant select on public.territories, public.territory_reps, public.accounts, public.scoring_settings,
  public.audiences to authenticated;
create policy "Members read territories" on public.territories for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));
create policy "Members read territory reps" on public.territory_reps for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));
create policy "Members read accounts" on public.accounts for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));
create policy "Members read scoring settings" on public.scoring_settings for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));
create policy "Members read audiences" on public.audiences for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));

-- ---------------------------------------------------------------------------
-- What Dialvo knows about a lead's company, in one place
-- ---------------------------------------------------------------------------

-- Country, region, size, title, domain and the words describing the
-- company, from the lead's own fields, its Find leads research and its
-- account. Internal.
create function private.lead_firmo(
  p_workspace_id uuid, p_lead_id uuid,
  out country text, out region text, out lo bigint, out hi bigint,
  out title text, out domain text, out haystack text, out source text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_l public.leads%rowtype;
  v_prospect uuid;
  v_p_country text;
  v_p_size text;
  v_p_industries text;
  v_a public.accounts%rowtype;
  v_size text;
  v_domain text;
begin
  select l.* into v_l from public.leads l where l.id = p_lead_id and l.workspace_id = p_workspace_id;
  if not found then
    return;
  end if;
  if coalesce(v_l.custom_fields #>> '{research,prospect_id}', '') ~ '^[0-9a-f-]{36}$' then
    v_prospect := (v_l.custom_fields #>> '{research,prospect_id}')::uuid;
  end if;
  select nullif(btrim(coalesce(nullif(p.country, ''), nullif(p.location, ''))), ''),
         nullif(btrim(p.size_range), ''), p.industries::text
  into v_p_country, v_p_size, v_p_industries
  from public.prospects p
  where p.workspace_id = p_workspace_id and (p.lead_id = p_lead_id or p.id = v_prospect)
  limit 1;
  v_domain := private.lead_domain(v_l.website, v_l.email);
  domain := v_domain;
  if v_l.account_id is not null then
    select a.* into v_a from public.accounts a where a.id = v_l.account_id and a.workspace_id = p_workspace_id;
  elsif v_domain is not null then
    select a.* into v_a from public.accounts a where a.workspace_id = p_workspace_id and a.domain = v_domain;
  end if;
  country := lower(coalesce(v_p_country, nullif(btrim(v_l.custom_fields ->> 'country'), ''),
                            nullif(v_a.country, ''), nullif(btrim(v_l.custom_fields #>> '{research,location}'), '')));
  region := lower(coalesce(nullif(btrim(v_l.custom_fields ->> 'state'), ''), nullif(btrim(v_l.custom_fields ->> 'region'), ''),
                           nullif(v_a.region, '')));
  v_size := coalesce(v_p_size, nullif(btrim(v_l.custom_fields ->> 'company_size'), ''),
                     nullif(btrim(v_l.custom_fields ->> 'employees'), ''), nullif(v_a.size_range, ''));
  select b.lo, b.hi into lo, hi from private.size_bounds(v_size) b;
  title := lower(coalesce(nullif(btrim(v_l.custom_fields ->> 'title'), ''),
                          nullif(btrim(v_l.custom_fields #>> '{research,contact_role}'), ''), ''));
  haystack := lower(concat_ws(' ', v_l.company, v_l.custom_fields #>> '{research,summary}',
                              v_l.custom_fields ->> 'industry', v_p_industries, v_a.industry, v_a.name));
  source := lower(v_l.source);
end;
$$;
revoke all on function private.lead_firmo(uuid, uuid) from public;

-- Whether a place matches any of a list of countries or regions, written as
-- people write them ("GB", "United Kingdom"); longer names also match inside
-- a place ("London, United Kingdom"). Empty list: true.
create function private.place_matches(p_place text, p_list jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_array_length(p_list), 0) = 0
    or (p_place is not null and exists (
      select 1 from jsonb_array_elements_text(p_list) c(v)
      where lower(btrim(c.v)) = p_place
         or (char_length(btrim(c.v)) >= 4 and position(lower(btrim(c.v)) in p_place) > 0)
         or (char_length(btrim(c.v)) between 2 and 3
             and p_place ~ ('(^|[ ,(])' || regexp_replace(lower(btrim(c.v)), '[^a-z]', '', 'g') || '([ ,)]|$)'))));
$$;
revoke all on function private.place_matches(text, jsonb) from public;

-- ---------------------------------------------------------------------------
-- Scoring
-- ---------------------------------------------------------------------------

-- The fit of one company or person against the rules: the share of the
-- rules set that it meets, 0-100, and which. Null when no rule is set.
create function private.fit_of(
  p_fit jsonb, p_country text, p_lo bigint, p_hi bigint, p_title text, p_haystack text, p_source text,
  p_recipe numeric, p_recipe_weight integer,
  out score integer, out detail jsonb
)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_total integer := 0;
  v_met integer := 0;
  v_ok boolean;
  v_items jsonb := '[]'::jsonb;
begin
  if coalesce(jsonb_array_length(p_fit -> 'countries'), 0) > 0 then
    v_ok := p_country is not null and private.place_matches(p_country, p_fit -> 'countries');
    v_total := v_total + 1; v_ok := coalesce(v_ok, false); v_met := v_met + v_ok::int;
    v_items := v_items || jsonb_build_object('label', 'In ' || (select string_agg(x, ' or ') from jsonb_array_elements_text(p_fit -> 'countries') x), 'met', v_ok);
  end if;
  if jsonb_typeof(p_fit -> 'size_min') = 'number' or jsonb_typeof(p_fit -> 'size_max') = 'number' then
    v_ok := p_lo is not null
      and (jsonb_typeof(p_fit -> 'size_min') <> 'number' or p_hi >= (p_fit ->> 'size_min')::numeric)
      and (jsonb_typeof(p_fit -> 'size_max') <> 'number' or p_lo <= (p_fit ->> 'size_max')::numeric);
    v_total := v_total + 1; v_ok := coalesce(v_ok, false); v_met := v_met + v_ok::int;
    v_items := v_items || jsonb_build_object('label', 'Company size ' || coalesce(p_fit ->> 'size_min', '1') || ' to ' || coalesce(p_fit ->> 'size_max', 'any'), 'met', v_ok);
  end if;
  if coalesce(jsonb_array_length(p_fit -> 'titles'), 0) > 0 then
    v_ok := coalesce(p_title, '') <> '' and exists (
      select 1 from jsonb_array_elements_text(p_fit -> 'titles') t(v)
      where char_length(btrim(t.v)) >= 2 and position(lower(btrim(t.v)) in p_title) > 0);
    v_total := v_total + 1; v_ok := coalesce(v_ok, false); v_met := v_met + v_ok::int;
    v_items := v_items || jsonb_build_object('label', 'Title has ' || (select string_agg(x, ' or ') from jsonb_array_elements_text(p_fit -> 'titles') x), 'met', v_ok);
  end if;
  if coalesce(jsonb_array_length(p_fit -> 'keywords'), 0) > 0 then
    v_ok := coalesce(p_haystack, '') <> '' and exists (
      select 1 from jsonb_array_elements_text(p_fit -> 'keywords') t(v)
      where char_length(btrim(t.v)) >= 2 and position(lower(btrim(t.v)) in p_haystack) > 0);
    v_total := v_total + 1; v_ok := coalesce(v_ok, false); v_met := v_met + v_ok::int;
    v_items := v_items || jsonb_build_object('label', 'Company is about ' || (select string_agg(x, ' or ') from jsonb_array_elements_text(p_fit -> 'keywords') x), 'met', v_ok);
  end if;
  if coalesce(jsonb_array_length(p_fit -> 'sources'), 0) > 0 then
    v_ok := p_source is not null and exists (
      select 1 from jsonb_array_elements_text(p_fit -> 'sources') t(v) where lower(btrim(t.v)) = p_source);
    v_total := v_total + 1; v_ok := coalesce(v_ok, false); v_met := v_met + v_ok::int;
    v_items := v_items || jsonb_build_object('label', 'Came from ' || (select string_agg(x, ' or ') from jsonb_array_elements_text(p_fit -> 'sources') x), 'met', v_ok);
  end if;
  if p_recipe_weight > 0 and p_recipe is not null then
    v_total := v_total + p_recipe_weight;
    v_met := v_met + round(p_recipe_weight * least(greatest(p_recipe, 0), 100) / 100.0)::int;
    v_items := v_items || jsonb_build_object('label', 'Recipe score ' || round(p_recipe)::text || ' of 100', 'met', p_recipe >= 50);
  end if;
  if v_total = 0 then
    score := null;
  else
    score := round(100.0 * v_met / v_total)::int;
  end if;
  detail := v_items;
end;
$$;
revoke all on function private.fit_of(jsonb, text, bigint, bigint, text, text, text, numeric, integer) from public;

-- A recipe's latest answer for a lead, as 0-100 (a yes is 100, a no 0):
-- from a list row linked to the lead, or a company row at its domain.
create function private.recipe_value(p_workspace_id uuid, p_recipe_id uuid, p_lead_id uuid, p_domain text)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case jsonb_typeof(x.value)
           when 'boolean' then case when x.value = 'true'::jsonb then 100 else 0 end
           when 'number' then least(greatest((x.value #>> '{}')::numeric, 0), 100)
         end
  from public.data_cells x
  join public.data_list_columns c on c.id = x.column_id and c.workspace_id = x.workspace_id
  join public.data_list_rows r on r.id = x.row_id and r.workspace_id = x.workspace_id
  where x.workspace_id = p_workspace_id and c.recipe_id = p_recipe_id and x.status = 'done'
    and jsonb_typeof(x.value) in ('boolean', 'number')
    and (r.lead_id = p_lead_id or (p_domain is not null and r.domain = p_domain))
  order by (r.lead_id = p_lead_id) desc, x.done_at desc
  limit 1;
$$;
revoke all on function private.recipe_value(uuid, uuid, uuid, text) from public;

-- Engagement, 0-100, from the last 90 days. Opens are not tracked and never
-- count. Points (capped per kind, then at 100):
--   a reply or message from them (email, text, social)  25 each, 50 at most
--   a website chat they wrote in                         20
--   a form they filled in                                20
--   pages read on the website                            2 each, 10 at most
--   the pricing page read                                15
--   product events from your app (API)                   10 each, 30 at most
--   a meeting booked                                     40
create function private.lead_engagement(p_workspace_id uuid, p_lead_id uuid, out score integer, out detail jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_since timestamptz := now() - interval '90 days';
  v_replies integer;
  v_chats integer;
  v_forms integer;
  v_pages integer;
  v_pricing integer;
  v_events integer;
  v_meetings integer;
  v_items jsonb := '[]'::jsonb;
  v_total integer := 0;
  v_points integer;
begin
  select count(*) filter (where c.channel <> 'chat'), count(distinct c.id) filter (where c.channel = 'chat')
  into v_replies, v_chats
  from public.messages m
  join public.conversations c on c.id = m.conversation_id and c.workspace_id = m.workspace_id
  where c.workspace_id = p_workspace_id and c.lead_id = p_lead_id and m.direction = 'in'
    and m.sent_at > v_since and coalesce(m.metadata ->> 'via', '') <> 'form';
  select count(*) into v_forms from public.activity_events a
  where a.workspace_id = p_workspace_id and a.lead_id = p_lead_id and a.kind = 'lead_captured' and a.created_at > v_since;
  select coalesce(sum(v.page_views), 0), coalesce(sum(v.pricing_views), 0) into v_pages, v_pricing
  from public.site_visitors v
  where v.workspace_id = p_workspace_id and v.lead_id = p_lead_id and v.last_seen_at > v_since;
  select count(*) into v_events from public.lead_product_events e
  where e.workspace_id = p_workspace_id and e.lead_id = p_lead_id and e.occurred_at > v_since;
  select count(*) into v_meetings from public.meetings mt
  where mt.workspace_id = p_workspace_id and mt.lead_id = p_lead_id and mt.created_at > v_since
    and mt.status <> 'cancelled';

  if v_replies > 0 then
    v_points := least(v_replies * 25, 50); v_total := v_total + v_points;
    v_items := v_items || jsonb_build_object('label', v_replies || case when v_replies = 1 then ' reply' else ' replies' end, 'points', v_points);
  end if;
  if v_chats > 0 then
    v_total := v_total + 20;
    v_items := v_items || jsonb_build_object('label', 'Wrote in the website chat', 'points', 20);
  end if;
  if v_forms > 0 then
    v_total := v_total + 20;
    v_items := v_items || jsonb_build_object('label', 'Filled in a form', 'points', 20);
  end if;
  if v_pages > 0 then
    v_points := least(v_pages * 2, 10); v_total := v_total + v_points;
    v_items := v_items || jsonb_build_object('label', v_pages || case when v_pages = 1 then ' page read' else ' pages read' end, 'points', v_points);
  end if;
  if v_pricing > 0 then
    v_total := v_total + 15;
    v_items := v_items || jsonb_build_object('label', 'Read the pricing page', 'points', 15);
  end if;
  if v_events > 0 then
    v_points := least(v_events * 10, 30); v_total := v_total + v_points;
    v_items := v_items || jsonb_build_object('label', v_events || case when v_events = 1 then ' product event' else ' product events' end, 'points', v_points);
  end if;
  if v_meetings > 0 then
    v_total := v_total + 40;
    v_items := v_items || jsonb_build_object('label', 'Meeting booked', 'points', 40);
  end if;
  score := least(v_total, 100);
  detail := v_items;
end;
$$;
revoke all on function private.lead_engagement(uuid, uuid) from public;

-- Scores one lead (and links it to its account by domain). Internal; never
-- raises, so scoring can't get in the way of a lead being saved.
create function private.score_lead(p_workspace_id uuid, p_lead_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s public.scoring_settings%rowtype;
  v_f record;
  v_fit record;
  v_eng record;
  v_recipe numeric;
  v_combined integer;
  v_tier integer;
  v_account uuid;
begin
  select s.* into v_s from public.scoring_settings s where s.workspace_id = p_workspace_id;
  if not found then
    v_s.fit := '{}'::jsonb; v_s.tier1_min := 70; v_s.tier2_min := 40; v_s.engagement_weight := 40;
    v_s.recipe_weight := 1;
  end if;
  select * into v_f from private.lead_firmo(p_workspace_id, p_lead_id);
  if v_s.recipe_id is not null then
    v_recipe := private.recipe_value(p_workspace_id, v_s.recipe_id, p_lead_id, v_f.domain);
  end if;
  select * into v_fit from private.fit_of(v_s.fit, v_f.country, v_f.lo, v_f.hi, v_f.title, v_f.haystack,
                                          v_f.source, v_recipe, case when v_s.recipe_id is null then 0 else v_s.recipe_weight end);
  select * into v_eng from private.lead_engagement(p_workspace_id, p_lead_id);
  v_combined := case when v_fit.score is null then v_eng.score
                     else round((v_fit.score * (100 - v_s.engagement_weight) + v_eng.score * v_s.engagement_weight) / 100.0)::int end;
  v_tier := case when v_combined >= v_s.tier1_min then 1 when v_combined >= v_s.tier2_min then 2 else 3 end;
  if v_f.domain is not null then
    select a.id into v_account from public.accounts a where a.workspace_id = p_workspace_id and a.domain = v_f.domain;
  end if;
  update public.leads l
  set fit_score = v_fit.score, engagement_score = v_eng.score, tier = v_tier, scored_at = now(),
      score_detail = jsonb_build_object('fit', v_fit.detail, 'engagement', v_eng.detail, 'combined', v_combined),
      account_id = coalesce(l.account_id, v_account)
  where l.id = p_lead_id and l.workspace_id = p_workspace_id;
exception when others then
  return;
end;
$$;
revoke all on function private.score_lead(uuid, uuid) from public;

create function private.leads_score()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select l.scored_at from public.leads l where l.id = new.id) is null then
    perform private.score_lead(new.workspace_id, new.id);
  end if;
  return null;
end;
$$;
revoke all on function private.leads_score() from public;
create trigger leads_score
  after insert on public.leads
  for each row execute function private.leads_score();

-- Rescores the leads scored longest ago (never scored first). Run by the
-- database itself every ten minutes (no app call, see the end), and after
-- the scoring settings change. Returns how many.
create function private.scores_refresh(p_limit integer, p_workspace_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead record;
  v_count integer := 0;
begin
  for v_lead in
    select l.id, l.workspace_id from public.leads l
    where (p_workspace_id is null or l.workspace_id = p_workspace_id)
      and (l.scored_at is null or l.scored_at < now() - interval '6 hours')
    order by l.scored_at nulls first
    limit greatest(least(p_limit, 5000), 0)
  loop
    perform private.score_lead(v_lead.workspace_id, v_lead.id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function private.scores_refresh(integer, uuid) from public;

-- Whether fit rules are well formed. Internal.
create function private.fit_rules_ok(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p) = 'object'
    and not exists (
      select 1 from unnest(array['countries', 'titles', 'keywords', 'sources']) k
      where p ? k and (
        jsonb_typeof(p -> k) <> 'array' or jsonb_array_length(p -> k) > 30
        or exists (select 1 from jsonb_array_elements(p -> k) v
                   where jsonb_typeof(v) <> 'string' or char_length(v #>> '{}') not between 1 and 80)))
    and not exists (
      select 1 from unnest(array['size_min', 'size_max']) k
      where p ? k and jsonb_typeof(p -> k) <> 'null' and (
        jsonb_typeof(p -> k) <> 'number' or (p ->> k)::numeric not between 1 and 10000000));
$$;
revoke all on function private.fit_rules_ok(jsonb) from public;

-- Saves the scoring settings, for an owner or admin, and rescores the
-- workspace's leads (the first p_rescore now, the rest within the hour).
create function public.scoring_save(
  p_workspace_id uuid, p_fit jsonb, p_recipe_id uuid, p_recipe_weight integer,
  p_tier1_min integer, p_tier2_min integer, p_engagement_weight integer, p_rescore integer
)
returns integer
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
  if not private.fit_rules_ok(coalesce(p_fit, 'null'::jsonb))
     or coalesce(p_tier1_min, 0) not between 1 and 100
     or coalesce(p_tier2_min, -1) not between 0 and 99
     or p_tier2_min >= p_tier1_min
     or coalesce(p_engagement_weight, -1) not between 0 and 100
     or coalesce(p_recipe_weight, 0) not between 1 and 3 then
    raise exception 'those settings are out of range' using errcode = '22023';
  end if;
  if p_recipe_id is not null and not exists (
    select 1 from public.data_recipes r
    where r.id = p_recipe_id and r.workspace_id = p_workspace_id and r.archived_at is null
      and r.answer_type in ('score', 'yes_no')) then
    raise exception 'recipe not found' using errcode = 'P0002';
  end if;
  insert into public.scoring_settings as s (workspace_id, fit, recipe_id, recipe_weight, tier1_min, tier2_min,
                                            engagement_weight, updated_by, updated_at)
  values (p_workspace_id, p_fit, p_recipe_id, p_recipe_weight, p_tier1_min, p_tier2_min,
          p_engagement_weight, v_user, now())
  on conflict (workspace_id) do update
  set fit = excluded.fit, recipe_id = excluded.recipe_id, recipe_weight = excluded.recipe_weight,
      tier1_min = excluded.tier1_min, tier2_min = excluded.tier2_min,
      engagement_weight = excluded.engagement_weight, updated_by = v_user, updated_at = now();
  update public.leads l set scored_at = null where l.workspace_id = p_workspace_id;
  return private.scores_refresh(greatest(least(coalesce(p_rescore, 0), 2000), 0), p_workspace_id);
end;
$$;
revoke all on function public.scoring_save(uuid, jsonb, uuid, integer, integer, integer, integer, integer) from public, anon;
grant execute on function public.scoring_save(uuid, jsonb, uuid, integer, integer, integer, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------------

-- Scores an account on the fit rules (no engagement). Internal.
create function private.score_account(p_workspace_id uuid, p_account_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a public.accounts%rowtype;
  v_fit jsonb;
  v_lo bigint;
  v_hi bigint;
  v_score integer;
begin
  select a.* into v_a from public.accounts a where a.id = p_account_id and a.workspace_id = p_workspace_id;
  if not found then
    return;
  end if;
  select s.fit into v_fit from public.scoring_settings s where s.workspace_id = p_workspace_id;
  select b.lo, b.hi into v_lo, v_hi from private.size_bounds(nullif(v_a.size_range, '')) b;
  -- Title and source rules are about people, so they are left out here.
  select f.score into v_score from private.fit_of(
    coalesce(v_fit, '{}'::jsonb) - 'titles' - 'sources', nullif(lower(v_a.country), ''), v_lo, v_hi, null,
    lower(concat_ws(' ', v_a.name, v_a.industry)), null, null, 0) f;
  update public.accounts a set fit_score = v_score where a.id = p_account_id;
end;
$$;
revoke all on function private.score_account(uuid, uuid) from public;

-- Adds target accounts (by domain) from a list's rows, for a member, links
-- the leads and list rows at those domains, and marks the list as a target
-- account list. Accounts that exist already are kept as they are.
--   { "added": n, "existing": n }
create function public.accounts_from_list(p_workspace_id uuid, p_list_id uuid, p_max integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.require_member(p_workspace_id);
  v_added integer;
  v_total integer;
  v_id uuid;
begin
  if not exists (select 1 from public.data_lists l
                 where l.id = p_list_id and l.workspace_id = p_workspace_id and l.archived_at is null
                   and l.kind = 'companies') then
    raise exception 'list not found' using errcode = 'P0002';
  end if;
  perform 1 from public.workspaces w where w.id = p_workspace_id for update;
  select count(distinct r.domain) into v_total from public.data_list_rows r
  where r.list_id = p_list_id and r.workspace_id = p_workspace_id and r.domain is not null;
  if (select count(*) from public.accounts a where a.workspace_id = p_workspace_id)
     + (select count(distinct r.domain) from public.data_list_rows r
        where r.list_id = p_list_id and r.workspace_id = p_workspace_id and r.domain is not null
          and not exists (select 1 from public.accounts a where a.workspace_id = p_workspace_id and a.domain = r.domain)) > p_max then
    raise exception 'too many accounts' using errcode = 'P0001';
  end if;
  with ins as (
    insert into public.accounts (workspace_id, domain, name, country, size_range, industry, created_by)
    select distinct on (r.domain) p_workspace_id, r.domain, r.company, r.country, r.size_range,
           left(coalesce(r.fields #>> '{_company,industry}', ''), 120), v_user
    from public.data_list_rows r
    where r.list_id = p_list_id and r.workspace_id = p_workspace_id and r.domain is not null
    order by r.domain, r.position
    on conflict (workspace_id, domain) do nothing
    returning id
  )
  select count(*) into v_added from ins;
  update public.data_list_rows r set account_id = a.id
  from public.accounts a
  where r.list_id = p_list_id and r.workspace_id = p_workspace_id and a.workspace_id = r.workspace_id
    and a.domain = r.domain;
  update public.leads l set account_id = a.id
  from public.accounts a
  where l.workspace_id = p_workspace_id and a.workspace_id = l.workspace_id and l.account_id is null
    and a.domain = private.lead_domain(l.website, l.email)
    and a.id in (select r.account_id from public.data_list_rows r where r.list_id = p_list_id and r.account_id is not null);
  update public.data_lists l set is_target = true where l.id = p_list_id;
  for v_id in select r.account_id from public.data_list_rows r
              where r.list_id = p_list_id and r.account_id is not null loop
    perform private.score_account(p_workspace_id, v_id);
  end loop;
  return jsonb_build_object('added', v_added, 'existing', v_total - v_added);
end;
$$;
revoke all on function public.accounts_from_list(uuid, uuid, integer) from public, anon;
grant execute on function public.accounts_from_list(uuid, uuid, integer) to authenticated;

-- Gives an account an owner (or none), for an owner or admin. The account's
-- leads without an owner go to that person too.
create function public.account_set_owner(p_workspace_id uuid, p_account_id uuid, p_owner uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if (select auth.uid()) is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if not (select private.is_workspace_admin(p_workspace_id)) then
    raise exception 'only an owner or admin can change this' using errcode = '42501';
  end if;
  if p_owner is not null and not private.is_member(p_workspace_id, p_owner) then
    raise exception 'that person isn''t in the workspace' using errcode = '22023';
  end if;
  update public.accounts a set owner_id = p_owner where a.id = p_account_id and a.workspace_id = p_workspace_id;
  if not found then
    raise exception 'account not found' using errcode = 'P0002';
  end if;
  if p_owner is null then
    return 0;
  end if;
  update public.leads l set owner_id = p_owner
  where l.workspace_id = p_workspace_id and l.account_id = p_account_id and l.owner_id is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.account_set_owner(uuid, uuid, uuid) from public, anon;
grant execute on function public.account_set_owner(uuid, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Territories
-- ---------------------------------------------------------------------------

create function public.territory_save(
  p_workspace_id uuid, p_id uuid, p_name text, p_position integer, p_countries jsonb, p_regions jsonb,
  p_size_min integer, p_size_max integer, p_reps uuid[]
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
     or coalesce(p_position, -1) not between 0 and 1000
     or not private.fit_rules_ok(jsonb_build_object('countries', coalesce(p_countries, '[]'::jsonb),
                                                    'titles', coalesce(p_regions, '[]'::jsonb)))
     or (p_size_min is not null and p_size_min not between 1 and 10000000)
     or (p_size_max is not null and p_size_max not between 1 and 10000000)
     or (p_size_min is not null and p_size_max is not null and p_size_min > p_size_max)
     or coalesce(cardinality(p_reps), 0) not between 1 and 30 then
    raise exception 'those settings are out of range' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(p_reps) r(u) where not private.is_member(p_workspace_id, r.u)) then
    raise exception 'everyone on a territory must be in the workspace' using errcode = '22023';
  end if;
  if p_id is null then
    perform 1 from public.workspaces w where w.id = p_workspace_id for update;
    if (select count(*) from public.territories t where t.workspace_id = p_workspace_id) >= 50 then
      raise exception 'too many territories' using errcode = 'P0001';
    end if;
    insert into public.territories (workspace_id, name, position, countries, regions, size_min, size_max, created_by)
    values (p_workspace_id, btrim(p_name), p_position, coalesce(p_countries, '[]'::jsonb),
            coalesce(p_regions, '[]'::jsonb), p_size_min, p_size_max, v_user)
    returning id into v_id;
  else
    update public.territories t
    set name = btrim(p_name), position = p_position, countries = coalesce(p_countries, '[]'::jsonb),
        regions = coalesce(p_regions, '[]'::jsonb), size_min = p_size_min, size_max = p_size_max
    where t.id = p_id and t.workspace_id = p_workspace_id
    returning t.id into v_id;
    if v_id is null then
      raise exception 'territory not found' using errcode = 'P0002';
    end if;
    delete from public.territory_reps r where r.territory_id = v_id and r.workspace_id = p_workspace_id;
  end if;
  insert into public.territory_reps (territory_id, workspace_id, user_id)
  select distinct v_id, p_workspace_id, r.u from unnest(p_reps) r(u);
  return v_id;
end;
$$;
revoke all on function public.territory_save(uuid, uuid, text, integer, jsonb, jsonb, integer, integer, uuid[]) from public, anon;
grant execute on function public.territory_save(uuid, uuid, text, integer, jsonb, jsonb, integer, integer, uuid[]) to authenticated;

create function public.territory_delete(p_workspace_id uuid, p_id uuid)
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
  delete from public.territories t where t.id = p_id and t.workspace_id = p_workspace_id;
  if not found then
    raise exception 'territory not found' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.territory_delete(uuid, uuid) from public, anon;
grant execute on function public.territory_delete(uuid, uuid) to authenticated;

-- The first territory (by position) a place and size fall in. Internal.
create function private.territory_for(p_workspace_id uuid, p_country text, p_region text, p_lo bigint, p_hi bigint)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select t.id from public.territories t
  where t.workspace_id = p_workspace_id
    and (jsonb_array_length(t.countries) = 0 or (p_country is not null and private.place_matches(p_country, t.countries)))
    and (jsonb_array_length(t.regions) = 0
         or (p_region is not null and private.place_matches(p_region, t.regions))
         or (p_country is not null and private.place_matches(p_country, t.regions)))
    and (t.size_min is null or (p_hi is not null and p_hi >= t.size_min))
    and (t.size_max is null or (p_lo is not null and p_lo <= t.size_max))
    and exists (select 1 from public.territory_reps r where r.territory_id = t.id)
  order by t.position, t.created_at, t.id
  limit 1;
$$;
revoke all on function private.territory_for(uuid, text, text, bigint, bigint) from public;

-- Puts every account in its territory and shares each territory's accounts
-- among its reps, for an owner or admin: highest fit first, each to the rep
-- with the least so far, by count of accounts or by their total fit score.
-- Accounts that already have an owner keep them unless p_reassign. Each
-- account's leads without an owner go to its owner.
--   { "accounts": n, "assigned": n, "no_territory": n, "leads": n }
create function public.territories_assign(p_workspace_id uuid, p_balance text, p_reassign boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a record;
  v_lo bigint;
  v_hi bigint;
  v_t uuid;
  v_rep uuid;
  v_total integer := 0;
  v_assigned integer := 0;
  v_none integer := 0;
  v_leads integer;
begin
  if (select auth.uid()) is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if not (select private.is_workspace_admin(p_workspace_id)) then
    raise exception 'only an owner or admin can change this' using errcode = '42501';
  end if;
  if coalesce(p_balance, '') not in ('count', 'score') then
    raise exception 'those settings are out of range' using errcode = '22023';
  end if;
  perform 1 from public.workspaces w where w.id = p_workspace_id for update;
  create temporary table if not exists pg_temp.territory_load (user_id uuid primary key, n numeric not null) on commit drop;
  delete from pg_temp.territory_load;
  -- What each rep holds already (the accounts that keep their owner).
  insert into pg_temp.territory_load (user_id, n)
  select r.user_id, coalesce(sum(case when p_balance = 'count' then 1 else coalesce(a.fit_score, 0) + 1 end), 0)
  from (select distinct user_id from public.territory_reps where workspace_id = p_workspace_id) r
  left join public.accounts a on a.workspace_id = p_workspace_id and a.owner_id = r.user_id
    and not coalesce(p_reassign, false)
  group by r.user_id;

  for v_a in
    select a.* from public.accounts a where a.workspace_id = p_workspace_id
    order by a.fit_score desc nulls last, a.created_at, a.id
  loop
    perform private.score_account(p_workspace_id, v_a.id);
    v_total := v_total + 1;
    select b.lo, b.hi into v_lo, v_hi from private.size_bounds(nullif(v_a.size_range, '')) b;
    v_t := private.territory_for(p_workspace_id, nullif(lower(v_a.country), ''), nullif(lower(v_a.region), ''), v_lo, v_hi);
    update public.accounts a set territory_id = v_t where a.id = v_a.id;
    if v_t is null then
      v_none := v_none + 1;
      continue;
    end if;
    if v_a.owner_id is not null and not coalesce(p_reassign, false) then
      continue;
    end if;
    select r.user_id into v_rep from public.territory_reps r
    join pg_temp.territory_load tl on tl.user_id = r.user_id
    where r.territory_id = v_t
    order by tl.n, r.created_at, r.user_id
    limit 1;
    update public.accounts a set owner_id = v_rep where a.id = v_a.id;
    update pg_temp.territory_load tl
    set n = tl.n + case when p_balance = 'count' then 1
                        else coalesce((select a.fit_score from public.accounts a where a.id = v_a.id), 0) + 1 end
    where tl.user_id = v_rep;
    v_assigned := v_assigned + 1;
  end loop;
  update public.leads l set owner_id = a.owner_id
  from public.accounts a
  where l.workspace_id = p_workspace_id and l.account_id = a.id and a.workspace_id = l.workspace_id
    and l.owner_id is null and a.owner_id is not null;
  get diagnostics v_leads = row_count;
  return jsonb_build_object('accounts', v_total, 'assigned', v_assigned, 'no_territory', v_none, 'leads', v_leads);
end;
$$;
revoke all on function public.territories_assign(uuid, text, boolean) from public, anon;
grant execute on function public.territories_assign(uuid, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Filters over leads: audiences and playbooks
-- ---------------------------------------------------------------------------

-- Whether lead filters are well formed (also every playbook key). Internal.
--   statuses, tiers, sources, countries: lists
--   min_fit, min_engagement, size_min, size_max, inactive_days,
--   active_within_days, added_within_days: numbers or null
--   list_id, audience_id: ids or null
--   recipe: { "id", "answer" } or null ("yes", "no", a number for "at
--   least", or the option or text to match)
create function private.lead_filters_ok(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p) = 'object'
    and (not p ? 'statuses' or (
      jsonb_typeof(p -> 'statuses') = 'array' and jsonb_array_length(p -> 'statuses') <= 7
      and not exists (select 1 from jsonb_array_elements_text(p -> 'statuses') s
                      where s not in ('new', 'engaged', 'qualified', 'meeting_booked', 'won', 'lost', 'unsubscribed'))))
    and (not p ? 'tiers' or (
      jsonb_typeof(p -> 'tiers') = 'array' and jsonb_array_length(p -> 'tiers') <= 3
      and not exists (select 1 from jsonb_array_elements(p -> 'tiers') t
                      where jsonb_typeof(t) <> 'number' or (t #>> '{}') not in ('1', '2', '3'))))
    and not exists (
      select 1 from unnest(array['sources', 'countries']) k
      where p ? k and (
        jsonb_typeof(p -> k) <> 'array' or jsonb_array_length(p -> k) > 30
        or exists (select 1 from jsonb_array_elements(p -> k) v
                   where jsonb_typeof(v) <> 'string' or char_length(v #>> '{}') not between 1 and 80)))
    and not exists (
      select 1 from unnest(array['min_fit', 'min_engagement']) k
      where p ? k and jsonb_typeof(p -> k) <> 'null' and (
        jsonb_typeof(p -> k) <> 'number' or (p ->> k)::numeric not between 0 and 100))
    and not exists (
      select 1 from unnest(array['inactive_days', 'active_within_days', 'added_within_days']) k
      where p ? k and jsonb_typeof(p -> k) <> 'null' and (
        jsonb_typeof(p -> k) <> 'number' or (p ->> k)::numeric not between 1 and 730))
    and not exists (
      select 1 from unnest(array['size_min', 'size_max']) k
      where p ? k and jsonb_typeof(p -> k) <> 'null' and (
        jsonb_typeof(p -> k) <> 'number' or (p ->> k)::numeric not between 1 and 10000000))
    and not exists (
      select 1 from unnest(array['list_id', 'audience_id']) k
      where p ? k and jsonb_typeof(p -> k) <> 'null' and (
        jsonb_typeof(p -> k) <> 'string' or (p ->> k) !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
    and (not p ? 'recipe' or jsonb_typeof(p -> 'recipe') = 'null' or (
      jsonb_typeof(p -> 'recipe') = 'object'
      and coalesce(p #>> '{recipe,id}', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and char_length(coalesce(p #>> '{recipe,answer}', '')) between 1 and 80));
$$;
revoke all on function private.lead_filters_ok(jsonb) from public;

-- Whether one lead matches the filters. An audience_id in the filters adds
-- that audience's own filters (one level: an audience can't name another).
-- Internal.
create function private.lead_matches(p_workspace_id uuid, p_lead_id uuid, p jsonb, p_depth integer default 0)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_l public.leads%rowtype;
  v_f record;
  v_last timestamptz;
  v_aud jsonb;
  v_answer text;
begin
  if p is null or p = '{}'::jsonb then
    return true;
  end if;
  select l.* into v_l from public.leads l where l.id = p_lead_id and l.workspace_id = p_workspace_id;
  if not found then
    return false;
  end if;
  if coalesce(jsonb_array_length(p -> 'statuses'), 0) > 0
     and v_l.status not in (select jsonb_array_elements_text(p -> 'statuses')) then
    return false;
  end if;
  if coalesce(jsonb_array_length(p -> 'tiers'), 0) > 0
     and (v_l.tier is null or v_l.tier not in (select (t #>> '{}')::int from jsonb_array_elements(p -> 'tiers') t)) then
    return false;
  end if;
  if jsonb_typeof(p -> 'min_fit') = 'number' and coalesce(v_l.fit_score, -1) < (p ->> 'min_fit')::numeric then
    return false;
  end if;
  if jsonb_typeof(p -> 'min_engagement') = 'number'
     and coalesce(v_l.engagement_score, -1) < (p ->> 'min_engagement')::numeric then
    return false;
  end if;
  if coalesce(jsonb_array_length(p -> 'sources'), 0) > 0
     and lower(v_l.source) not in (select lower(s) from jsonb_array_elements_text(p -> 'sources') s) then
    return false;
  end if;
  if jsonb_typeof(p -> 'added_within_days') = 'number'
     and v_l.created_at < now() - make_interval(days => (p ->> 'added_within_days')::integer) then
    return false;
  end if;
  if coalesce(jsonb_array_length(p -> 'countries'), 0) > 0
     or jsonb_typeof(p -> 'size_min') = 'number' or jsonb_typeof(p -> 'size_max') = 'number'
     or jsonb_typeof(p -> 'list_id') = 'string' or jsonb_typeof(p -> 'recipe') = 'object' then
    select * into v_f from private.lead_firmo(p_workspace_id, p_lead_id);
    if not private.place_matches(v_f.country, p -> 'countries')
       or (coalesce(jsonb_array_length(p -> 'countries'), 0) > 0 and v_f.country is null) then
      return false;
    end if;
    if jsonb_typeof(p -> 'size_min') = 'number' and (v_f.hi is null or v_f.hi < (p ->> 'size_min')::numeric) then
      return false;
    end if;
    if jsonb_typeof(p -> 'size_max') = 'number' and (v_f.lo is null or v_f.lo > (p ->> 'size_max')::numeric) then
      return false;
    end if;
    if jsonb_typeof(p -> 'list_id') = 'string' and not exists (
      select 1 from public.data_list_rows r
      join public.data_lists dl on dl.id = r.list_id and dl.workspace_id = r.workspace_id
      where r.workspace_id = p_workspace_id and r.list_id = (p ->> 'list_id')::uuid
        and (r.lead_id = p_lead_id or (dl.kind = 'companies' and v_f.domain is not null and r.domain = v_f.domain))) then
      return false;
    end if;
    if jsonb_typeof(p -> 'recipe') = 'object' then
      v_answer := lower(btrim(p #>> '{recipe,answer}'));
      if not exists (
        select 1 from public.data_cells x
        join public.data_list_columns c on c.id = x.column_id and c.workspace_id = x.workspace_id
        join public.data_list_rows r on r.id = x.row_id and r.workspace_id = x.workspace_id
        where x.workspace_id = p_workspace_id and c.recipe_id = (p #>> '{recipe,id}')::uuid and x.status = 'done'
          and (r.lead_id = p_lead_id or (v_f.domain is not null and r.domain = v_f.domain))
          and case jsonb_typeof(x.value)
                when 'boolean' then (x.value = 'true'::jsonb and v_answer = 'yes') or (x.value = 'false'::jsonb and v_answer = 'no')
                when 'number' then v_answer ~ '^-?[0-9]+(\.[0-9]+)?$' and (x.value #>> '{}')::numeric >= v_answer::numeric
                when 'string' then lower(btrim(x.value #>> '{}')) = v_answer
                else false
              end) then
        return false;
      end if;
    end if;
  end if;
  if jsonb_typeof(p -> 'inactive_days') = 'number' or jsonb_typeof(p -> 'active_within_days') = 'number' then
    v_last := private.lead_last_activity(p_workspace_id, p_lead_id);
    if jsonb_typeof(p -> 'inactive_days') = 'number'
       and v_last > now() - make_interval(days => (p ->> 'inactive_days')::integer) then
      return false;
    end if;
    if jsonb_typeof(p -> 'active_within_days') = 'number'
       and v_last < now() - make_interval(days => (p ->> 'active_within_days')::integer) then
      return false;
    end if;
  end if;
  if jsonb_typeof(p -> 'audience_id') = 'string' and p_depth = 0 then
    select a.filters into v_aud from public.audiences a
    where a.id = (p ->> 'audience_id')::uuid and a.workspace_id = p_workspace_id and a.archived_at is null;
    if v_aud is null or not private.lead_matches(p_workspace_id, p_lead_id, v_aud - 'audience_id', 1) then
      return false;
    end if;
  end if;
  return true;
end;
$$;
revoke all on function private.lead_matches(uuid, uuid, jsonb, integer) from public;

create function public.audience_save(p_workspace_id uuid, p_id uuid, p_name text, p_filters jsonb, p_max integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.require_member(p_workspace_id);
  v_id uuid;
begin
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 80
     or not private.lead_filters_ok(coalesce(p_filters, 'null'::jsonb))
     or p_filters ? 'audience_id' then
    raise exception 'those settings are out of range' using errcode = '22023';
  end if;
  if p_id is null then
    perform 1 from public.workspaces w where w.id = p_workspace_id for update;
    if (select count(*) from public.audiences a where a.workspace_id = p_workspace_id and a.archived_at is null) >= p_max then
      raise exception 'too many audiences' using errcode = 'P0001';
    end if;
    insert into public.audiences (workspace_id, name, filters, created_by)
    values (p_workspace_id, btrim(p_name), p_filters, v_user)
    returning id into v_id;
  else
    update public.audiences a set name = btrim(p_name), filters = p_filters
    where a.id = p_id and a.workspace_id = p_workspace_id and a.archived_at is null
    returning a.id into v_id;
    if v_id is null then
      raise exception 'audience not found' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end;
$$;
revoke all on function public.audience_save(uuid, uuid, text, jsonb, integer) from public, anon;
grant execute on function public.audience_save(uuid, uuid, text, jsonb, integer) to authenticated;

create function public.audience_archive(p_workspace_id uuid, p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_member(p_workspace_id);
  update public.audiences a set archived_at = now()
  where a.id = p_id and a.workspace_id = p_workspace_id and a.archived_at is null;
  if not found then
    raise exception 'audience not found' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.audience_archive(uuid, uuid) from public, anon;
grant execute on function public.audience_archive(uuid, uuid) to authenticated;

-- The leads that match a saved audience (or unsaved filters, to preview),
-- newest first, for a member. Evaluated now, so it is always up to date.
create function public.audience_lead_ids(p_workspace_id uuid, p_audience_id uuid, p_filters jsonb, p_limit integer)
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_filters jsonb := p_filters;
  v_out uuid[];
begin
  perform private.require_member(p_workspace_id);
  if p_audience_id is not null then
    select a.filters into v_filters from public.audiences a
    where a.id = p_audience_id and a.workspace_id = p_workspace_id and a.archived_at is null;
    if v_filters is null then
      return null;
    end if;
  end if;
  if not private.lead_filters_ok(coalesce(v_filters, 'null'::jsonb)) then
    raise exception 'those settings are out of range' using errcode = '22023';
  end if;
  select array_agg(x.id order by x.created_at desc) into v_out
  from (
    select l.id, l.created_at from public.leads l
    where l.workspace_id = p_workspace_id and private.lead_matches(p_workspace_id, l.id, v_filters)
    order by l.created_at desc
    limit greatest(least(p_limit, 10000), 1)
  ) x;
  return coalesce(v_out, '{}');
end;
$$;
revoke all on function public.audience_lead_ids(uuid, uuid, jsonb, integer) from public, anon;
grant execute on function public.audience_lead_ids(uuid, uuid, jsonb, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Playbooks: the new filters, and starting one on chosen leads
-- ---------------------------------------------------------------------------

-- As in 20261121004555_playbooks: the same keys, plus every lead filter.
create or replace function private.playbook_filters_ok(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select private.lead_filters_ok(p)
    and not exists (select 1 from jsonb_array_elements_text(coalesce(p -> 'statuses', '[]'::jsonb)) s
                    where s = 'unsubscribed');
$$;

-- As private.playbook_candidates in 20261121004555_playbooks, with the new
-- filters (private.lead_matches), and narrowed to p_lead_ids when given.
create function private.playbook_candidates_for(
  p_workspace_id uuid, p_playbook_id uuid, p_limit integer, p_lead_ids uuid[]
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with pb as (
    select b.* from public.playbooks b
    where b.id = p_playbook_id and b.workspace_id = p_workspace_id and b.archived_at is null
  ),
  base as (
    select l.*, private.lead_last_activity(l.workspace_id, l.id) as last_at
    from public.leads l, pb
    where l.workspace_id = p_workspace_id
      and (p_lead_ids is null or l.id = any (p_lead_ids))
      and l.email is not null
      and not l.do_not_contact
      and l.status <> 'unsubscribed'
      and not private.outbound_is_suppressed(l.workspace_id, l.email, private.site_domain(l.website))
      and not exists (
        select 1 from public.mail_threads t
        where t.workspace_id = l.workspace_id and (t.lead_id = l.id or t.to_email = l.email)
          and (t.reply_class in ('not_interested', 'unsubscribe', 'wrong_person')
               or t.status in ('unsubscribed', 'active')))
      and not exists (
        select 1 from public.outbound_emails e
        where e.workspace_id = l.workspace_id and e.to_email = l.email
          and e.status in ('queued', 'scheduled', 'sending', 'needs_check'))
      and not exists (
        select 1 from public.outbound_drafts d
        where d.workspace_id = l.workspace_id and d.to_email = l.email
          and (d.status in ('drafting', 'draft')
               or (d.status = 'approved' and not exists (
                     select 1 from public.outbound_emails e2 where e2.draft_id = d.id))))
      and not exists (
        select 1 from public.outbound_campaign_targets ct
        join public.outbound_campaigns c on c.id = ct.campaign_id and c.workspace_id = ct.workspace_id
        where ct.workspace_id = l.workspace_id and ct.lead_id = l.id and c.playbook_id = pb.id
          and ct.created_at > now() - make_interval(days => pb.repeat_days))
      -- Every filter but inactivity, which also writes the "why now" below.
      and private.lead_matches(l.workspace_id, l.id, pb.filters - 'inactive_days')
      -- A customer only with their email consent or a conversation.
      and (l.status <> 'won' or l.consent_email or exists (
            select 1 from public.messages m
            join public.conversations c on c.id = m.conversation_id and c.workspace_id = m.workspace_id
            where c.lead_id = l.id and c.workspace_id = l.workspace_id and m.direction = 'in'))
  ),
  picked as (
    select b.id as lead_id, b.last_at as at,
           case when jsonb_typeof(pb.filters -> 'inactive_days') = 'number'
             then 'No activity since ' || to_char(b.last_at at time zone 'utc', 'FMDD Mon YYYY')
                  || ' (' || extract(day from now() - b.last_at)::int || ' days)'
             when p_lead_ids is not null
             then 'Chosen for your playbook "' || pb.name || '"'
                  || coalesce(' (tier ' || b.tier::text || ')', '')
             else 'Matches your playbook "' || pb.name || '" (' || b.status
                  || coalesce(', from ' || nullif(b.source, ''), '')
                  || coalesce(', tier ' || b.tier::text, '') || ')'
           end as fact
    from base b, pb
    where jsonb_typeof(pb.filters -> 'inactive_days') is distinct from 'number'
       or b.last_at < now() - make_interval(days => (pb.filters ->> 'inactive_days')::integer)
  )
  select coalesce(jsonb_agg(jsonb_build_object('lead_id', p.lead_id, 'fact', p.fact, 'at', p.at)
                            order by p.at, p.lead_id), '[]'::jsonb)
  from (select * from picked order by at, lead_id limit greatest(p_limit, 0)) p;
$$;
revoke all on function private.playbook_candidates_for(uuid, uuid, integer, uuid[]) from public;

create or replace function private.playbook_candidates(p_workspace_id uuid, p_playbook_id uuid, p_limit integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.playbook_candidates_for(p_workspace_id, p_playbook_id, p_limit, null);
$$;

-- Starts a playbook on chosen leads (from a list, an audience or an
-- account), for a member, with every rule playbook_start keeps. Server only.
--   { "status": "created", "campaign_id", "selected", "left_out" } | { "status": "empty" | "not_found" }
create function public.playbook_start_for(
  p_workspace_id uuid, p_user_id uuid, p_playbook_id uuid, p_lead_ids uuid[], p_limit integer, p_label text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pb public.playbooks%rowtype;
  v_list jsonb;
  v_campaign uuid;
begin
  if not private.is_member(p_workspace_id, p_user_id) then
    return jsonb_build_object('status', 'not_found');
  end if;
  perform 1 from public.workspaces w where w.id = p_workspace_id for update;
  select b.* into v_pb from public.playbooks b
  where b.id = p_playbook_id and b.workspace_id = p_workspace_id and b.archived_at is null;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  v_list := private.playbook_candidates_for(p_workspace_id, p_playbook_id, p_limit, coalesce(p_lead_ids, '{}'));
  if jsonb_array_length(v_list) = 0 then
    return jsonb_build_object('status', 'empty', 'left_out', coalesce(cardinality(p_lead_ids), 0));
  end if;
  insert into public.outbound_campaigns (workspace_id, kind, name, settings, created_by,
                                         playbook_id, sequence_id, language)
  values (p_workspace_id, 'playbook',
          left(v_pb.name || ', ' || coalesce(nullif(btrim(p_label), '') || ', ', '')
               || to_char(now() at time zone 'utc', 'FMDD Mon'), 120),
          jsonb_build_object('guidance', v_pb.goal, 'playbook_id', v_pb.id),
          p_user_id, v_pb.id, v_pb.sequence_id, v_pb.language)
  returning id into v_campaign;
  insert into public.outbound_campaign_targets (workspace_id, campaign_id, position, lead_id, status, why_now)
  select p_workspace_id, v_campaign, x.ord, (x.item ->> 'lead_id')::uuid, 'selected',
         jsonb_build_object('fact', x.item ->> 'fact', 'at', x.item ->> 'at', 'source', 'your leads')
  from jsonb_array_elements(v_list) with ordinality as x(item, ord);
  return jsonb_build_object('status', 'created', 'campaign_id', v_campaign,
                            'selected', jsonb_array_length(v_list),
                            'left_out', greatest(coalesce(cardinality(p_lead_ids), 0) - jsonb_array_length(v_list), 0));
end;
$$;
revoke all on function public.playbook_start_for(uuid, uuid, uuid, uuid[], integer, text) from public, anon, authenticated;
grant execute on function public.playbook_start_for(uuid, uuid, uuid, uuid[], integer, text) to service_role;

-- ---------------------------------------------------------------------------
-- Routing: the account's owner, then territories, then the rules (now also
-- by tier)
-- ---------------------------------------------------------------------------

-- As in 20261121004738_lead_routing, plus "tiers": [1, 2, 3].
create or replace function private.routing_match_ok(p jsonb)
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
         or (p ->> 'size_min')::numeric <= (p ->> 'size_max')::numeric)
    and (not p ? 'tiers' or (
      jsonb_typeof(p -> 'tiers') = 'array' and jsonb_array_length(p -> 'tiers') <= 3
      and not exists (select 1 from jsonb_array_elements(p -> 'tiers') t
                      where jsonb_typeof(t) <> 'number' or (t #>> '{}') not in ('1', '2', '3'))));
$$;

-- Gives a lead to a person and says so. Internal.
create function private.route_to(p_workspace_id uuid, p_lead_id uuid, p_user uuid, p_why text, p_company text, p_meta jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.leads l set owner_id = p_user where l.id = p_lead_id;
  update public.conversations c set assigned_to = p_user
  where c.workspace_id = p_workspace_id and c.lead_id = p_lead_id and c.assigned_to is null
    and c.status <> 'closed';
  insert into public.activity_events (workspace_id, lead_id, kind, summary, metadata)
  values (p_workspace_id, p_lead_id, 'lead_routed',
          'Routed to ' || coalesce(nullif((select pf.name from public.profiles pf where pf.id = p_user), ''), 'a teammate')
            || ' ' || p_why || '.',
          p_meta || jsonb_build_object('user_id', p_user));
  insert into public.team_alerts (workspace_id, lead_id, recipient_user_id, kind, summary)
  values (p_workspace_id, p_lead_id, p_user, 'lead_assigned',
          left('Routed to you ' || p_why || coalesce('. ' || nullif(btrim(coalesce(p_company, '')), ''), '') || '.', 1000));
end;
$$;
revoke all on function private.route_to(uuid, uuid, uuid, text, text, jsonb) from public;

-- As in 20261121004738_lead_routing, with three changes: the lead is scored
-- first; a lead at a target account with an owner goes to that owner; a
-- lead in a territory goes to the territory's rep with the fewest open
-- leads; then the rules, which may also match tiers. Never raises.
create or replace function private.route_lead(p_workspace_id uuid, p_lead_id uuid, p_play text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_l public.leads%rowtype;
  v_f record;
  v_rule public.routing_rules%rowtype;
  v_people uuid[];
  v_user uuid;
  v_account public.accounts%rowtype;
  v_territory uuid;
begin
  perform private.score_lead(p_workspace_id, p_lead_id);
  select l.* into v_l from public.leads l
  where l.id = p_lead_id and l.workspace_id = p_workspace_id for update;
  if not found or v_l.owner_id is not null then
    return null;
  end if;

  -- 1. The account's owner.
  if v_l.account_id is not null then
    select a.* into v_account from public.accounts a
    where a.id = v_l.account_id and a.workspace_id = p_workspace_id;
    if v_account.owner_id is not null and private.is_member(p_workspace_id, v_account.owner_id) then
      perform private.route_to(p_workspace_id, p_lead_id, v_account.owner_id,
                               'as the owner of the account ' || coalesce(nullif(v_account.name, ''), v_account.domain),
                               v_l.company, jsonb_build_object('account_id', v_account.id));
      return v_account.owner_id;
    end if;
  end if;

  select * into v_f from private.lead_firmo(p_workspace_id, p_lead_id);

  -- 2. A territory's rep: the one with the fewest open leads.
  if exists (select 1 from public.territories t where t.workspace_id = p_workspace_id) then
    v_territory := coalesce(v_account.territory_id,
                            private.territory_for(p_workspace_id, v_f.country, v_f.region, v_f.lo, v_f.hi));
    if v_territory is not null then
      select r.user_id into v_user from public.territory_reps r
      where r.territory_id = v_territory and r.workspace_id = p_workspace_id
      order by (select count(*) from public.leads x
                where x.workspace_id = p_workspace_id and x.owner_id = r.user_id
                  and x.status in ('new', 'engaged', 'qualified')), r.created_at, r.user_id
      limit 1;
      if v_user is not null then
        perform private.route_to(p_workspace_id, p_lead_id, v_user,
                                 'in the territory "' || (select t.name from public.territories t where t.id = v_territory) || '"',
                                 v_l.company, jsonb_build_object('territory_id', v_territory));
        return v_user;
      end if;
    end if;
  end if;

  -- 3. The rules.
  if not exists (select 1 from public.routing_rules r where r.workspace_id = p_workspace_id and r.enabled) then
    return null;
  end if;
  for v_rule in
    select r.* from public.routing_rules r
    where r.workspace_id = p_workspace_id and r.enabled
    order by r.position, r.created_at, r.id
  loop
    continue when coalesce(jsonb_array_length(v_rule.match -> 'countries'), 0) > 0 and (
      v_f.country is null or not private.place_matches(v_f.country, v_rule.match -> 'countries'));
    continue when jsonb_typeof(v_rule.match -> 'size_min') = 'number'
      and (v_f.hi is null or v_f.hi < (v_rule.match ->> 'size_min')::numeric);
    continue when jsonb_typeof(v_rule.match -> 'size_max') = 'number'
      and (v_f.lo is null or v_f.lo > (v_rule.match ->> 'size_max')::numeric);
    continue when coalesce(jsonb_array_length(v_rule.match -> 'sources'), 0) > 0 and not exists (
      select 1 from jsonb_array_elements_text(v_rule.match -> 'sources') s(v)
      where lower(btrim(s.v)) = lower(v_l.source));
    continue when coalesce(jsonb_array_length(v_rule.match -> 'plays'), 0) > 0 and (
      p_play is null or not exists (
        select 1 from jsonb_array_elements_text(v_rule.match -> 'plays') x(v) where x.v = p_play));
    continue when coalesce(jsonb_array_length(v_rule.match -> 'tiers'), 0) > 0 and (
      v_l.tier is null or v_l.tier not in (select (t #>> '{}')::int from jsonb_array_elements(v_rule.match -> 'tiers') t));

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
    perform private.route_to(p_workspace_id, p_lead_id, v_user, 'by the rule "' || v_rule.name || '"',
                             v_l.company, jsonb_build_object('rule_id', v_rule.id));
    return v_user;
  end loop;
  return null;
exception when others then
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- The scores' own schedule: in the database, no app call
-- ---------------------------------------------------------------------------
do $do$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    execute 'create extension if not exists pg_cron with schema pg_catalog';
    execute $job$
      select cron.schedule('dialvo-lead-scores', '*/10 * * * *', 'select private.scores_refresh(2000)')
    $job$;
  end if;
end;
$do$;

-- ---------------------------------------------------------------------------
-- The day's contact database credits for lookups outside a list's cells
-- (a buying committee), and adding the people found
-- ---------------------------------------------------------------------------

-- Takes p_credits from today's data credits if they fit under p_day_cap.
-- Server only, for a member.
create function public.data_credits_take(p_workspace_id uuid, p_user_id uuid, p_credits integer, p_day_cap integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day date := (now() at time zone 'utc')::date;
  v_used integer;
begin
  if not private.is_member(p_workspace_id, p_user_id) or coalesce(p_credits, -1) < 0 then
    return false;
  end if;
  insert into public.data_usage (workspace_id, day) values (p_workspace_id, v_day)
  on conflict (workspace_id, day) do nothing;
  select u.credits into v_used from public.data_usage u
  where u.workspace_id = p_workspace_id and u.day = v_day for update;
  if v_used + p_credits > p_day_cap then
    return false;
  end if;
  update public.data_usage u set credits = u.credits + p_credits
  where u.workspace_id = p_workspace_id and u.day = v_day;
  return true;
end;
$$;
revoke all on function public.data_credits_take(uuid, uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.data_credits_take(uuid, uuid, integer, integer) to service_role;

-- Gives back what a lookup reserved and didn't use. Server only.
create function public.data_credits_give_back(p_workspace_id uuid, p_credits integer)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.data_usage u set credits = greatest(u.credits - greatest(p_credits, 0), 0)
  where u.workspace_id = p_workspace_id and u.day = (now() at time zone 'utc')::date;
$$;
revoke all on function public.data_credits_give_back(uuid, integer) from public, anon, authenticated;
grant execute on function public.data_credits_give_back(uuid, integer) to service_role;

-- Adds the people found for an account's buying committee as leads at that
-- account (or links the lead that has their email), and remembers the
-- titles searched. Server only, for a member.
--   p_people: [{ name, title, email, linkedin_url }]
--   { "added": n, "existing": n }
create function public.account_committee_add(
  p_workspace_id uuid, p_user_id uuid, p_account_id uuid, p_titles jsonb, p_people jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a public.accounts%rowtype;
  v_p jsonb;
  v_email text;
  v_name text;
  v_lead uuid;
  v_added integer := 0;
  v_existing integer := 0;
  v_link text;
begin
  if not private.is_member(p_workspace_id, p_user_id) then
    return null;
  end if;
  select a.* into v_a from public.accounts a where a.id = p_account_id and a.workspace_id = p_workspace_id for update;
  if not found then
    return null;
  end if;
  if jsonb_typeof(p_titles) = 'array' and jsonb_array_length(p_titles) <= 10 then
    update public.accounts a set committee_titles = p_titles where a.id = p_account_id;
  end if;
  for v_p in select * from jsonb_array_elements(coalesce(p_people, '[]'::jsonb)) limit 20 loop
    continue when jsonb_typeof(v_p) <> 'object';
    v_name := left(btrim(coalesce(v_p ->> 'name', '')), 200);
    continue when v_name = '';
    v_email := lower(btrim(coalesce(v_p ->> 'email', '')));
    if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' or char_length(v_email) > 254 then
      v_email := null;
    end if;
    v_link := nullif(btrim(coalesce(v_p ->> 'linkedin_url', '')), '');
    if v_link is not null and (v_link !~ '^https://([a-z]+\.)?linkedin\.com/' or char_length(v_link) > 300) then
      v_link := null;
    end if;
    v_lead := null;
    if v_email is not null then
      select l.id into v_lead from public.leads l where l.workspace_id = p_workspace_id and l.email = v_email;
    end if;
    if v_lead is null then
      select l.id into v_lead from public.leads l
      where l.workspace_id = p_workspace_id and l.account_id = p_account_id and lower(l.name) = lower(v_name);
    end if;
    if v_lead is not null then
      update public.leads l set account_id = coalesce(l.account_id, p_account_id) where l.id = v_lead;
      v_existing := v_existing + 1;
      continue;
    end if;
    insert into public.leads (workspace_id, name, email, company, website, source, account_id, owner_id, custom_fields)
    values (p_workspace_id, v_name, v_email, nullif(v_a.name, ''), 'https://' || v_a.domain, 'buying committee',
            p_account_id, v_a.owner_id,
            jsonb_strip_nulls(jsonb_build_object('title', nullif(left(btrim(coalesce(v_p ->> 'title', '')), 200), ''),
                                                 'linkedin_url', v_link)))
    returning id into v_lead;
    insert into public.activity_events (workspace_id, lead_id, actor_id, kind, summary, metadata)
    values (p_workspace_id, v_lead, p_user_id, 'lead_created',
            'Found for the buying committee of ' || coalesce(nullif(v_a.name, ''), v_a.domain) || '.',
            jsonb_build_object('account_id', p_account_id));
    v_added := v_added + 1;
  end loop;
  return jsonb_build_object('added', v_added, 'existing', v_existing);
end;
$$;
revoke all on function public.account_committee_add(uuid, uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.account_committee_add(uuid, uuid, uuid, jsonb, jsonb) to service_role;

-- Adds one account by domain, for a member (from the account page or a
-- lead). Returns its id.
create function public.account_add(p_workspace_id uuid, p_domain text, p_name text, p_max integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.require_member(p_workspace_id);
  v_domain text := private.site_domain(left(p_domain, 300));
  v_id uuid;
begin
  if v_domain is null or private.is_free_mail(v_domain) then
    raise exception 'give a company website' using errcode = '22023';
  end if;
  select a.id into v_id from public.accounts a where a.workspace_id = p_workspace_id and a.domain = v_domain;
  if v_id is not null then
    return v_id;
  end if;
  perform 1 from public.workspaces w where w.id = p_workspace_id for update;
  if (select count(*) from public.accounts a where a.workspace_id = p_workspace_id) >= p_max then
    raise exception 'too many accounts' using errcode = 'P0001';
  end if;
  insert into public.accounts (workspace_id, domain, name, created_by)
  values (p_workspace_id, v_domain, left(btrim(coalesce(p_name, '')), 200), v_user)
  returning id into v_id;
  update public.leads l set account_id = v_id
  where l.workspace_id = p_workspace_id and l.account_id is null
    and private.lead_domain(l.website, l.email) = v_domain;
  perform private.score_account(p_workspace_id, v_id);
  return v_id;
end;
$$;
revoke all on function public.account_add(uuid, text, text, integer) from public, anon;
grant execute on function public.account_add(uuid, text, text, integer) to authenticated;
