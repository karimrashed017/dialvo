-- Integrations out of Dialvo: Slack and webhooks.
--
--   Slack     a workspace pastes a Slack incoming-webhook URL. Dialvo posts
--             hot replies, chats that need a person, meetings booked, a
--             daily digest of what waits for approval, and plays finishing.
--   Webhooks  a workspace registers its own HTTPS endpoints. Dialvo POSTs
--             signed JSON (HMAC-SHA256) for lead.created, reply.received and
--             meeting.booked.
--
-- Additive. Three new tables:
--   slack_connections        one per workspace: state and which posts it wants
--   webhook_endpoints        a workspace's endpoints (at most 5)
--   integration_deliveries   the outbox: one row per post to Slack or per
--                            delivery to one endpoint, retried with backoff
--
-- Secrets live in Supabase Vault only: the Slack URL as
-- 'slack_webhook:<workspace id>' and each endpoint's signing secret as
-- 'webhook_secret:<endpoint id>'. They are written and read by functions the
-- secret key alone may call; no table holds them and nothing returns them to
-- a browser. (A Slack incoming-webhook URL is itself the credential: anyone
-- holding it can post to the channel.)
--
-- Where events come from: triggers on team_alerts (hot replies and chats
-- needing a person, the same moments the team is emailed about), meetings,
-- leads, messages and outbound_campaigns. Each trigger only queues, only for
-- a workspace that has asked for that event, and never gets in the way of
-- the write that set it off.
--
-- The scheduler: like CRM sync's, pg_cron runs private.integration_cron_tick()
-- every minute; it calls POST <app>/api/integrations/step only when a
-- delivery is due, with the same Vault token ('dialvo_cron_token'). The tick
-- also queues each workspace's daily approvals digest and drops old rows.

-- ---------------------------------------------------------------------------
-- slack_connections
-- ---------------------------------------------------------------------------
create table public.slack_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null unique references public.workspaces (id) on delete cascade,
  -- active: posting. error: Slack refused the URL (status_reason says why);
  -- nothing is posted until it is connected again. disconnected: the URL
  -- has been deleted.
  status text not null default 'active' check (status in ('active', 'error', 'disconnected')),
  status_reason text check (status_reason is null or char_length(status_reason) <= 300),
  -- What the team calls the channel ("#sales"), to show where posts go.
  channel_label text not null default '' check (char_length(channel_label) <= 80),
  -- Which posts it wants.
  events text[] not null default array['hot_reply', 'needs_human', 'meeting_booked', 'approvals_digest', 'play_finished']
    check (events <@ array['hot_reply', 'needs_human', 'meeting_booked', 'approvals_digest', 'play_finished']),
  -- The hour (UTC) the approvals digest is posted, and the last day it was.
  digest_hour integer not null default 8 check (digest_hour between 0 and 23),
  last_digest_on date,
  last_posted_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 300),
  last_error_at timestamptz,
  connected_by uuid references auth.users (id) on delete set null,
  connected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id)
);
alter table public.slack_connections enable row level security;
create index slack_connections_connected_by_idx on public.slack_connections (connected_by);

create trigger slack_connections_set_updated_at
  before update on public.slack_connections
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- webhook_endpoints
-- ---------------------------------------------------------------------------
create table public.webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  url text not null check (url ~ '^https://[^\s/?#@]+(/[^\s]*)?$' and char_length(url) <= 500),
  description text not null default '' check (char_length(description) <= 120),
  events text[] not null
    check (cardinality(events) between 1 and 3
           and events <@ array['lead.created', 'reply.received', 'meeting.booked']),
  -- active. paused: by a person. disabled: by Dialvo after too many failed
  -- deliveries in a row (status_reason says so); a person can switch it back on.
  status text not null default 'active' check (status in ('active', 'paused', 'disabled')),
  status_reason text check (status_reason is null or char_length(status_reason) <= 300),
  -- The secret's first characters, so a person can tell which one is in use.
  secret_prefix text not null check (secret_prefix ~ '^whsec_[A-Za-z0-9_-]{4,10}$'),
  consecutive_failures integer not null default 0,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 300),
  -- Null when it was registered through the API with a key.
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id)
);
alter table public.webhook_endpoints enable row level security;
create index webhook_endpoints_workspace_idx on public.webhook_endpoints (workspace_id, created_at);
create index webhook_endpoints_created_by_idx on public.webhook_endpoints (created_by);

