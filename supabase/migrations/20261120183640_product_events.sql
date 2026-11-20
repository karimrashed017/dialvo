-- Product events from a workspace's own app, for the "Trial users ready to
-- buy" play: POST /api/v1/events with a per-workspace API key records events
-- such as trial_started or limit_reached on the lead with that email.
--
-- Additive. Three new tables:
--   workspace_api_keys     a workspace's keys. Only a SHA-256 hash of each key
--                          is stored; the key itself is shown once, when it is
--                          made, and never again. The hash column can't be
--                          read through the API by anyone.
--   api_key_minute_usage   how many events a key sent in each minute, for the
--                          rate limit. Server only.
--   lead_product_events    the events, on the lead they matched.

-- ---------------------------------------------------------------------------
-- workspace_api_keys
-- ---------------------------------------------------------------------------
create table public.workspace_api_keys (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null default 'Product events' check (char_length(name) between 1 and 80),
  -- The first characters of the key, so a person can tell keys apart.
  key_prefix text not null check (key_prefix ~ '^[A-Za-z0-9_-]{8,16}$'),
  -- Hex SHA-256 of the whole key.
  key_hash text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null,
  unique (id, workspace_id)
);
alter table public.workspace_api_keys enable row level security;
create index workspace_api_keys_workspace_idx on public.workspace_api_keys (workspace_id, created_at desc);
create index workspace_api_keys_created_by_idx on public.workspace_api_keys (created_by);
create index workspace_api_keys_revoked_by_idx on public.workspace_api_keys (revoked_by);

-- ---------------------------------------------------------------------------
-- api_key_minute_usage: the rate limit's counter. Server only.
-- ---------------------------------------------------------------------------
create table public.api_key_minute_usage (
  key_id uuid not null,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  minute timestamptz not null,
  events integer not null default 0,
  primary key (key_id, minute),
  foreign key (key_id, workspace_id)
    references public.workspace_api_keys (id, workspace_id) on delete cascade
);
alter table public.api_key_minute_usage enable row level security;
create index api_key_minute_usage_workspace_idx on public.api_key_minute_usage (workspace_id);
create index api_key_minute_usage_key_ws_idx on public.api_key_minute_usage (key_id, workspace_id);

-- ---------------------------------------------------------------------------
-- lead_product_events
-- ---------------------------------------------------------------------------
create table public.lead_product_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  lead_id uuid not null,
  event text not null check (event in (
    'trial_started', 'limit_reached', 'teammate_invited', 'trial_ending', 'trial_converted'
  )),
  occurred_at timestamptz not null default now(),
  -- Small and flat: { "limit": "projects", "ends_at": "2026-12-01" }.
  properties jsonb not null default '{}'::jsonb
    check (jsonb_typeof(properties) = 'object' and octet_length(properties::text) <= 2000),
  api_key_id uuid,
  created_at timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (lead_id, workspace_id)
    references public.leads (id, workspace_id) on delete cascade,
  foreign key (api_key_id, workspace_id)
    references public.workspace_api_keys (id, workspace_id) on delete set null (api_key_id)
);
alter table public.lead_product_events enable row level security;
create index lead_product_events_lead_idx on public.lead_product_events (lead_id, workspace_id, event, occurred_at desc);
create index lead_product_events_workspace_idx on public.lead_product_events (workspace_id, occurred_at desc);
create index lead_product_events_key_idx on public.lead_product_events (api_key_id, workspace_id) where api_key_id is not null;

-- ---------------------------------------------------------------------------
-- Grants and policies
-- ---------------------------------------------------------------------------
revoke all on public.workspace_api_keys, public.api_key_minute_usage, public.lead_product_events
  from anon, authenticated;
grant all on public.workspace_api_keys, public.api_key_minute_usage, public.lead_product_events
  to service_role;
-- Everything but the hash.
grant select (id, workspace_id, name, key_prefix, created_by, created_at, last_used_at, revoked_at, revoked_by)
  on public.workspace_api_keys to authenticated;
grant select on public.lead_product_events to authenticated;

create policy "Members see their workspace's keys" on public.workspace_api_keys for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));
create policy "Members read product events" on public.lead_product_events for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));
-- api_key_minute_usage: no policies. Only the server reads or writes it.

-- ---------------------------------------------------------------------------
-- Keys: made and revoked by an owner or admin (signed in)
-- ---------------------------------------------------------------------------

