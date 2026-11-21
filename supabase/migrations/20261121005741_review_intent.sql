-- Review-site intent, on Find leads' Signals tab: companies researching the
-- workspace's category on review sites (a product page, a comparison, the
-- pricing page, alternatives).
--
-- No review site sells this data self-serve, so it comes in three ways, all
-- the customer's own data:
--   csv      the export their review-site subscription gives them, uploaded
--   webhook  pushed by their own tool or automation to
--            POST /api/intent/<token> (the token is shown once; only its
--            hash is kept)
--   g2       pulled once a day from G2's API with the customer's own G2 API
--            token (it needs a G2 plan that includes Buyer Intent). The
--            token is kept in Vault as 'intent_g2:<workspace id>'.
--
-- Keeping a signal puts its company into a target-accounts campaign marked
-- as this play: its run finds a named contact (Findymail) and drafts a first
-- email that waits for approval, exactly like Target accounts. The email
-- never says the company was seen on a review site.
--
-- Additive. Two new tables (intent_sources, intent_signals) and one column
-- (outbound_usage.intent_rows, for the daily import cap).

alter table public.outbound_usage add column intent_rows integer not null default 0;

-- ---------------------------------------------------------------------------
-- intent_sources: the webhook and the G2 connection (CSV needs none)
-- ---------------------------------------------------------------------------
create table public.intent_sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  kind text not null check (kind in ('webhook', 'g2')),
  status text not null default 'active' check (status in ('active', 'error', 'disconnected')),
  status_reason text check (status_reason is null or char_length(status_reason) <= 300),
  -- webhook: SHA-256 (hex) of the token in its URL, and its first characters.
  token_hash text unique check (token_hash is null or token_hash ~ '^[0-9a-f]{64}$'),
  token_prefix text check (token_prefix is null or token_prefix ~ '^[A-Za-z0-9_-]{4,16}$'),
  last_import_at timestamptz,
  last_import_count integer not null default 0,
  last_error text check (last_error is null or char_length(last_error) <= 300),
  -- g2: when it is next pulled, and the lease while it is.
  next_pull_at timestamptz,
  locked_until timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (workspace_id, kind),
  check (kind <> 'webhook' or status = 'disconnected' or token_hash is not null)
);
alter table public.intent_sources enable row level security;
create index intent_sources_created_by_idx on public.intent_sources (created_by);
create index intent_sources_due_idx on public.intent_sources (next_pull_at) where kind = 'g2' and status = 'active';

create trigger intent_sources_set_updated_at
  before update on public.intent_sources
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- intent_signals
-- ---------------------------------------------------------------------------
create table public.intent_signals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  source text not null check (source in ('csv', 'webhook', 'g2')),
  source_id uuid,
  -- The review site: g2, capterra, trustradius, getapp, software_advice, other.
  provider text not null default 'other' check (provider ~ '^[a-z0-9_]{1,40}$'),
  company_name text not null default '' check (char_length(company_name) <= 200),
  company_domain text not null check (company_domain = lower(company_domain) and char_length(company_domain) between 3 and 253),
  company_country text not null default '' check (char_length(company_country) <= 60),
  company_size text not null default '' check (char_length(company_size) <= 40),
  company_industry text not null default '' check (char_length(company_industry) <= 120),
  -- What they looked at: profile, pricing, compare, alternatives, category,
  -- reviews or other.
  signal_type text not null default 'other' check (signal_type in ('profile', 'pricing', 'compare', 'alternatives', 'category', 'reviews', 'other')),
  -- The product, comparison or category it was about.
  topic text not null default '' check (char_length(topic) <= 200),
  activity integer check (activity is null or activity between 0 and 1000000),
  seen_on date not null,
  dedupe_key text not null check (char_length(dedupe_key) between 3 and 700),
  -- new. queued: in a campaign (campaign_id). dismissed. skipped: already
  -- a lead or prospect, or never contact (reason says which).
  status text not null default 'new' check (status in ('new', 'queued', 'dismissed', 'skipped')),
  reason text check (reason is null or char_length(reason) <= 60),
  campaign_id uuid,
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (workspace_id, dedupe_key),
  foreign key (source_id, workspace_id)
    references public.intent_sources (id, workspace_id) on delete set null (source_id),
  foreign key (campaign_id, workspace_id)
    references public.outbound_campaigns (id, workspace_id) on delete set null (campaign_id)
);
alter table public.intent_signals enable row level security;
create index intent_signals_list_idx on public.intent_signals (workspace_id, status, seen_on desc);
create index intent_signals_source_idx on public.intent_signals (source_id, workspace_id) where source_id is not null;
create index intent_signals_campaign_idx on public.intent_signals (campaign_id, workspace_id) where campaign_id is not null;
create index intent_signals_decided_by_idx on public.intent_signals (decided_by) where decided_by is not null;
create index intent_signals_domain_idx on public.intent_signals (workspace_id, company_domain);