create trigger webhook_endpoints_set_updated_at
  before update on public.webhook_endpoints
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- integration_deliveries: the outbox. source_key names the Dialvo event a
-- delivery is about ('lead:<id>', 'meeting:<id>', 'msg:<id>',
-- 'alert:<id>', 'campaign:<id>', 'digest:<date>'), unique per target, so the
-- same event is never queued, or delivered, twice.
-- ---------------------------------------------------------------------------
create table public.integration_deliveries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  target text not null check (target in ('slack', 'webhook')),
  endpoint_id uuid,
  event text not null check (event in (
    'hot_reply', 'needs_human', 'meeting_booked', 'approvals_digest', 'play_finished',
    'lead.created', 'reply.received', 'meeting.booked'
  )),
  source_key text not null check (char_length(source_key) between 3 and 200),
  -- Slack: what the post is about, turned into words by the app. Webhook:
  -- the "data" of the JSON body, exactly as it will be sent.
  payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 20000),
  -- pending -> running -> delivered | failed (gave up) | skipped (the
  -- connection or endpoint went away, or over a cap).
  status text not null default 'pending'
    check (status in ('pending', 'running', 'delivered', 'failed', 'skipped')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  response_status integer,
  last_error text check (last_error is null or char_length(last_error) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  delivered_at timestamptz,
  unique (id, workspace_id),
  check ((target = 'webhook') = (endpoint_id is not null)),
  foreign key (endpoint_id, workspace_id)
    references public.webhook_endpoints (id, workspace_id) on delete cascade
);
alter table public.integration_deliveries enable row level security;
create unique index integration_deliveries_once_idx
  on public.integration_deliveries (workspace_id, target, coalesce(endpoint_id, '00000000-0000-0000-0000-000000000000'::uuid), source_key);
create index integration_deliveries_endpoint_idx on public.integration_deliveries (endpoint_id, workspace_id) where endpoint_id is not null;
create index integration_deliveries_due_idx on public.integration_deliveries (next_attempt_at)
  where status in ('pending', 'running');
create index integration_deliveries_recent_idx on public.integration_deliveries (workspace_id, created_at desc);

create trigger integration_deliveries_set_updated_at
  before update on public.integration_deliveries
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Grants and policies. Members read; every write goes through a function.
-- ---------------------------------------------------------------------------
revoke all on public.slack_connections, public.webhook_endpoints, public.integration_deliveries
  from anon, authenticated;
grant all on public.slack_connections, public.webhook_endpoints, public.integration_deliveries
  to service_role;
grant select on public.slack_connections, public.webhook_endpoints, public.integration_deliveries
  to authenticated;

create policy "Members read the Slack connection" on public.slack_connections for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));
create policy "Members read webhook endpoints" on public.webhook_endpoints for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));
create policy "Members read deliveries" on public.integration_deliveries for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));

-- ---------------------------------------------------------------------------
-- Queueing (internal)
-- ---------------------------------------------------------------------------

-- Queues a Slack post, if the workspace's connection is active and wants
-- this kind. At most 60 posts an hour per workspace; more are dropped (the
-- digest and the app still show everything).
create function private.slack_enqueue(p_workspace_id uuid, p_event text, p_source_key text, p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.slack_connections s
    where s.workspace_id = p_workspace_id and s.status = 'active' and p_event = any (s.events)
  ) then
    return;
  end if;
  if (select count(*) from public.integration_deliveries d
      where d.workspace_id = p_workspace_id and d.target = 'slack'
        and d.created_at > now() - interval '1 hour') >= 60 then
    return;
  end if;
  insert into public.integration_deliveries (workspace_id, target, event, source_key, payload)
  values (p_workspace_id, 'slack', p_event, left(p_source_key, 200), coalesce(p_payload, '{}'::jsonb))
  on conflict do nothing;
end;
$$;
revoke all on function private.slack_enqueue(uuid, text, text, jsonb) from public;

