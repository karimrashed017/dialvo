-- Website visitors, and the "Retargeting website visitors" play.
--
-- The website chat's script (public/widget.js) can also count page views on
-- the customer's site, once the customer switches it on (off by default).
-- It never runs when the browser sends Do Not Track or Global Privacy
-- Control, and by default it waits until the site says the visitor agreed
-- (consent_mode 'wait'). What it sends: the page's path (never its query
-- string), its title, the referring site's host name, a random id kept in
-- the browser, and a session id. The visitor's IP address is never stored:
-- only a SHA-256 of it with the workspace's id, to remember a company
-- lookup.
--
-- A visitor becomes a known lead when they chat (the chat's own key proves
-- it), submit a form with an email on the site, or arrive through a tagged
-- link in an email from Dialvo (opt-in, see tag_email_links). A visitor's
-- company comes from an IP-to-company lookup done by the server with a
-- data provider's key (src/lib/visitors/identify.ts); without one, only
-- known leads are shown.
--
-- The play: identified companies go into a target-accounts campaign whose
-- runs find a named contact and draft a first email (the existing engine,
-- marked as this play); known leads who read the pricing page get a short
-- check-in through a 'retargeting' lead play. Every email waits for a
-- person's approval, and none of them may say the person visited.
--
-- Additive. New tables:
--   site_tracking      one per workspace: on/off, consent mode, pricing pages
--   site_companies     companies identified from visits
--   site_visitors      one per browser id
--   site_page_views    the page views (kept 180 days)
--   site_ip_lookups    what a lookup said about an address hash (server only)
--   site_link_tokens   the token a tagged email link carries (server only)
-- New columns: outbound_usage.site_views, outbound_usage.ip_lookups.
-- Widened checks: outbound_campaigns.kind + 'retargeting';
-- outbound_drafts.play + 'retargeting', 'intent'.

-- ---------------------------------------------------------------------------
-- Widened checks, read from the live definitions so that values another
-- migration added are kept.
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
      ('public.outbound_campaigns', 'outbound_campaigns_kind_check', 'kind', array['retargeting'], false),
      ('public.outbound_drafts', 'outbound_drafts_play_check', 'play', array['retargeting', 'intent'], true)
    ) as t(tbl, con, col, extra, nullable)
  loop
    select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
    where c.conrelid = r.tbl::regclass and c.conname = r.con;
    select coalesce(array_agg(m[1]), '{}') into v_values
    from regexp_matches(coalesce(v_def, ''), '''([a-z_]+)''', 'g') as m;
    select array_agg(distinct x order by x) into v_new from unnest(v_values || r.extra) x;
    execute format('alter table %s drop constraint if exists %I', r.tbl, r.con);
    execute format('alter table %s add constraint %I check (%s%I = any (%L::text[]))',
                   r.tbl, r.con, case when r.nullable then format('%I is null or ', r.col) else '' end,
                   r.col, v_new);
  end loop;
end;
$do$;

alter table public.outbound_usage
  add column site_views integer not null default 0,
  add column ip_lookups integer not null default 0;

-- ---------------------------------------------------------------------------
-- site_tracking
-- ---------------------------------------------------------------------------
create table public.site_tracking (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  enabled boolean not null default false,
  -- wait: nothing is sent until the site calls dialvo('consent', true) (or
  -- the script tag says data-consent="granted"). notice: the site has a
  -- cookie notice and counts page views without asking first.
  consent_mode text not null default 'wait' check (consent_mode in ('wait', 'notice')),
  pricing_paths text[] not null default array['/pricing']
    check (cardinality(pricing_paths) between 1 and 10),
  -- Add a token to links to the workspace's own website in first emails, so
  -- a click makes the visit a known lead. Off by default; the person
  -- approving the email sees the link as it will be sent.
  tag_email_links boolean not null default false,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.site_tracking enable row level security;
create index site_tracking_updated_by_idx on public.site_tracking (updated_by);

create trigger site_tracking_set_updated_at
  before update on public.site_tracking
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- site_companies
-- ---------------------------------------------------------------------------
create table public.site_companies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  domain text not null check (domain = lower(domain) and char_length(domain) between 3 and 253),
  name text not null default '' check (char_length(name) <= 200),
  country text not null default '' check (char_length(country) <= 60),
  -- Which provider said so ('ipapi'), for the page to say where it came from.
  source text not null default '' check (char_length(source) <= 40),
  visitors integer not null default 0,
  page_views integer not null default 0,
  pricing_views integer not null default 0,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  -- new. retargeted: in a campaign (campaign_id). dismissed.
  status text not null default 'new' check (status in ('new', 'retargeted', 'dismissed')),
  campaign_id uuid,
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (workspace_id, domain),
  foreign key (campaign_id, workspace_id)
    references public.outbound_campaigns (id, workspace_id) on delete set null (campaign_id)
);
alter table public.site_companies enable row level security;
create index site_companies_list_idx on public.site_companies (workspace_id, status, last_seen_at desc);
create index site_companies_campaign_idx on public.site_companies (campaign_id, workspace_id) where campaign_id is not null;
create index site_companies_decided_by_idx on public.site_companies (decided_by) where decided_by is not null;