create trigger intent_signals_set_updated_at
  before update on public.intent_signals
  for each row execute function private.set_updated_at();

revoke all on public.intent_sources, public.intent_signals from anon, authenticated;
grant all on public.intent_sources, public.intent_signals to service_role;
-- Everything but the webhook token's hash.
grant select (id, workspace_id, kind, status, status_reason, token_prefix, last_import_at, last_import_count,
              last_error, next_pull_at, locked_until, created_by, created_at, updated_at)
  on public.intent_sources to authenticated;
grant select on public.intent_signals to authenticated;

create policy "Members read intent sources" on public.intent_sources for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));
create policy "Members read intent signals" on public.intent_signals for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));

-- ---------------------------------------------------------------------------
-- Importing (secret key only)
-- ---------------------------------------------------------------------------

-- Stores rows of intent, deduplicated. Each row:
--   { "provider", "company_name", "company_domain", "company_country",
--     "company_size", "company_industry", "signal_type", "topic",
--     "activity", "seen_on" }
-- A row without a usable website domain is invalid. A company the
-- workspace already has, or never wants, is stored as skipped. At most
-- p_max_per_call rows a call and p_max_per_day a day.
--   { "status": "ok", "added", "duplicates", "skipped", "invalid" }
--   { "status": "capped" | "too_many" | "not_found" }
create function public.intent_ingest(
  p_workspace_id uuid, p_source text, p_source_id uuid, p_rows jsonb,
  p_max_per_call integer, p_max_per_day integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r jsonb;
  v_domain text;
  v_type text;
  v_provider text;
  v_seen date;
  v_key text;
  v_known text;
  v_added integer := 0;
  v_dupes integer := 0;
  v_skipped integer := 0;
  v_invalid integer := 0;
  v_n integer := jsonb_array_length(coalesce(p_rows, '[]'::jsonb));
  v_used integer;
begin
  if not exists (select 1 from public.workspaces w where w.id = p_workspace_id)
     or p_source not in ('csv', 'webhook', 'g2') then
    return jsonb_build_object('status', 'not_found');
  end if;
  if jsonb_typeof(coalesce(p_rows, 'null'::jsonb)) <> 'array' or v_n > p_max_per_call then
    return jsonb_build_object('status', 'too_many');
  end if;
  insert into public.outbound_usage as u (workspace_id, day, intent_rows)
  values (p_workspace_id, (now() at time zone 'utc')::date, v_n)
  on conflict (workspace_id, day) do update set intent_rows = u.intent_rows + v_n
  where u.intent_rows + v_n <= p_max_per_day
  returning u.intent_rows into v_used;
  if v_used is null or v_used > p_max_per_day then
    return jsonb_build_object('status', 'capped');
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(r) <> 'object' then
      v_invalid := v_invalid + 1;
      continue;
    end if;
    v_domain := private.site_domain(r ->> 'company_domain');
    if v_domain is null or char_length(v_domain) > 253 then
      v_invalid := v_invalid + 1;
      continue;
    end if;
    v_provider := coalesce(nullif(regexp_replace(lower(coalesce(r ->> 'provider', '')), '[^a-z0-9]+', '_', 'g'), ''), 'other');
    v_provider := left(trim(both '_' from v_provider), 40);
    if v_provider = '' then v_provider := 'other'; end if;
    v_type := lower(btrim(coalesce(r ->> 'signal_type', '')));
    v_type := case
      when v_type in ('profile', 'pricing', 'compare', 'alternatives', 'category', 'reviews') then v_type
      when v_type like '%pricing%' then 'pricing'
      when v_type like '%compar%' then 'compare'
      when v_type like '%alternative%' or v_type like '%competitor%' then 'alternatives'
      when v_type like '%categor%' then 'category'
      when v_type like '%review%' then 'reviews'
      when v_type like '%profile%' or v_type like '%product%' then 'profile'
      else 'other' end;
    begin
      v_seen := coalesce(nullif(btrim(r ->> 'seen_on'), '')::date, (now() at time zone 'utc')::date);
    exception when others then
      v_seen := (now() at time zone 'utc')::date;
    end;
    v_seen := least(v_seen, (now() at time zone 'utc')::date);
    v_key := v_provider || '|' || v_domain || '|' || v_type || '|' || lower(left(btrim(coalesce(r ->> 'topic', '')), 200)) || '|' || v_seen;
    v_known := private.campaign_company_known(p_workspace_id, v_domain, null);
    insert into public.intent_signals (
      workspace_id, source, source_id, provider, company_name, company_domain, company_country,
      company_size, company_industry, signal_type, topic, activity, seen_on, dedupe_key, status, reason
    ) values (
      p_workspace_id, p_source, p_source_id, v_provider,
      left(regexp_replace(btrim(coalesce(r ->> 'company_name', '')), '[\u0000-\u001f\u007f<>]', ' ', 'g'), 200),
      v_domain,
      left(btrim(coalesce(r ->> 'company_country', '')), 60),
      left(btrim(coalesce(r ->> 'company_size', '')), 40),
      left(regexp_replace(btrim(coalesce(r ->> 'company_industry', '')), '[\u0000-\u001f\u007f<>]', ' ', 'g'), 120),
      v_type,
      left(regexp_replace(btrim(coalesce(r ->> 'topic', '')), '[\u0000-\u001f\u007f<>]', ' ', 'g'), 200),
      case when coalesce(r ->> 'activity', '') ~ '^\d{1,7}$' then least((r ->> 'activity')::integer, 1000000) end,
      v_seen, left(v_key, 700),
      case when v_known is null then 'new' else 'skipped' end, v_known
    )
    on conflict (workspace_id, dedupe_key) do nothing;
    if found then
      if v_known is null then v_added := v_added + 1; else v_skipped := v_skipped + 1; end if;
    else
      v_dupes := v_dupes + 1;
    end if;
  end loop;

  if p_source_id is not null then
    update public.intent_sources s
    set last_import_at = now(), last_import_count = v_added, last_error = null
    where s.id = p_source_id and s.workspace_id = p_workspace_id;
  end if;
  return jsonb_build_object('status', 'ok', 'added', v_added, 'duplicates', v_dupes,
                            'skipped', v_skipped, 'invalid', v_invalid);
end;
$$;

-- The webhook: made (or made again, which retires the old URL) by an owner
-- or admin through the server. The token is made in the app and shown once.
create function public.intent_webhook_set(p_workspace_id uuid, p_user_id uuid, p_token_hash text, p_prefix text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace_id and m.user_id = p_user_id and m.role in ('owner', 'admin')
  ) or coalesce(p_token_hash, '') !~ '^[0-9a-f]{64}$' then
    return false;
  end if;
  insert into public.intent_sources as s (workspace_id, kind, status, token_hash, token_prefix, created_by)
  values (p_workspace_id, 'webhook', 'active', p_token_hash, p_prefix, p_user_id)
  on conflict (workspace_id, kind) do update
  set status = 'active', status_reason = null, token_hash = excluded.token_hash,
      token_prefix = excluded.token_prefix, created_by = excluded.created_by;
  return true;
end;
$$;

-- Which workspace a webhook token belongs to. Null when none, or switched off.
create function public.intent_webhook_source(p_token_hash text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('workspace_id', s.workspace_id, 'source_id', s.id)
  from public.intent_sources s
  where s.kind = 'webhook' and s.status = 'active' and s.token_hash = lower(coalesce(p_token_hash, ''));
$$;

-- G2: connecting with the customer's own API token (after the server has
-- checked it with G2), and the daily pull.
create function public.intent_g2_connect(p_workspace_id uuid, p_user_id uuid, p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret uuid;
  v_name text := 'intent_g2:' || p_workspace_id;
begin
  if not exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace_id and m.user_id = p_user_id and m.role in ('owner', 'admin')
  ) then
    return jsonb_build_object('status', 'not_found');
  end if;
  if char_length(coalesce(p_token, '')) not between 10 and 500 then
    return jsonb_build_object('status', 'invalid');
  end if;
  select s.id into v_secret from vault.secrets s where s.name = v_name;
  if v_secret is null then
    perform vault.create_secret(p_token, v_name, 'The G2 API token of one Dialvo workspace.');
  else
    perform vault.update_secret(v_secret, p_token);
  end if;
  insert into public.intent_sources as s (workspace_id, kind, status, next_pull_at, created_by)
  values (p_workspace_id, 'g2', 'active', now(), p_user_id)
  on conflict (workspace_id, kind) do update
  set status = 'active', status_reason = null, next_pull_at = now(), locked_until = null,
      last_error = null, created_by = excluded.created_by;
  return jsonb_build_object('status', 'connected');
end;
$$;

-- Claims one G2 connection that is due, with its token, under a lease.
create function public.intent_pull_claim(p_lease_seconds integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.intent_sources%rowtype;
  v_token text;
begin
  select s.* into v_source from public.intent_sources s
  where s.kind = 'g2' and s.status = 'active' and s.next_pull_at <= now()
    and (s.locked_until is null or s.locked_until < now())
  order by s.next_pull_at
  limit 1
  for update skip locked;
  if not found then
    return null;
  end if;
  select d.decrypted_secret into v_token from vault.decrypted_secrets d
  where d.name = 'intent_g2:' || v_source.workspace_id;
  if v_token is null then
    update public.intent_sources s set status = 'disconnected' where s.id = v_source.id;
    return null;
  end if;
  update public.intent_sources s set locked_until = now() + make_interval(secs => greatest(p_lease_seconds, 30))
  where s.id = v_source.id;
  return jsonb_build_object('source_id', v_source.id, 'workspace_id', v_source.workspace_id,
                            'token', v_token,
                            'since', coalesce(v_source.last_import_at, now() - interval '7 days'));
end;
$$;

-- p_outcome: 'ok' (next pull in a day), 'retry' (in an hour), 'revoked'
-- (G2 refused the token: the connection goes to error).
create function public.intent_pull_finish(p_source_id uuid, p_workspace_id uuid, p_outcome text, p_error text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.intent_sources s
  set locked_until = null,
      next_pull_at = now() + case p_outcome when 'ok' then interval '1 day' else interval '1 hour' end,
      last_import_at = case when p_outcome = 'ok' then now() else s.last_import_at end,
      last_error = case when p_outcome = 'ok' then null else left(p_error, 300) end,
      status = case when p_outcome = 'revoked' then 'error' else s.status end,
      status_reason = case when p_outcome = 'revoked' then left(p_error, 300) else s.status_reason end
  where s.id = p_source_id and s.workspace_id = p_workspace_id;
$$;

-- Owners and admins: switch the webhook off, or disconnect G2 (its token is
-- deleted).
create function public.intent_source_disconnect(p_workspace_id uuid, p_kind text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.is_workspace_admin(p_workspace_id)) then
    return false;
  end if;
  if p_kind = 'g2' then
    delete from vault.secrets s where s.name = 'intent_g2:' || p_workspace_id;
  end if;
  update public.intent_sources s set status = 'disconnected', token_hash = null, locked_until = null
  where s.workspace_id = p_workspace_id and s.kind = p_kind;
  return found;
end;
$$;

-- Any member: not interested.
create function public.intent_signal_dismiss(p_signal_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.intent_signals s set status = 'dismissed', decided_by = (select auth.uid()), decided_at = now()
  where s.id = p_signal_id and s.status = 'new'
    and (select private.is_workspace_member(s.workspace_id));
  return found;
end;
$$;

-- Keeping signals: their companies (one per domain) go into a
-- target-accounts campaign marked as this play; the server starts its run.
create function public.intent_signals_keep(
  p_workspace_id uuid, p_user_id uuid, p_signal_ids uuid[], p_name text, p_titles jsonb, p_max integer
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
  select coalesce(jsonb_agg(jsonb_build_object('input', x.company_domain, 'domain', x.company_domain,
                                               'company_name', x.company_name)), '[]'::jsonb)
  into v_targets
  from (select distinct on (s.company_domain) s.company_domain, s.company_name
        from public.intent_signals s
        where s.workspace_id = p_workspace_id and s.id = any (p_signal_ids) and s.status = 'new'
        order by s.company_domain, s.seen_on desc) x;
  if jsonb_array_length(v_targets) = 0 then
    return jsonb_build_object('status', 'invalid');
  end if;
  v_made := public.campaign_create_company(
    p_workspace_id, p_user_id, 'accounts', p_name,
    jsonb_build_object('titles', coalesce(p_titles, '[]'::jsonb), 'source', 'intent'),
    v_targets, p_max);
  if v_made ->> 'status' = 'created' then
    update public.intent_signals s
    set status = 'queued', campaign_id = (v_made ->> 'campaign_id')::uuid, decided_by = p_user_id, decided_at = now()
    where s.workspace_id = p_workspace_id and s.status = 'new'
      and s.company_domain in (select t ->> 'domain' from jsonb_array_elements(v_targets) t);
  end if;
  return v_made;
end;
$$;

revoke all on function public.intent_ingest(uuid, text, uuid, jsonb, integer, integer) from public, anon, authenticated;
revoke all on function public.intent_webhook_set(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.intent_webhook_source(text) from public, anon, authenticated;
revoke all on function public.intent_g2_connect(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.intent_pull_claim(integer) from public, anon, authenticated;
revoke all on function public.intent_pull_finish(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.intent_signals_keep(uuid, uuid, uuid[], text, jsonb, integer) from public, anon, authenticated;
grant execute on function public.intent_ingest(uuid, text, uuid, jsonb, integer, integer) to service_role;
grant execute on function public.intent_webhook_set(uuid, uuid, text, text) to service_role;
grant execute on function public.intent_webhook_source(text) to service_role;
grant execute on function public.intent_g2_connect(uuid, uuid, text) to service_role;
grant execute on function public.intent_pull_claim(integer) to service_role;
grant execute on function public.intent_pull_finish(uuid, uuid, text, text) to service_role;
grant execute on function public.intent_signals_keep(uuid, uuid, uuid[], text, jsonb, integer) to service_role;

revoke all on function public.intent_source_disconnect(uuid, text) from public, anon;
revoke all on function public.intent_signal_dismiss(uuid) from public, anon;
grant execute on function public.intent_source_disconnect(uuid, text) to authenticated;
grant execute on function public.intent_signal_dismiss(uuid) to authenticated;

-- The daily G2 pull: hourly, the database calls the app only when a G2
-- connection is due, with the scheduler's Vault token.
create function private.intent_cron_tick()
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
    select 1 from public.intent_sources s
    where s.kind = 'g2' and s.status = 'active' and s.next_pull_at <= now()
      and (s.locked_until is null or s.locked_until < now())
  ) then
    return;
  end if;
  select s.decrypted_secret into v_url from vault.decrypted_secrets s where s.name = 'dialvo_app_url';
  select s.decrypted_secret into v_token from vault.decrypted_secrets s where s.name = 'dialvo_cron_token';
  if v_url is null or v_token is null then
    return;
  end if;
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := $4)'
  using rtrim(v_url, '/') || '/api/integrations/step?job=intent', '{}'::jsonb,
        jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_token),
        58000;
end;
$$;
revoke all on function private.intent_cron_tick() from public;

do $do$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    execute 'create extension if not exists pg_cron with schema pg_catalog';
    execute 'create extension if not exists pg_net with schema extensions';
    execute $job$
      select cron.schedule('dialvo-intent-steps', '23 * * * *', 'select private.intent_cron_tick()')
    $job$;
  end if;
end;
$do$;