-- Stores a new key's hash. The key itself is made in the app, shown once,
-- and never reaches the database. At most 3 active keys per workspace
-- (written here rather than passed in, because a signed-in person calls
-- this; src/lib/campaigns/config.ts says the same number).
create function public.api_key_create(p_workspace_id uuid, p_name text, p_prefix text, p_hash text)
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
    raise exception 'only an owner or admin can make a key' using errcode = '42501';
  end if;
  perform 1 from public.workspaces w where w.id = p_workspace_id for update;
  if (select count(*) from public.workspace_api_keys k
      where k.workspace_id = p_workspace_id and k.revoked_at is null) >= 3 then
    raise exception 'this workspace has as many keys as it may have' using errcode = 'P0001';
  end if;
  insert into public.workspace_api_keys (workspace_id, name, key_prefix, key_hash, created_by)
  values (p_workspace_id, left(coalesce(nullif(btrim(p_name), ''), 'Product events'), 80), p_prefix, p_hash, v_user)
  returning id into v_id;
  return v_id;
end;
$$;

create function public.api_key_revoke(p_key_id uuid)
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
  update public.workspace_api_keys k
  set revoked_at = now(), revoked_by = v_user
  where k.id = p_key_id and k.revoked_at is null
    and (select private.is_workspace_admin(k.workspace_id));
  return found;
end;
$$;

-- ---------------------------------------------------------------------------
-- The events endpoint's one call (secret key only)
-- ---------------------------------------------------------------------------

-- Records one event sent with a key:
--   { "status": "recorded", "lead_id" }
--   { "status": "unauthorised" }   no such key, or revoked
--   { "status": "rate_limited" }   more than p_max_per_minute this minute
--   { "status": "no_lead" }        no lead in the workspace has that email
--   { "status": "invalid" }        an event or email it doesn't take
create function public.api_event_record(
  p_key_hash text, p_email text, p_event text, p_occurred_at timestamptz,
  p_properties jsonb, p_max_per_minute integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key public.workspace_api_keys%rowtype;
  v_minute timestamptz := date_trunc('minute', now());
  v_taken integer;
  v_lead uuid;
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  select k.* into v_key from public.workspace_api_keys k
  where k.key_hash = lower(coalesce(p_key_hash, '')) and k.revoked_at is null;
  if not found then
    return jsonb_build_object('status', 'unauthorised');
  end if;
  insert into public.api_key_minute_usage as u (key_id, workspace_id, minute, events)
  values (v_key.id, v_key.workspace_id, v_minute, 1)
  on conflict (key_id, minute) do update
  set events = u.events + 1
  where u.events < p_max_per_minute
  returning u.events into v_taken;
  if v_taken is null or p_max_per_minute <= 0 then
    return jsonb_build_object('status', 'rate_limited');
  end if;
  -- Old counters are of no use: keep the last hour only.
  delete from public.api_key_minute_usage u
  where u.key_id = v_key.id and u.minute < v_minute - interval '1 hour';
  update public.workspace_api_keys k set last_used_at = now()
  where k.id = v_key.id and (k.last_used_at is null or k.last_used_at < now() - interval '1 minute');

  if p_event not in ('trial_started', 'limit_reached', 'teammate_invited', 'trial_ending', 'trial_converted')
    or v_email !~ '^[^\s@]+@[a-z0-9-]+(\.[a-z0-9-]+)+$' or char_length(v_email) > 254
    or jsonb_typeof(coalesce(p_properties, '{}'::jsonb)) <> 'object'
    or octet_length(coalesce(p_properties, '{}'::jsonb)::text) > 2000 then
    return jsonb_build_object('status', 'invalid');
  end if;
  select l.id into v_lead from public.leads l
  where l.workspace_id = v_key.workspace_id and l.email = v_email;
  if v_lead is null then
    return jsonb_build_object('status', 'no_lead');
  end if;
  insert into public.lead_product_events (workspace_id, lead_id, event, occurred_at, properties, api_key_id)
  values (
    v_key.workspace_id, v_lead, p_event,
    -- Never in the future, never more than a year back.
    least(greatest(coalesce(p_occurred_at, now()), now() - interval '365 days'), now()),
    coalesce(p_properties, '{}'::jsonb), v_key.id
  );
  return jsonb_build_object('status', 'recorded', 'lead_id', v_lead);
end;
$$;

revoke all on function public.api_key_create(uuid, text, text, text) from public, anon;
revoke all on function public.api_key_revoke(uuid) from public, anon;
grant execute on function public.api_key_create(uuid, text, text, text) to authenticated;
grant execute on function public.api_key_revoke(uuid) to authenticated;
revoke all on function public.api_event_record(text, text, text, timestamptz, jsonb, integer) from public, anon, authenticated;
grant execute on function public.api_event_record(text, text, text, timestamptz, jsonb, integer) to service_role;