create trigger site_companies_set_updated_at
  before update on public.site_companies
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- site_visitors
-- ---------------------------------------------------------------------------
create table public.site_visitors (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  -- SHA-256 (hex) of the random id the browser keeps.
  visitor_hash text not null check (visitor_hash ~ '^[0-9a-f]{64}$'),
  lead_id uuid,
  company_id uuid,
  -- How it became a known lead: 'chat', 'form' or 'email_link'.
  identified_by text check (identified_by is null or identified_by in ('chat', 'form', 'email_link')),
  -- An email typed into a form here before the lead existed; matched when
  -- the lead is saved, and forgotten after 30 days.
  pending_email text check (pending_email is null or (pending_email = lower(pending_email) and char_length(pending_email) between 3 and 254)),
  pending_email_at timestamptz,
  page_views integer not null default 0,
  pricing_views integer not null default 0,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (workspace_id, visitor_hash),
  foreign key (lead_id, workspace_id)
    references public.leads (id, workspace_id) on delete set null (lead_id),
  foreign key (company_id, workspace_id)
    references public.site_companies (id, workspace_id) on delete set null (company_id)
);
alter table public.site_visitors enable row level security;
create index site_visitors_lead_idx on public.site_visitors (lead_id, workspace_id) where lead_id is not null;
create index site_visitors_company_idx on public.site_visitors (company_id, workspace_id) where company_id is not null;
create index site_visitors_pending_idx on public.site_visitors (workspace_id, pending_email) where pending_email is not null;
create index site_visitors_recent_idx on public.site_visitors (workspace_id, last_seen_at desc);

-- ---------------------------------------------------------------------------
-- site_page_views
-- ---------------------------------------------------------------------------
create table public.site_page_views (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  visitor_id uuid not null,
  session_id text not null check (session_id ~ '^[A-Za-z0-9_-]{8,40}$'),
  path text not null check (path ~ '^/' and char_length(path) <= 500),
  title text not null default '' check (char_length(title) <= 200),
  referrer_host text check (referrer_host is null or char_length(referrer_host) <= 253),
  is_pricing boolean not null default false,
  viewed_at timestamptz not null default now(),
  foreign key (visitor_id, workspace_id)
    references public.site_visitors (id, workspace_id) on delete cascade
);
alter table public.site_page_views enable row level security;
create index site_page_views_visitor_idx on public.site_page_views (visitor_id, workspace_id, viewed_at desc);
create index site_page_views_recent_idx on public.site_page_views (workspace_id, viewed_at desc);

-- ---------------------------------------------------------------------------
-- site_ip_lookups and site_link_tokens: server only
-- ---------------------------------------------------------------------------
create table public.site_ip_lookups (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  ip_hash text not null check (ip_hash ~ '^[0-9a-f]{64}$'),
  -- { "domain", "name", "country", "source" }, or null: not a company.
  company jsonb check (company is null or jsonb_typeof(company) = 'object'),
  looked_up_at timestamptz not null default now(),
  primary key (workspace_id, ip_hash)
);
alter table public.site_ip_lookups enable row level security;

create table public.site_link_tokens (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email text not null check (email = lower(email) and char_length(email) between 3 and 254),
  token text not null unique check (token ~ '^[A-Za-z0-9]{16}$'),
  created_at timestamptz not null default now(),
  primary key (workspace_id, email)
);
alter table public.site_link_tokens enable row level security;