-- Queues one delivery per active endpoint that wants this event. An
-- endpoint with 5,000 deliveries already waiting gets no more until it
-- catches up.
create function private.webhook_enqueue(p_workspace_id uuid, p_event text, p_source_key text, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.integration_deliveries (workspace_id, target, endpoint_id, event, source_key, payload)
  select p_workspace_id, 'webhook', e.id, p_event, left(p_source_key, 200), coalesce(p_data, '{}'::jsonb)
  from public.webhook_endpoints e
  where e.workspace_id = p_workspace_id and e.status = 'active' and p_event = any (e.events)
    and (select count(*) from public.integration_deliveries d
         where d.endpoint_id = e.id and d.workspace_id = e.workspace_id
           and d.status in ('pending', 'running')) < 5000
  on conflict do nothing;
end;
$$;
revoke all on function private.webhook_enqueue(uuid, text, text, jsonb) from public;

-- A lead as webhooks and the API show it.
create function private.lead_public_json(p_lead public.leads)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_lead.id, 'name', p_lead.name, 'email', p_lead.email, 'phone', p_lead.phone,
    'company', p_lead.company, 'website', p_lead.website, 'source', p_lead.source,
    'status', p_lead.status, 'do_not_contact', p_lead.do_not_contact,
    'consent', jsonb_build_object('email', p_lead.consent_email, 'call', p_lead.consent_call,
                                  'sms', p_lead.consent_sms, 'whatsapp', p_lead.consent_whatsapp),
    'custom_fields', p_lead.custom_fields,
    'created_at', p_lead.created_at, 'updated_at', p_lead.updated_at
  );
$$;
revoke all on function private.lead_public_json(public.leads) from public;
grant execute on function private.lead_public_json(public.leads) to service_role;

-- ---------------------------------------------------------------------------
-- The triggers. Each swallows its own failure: a post that can't be queued
-- must never stop a lead, a message or a meeting from being saved.
-- ---------------------------------------------------------------------------

-- Hot replies and chats that need a person: the same moments the team is
-- emailed about (team_alerts).
create function private.integrations_on_team_alert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead record;
begin
  if new.kind not in ('reply_interested', 'needs_human') then
    return new;
  end if;
  select l.id, l.name, l.email, l.company into v_lead
  from public.conversations c
  join public.leads l on l.id = c.lead_id and l.workspace_id = c.workspace_id
  where c.id = new.conversation_id and c.workspace_id = new.workspace_id;
  perform private.slack_enqueue(
    new.workspace_id,
    case new.kind when 'reply_interested' then 'hot_reply' else 'needs_human' end,
    'alert:' || new.id,
    jsonb_build_object(
      'summary', left(new.summary, 600),
      'conversation_id', new.conversation_id,
      'lead', case when v_lead.id is null then null else jsonb_build_object(
        'id', v_lead.id, 'name', v_lead.name, 'email', v_lead.email, 'company', v_lead.company) end
    )
  );
  return new;
exception when others then
  return new;
end;
$$;
revoke all on function private.integrations_on_team_alert() from public;

create trigger team_alerts_integrations
  after insert on public.team_alerts
  for each row execute function private.integrations_on_team_alert();

create function private.integrations_on_lead()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.webhook_enqueue(new.workspace_id, 'lead.created', 'lead:' || new.id,
                                  private.lead_public_json(new));
  return new;
exception when others then
  return new;
end;
$$;
revoke all on function private.integrations_on_lead() from public;

create trigger leads_integrations
  after insert on public.leads
  for each row execute function private.integrations_on_lead();

-- reply.received: a message from a lead on any channel but the website chat
-- (a chat is many short messages; its "needs a person" moments go to Slack).
create function private.integrations_on_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conv record;
begin
  if new.direction <> 'in' then
    return new;
  end if;
  select c.id, c.channel, c.lead_id, l.email into v_conv
  from public.conversations c
  left join public.leads l on l.id = c.lead_id and l.workspace_id = c.workspace_id
  where c.id = new.conversation_id and c.workspace_id = new.workspace_id;
  if v_conv.id is null or v_conv.channel = 'chat' then
    return new;
  end if;
  perform private.webhook_enqueue(new.workspace_id, 'reply.received', 'msg:' || new.id,
    jsonb_build_object(
      'id', new.id, 'conversation_id', new.conversation_id, 'channel', v_conv.channel,
      'lead_id', v_conv.lead_id, 'lead_email', v_conv.email,
      'body', left(new.body, 4000), 'received_at', new.sent_at,
      'classification', new.metadata ->> 'classification'
    ));
  return new;
exception when others then
  return new;
end;
$$;
revoke all on function private.integrations_on_message() from public;

create trigger messages_integrations
  after insert on public.messages
  for each row execute function private.integrations_on_message();

