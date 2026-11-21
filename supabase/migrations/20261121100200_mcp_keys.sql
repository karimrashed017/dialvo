-- Read-only and personal API keys, for the API and for the MCP server for
-- reps (POST /api/mcp).
--
--   workspace_api_keys + scope    'write' (what every key could do until now,
--                                 and what existing keys stay) or 'read':
--                                 a read key can look but not change
--                                 anything, in the REST API and in MCP.
--                      + user_id  null: a workspace key, made by an owner or
--                                 admin. Set: a personal key, which any
--                                 member makes for themselves and which acts
--                                 as them (what they add is theirs). It goes
--                                 when they leave the workspace.
--
-- Additive: two columns, new functions, and api_key_authorise() answering
-- with the key's scope and person as well (same arguments, same answers
-- otherwise).

alter table public.workspace_api_keys
  add column scope text not null default 'write' check (scope in ('read', 'write')),
  add column user_id uuid,
  add foreign key (workspace_id, user_id)
    references public.workspace_members (workspace_id, user_id) on delete cascade;
create index workspace_api_keys_user_idx on public.workspace_api_keys (workspace_id, user_id) where user_id is not null;

grant select (scope, user_id) on public.workspace_api_keys to authenticated;

-- A new key, with its scope. Personal keys: any member, for themselves, at
-- most 3 active each. Workspace keys: owners and admins, at most 3 active
-- (the same number as API_KEYS_MAX in src/lib/plays/config.ts).
create function public.api_key_create_scoped(
  p_workspace_id uuid, p_name text, p_prefix text, p_hash text, p_scope text, p_personal boolean
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
  if p_scope not in ('read', 'write') then
    raise exception 'unknown scope' using errcode = '22023';
  end if;
  if coalesce(p_personal, false) then
    if not (select private.is_workspace_member(p_workspace_id)) then
      raise exception 'not a member' using errcode = '42501';
    end if;
    perform 1 from public.workspaces w where w.id = p_workspace_id for update;
    if (select count(*) from public.workspace_api_keys k
        where k.workspace_id = p_workspace_id and k.user_id = v_user and k.revoked_at is null) >= 3 then
      raise exception 'you have as many keys as you may have' using errcode = 'P0001';
    end if;
  else
    if not (select private.is_workspace_admin(p_workspace_id)) then
      raise exception 'only an owner or admin can make a workspace key' using errcode = '42501';
    end if;
    perform 1 from public.workspaces w where w.id = p_workspace_id for update;
    if (select count(*) from public.workspace_api_keys k
        where k.workspace_id = p_workspace_id and k.user_id is null and k.revoked_at is null) >= 3 then
      raise exception 'this workspace has as many keys as it may have' using errcode = 'P0001';
    end if;
  end if;
  insert into public.workspace_api_keys (workspace_id, name, key_prefix, key_hash, created_by, scope, user_id)
  values (p_workspace_id, left(coalesce(nullif(btrim(p_name), ''), 'API key'), 80), p_prefix, p_hash, v_user,
          p_scope, case when coalesce(p_personal, false) then v_user end)
  returning id into v_id;
  return v_id;
end;
$$;

-- A member revokes one of their own personal keys (admins revoke any key
-- with api_key_revoke, as before).
create function public.api_key_revoke_own(p_key_id uuid)
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
  where k.id = p_key_id and k.revoked_at is null and k.user_id = v_user;
  return found;
end;
$$;

-- As before, and also the key's scope, its person and their role now.
--   { "status": "ok", "workspace_id", "key_id", "remaining", "scope", "user_id", "role" }
--   | { "status": "unauthorised" | "rate_limited" }
create or replace function public.api_key_authorise(p_key_hash text, p_max_per_minute integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key public.workspace_api_keys%rowtype;
  v_minute timestamptz := date_trunc('minute', now());
  v_taken integer;
  v_role text;
begin
  select k.* into v_key from public.workspace_api_keys k
  where k.key_hash = lower(coalesce(p_key_hash, '')) and k.revoked_at is null;
  if not found then
    return jsonb_build_object('status', 'unauthorised');
  end if;
  if v_key.user_id is not null then
    select m.role into v_role from public.workspace_members m
    where m.workspace_id = v_key.workspace_id and m.user_id = v_key.user_id;
    if v_role is null then
      return jsonb_build_object('status', 'unauthorised');
    end if;
  end if;
  insert into public.api_key_minute_usage as u (key_id, workspace_id, minute, requests)
  values (v_key.id, v_key.workspace_id, v_minute, 1)
  on conflict (key_id, minute) do update
  set requests = u.requests + 1
  where u.requests < p_max_per_minute
  returning u.requests into v_taken;
  if v_taken is null or p_max_per_minute <= 0 then
    return jsonb_build_object('status', 'rate_limited');
  end if;
  delete from public.api_key_minute_usage u
  where u.key_id = v_key.id and u.minute < v_minute - interval '1 hour';
  update public.workspace_api_keys k set last_used_at = now()
  where k.id = v_key.id and (k.last_used_at is null or k.last_used_at < now() - interval '1 minute');
  return jsonb_build_object('status', 'ok', 'workspace_id', v_key.workspace_id, 'key_id', v_key.id,
                            'remaining', p_max_per_minute - v_taken, 'scope', v_key.scope,
                            'user_id', v_key.user_id, 'role', v_role);
end;
$$;

-- The scope of a key, for POST /api/v1/events (which checks the key in its
-- own call). Null for no such key.
create function public.api_key_scope(p_key_hash text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select k.scope from public.workspace_api_keys k
  where k.key_hash = lower(coalesce(p_key_hash, '')) and k.revoked_at is null;
$$;

revoke all on function public.api_key_create_scoped(uuid, text, text, text, text, boolean) from public, anon;
revoke all on function public.api_key_revoke_own(uuid) from public, anon;
grant execute on function public.api_key_create_scoped(uuid, text, text, text, text, boolean) to authenticated;
grant execute on function public.api_key_revoke_own(uuid) to authenticated;
revoke all on function public.api_key_scope(text) from public, anon, authenticated;
grant execute on function public.api_key_scope(text) to service_role;