-- ---------------------------------------------------------------------------
-- Grants and policies
-- ---------------------------------------------------------------------------
revoke all on public.site_tracking, public.site_companies, public.site_visitors,
  public.site_page_views, public.site_ip_lookups, public.site_link_tokens from anon, authenticated;
grant all on public.site_tracking, public.site_companies, public.site_visitors,
  public.site_page_views, public.site_ip_lookups, public.site_link_tokens to service_role;
grant select on public.site_tracking, public.site_companies, public.site_visitors, public.site_page_views
  to authenticated;

create policy "Members read the tracking settings" on public.site_tracking for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));
create policy "Members read visiting companies" on public.site_companies for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));
create policy "Members read visitors" on public.site_visitors for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));
create policy "Members read page views" on public.site_page_views for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));
-- site_ip_lookups, site_link_tokens: no policies. Only the server reads them.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create function private.site_is_pricing(p_paths text[], p_path text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select exists (
    select 1 from unnest(p_paths) p
    where lower(p_path) = lower(p) or lower(p_path) like rtrim(lower(p), '/') || '/%'
  );
$$;
revoke all on function private.site_is_pricing(text[], text) from public;

-- Puts a visitor in a company and adds what they have read so far to it.
create function private.site_visitor_join_company(p_workspace_id uuid, p_visitor_id uuid, p_company jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_domain text := private.site_domain(p_company ->> 'domain');
  v_company uuid;
  v_visitor public.site_visitors%rowtype;
begin
  if v_domain is null then
    return null;
  end if;
  select v.* into v_visitor from public.site_visitors v
  where v.id = p_visitor_id and v.workspace_id = p_workspace_id for update;
  if not found or v_visitor.company_id is not null then
    return v_visitor.company_id;
  end if;
  insert into public.site_companies as c (workspace_id, domain, name, country, source, visitors, page_views, pricing_views, last_seen_at)
  values (p_workspace_id, v_domain, left(coalesce(p_company ->> 'name', ''), 200),
          left(coalesce(p_company ->> 'country', ''), 60), left(coalesce(p_company ->> 'source', ''), 40),
          1, v_visitor.page_views, v_visitor.pricing_views, now())
  on conflict (workspace_id, domain) do update
  set visitors = c.visitors + 1, page_views = c.page_views + excluded.page_views,
      pricing_views = c.pricing_views + excluded.pricing_views, last_seen_at = now(),
      name = case when c.name = '' then excluded.name else c.name end
  returning c.id into v_company;
  update public.site_visitors v set company_id = v_company where v.id = p_visitor_id;
  return v_company;
end;
$$;
revoke all on function private.site_visitor_join_company(uuid, uuid, jsonb) from public;

-- ---------------------------------------------------------------------------
-- The tracker's calls (secret key only; the public endpoint makes them)
-- ---------------------------------------------------------------------------

-- What the script needs before it sends anything: is tracking on for the
-- workspace behind this widget, and must it wait for consent?
create function public.site_tracker_config(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select jsonb_build_object('on', t.enabled, 'consent', t.consent_mode)
    from public.chat_widgets w
    join public.site_tracking t on t.workspace_id = w.workspace_id
    where w.token = p_token
  ), jsonb_build_object('on', false));
$$;

-- One page view.
--   { "status": "recorded", "visitor_id", "lookup": bool }
--   { "status": "off" | "capped" | "invalid" }
-- p_conversation_id + p_chat_key: the visitor's website chat, if they have
-- one, proved by its key; p_link_token: from a tagged email link.
create function public.site_track(
  p_token text, p_visitor_hash text, p_session text, p_path text, p_title text,
  p_referrer_host text, p_ip_hash text, p_conversation_id uuid, p_chat_key text,
  p_link_token text, p_max_per_day integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid;
  v_settings public.site_tracking%rowtype;
  v_visitor public.site_visitors%rowtype;
  v_pricing boolean;
  v_lead uuid;
  v_how text;
  v_used integer;
  v_cached public.site_ip_lookups%rowtype;
  v_lookup boolean := false;
begin
  select w.workspace_id into v_ws from public.chat_widgets w where w.token = p_token;
  if v_ws is null then
    return jsonb_build_object('status', 'off');
  end if;
  select t.* into v_settings from public.site_tracking t where t.workspace_id = v_ws;
  if not found or not v_settings.enabled then
    return jsonb_build_object('status', 'off');
  end if;
  if coalesce(p_visitor_hash, '') !~ '^[0-9a-f]{64}$'
     or coalesce(p_session, '') !~ '^[A-Za-z0-9_-]{8,40}$'
     or coalesce(p_path, '') !~ '^/' or char_length(p_path) > 500
     or (p_ip_hash is not null and p_ip_hash !~ '^[0-9a-f]{64}$') then
    return jsonb_build_object('status', 'invalid');
  end if;

  insert into public.outbound_usage as u (workspace_id, day, site_views)
  values (v_ws, (now() at time zone 'utc')::date, 1)
  on conflict (workspace_id, day) do update set site_views = u.site_views + 1
  where u.site_views < p_max_per_day
  returning u.site_views into v_used;
  if v_used is null then
    return jsonb_build_object('status', 'capped');
  end if;

  v_pricing := private.site_is_pricing(v_settings.pricing_paths, p_path);
  insert into public.site_visitors as v (workspace_id, visitor_hash, page_views, pricing_views)
  values (v_ws, p_visitor_hash, 1, case when v_pricing then 1 else 0 end)
  on conflict (workspace_id, visitor_hash) do update
  set page_views = v.page_views + 1,
      pricing_views = v.pricing_views + case when v_pricing then 1 else 0 end,
      last_seen_at = now()
  returning v.* into v_visitor;

  insert into public.site_page_views (workspace_id, visitor_id, session_id, path, title, referrer_host, is_pricing)
  values (v_ws, v_visitor.id, p_session, p_path,
          left(regexp_replace(coalesce(p_title, ''), '[\u0000-\u001f\u007f]', ' ', 'g'), 200),
          nullif(left(lower(coalesce(p_referrer_host, '')), 253), ''), v_pricing);

  if v_visitor.company_id is not null then
    update public.site_companies c
    set page_views = c.page_views + 1,
        pricing_views = c.pricing_views + case when v_pricing then 1 else 0 end,
        last_seen_at = now()
    where c.id = v_visitor.company_id;
  end if;

  -- Becoming a known lead.
  if v_visitor.lead_id is null then
    if p_conversation_id is not null and coalesce(p_chat_key, '') <> '' then
      select c.lead_id into v_lead from public.conversations c
      join public.chat_widgets w on w.id = c.widget_id and w.workspace_id = c.workspace_id
      where c.id = p_conversation_id and c.workspace_id = v_ws
        and c.visitor_key_hash = private.chat_key_hash(p_chat_key);
      v_how := 'chat';
    end if;
    if v_lead is null and coalesce(p_link_token, '') ~ '^[A-Za-z0-9]{16}$' then
      select l.id into v_lead from public.site_link_tokens k
      join public.leads l on l.workspace_id = k.workspace_id and l.email = k.email
      where k.token = p_link_token and k.workspace_id = v_ws;
      v_how := 'email_link';
    end if;
    if v_lead is not null then
      update public.site_visitors v set lead_id = v_lead, identified_by = v_how,
        pending_email = null, pending_email_at = null
      where v.id = v_visitor.id;
    end if;
  end if;

  -- The company: from an earlier lookup of this address if there is one,
  -- otherwise the server may look it up (and tells site_lookup_save).
  if v_visitor.company_id is null and p_ip_hash is not null then
    select l.* into v_cached from public.site_ip_lookups l
    where l.workspace_id = v_ws and l.ip_hash = p_ip_hash and l.looked_up_at > now() - interval '30 days';
    if found then
      if v_cached.company is not null then
        perform private.site_visitor_join_company(v_ws, v_visitor.id, v_cached.company);
      end if;
    else
      v_lookup := true;
    end if;
  end if;
  return jsonb_build_object('status', 'recorded', 'visitor_id', v_visitor.id, 'workspace_id', v_ws,
                            'lookup', v_lookup);
end;
$$;

-- An email the visitor typed into a form on the site. Links them to that
-- lead now, or as soon as a lead with that email is saved (within 30 days).
--   { "status": "linked" | "pending" | "off" | "invalid" }
create function public.site_identify(p_token text, p_visitor_hash text, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_lead uuid;
begin
  select w.workspace_id into v_ws from public.chat_widgets w
  join public.site_tracking t on t.workspace_id = w.workspace_id and t.enabled
  where w.token = p_token;
  if v_ws is null then
    return jsonb_build_object('status', 'off');
  end if;
  if coalesce(p_visitor_hash, '') !~ '^[0-9a-f]{64}$' or char_length(v_email) > 254
     or v_email !~ '^[^\s@]+@[a-z0-9-]+(\.[a-z0-9-]+)+$' then
    return jsonb_build_object('status', 'invalid');
  end if;
  select l.id into v_lead from public.leads l where l.workspace_id = v_ws and l.email = v_email;
  update public.site_visitors v
  set lead_id = coalesce(v.lead_id, v_lead),
      identified_by = case when v.lead_id is null and v_lead is not null then 'form' else v.identified_by end,
      pending_email = case when v.lead_id is null and v_lead is null then v_email end,
      pending_email_at = case when v.lead_id is null and v_lead is null then now() end
  where v.workspace_id = v_ws and v.visitor_hash = p_visitor_hash;
  if not found then
    return jsonb_build_object('status', 'invalid');
  end if;
  return jsonb_build_object('status', case when v_lead is null then 'pending' else 'linked' end);
end;
$$;

-- A lead saved with an email a visitor typed earlier: they are that lead.
create function private.site_visitors_on_lead()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is not null then
    update public.site_visitors v
    set lead_id = new.id, identified_by = 'form', pending_email = null, pending_email_at = null
    where v.workspace_id = new.workspace_id and v.pending_email = new.email and v.lead_id is null;
  end if;
  return new;
exception when others then
  return new;
end;
$$;
revoke all on function private.site_visitors_on_lead() from public;

create trigger leads_site_visitors
  after insert or update of email on public.leads
  for each row execute function private.site_visitors_on_lead();

-- Takes one company lookup of today's allowance. True when taken.
create function public.site_lookup_reserve(p_workspace_id uuid, p_max_per_day integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_used integer;
begin
  insert into public.outbound_usage as u (workspace_id, day, ip_lookups)
  values (p_workspace_id, (now() at time zone 'utc')::date, 1)
  on conflict (workspace_id, day) do update set ip_lookups = u.ip_lookups + 1
  where u.ip_lookups < p_max_per_day
  returning u.ip_lookups into v_used;
  return v_used is not null and p_max_per_day > 0;
end;
$$;

-- What a lookup said. p_company null: not a company (an internet provider,
-- a phone network, a data centre) or the workspace's own. Remembered for
-- 30 days either way, so an address is looked up at most once a month.
create function public.site_lookup_save(p_workspace_id uuid, p_visitor_id uuid, p_ip_hash text, p_company jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company jsonb := p_company;
  v_own text;
begin
  if coalesce(p_ip_hash, '') !~ '^[0-9a-f]{64}$' then
    return null;
  end if;
  select private.site_domain(w.website) into v_own from public.workspaces w where w.id = p_workspace_id;
  if v_company is not null and (
       private.site_domain(v_company ->> 'domain') is null
       or private.site_domain(v_company ->> 'domain') = v_own) then
    v_company := null;
  end if;
  insert into public.site_ip_lookups as l (workspace_id, ip_hash, company, looked_up_at)
  values (p_workspace_id, p_ip_hash, v_company, now())
  on conflict (workspace_id, ip_hash) do update set company = excluded.company, looked_up_at = now();
  if v_company is null then
    return null;
  end if;
  return private.site_visitor_join_company(p_workspace_id, p_visitor_id, v_company);
end;
$$;

-- The token for one email address's tagged links (made once, kept).
create function private.site_link_token(p_workspace_id uuid, p_email text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_token text;
begin
  select k.token into v_token from public.site_link_tokens k
  where k.workspace_id = p_workspace_id and k.email = v_email;
  if v_token is null then
    v_token := substr(translate(encode(sha256(convert_to(gen_random_uuid()::text || clock_timestamp()::text, 'UTF8')), 'base64'), '+/=', 'abc'), 1, 16);
    insert into public.site_link_tokens (workspace_id, email, token) values (p_workspace_id, v_email, v_token)
    on conflict (workspace_id, email) do nothing;
    select k.token into v_token from public.site_link_tokens k
    where k.workspace_id = p_workspace_id and k.email = v_email;
  end if;
  return v_token;
end;
$$;
revoke all on function private.site_link_token(uuid, text) from public;

-- With tag_email_links on, a first email's links to the workspace's own
-- website get "dvl=<token>" when its draft is written, before anyone sees
-- it: the person approving reads the link exactly as it will be sent.
create function private.site_tag_draft_links()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_domain text;
  v_token text;
  v_body text;
  m text[];
  v_link text;
  v_tagged text;
begin
  if new.status <> 'draft' or old.status = 'draft' or new.body = '' then
    return new;
  end if;
  if not exists (select 1 from public.site_tracking t
                 where t.workspace_id = new.workspace_id and t.enabled and t.tag_email_links) then
    return new;
  end if;
  select private.site_domain(w.website) into v_domain from public.workspaces w where w.id = new.workspace_id;
  if v_domain is null or position(v_domain in lower(new.body)) = 0 then
    return new;
  end if;
  v_token := private.site_link_token(new.workspace_id, new.to_email);
  v_body := new.body;
  for m in
    select distinct x from regexp_matches(new.body, '(https?://(?:www\.)?' || replace(v_domain, '.', '\.') || '(?:[/?#][^\s<>"'')]*)?)', 'gi') as x
  loop
    v_link := rtrim(m[1], '.,;:!?');
    continue when v_link ~* '[?&]dvl=';
    v_tagged := case
      when position('#' in v_link) > 0 then
        split_part(v_link, '#', 1) || case when position('?' in v_link) > 0 then '&' else '?' end
          || 'dvl=' || v_token || '#' || split_part(v_link, '#', 2)
      else v_link || case when position('?' in v_link) > 0 then '&' else '?' end || 'dvl=' || v_token end;
    v_body := replace(v_body, v_link, v_tagged);
  end loop;
  if char_length(v_body) <= 5000 then
    new.body := v_body;
  end if;
  return new;
exception when others then
  return new;
end;
$$;
revoke all on function private.site_tag_draft_links() from public;

create trigger outbound_drafts_site_links
  before update of status on public.outbound_drafts
  for each row execute function private.site_tag_draft_links();

-- A first email to a company found by this play is this play's.
create function private.site_draft_play()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source text;
begin
  if new.prospect_id is not null then
    select c.settings ->> 'source' into v_source
    from public.prospects p
    join public.outbound_campaigns c on c.id = p.campaign_id and c.workspace_id = p.workspace_id
    where p.id = new.prospect_id and p.workspace_id = new.workspace_id;
    if v_source in ('retargeting', 'intent') then
      new.play := v_source;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.site_draft_play() from public;

-- Named to run after outbound_drafts_play (triggers run in name order).
create trigger outbound_drafts_site_play
  before insert on public.outbound_drafts
  for each row execute function private.site_draft_play();

-- ---------------------------------------------------------------------------
-- The team's side
-- ---------------------------------------------------------------------------

-- Owners and admins. Paths: up to 10, each starting with "/".
create function public.site_tracking_save(
  p_workspace_id uuid, p_enabled boolean, p_consent_mode text, p_pricing_paths text[], p_tag_links boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_paths text[];
begin
  if not (select private.is_workspace_admin(p_workspace_id)) then
    return false;
  end if;
  select array_agg(distinct left(lower(btrim(p)), 100)) into v_paths
  from unnest(coalesce(p_pricing_paths, '{}')) p where btrim(p) ~ '^/[^\s?#]*$';
  if p_consent_mode not in ('wait', 'notice') or coalesce(cardinality(v_paths), 0) not between 1 and 10 then
    raise exception 'invalid tracking settings' using errcode = '22023';
  end if;
  insert into public.site_tracking as t (workspace_id, enabled, consent_mode, pricing_paths, tag_email_links, updated_by)
  values (p_workspace_id, coalesce(p_enabled, false), p_consent_mode, v_paths, coalesce(p_tag_links, false), (select auth.uid()))
  on conflict (workspace_id) do update
  set enabled = excluded.enabled, consent_mode = excluded.consent_mode, pricing_paths = excluded.pricing_paths,
      tag_email_links = excluded.tag_email_links, updated_by = excluded.updated_by;
  return true;
end;
$$;

-- Any member: not interested in this company.
create function public.site_company_dismiss(p_company_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.site_companies c set status = 'dismissed', decided_by = (select auth.uid()), decided_at = now()
  where c.id = p_company_id and c.status = 'new'
    and (select private.is_workspace_member(c.workspace_id));
  return found;
end;
$$;

-- Deletes a visitor and everything they read (a person asked to be forgotten).
create function public.site_visitor_forget(p_visitor_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.site_visitors v
  where v.id = p_visitor_id and (select private.is_workspace_admin(v.workspace_id));
  return found;
end;
$$;

-- The play, for identified companies: a target-accounts campaign (the
-- server then starts its run, which finds a contact and drafts an email).
--   campaign_create_company's answer, and the companies are marked.
create function public.site_retarget_companies(
  p_workspace_id uuid, p_user_id uuid, p_company_ids uuid[], p_name text, p_titles jsonb,
  p_source text, p_max integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_targets jsonb;
  v_made jsonb;
begin
  if p_source not in ('retargeting') then
    return jsonb_build_object('status', 'invalid');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('input', c.domain, 'domain', c.domain, 'company_name', c.name)
                            order by c.pricing_views desc, c.page_views desc), '[]'::jsonb)
  into v_targets
  from public.site_companies c
  where c.workspace_id = p_workspace_id and c.id = any (p_company_ids) and c.status = 'new';
  if jsonb_array_length(v_targets) = 0 then
    return jsonb_build_object('status', 'invalid');
  end if;
  v_made := public.campaign_create_company(
    p_workspace_id, p_user_id, 'accounts', p_name,
    jsonb_build_object('titles', coalesce(p_titles, '[]'::jsonb), 'source', p_source),
    v_targets, p_max);
  if v_made ->> 'status' = 'created' then
    update public.site_companies c
    set status = 'retargeted', campaign_id = (v_made ->> 'campaign_id')::uuid,
        decided_by = p_user_id, decided_at = now()
    where c.workspace_id = p_workspace_id and c.id = any (p_company_ids) and c.status = 'new';
  end if;
  return v_made;
end;
$$;

-- The play, for known leads who read the pricing page in the last p_days:
-- a 'retargeting' lead play, one short check-in each, waiting for approval.
-- Not a lead the play wrote to in the last p_repeat_days, not a customer
-- (customers hear from the customer plays, which need their consent), and
-- never one who is do not contact, unsubscribed or on the never-contact list.
--   { "status": "created", "campaign_id", "selected" } | { "status": "empty" | "not_found" }
create function public.site_retarget_leads(
  p_workspace_id uuid, p_user_id uuid, p_lead_ids uuid[], p_days integer, p_repeat_days integer, p_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign uuid;
  v_count integer;
begin
  if not exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace_id and m.user_id = p_user_id
  ) then
    return jsonb_build_object('status', 'not_found');
  end if;
  perform 1 from public.workspaces w where w.id = p_workspace_id for update;
  create temporary table if not exists pg_temp.site_picked (lead_id uuid, fact text) on commit drop;
  delete from pg_temp.site_picked;
  insert into pg_temp.site_picked (lead_id, fact)
  select l.id,
         'Read ' || count(pv.*) || ' page' || case when count(pv.*) = 1 then '' else 's' end
           || ' of the business''s website in the last ' || p_days || ' days'
           || case when bool_or(pv.is_pricing) then ', including the pricing page' else '' end
           || '. Pages: ' || left(string_agg(distinct coalesce(nullif(pv.title, ''), pv.path), '; '), 240) || '.'
  from public.leads l
  join public.site_visitors v on v.lead_id = l.id and v.workspace_id = l.workspace_id
  join public.site_page_views pv on pv.visitor_id = v.id and pv.workspace_id = v.workspace_id
    and pv.viewed_at > now() - make_interval(days => greatest(p_days, 1))
  where l.workspace_id = p_workspace_id
    and (p_lead_ids is null or l.id = any (p_lead_ids))
    and l.email is not null and not l.do_not_contact and l.status not in ('unsubscribed', 'won')
    and not private.outbound_is_suppressed(l.workspace_id, l.email, private.site_domain(l.website))
    and not exists (
      select 1 from public.outbound_campaign_targets t
      join public.outbound_campaigns c on c.id = t.campaign_id and c.workspace_id = t.workspace_id
      where t.lead_id = l.id and t.workspace_id = l.workspace_id and c.kind = 'retargeting'
        and t.created_at > now() - make_interval(days => greatest(p_repeat_days, 0)))
  group by l.id
  having bool_or(pv.is_pricing)
  order by max(pv.viewed_at) desc
  limit greatest(p_limit, 0);
  select count(*) into v_count from pg_temp.site_picked;
  if v_count = 0 then
    return jsonb_build_object('status', 'empty');
  end if;
  insert into public.outbound_campaigns (workspace_id, kind, name, settings, created_by)
  values (p_workspace_id, 'retargeting',
          'Website visitors, ' || to_char(now() at time zone 'utc', 'FMDD Mon'),
          jsonb_build_object('days', p_days), p_user_id)
  returning id into v_campaign;
  insert into public.outbound_campaign_targets (workspace_id, campaign_id, position, lead_id, status, why_now)
  select p_workspace_id, v_campaign, row_number() over (), s.lead_id, 'selected',
         jsonb_build_object('fact', s.fact, 'at', now(), 'source', 'your website')
  from pg_temp.site_picked s;
  return jsonb_build_object('status', 'created', 'campaign_id', v_campaign, 'selected', v_count);
end;
$$;

-- Keeps the tables small: page views 180 days, lookups 30 days, typed
-- emails that never became a lead 30 days. Daily.
create function private.site_cleanup()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.site_page_views pv where pv.viewed_at < now() - interval '180 days';
  delete from public.site_ip_lookups l where l.looked_up_at < now() - interval '30 days';
  update public.site_visitors v set pending_email = null, pending_email_at = null
  where v.pending_email is not null and v.pending_email_at < now() - interval '30 days';
  delete from public.site_visitors v
  where v.last_seen_at < now() - interval '180 days' and v.lead_id is null;
end;
$$;
revoke all on function private.site_cleanup() from public;

revoke all on function public.site_tracker_config(text) from public, anon, authenticated;
revoke all on function public.site_track(text, text, text, text, text, text, text, uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public.site_identify(text, text, text) from public, anon, authenticated;
revoke all on function public.site_lookup_reserve(uuid, integer) from public, anon, authenticated;
revoke all on function public.site_lookup_save(uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.site_retarget_companies(uuid, uuid, uuid[], text, jsonb, text, integer) from public, anon, authenticated;
revoke all on function public.site_retarget_leads(uuid, uuid, uuid[], integer, integer, integer) from public, anon, authenticated;
grant execute on function public.site_tracker_config(text) to service_role;
grant execute on function public.site_track(text, text, text, text, text, text, text, uuid, text, text, integer) to service_role;
grant execute on function public.site_identify(text, text, text) to service_role;
grant execute on function public.site_lookup_reserve(uuid, integer) to service_role;
grant execute on function public.site_lookup_save(uuid, uuid, text, jsonb) to service_role;
grant execute on function public.site_retarget_companies(uuid, uuid, uuid[], text, jsonb, text, integer) to service_role;
grant execute on function public.site_retarget_leads(uuid, uuid, uuid[], integer, integer, integer) to service_role;

revoke all on function public.site_tracking_save(uuid, boolean, text, text[], boolean) from public, anon;
revoke all on function public.site_company_dismiss(uuid) from public, anon;
revoke all on function public.site_visitor_forget(uuid) from public, anon;
grant execute on function public.site_tracking_save(uuid, boolean, text, text[], boolean) to authenticated;
grant execute on function public.site_company_dismiss(uuid) to authenticated;
grant execute on function public.site_visitor_forget(uuid) to authenticated;

do $do$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    execute 'create extension if not exists pg_cron with schema pg_catalog';
    execute $job$
      select cron.schedule('dialvo-site-cleanup', '17 3 * * *', 'select private.site_cleanup()')
    $job$;
  end if;
end;
$do$;
