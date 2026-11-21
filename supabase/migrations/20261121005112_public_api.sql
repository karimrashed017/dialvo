-- The public REST API, v1 (src/app/api/v1): leads, conversations, plays,
-- meetings and webhooks, with the same workspace API keys as POST
-- /api/v1/events (workspace_api_keys, only their hashes stored).
--
-- Additive:
--   api_key_minute_usage + requests   the API's own per-key, per-minute count
--                                     (events keep their own column and cap)
--   api_key_authorise()               a key's hash -> its workspace, counted
--                                     against the minute's cap
--   api_play_add_lead()               adds one of the workspace's leads to a
--                                     running play; its email is written by
--                                     the usual step and waits for approval
--
-- Everything else the API does is a plain read or write with the secret key,
-- and every query names the key's workspace itself (the secret key bypasses
-- row-level security): see src/lib/api/v1.ts.

alter table public.api_key_minute_usage add column requests integer not null default 0;

-- { "status": "ok", "workspace_id", "key_id" } | { "status": "unauthorised" | "rate_limited" }
create function public.api_key_authorise(p_key_hash text, p_max_per_minute integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key public.workspace_api_keys%rowtype;
  v_minute timestamptz := date_trunc('minute', now());
  v_taken integer;
begin
  select k.* into v_key from public.workspace_api_keys k
  where k.key_hash = lower(coalesce(p_key_hash, '')) and k.revoked_at is null;
  if not found then
    return jsonb_build_object('status', 'unauthorised');
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
                            'remaining', p_max_per_minute - v_taken);
end;
$$;

-- Adds a lead to a running play on the workspace's own leads. The same
-- rules as the play itself: not do not contact, not unsubscribed, not on the
-- never-contact list, has an email, and not already in this play.
--   { "status": "added", "target_id" } | { "status": "not_found" | "not_a_lead_play"
--     | "stopped" | "no_email" | "not_allowed" | "already_added" }
create function public.api_play_add_lead(p_workspace_id uuid, p_campaign_id uuid, p_lead_id uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign public.outbound_campaigns%rowtype;
  v_lead public.leads%rowtype;
  v_target uuid;
begin
  select c.* into v_campaign from public.outbound_campaigns c
  where c.id = p_campaign_id and c.workspace_id = p_workspace_id for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if v_campaign.kind in ('accounts', 'lookalike', 'signals') then
    return jsonb_build_object('status', 'not_a_lead_play');
  end if;
  if v_campaign.status <> 'active' then
    return jsonb_build_object('status', 'stopped');
  end if;
  select l.* into v_lead from public.leads l where l.id = p_lead_id and l.workspace_id = p_workspace_id;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if v_lead.email is null then
    return jsonb_build_object('status', 'no_email');
  end if;
  if v_lead.do_not_contact or v_lead.status = 'unsubscribed'
     or private.outbound_is_suppressed(p_workspace_id, v_lead.email, private.site_domain(v_lead.website)) then
    return jsonb_build_object('status', 'not_allowed');
  end if;
  insert into public.outbound_campaign_targets (workspace_id, campaign_id, position, lead_id, status, why_now)
  values (p_workspace_id, p_campaign_id,
          coalesce((select max(t.position) from public.outbound_campaign_targets t where t.campaign_id = p_campaign_id), 0) + 1,
          p_lead_id, 'selected',
          jsonb_build_object('fact', left(coalesce(nullif(btrim(p_note), ''), 'Added to this play through the API.'), 300),
                             'at', now(), 'source', 'api'))
  on conflict (campaign_id, lead_id) where lead_id is not null do nothing
  returning id into v_target;
  if v_target is null then
    return jsonb_build_object('status', 'already_added');
  end if;
  return jsonb_build_object('status', 'added', 'target_id', v_target);
end;
$$;

revoke all on function public.api_key_authorise(text, integer) from public, anon, authenticated;
revoke all on function public.api_play_add_lead(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.api_key_authorise(text, integer) to service_role;
grant execute on function public.api_play_add_lead(uuid, uuid, uuid, text) to service_role;