create function private.integrations_on_meeting()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead record;
  v_data jsonb;
begin
  if new.status <> 'scheduled' then
    return new;
  end if;
  select l.id, l.name, l.email, l.company into v_lead from public.leads l
  where l.id = new.lead_id and l.workspace_id = new.workspace_id;
  v_data := jsonb_build_object(
    'id', new.id, 'title', new.title, 'starts_at', new.starts_at, 'ends_at', new.ends_at,
    'booked_by', new.booked_by, 'channel', new.channel, 'lead_id', new.lead_id,
    'lead', jsonb_build_object('name', v_lead.name, 'email', v_lead.email, 'company', v_lead.company)
  );
  perform private.webhook_enqueue(new.workspace_id, 'meeting.booked', 'meeting:' || new.id, v_data);
  perform private.slack_enqueue(new.workspace_id, 'meeting_booked', 'meeting:' || new.id, v_data);
  return new;
exception when others then
  return new;
end;
$$;
revoke all on function private.integrations_on_meeting() from public;

create trigger meetings_integrations
  after insert on public.meetings
  for each row execute function private.integrations_on_meeting();

-- A play (any campaign) has nothing left to do.
create function private.integrations_on_campaign()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'done' and old.status = 'active' then
    perform private.slack_enqueue(new.workspace_id, 'play_finished', 'campaign:' || new.id,
      jsonb_build_object(
        'campaign_id', new.id, 'name', new.name, 'kind', new.kind,
        'targets', (select count(*) from public.outbound_campaign_targets t
                    where t.campaign_id = new.id and t.workspace_id = new.workspace_id),
        'drafts', (select count(*) from public.outbound_drafts d
                   where d.campaign_id = new.id and d.workspace_id = new.workspace_id
                     and d.status in ('draft', 'approved'))
      ));
  end if;
  return new;
exception when others then
  return new;
end;
$$;
revoke all on function private.integrations_on_campaign() from public;

create trigger outbound_campaigns_integrations
  after update of status on public.outbound_campaigns
  for each row execute function private.integrations_on_campaign();

-- ---------------------------------------------------------------------------
-- Slack: connecting (the server, after it posted a test message with the
-- URL), settings and disconnecting (owners and admins)
-- ---------------------------------------------------------------------------
create function public.slack_connect(p_workspace_id uuid, p_user_id uuid, p_url text, p_label text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret uuid;
  v_name text := 'slack_webhook:' || p_workspace_id;
begin
  if not exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace_id and m.user_id = p_user_id and m.role in ('owner', 'admin')
  ) then
    return jsonb_build_object('status', 'not_found');
  end if;
  if coalesce(p_url, '') !~ '^https://hooks\.slack\.com/services/[A-Za-z0-9/_-]{10,200}$' then
    return jsonb_build_object('status', 'invalid');
  end if;
  select s.id into v_secret from vault.secrets s where s.name = v_name;
  if v_secret is null then
    perform vault.create_secret(p_url, v_name, 'The Slack incoming-webhook URL of one Dialvo workspace.');
  else
    perform vault.update_secret(v_secret, p_url);
  end if;
  insert into public.slack_connections as s (workspace_id, status, channel_label, connected_by, connected_at)
  values (p_workspace_id, 'active', left(btrim(coalesce(p_label, '')), 80), p_user_id, now())
  on conflict (workspace_id) do update
  set status = 'active', status_reason = null, channel_label = excluded.channel_label,
      last_error = null, last_error_at = null,
      connected_by = excluded.connected_by, connected_at = now();
  -- Posts that waited on a broken URL are not sent late.
  update public.integration_deliveries d set status = 'skipped', last_error = 'Slack was reconnected'
  where d.workspace_id = p_workspace_id and d.target = 'slack' and d.status in ('pending', 'running')
    and d.created_at < now() - interval '1 hour';
  return jsonb_build_object('status', 'connected');
end;
$$;

-- The URL, for the server's own posts. Null when not connected.
create function public.slack_credentials(p_workspace_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.decrypted_secret from vault.decrypted_secrets s
  join public.slack_connections c on c.workspace_id = p_workspace_id and c.status <> 'disconnected'
  where s.name = 'slack_webhook:' || p_workspace_id;
$$;

create function public.slack_settings_save(p_workspace_id uuid, p_events text[], p_digest_hour integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.is_workspace_admin(p_workspace_id)) then
    return false;
  end if;
  update public.slack_connections c
  set events = coalesce((select array_agg(distinct e) from unnest(p_events) e
                         where e = any (array['hot_reply', 'needs_human', 'meeting_booked', 'approvals_digest', 'play_finished'])),
                        '{}'::text[]),
      digest_hour = least(greatest(coalesce(p_digest_hour, 8), 0), 23)
  where c.workspace_id = p_workspace_id;
  return found;
end;
$$;

create function public.slack_disconnect(p_workspace_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.is_workspace_admin(p_workspace_id)) then
    return false;
  end if;
  delete from vault.secrets s where s.name = 'slack_webhook:' || p_workspace_id;
  update public.slack_connections c set status = 'disconnected', status_reason = null
  where c.workspace_id = p_workspace_id;
  update public.integration_deliveries d set status = 'skipped', last_error = 'Slack was disconnected'
  where d.workspace_id = p_workspace_id and d.target = 'slack' and d.status in ('pending', 'running');
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Webhook endpoints
-- ---------------------------------------------------------------------------

-- Registers an endpoint. The signing secret is made by the app, shown once
-- and kept here in Vault. p_user_id is the owner or admin who registered it
-- in the app, or null for a request made with the workspace's API key
-- (which the API checked before calling).
--   { "status": "created", "id" } | { "status": "not_found" | "invalid" | "capped" }
create function public.webhook_endpoint_create(
  p_workspace_id uuid, p_user_id uuid, p_url text, p_events text[], p_description text,
  p_secret text, p_max integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not exists (select 1 from public.workspaces w where w.id = p_workspace_id)
     or (p_user_id is not null and not exists (
       select 1 from public.workspace_members m
       where m.workspace_id = p_workspace_id and m.user_id = p_user_id and m.role in ('owner', 'admin'))) then
    return jsonb_build_object('status', 'not_found');
  end if;
  if coalesce(p_secret, '') !~ '^whsec_[A-Za-z0-9_-]{32,64}$'
     or coalesce(p_url, '') !~ '^https://[^\s/?#@]+(/[^\s]*)?$' or char_length(p_url) > 500
     or coalesce(cardinality(p_events), 0) = 0
     or not (p_events <@ array['lead.created', 'reply.received', 'meeting.booked']) then
    return jsonb_build_object('status', 'invalid');
  end if;
  perform 1 from public.workspaces w where w.id = p_workspace_id for update;
  if (select count(*) from public.webhook_endpoints e where e.workspace_id = p_workspace_id) >= p_max then
    return jsonb_build_object('status', 'capped');
  end if;
  insert into public.webhook_endpoints (workspace_id, url, description, events, secret_prefix, created_by)
  values (p_workspace_id, p_url, left(btrim(coalesce(p_description, '')), 120),
          (select array_agg(distinct e) from unnest(p_events) e), left(p_secret, 12), p_user_id)
  returning id into v_id;
  perform vault.create_secret(p_secret, 'webhook_secret:' || v_id, 'A Dialvo webhook endpoint''s signing secret.');
  return jsonb_build_object('status', 'created', 'id', v_id);
end;
$$;

-- A new signing secret for an endpoint (the old one stops being used now).
create function public.webhook_endpoint_roll(p_workspace_id uuid, p_user_id uuid, p_endpoint_id uuid, p_secret text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret uuid;
begin
  if coalesce(p_secret, '') !~ '^whsec_[A-Za-z0-9_-]{32,64}$'
     or (p_user_id is not null and not exists (
       select 1 from public.workspace_members m
       where m.workspace_id = p_workspace_id and m.user_id = p_user_id and m.role in ('owner', 'admin'))) then
    return false;
  end if;
  update public.webhook_endpoints e set secret_prefix = left(p_secret, 12)
  where e.id = p_endpoint_id and e.workspace_id = p_workspace_id;
  if not found then
    return false;
  end if;
  select s.id into v_secret from vault.secrets s where s.name = 'webhook_secret:' || p_endpoint_id;
  if v_secret is null then
    perform vault.create_secret(p_secret, 'webhook_secret:' || p_endpoint_id, 'A Dialvo webhook endpoint''s signing secret.');
  else
    perform vault.update_secret(v_secret, p_secret);
  end if;
  return true;
end;
$$;

-- What the server needs to send to one endpoint by hand (the test button).
create function public.webhook_endpoint_credentials(p_workspace_id uuid, p_endpoint_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('url', e.url, 'secret', s.decrypted_secret)
  from public.webhook_endpoints e
  join vault.decrypted_secrets s on s.name = 'webhook_secret:' || e.id
  where e.id = p_endpoint_id and e.workspace_id = p_workspace_id;
$$;

-- Pause, switch back on, or change the events. p_user_id null: the API.
create function public.webhook_endpoint_update(
  p_workspace_id uuid, p_user_id uuid, p_endpoint_id uuid, p_events text[], p_active boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is not null and not exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace_id and m.user_id = p_user_id and m.role in ('owner', 'admin')
  ) then
    return false;
  end if;
  if p_events is not null and (cardinality(p_events) = 0
     or not (p_events <@ array['lead.created', 'reply.received', 'meeting.booked'])) then
    return false;
  end if;
  update public.webhook_endpoints e
  set events = coalesce((select array_agg(distinct x) from unnest(p_events) x), e.events),
      status = case when p_active is null then e.status when p_active then 'active' else 'paused' end,
      status_reason = case when p_active then null else e.status_reason end,
      consecutive_failures = case when p_active then 0 else e.consecutive_failures end
  where e.id = p_endpoint_id and e.workspace_id = p_workspace_id;
  return found;
end;
$$;

create function public.webhook_endpoint_delete(p_workspace_id uuid, p_user_id uuid, p_endpoint_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is not null and not exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace_id and m.user_id = p_user_id and m.role in ('owner', 'admin')
  ) then
    return false;
  end if;
  delete from public.webhook_endpoints e where e.id = p_endpoint_id and e.workspace_id = p_workspace_id;
  if not found then
    return false;
  end if;
  delete from vault.secrets s where s.name = 'webhook_secret:' || p_endpoint_id;
  return true;
end;
$$;

-- A failed delivery, back in the queue (owners and admins, signed in).
create function public.integration_delivery_retry(p_workspace_id uuid, p_delivery_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.is_workspace_admin(p_workspace_id)) then
    return false;
  end if;
  update public.integration_deliveries d
  set status = 'pending', attempts = 0, next_attempt_at = now(), locked_until = null, last_error = null
  where d.id = p_delivery_id and d.workspace_id = p_workspace_id and d.status = 'failed';
  return found;
end;
$$;

-- ---------------------------------------------------------------------------
-- The delivery step (secret key only)
-- ---------------------------------------------------------------------------

-- Claims up to p_limit due deliveries under a lease, with what is needed to
-- send each: the Slack URL, or the endpoint's URL and signing secret. A
-- delivery whose connection or endpoint isn't active any more is skipped
-- here. p_workspace_id narrows it to one workspace ("send now").
create function public.integration_claim(p_limit integer, p_lease_seconds integer, p_workspace_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_out jsonb := '[]'::jsonb;
  d record;
begin
  update public.integration_deliveries x set status = 'skipped', last_error = 'Not connected any more'
  where x.status in ('pending', 'running')
    and (p_workspace_id is null or x.workspace_id = p_workspace_id)
    and ((x.target = 'slack' and not exists (
           select 1 from public.slack_connections s where s.workspace_id = x.workspace_id and s.status = 'active'))
      or (x.target = 'webhook' and not exists (
           select 1 from public.webhook_endpoints e
           where e.id = x.endpoint_id and e.workspace_id = x.workspace_id and e.status = 'active')));

  for d in
    select x.id, x.workspace_id, x.target, x.endpoint_id, x.event, x.payload, x.attempts, x.created_at,
           w.name as workspace_name
    from public.integration_deliveries x
    join public.workspaces w on w.id = x.workspace_id
    where ((x.status = 'pending' and x.next_attempt_at <= now())
           or (x.status = 'running' and x.locked_until < now()))
      and (p_workspace_id is null or x.workspace_id = p_workspace_id)
    order by x.next_attempt_at, x.created_at
    limit greatest(least(p_limit, 200), 0)
    for update of x skip locked
  loop
    update public.integration_deliveries x
    set status = 'running', attempts = x.attempts + 1,
        locked_until = now() + make_interval(secs => greatest(p_lease_seconds, 10))
    where x.id = d.id;
    v_out := v_out || jsonb_build_object(
      'id', d.id, 'workspace_id', d.workspace_id, 'workspace_name', d.workspace_name,
      'target', d.target, 'event', d.event, 'payload', d.payload,
      'attempt', d.attempts + 1, 'created_at', d.created_at,
      'url', case d.target
        when 'slack' then (select s.decrypted_secret from vault.decrypted_secrets s
                           where s.name = 'slack_webhook:' || d.workspace_id)
        else (select e.url from public.webhook_endpoints e where e.id = d.endpoint_id) end,
      'secret', case when d.target = 'webhook' then
        (select s.decrypted_secret from vault.decrypted_secrets s where s.name = 'webhook_secret:' || d.endpoint_id) end
    );
  end loop;
  return v_out;
end;
$$;

-- What happened to one claimed delivery:
--   'delivered'  the receiver said 2xx.
--   'retry'      a timeout, 429 or 5xx: tried again after p_retry_after
--                seconds (backoff chosen by the app), until p_max_attempts.
--   'failed'     a permanent refusal (4xx), or out of attempts.
--   'revoked'    Slack says the URL is gone: the connection goes to error.
-- An endpoint with p_disable_after failures in a row is disabled.
create function public.integration_finish(
  p_delivery_id uuid, p_outcome text, p_status integer, p_error text,
  p_retry_after integer, p_max_attempts integer, p_disable_after integer
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.integration_deliveries%rowtype;
  v_status text;
begin
  select * into d from public.integration_deliveries x where x.id = p_delivery_id and x.status = 'running' for update;
  if not found then
    return null;
  end if;
  v_status := case
    when p_outcome = 'delivered' then 'delivered'
    when p_outcome = 'retry' and d.attempts < p_max_attempts then 'pending'
    else 'failed' end;
  update public.integration_deliveries x
  set status = v_status, response_status = p_status, locked_until = null,
      last_error = case when v_status = 'delivered' then null else left(p_error, 300) end,
      next_attempt_at = case when v_status = 'pending' then now() + make_interval(secs => greatest(p_retry_after, 30)) else x.next_attempt_at end,
      delivered_at = case when v_status = 'delivered' then now() end
  where x.id = d.id;

  if d.target = 'slack' then
    update public.slack_connections s
    set last_posted_at = case when v_status = 'delivered' then now() else s.last_posted_at end,
        last_error = case when v_status = 'delivered' then null else left(p_error, 300) end,
        last_error_at = case when v_status = 'delivered' then s.last_error_at else now() end,
        status = case when p_outcome = 'revoked' then 'error' else s.status end,
        status_reason = case when p_outcome = 'revoked' then left(p_error, 300) else s.status_reason end
    where s.workspace_id = d.workspace_id;
  else
    update public.webhook_endpoints e
    set consecutive_failures = case when v_status = 'delivered' then 0 else e.consecutive_failures + 1 end,
        last_success_at = case when v_status = 'delivered' then now() else e.last_success_at end,
        last_failure_at = case when v_status = 'delivered' then e.last_failure_at else now() end,
        last_error = case when v_status = 'delivered' then e.last_error else left(p_error, 300) end
    where e.id = d.endpoint_id and e.workspace_id = d.workspace_id;
    update public.webhook_endpoints e
    set status = 'disabled',
        status_reason = 'Switched off after ' || e.consecutive_failures || ' failed deliveries in a row.'
    where e.id = d.endpoint_id and e.status = 'active' and e.consecutive_failures >= p_disable_after;
  end if;
  return v_status;
end;
$$;

-- ---------------------------------------------------------------------------
-- The scheduler
-- ---------------------------------------------------------------------------

-- Queues today's approvals digest for each connection that wants one and
-- whose hour has come: how many first emails, replies and chat answers wait
-- for a person. Nothing is posted when nothing waits.
create function private.integration_queue_digests()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c record;
  v_today date := (now() at time zone 'utc')::date;
  v_first integer;
  v_replies integer;
  v_chat integer;
begin
  for c in
    select s.workspace_id from public.slack_connections s
    where s.status = 'active' and 'approvals_digest' = any (s.events)
      and (s.last_digest_on is null or s.last_digest_on < v_today)
      and extract(hour from now() at time zone 'utc') >= s.digest_hour
    for update of s skip locked
  loop
    select count(*) into v_first from public.outbound_drafts d
    where d.workspace_id = c.workspace_id and d.status = 'draft';
    select count(*) into v_replies from public.outbound_emails e
    where e.workspace_id = c.workspace_id and e.status = 'draft';
    select count(*) into v_chat from public.message_drafts m
    where m.workspace_id = c.workspace_id and m.status = 'pending';
    if v_first + v_replies + v_chat > 0 then
      perform private.slack_enqueue(c.workspace_id, 'approvals_digest', 'digest:' || v_today,
        jsonb_build_object('first_emails', v_first, 'replies', v_replies, 'chat', v_chat, 'day', v_today));
    end if;
    update public.slack_connections s set last_digest_on = v_today where s.workspace_id = c.workspace_id;
  end loop;
end;
$$;
revoke all on function private.integration_queue_digests() from public;

-- What a tick would ask the app to do: true when a delivery is due. Also
-- queues the digests and keeps 30 days of finished deliveries.
create function private.integration_due_work()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.integration_queue_digests();
  delete from public.integration_deliveries d
  where d.status in ('delivered', 'failed', 'skipped') and d.updated_at < now() - interval '30 days';
  return exists (
    select 1 from public.integration_deliveries d
    where (d.status = 'pending' and d.next_attempt_at <= now())
       or (d.status = 'running' and d.locked_until < now())
  );
end;
$$;
revoke all on function private.integration_due_work() from public;

create function private.integration_cron_tick()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_token text;
begin
  if not private.integration_due_work() then
    return;
  end if;
  select s.decrypted_secret into v_url from vault.decrypted_secrets s where s.name = 'dialvo_app_url';
  select s.decrypted_secret into v_token from vault.decrypted_secrets s where s.name = 'dialvo_cron_token';
  if v_url is null or v_token is null then
    return;
  end if;
  -- By name through execute, so this can be created where pg_net doesn't
  -- exist (the in-memory Postgres the tests run on).
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := $4)'
  using rtrim(v_url, '/') || '/api/integrations/step?job=deliver', '{}'::jsonb,
        jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_token),
        58000;
end;
$$;
revoke all on function private.integration_cron_tick() from public;

-- ---------------------------------------------------------------------------
-- Function grants
-- ---------------------------------------------------------------------------
revoke all on function public.slack_connect(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.slack_credentials(uuid) from public, anon, authenticated;
revoke all on function public.webhook_endpoint_create(uuid, uuid, text, text[], text, text, integer) from public, anon, authenticated;
revoke all on function public.webhook_endpoint_roll(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.webhook_endpoint_credentials(uuid, uuid) from public, anon, authenticated;
revoke all on function public.webhook_endpoint_update(uuid, uuid, uuid, text[], boolean) from public, anon, authenticated;
revoke all on function public.webhook_endpoint_delete(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.integration_claim(integer, integer, uuid) from public, anon, authenticated;
revoke all on function public.integration_finish(uuid, text, integer, text, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.slack_connect(uuid, uuid, text, text) to service_role;
grant execute on function public.slack_credentials(uuid) to service_role;
grant execute on function public.webhook_endpoint_create(uuid, uuid, text, text[], text, text, integer) to service_role;
grant execute on function public.webhook_endpoint_roll(uuid, uuid, uuid, text) to service_role;
grant execute on function public.webhook_endpoint_credentials(uuid, uuid) to service_role;
grant execute on function public.webhook_endpoint_update(uuid, uuid, uuid, text[], boolean) to service_role;
grant execute on function public.webhook_endpoint_delete(uuid, uuid, uuid) to service_role;
grant execute on function public.integration_claim(integer, integer, uuid) to service_role;
grant execute on function public.integration_finish(uuid, text, integer, text, integer, integer, integer) to service_role;

revoke all on function public.slack_settings_save(uuid, text[], integer) from public, anon;
revoke all on function public.slack_disconnect(uuid) from public, anon;
revoke all on function public.integration_delivery_retry(uuid, uuid) from public, anon;
grant execute on function public.slack_settings_save(uuid, text[], integer) to authenticated;
grant execute on function public.slack_disconnect(uuid) to authenticated;
grant execute on function public.integration_delivery_retry(uuid, uuid) to authenticated;

-- The job itself. Skipped where pg_cron doesn't exist.
do $do$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    execute 'create extension if not exists pg_cron with schema pg_catalog';
    execute 'create extension if not exists pg_net with schema extensions';
    execute $job$
      select cron.schedule('dialvo-integration-steps', '* * * * *', 'select private.integration_cron_tick()')
    $job$;
  end if;
end;
$do$;
