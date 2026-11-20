-- Slice 2b: getting a new workspace to a working agent, and the trial clock.
--
-- Everything here is additive: new columns, three new tables
-- (workspace_setup, agent_test_messages, team_alerts) and new functions.
-- Two existing functions are replaced with the same body plus a little more:
-- create_workspace (a chat widget and a setup row from the start) and
-- chat_agent_context (the trial dates, and test chats in the daily count).
--
--   visitors (anon): chat_widget_seen, the widget saying which site it
--     loaded on.
--   the server (secret key only): chat_billing_state, agent_test_begin,
--     agent_test_commit, claim_team_alerts, finish_team_alert.

-- ---------------------------------------------------------------------------
-- The trial clock. Seven days from the day the workspace was made. Nobody
-- signed in can change either column: only the server will, when billing
-- exists.
-- ---------------------------------------------------------------------------
alter table public.workspaces
  add column trial_ends_at timestamptz not null default (now() + interval '7 days'),
  add column billing_status text not null default 'trialing'
    check (billing_status in ('trialing', 'active', 'past_due', 'canceled'));

update public.workspaces set trial_ends_at = created_at + interval '7 days';

-- ---------------------------------------------------------------------------
-- Email alerts: each person's own switch, on unless they turn it off.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column alert_emails boolean not null default true;
grant update (alert_emails) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- The install check: where and when a widget was last loaded. The origin of
-- the page only (https://example.com), never the page, the visitor or an
-- address. People read these; only chat_widget_seen writes them.
-- ---------------------------------------------------------------------------
alter table public.chat_widgets
  add column first_seen_at timestamptz,
  add column first_seen_origin text
    check (first_seen_origin is null or char_length(first_seen_origin) <= 300),
  add column last_seen_at timestamptz,
  add column last_seen_origin text
    check (last_seen_origin is null or char_length(last_seen_origin) <= 300);

-- Called by the widget when it loads. Writes at most once every 30 seconds
-- per widget, so a busy site costs one small update now and then.
create function public.chat_widget_seen(p_token text, p_origin text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_origin text := lower(btrim(coalesce(p_origin, '')));
begin
  if v_origin !~ '^https?://[a-z0-9.-]{1,253}(:[0-9]{1,5})?$' then
    return false;
  end if;
  update public.chat_widgets w
  set last_seen_at = now(),
      last_seen_origin = v_origin,
      first_seen_at = coalesce(w.first_seen_at, now()),
      first_seen_origin = coalesce(w.first_seen_origin, v_origin)
  where w.token = p_token and w.enabled
    and (w.last_seen_at is null or w.last_seen_at < now() - interval '30 seconds');
  return found;
end;
$$;

-- ---------------------------------------------------------------------------
-- workspace_setup: one row per workspace, the "Get started" checklist's
-- memory. What a step shows is mostly worked out from real data (is there
-- knowledge, was the widget seen, is the agent on); this holds the rest.
-- ---------------------------------------------------------------------------
create table public.workspace_setup (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  -- Reading the workspace's website into Knowledge.
  site_status text not null default 'none'
    check (site_status in ('none', 'reading', 'done', 'failed')),
  site_url text check (site_url is null or char_length(site_url) <= 300),
  site_started_at timestamptz,
  site_finished_at timestamptz,
  site_pages integer not null default 0 check (site_pages between 0 and 50),
  -- The first time the agent answered someone in the "Try your agent" chat.
  tried_agent_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.workspace_setup enable row level security;

create trigger workspace_setup_set_updated_at
  before update on public.workspace_setup
  for each row execute function private.set_updated_at();

insert into public.workspace_setup (workspace_id)
select w.id from public.workspaces w
on conflict (workspace_id) do nothing;

revoke all on public.workspace_setup from anon, authenticated;
grant all on public.workspace_setup to service_role;
grant select on public.workspace_setup to authenticated;
-- Rows are made with the workspace. Members move the checklist along; only
-- the server records that the agent was tried.
grant update (site_status, site_url, site_started_at, site_finished_at, site_pages, dismissed_at)
  on public.workspace_setup to authenticated;

create policy "Members read their setup" on public.workspace_setup for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));
create policy "Members update their setup" on public.workspace_setup for update to authenticated
  using ((select private.is_workspace_member(workspace_id)))
  with check ((select private.is_workspace_member(workspace_id)));

-- ---------------------------------------------------------------------------
-- agent_test_messages: "Try your agent". A teammate talks to their own
-- inbound agent inside the app. Nothing here is a lead, a conversation or a
-- message, so test chats never show in Leads, the Inbox or Today's numbers.
-- People read them; only the server writes them (agent_test_begin/commit).
-- ---------------------------------------------------------------------------
create table public.agent_test_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null,
  -- One test chat. "Start over" begins a new one.
  session_id uuid not null,
  author text not null check (author in ('user', 'agent')),
  body text not null check (char_length(body) between 1 and 10000),
  -- For the agent's turns: what it concluded (outcome, summary, handoff).
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  foreign key (workspace_id, user_id)
    references public.workspace_members (workspace_id, user_id) on delete cascade
);
alter table public.agent_test_messages enable row level security;
create index agent_test_messages_session_idx
  on public.agent_test_messages (workspace_id, user_id, session_id, created_at);
create index agent_test_messages_recent_idx
  on public.agent_test_messages (workspace_id, created_at desc);

revoke all on public.agent_test_messages from anon, authenticated;
grant all on public.agent_test_messages to service_role;
grant select on public.agent_test_messages to authenticated;

create policy "Members read test chats" on public.agent_test_messages for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));

-- ---------------------------------------------------------------------------
-- team_alerts: emails to the team that are waiting to go out, and the record
-- of the ones that went. A row is queued by the trigger below when a website
-- chat is qualified, needs a person, or has a draft waiting. The server
-- claims and sends them (claim_team_alerts); nothing here ever emails a lead.
-- ---------------------------------------------------------------------------
create table public.team_alerts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  conversation_id uuid not null,
  kind text not null check (kind in ('qualified', 'needs_human', 'draft_waiting')),
  summary text not null default '' check (char_length(summary) <= 1000),
  -- pending: queued. sending: claimed by a server. sent / failed: what the
  -- email provider said. skipped: over the hourly cap, or nobody to tell.
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'skipped', 'failed')),
  recipients integer not null default 0 check (recipients >= 0),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  foreign key (conversation_id, workspace_id)
    references public.conversations (id, workspace_id) on delete cascade
);
alter table public.team_alerts enable row level security;
create index team_alerts_conversation_idx
  on public.team_alerts (conversation_id, workspace_id);
create index team_alerts_recent_idx
  on public.team_alerts (workspace_id, created_at desc);

revoke all on public.team_alerts from anon, authenticated;
grant all on public.team_alerts to service_role;
grant select on public.team_alerts to authenticated;

create policy "Members read team alerts" on public.team_alerts for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));

-- Queues an alert for the feed events the team wants to hear about. It must
-- never get in the way of the chat itself, so any failure here is swallowed.
create function private.queue_team_alert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
  v_summary text := new.summary;
  v_conversation uuid;
begin
  -- Only what the chat itself and the agent record counts. A signed-in
  -- person adding a feed event by hand never sets off an email.
  if (select auth.uid()) is not null then
    return new;
  end if;
  if new.kind = 'lead_status_changed' and new.agent_id is not null
     and new.metadata ->> 'to' = 'qualified' then
    v_kind := 'qualified';
  elsif new.kind = 'handoff_requested' then
    v_kind := 'needs_human';
  elsif new.kind = 'draft_waiting' then
    v_kind := 'draft_waiting';
  elsif new.kind = 'chat_started' and not exists (
    select 1 from public.agents a
    where a.workspace_id = new.workspace_id
      and a.role = 'inbound' and a.channel = 'chat' and a.enabled
  ) then
    -- No agent is answering: a person has to.
    v_kind := 'needs_human';
    v_summary := 'A new website chat is waiting for your team.';
  else
    return new;
  end if;

  v_conversation := (new.metadata ->> 'conversation_id')::uuid;
  if v_conversation is null then
    return new;
  end if;
  insert into public.team_alerts (workspace_id, conversation_id, kind, summary)
  values (new.workspace_id, v_conversation, v_kind, left(v_summary, 1000));
  return new;
exception when others then
  return new;
end;
$$;
revoke all on function private.queue_team_alert() from public;

create trigger activity_events_queue_team_alert
  after insert on public.activity_events
  for each row
  when (new.channel = 'chat' and new.kind in (
    'lead_status_changed', 'handoff_requested', 'draft_waiting', 'chat_started'
  ))
  execute function private.queue_team_alert();

-- Hands a server the alerts waiting for one conversation of the workspace
-- behind the widget token, with who to email. Each alert is handed out once.
-- The brake: 20 alert emails per workspace per hour; the rest are marked
-- skipped. Alerts older than 15 minutes are left alone, so switching email
-- on later doesn't send a backlog.
create function public.claim_team_alerts(p_token text, p_conversation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conv public.conversations%rowtype;
  v_ws public.workspaces%rowtype;
  v_lead_name text;
  v_recipients text[];
  v_sent integer;
  v_alert record;
  v_alerts jsonb := '[]'::jsonb;
begin
  select c.* into v_conv
  from public.conversations c
  join public.chat_widgets w on w.id = c.widget_id and w.workspace_id = c.workspace_id
  where w.token = p_token and c.id = p_conversation_id;
  if not found then
    return null;
  end if;
  select * into v_ws from public.workspaces w where w.id = v_conv.workspace_id;
  perform pg_advisory_xact_lock(hashtextextended('team_alerts:' || v_ws.id::text, 0));

  select array_agg(p.email order by p.email) into v_recipients
  from public.workspace_members m
  join public.profiles p on p.id = m.user_id
  where m.workspace_id = v_ws.id and p.alert_emails and p.email <> '';

  select count(*) into v_sent from public.team_alerts t
  where t.workspace_id = v_ws.id and t.status in ('sending', 'sent')
    and t.created_at > now() - interval '1 hour';

  select l.name into v_lead_name from public.leads l
  where l.id = v_conv.lead_id and l.workspace_id = v_conv.workspace_id;

  for v_alert in
    select t.id, t.kind, t.summary from public.team_alerts t
    where t.conversation_id = v_conv.id and t.workspace_id = v_ws.id
      and t.status = 'pending' and t.created_at > now() - interval '15 minutes'
    order by t.created_at
    for update
  loop
    if v_recipients is null or v_sent >= 20 then
      update public.team_alerts t set status = 'skipped' where t.id = v_alert.id;
    else
      update public.team_alerts t set status = 'sending' where t.id = v_alert.id;
      v_sent := v_sent + 1;
      v_alerts := v_alerts || jsonb_build_object(
        'id', v_alert.id, 'kind', v_alert.kind, 'summary', v_alert.summary
      );
    end if;
  end loop;

  return jsonb_build_object(
    'workspace', v_ws.name,
    'conversation_id', v_conv.id,
    'lead', coalesce(v_lead_name, ''),
    'recipients', to_jsonb(coalesce(v_recipients, array[]::text[])),
    'alerts', v_alerts
  );
end;
$$;

-- What happened to a claimed alert.
create function public.finish_team_alert(p_alert_id uuid, p_sent boolean, p_recipients integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.team_alerts t
  set status = case when p_sent then 'sent' else 'failed' end,
      recipients = greatest(coalesce(p_recipients, 0), 0),
      sent_at = case when p_sent then now() else null end
  where t.id = p_alert_id and t.status = 'sending';
  return found;
end;
$$;

-- ---------------------------------------------------------------------------
-- The agent's daily count, in one place: replies it sent or drafted in real
-- chats, plus its replies in test chats, in the last 24 hours.
-- ---------------------------------------------------------------------------
create function private.agent_replies_today(p_workspace_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select (
    (
      select count(*) from public.messages m
      where m.workspace_id = p_workspace_id and m.author = 'agent'
        and m.sent_at > now() - interval '1 day'
        and not (m.metadata ? 'draft_id')
    ) + (
      select count(*) from public.message_drafts d
      where d.workspace_id = p_workspace_id
        and d.created_at > now() - interval '1 day'
    ) + (
      select count(*) from public.agent_test_messages t
      where t.workspace_id = p_workspace_id and t.author = 'agent'
        and t.created_at > now() - interval '1 day'
    )
  )::integer;
$$;
revoke all on function private.agent_replies_today(uuid) from public;

-- The trial dates of the workspace behind a widget, for the server to decide
-- whether the agent may answer. Null for an unknown widget.
create function public.chat_billing_state(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'trial_ends_at', ws.trial_ends_at, 'billing_status', ws.billing_status
  )
  from public.chat_widgets w
  join public.workspaces ws on ws.id = w.workspace_id
  where w.token = p_token;
$$;

-- chat_agent_context, as before, plus: the workspace's trial dates, and test
-- chats counted in replies_today.
create or replace function public.chat_agent_context(p_token text, p_conversation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_conv public.conversations%rowtype;
  v_ws public.workspaces%rowtype;
  v_agent public.agents%rowtype;
begin
  select c.* into v_conv
  from public.conversations c
  join public.chat_widgets w on w.id = c.widget_id and w.workspace_id = c.workspace_id
  where w.token = p_token and w.enabled and c.id = p_conversation_id;
  if not found then
    return null;
  end if;
  select * into v_ws from public.workspaces w where w.id = v_conv.workspace_id;
  select a.* into v_agent from public.agents a
  where a.workspace_id = v_conv.workspace_id
    and a.role = 'inbound' and a.channel = 'chat' and a.enabled
  order by a.created_at
  limit 1;

  return jsonb_build_object(
    'workspace', jsonb_build_object(
      'name', v_ws.name, 'website', v_ws.website,
      'trial_ends_at', v_ws.trial_ends_at, 'billing_status', v_ws.billing_status
    ),
    'agent', case when v_agent.id is null then null else jsonb_build_object(
      'id', v_agent.id,
      'name', v_agent.name,
      'instructions', v_agent.instructions,
      'qualifying_questions', v_agent.qualifying_questions,
      'approval_mode', v_agent.approval_mode
    ) end,
    'paused', v_conv.agent_paused,
    'status', v_conv.status,
    'outcome', v_conv.outcome,
    'replies_today', private.agent_replies_today(v_conv.workspace_id),
    'latest_visitor_message_id', (
      select m.id from public.messages m
      where m.conversation_id = v_conv.id and m.workspace_id = v_conv.workspace_id
        and m.direction = 'in'
      order by m.sent_at desc, m.created_at desc
      limit 1
    ),
    'knowledge', coalesce((
      select jsonb_agg(
        jsonb_build_object('title', k.title, 'content', k.content, 'source_url', k.source_url)
        order by k.created_at desc
      )
      from (
        select k.title, k.content, k.source_url, k.created_at
        from public.knowledge_items k
        where k.workspace_id = v_conv.workspace_id and k.status = 'ready'
          and (k.kind = 'text' or k.source_url is not null)
        order by k.created_at desc
        limit 50
      ) k
    ), '[]'::jsonb),
    'messages', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', t.id, 'author', t.author, 'body', t.body)
        order by t.sent_at, t.created_at, t.id
      )
      from (
        select m.id, m.author, m.body, m.sent_at, m.created_at
        from public.messages m
        where m.conversation_id = v_conv.id and m.workspace_id = v_conv.workspace_id
          and (m.direction = 'in' or m.delivery_status in ('sent', 'delivered'))
        order by m.sent_at desc, m.created_at desc
        limit 40
      ) t
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- "Try your agent", the server's two calls. Both take the workspace and the
-- person from the server, which has already checked the session; both check
-- again that the person is a member.
-- ---------------------------------------------------------------------------

-- Saves what the teammate typed and returns what the agent needs to answer,
-- in the same shape as chat_agent_context. The agent is the workspace's
-- inbound chat agent whether or not it is switched on. Null when the person
-- isn't in the workspace. Brakes: 8 test messages a minute per person and
-- 150 a day per workspace (DV429).
create function public.agent_test_begin(
  p_workspace_id uuid,
  p_user_id uuid,
  p_session_id uuid,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws public.workspaces%rowtype;
  v_agent public.agents%rowtype;
  v_body text := btrim(coalesce(p_body, ''));
  v_message_id uuid;
begin
  if p_session_id is null or not exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace_id and m.user_id = p_user_id
  ) then
    return null;
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 2000 then
    raise exception 'a message must be 1 to 2000 characters' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('agent_test:' || p_workspace_id::text, 0));
  if (
    select count(*) from public.agent_test_messages t
    where t.workspace_id = p_workspace_id and t.user_id = p_user_id
      and t.author = 'user' and t.created_at > now() - interval '1 minute'
  ) >= 8 or (
    select count(*) from public.agent_test_messages t
    where t.workspace_id = p_workspace_id
      and t.author = 'user' and t.created_at > now() - interval '1 day'
  ) >= 150 then
    raise exception 'too many test messages' using errcode = 'DV429';
  end if;

  insert into public.agent_test_messages (workspace_id, user_id, session_id, author, body)
  values (p_workspace_id, p_user_id, p_session_id, 'user', v_body)
  returning id into v_message_id;

  select * into v_ws from public.workspaces w where w.id = p_workspace_id;
  select a.* into v_agent from public.agents a
  where a.workspace_id = p_workspace_id and a.role = 'inbound' and a.channel = 'chat'
  order by a.created_at
  limit 1;

  return jsonb_build_object(
    'workspace', jsonb_build_object(
      'name', v_ws.name, 'website', v_ws.website,
      'trial_ends_at', v_ws.trial_ends_at, 'billing_status', v_ws.billing_status
    ),
    'agent', case when v_agent.id is null then null else jsonb_build_object(
      'id', v_agent.id,
      'name', v_agent.name,
      'instructions', v_agent.instructions,
      'qualifying_questions', v_agent.qualifying_questions,
      'approval_mode', v_agent.approval_mode
    ) end,
    'paused', false,
    'status', 'open',
    'outcome', null,
    'replies_today', private.agent_replies_today(p_workspace_id),
    'latest_visitor_message_id', v_message_id,
    'knowledge', coalesce((
      select jsonb_agg(
        jsonb_build_object('title', k.title, 'content', k.content, 'source_url', k.source_url)
        order by k.created_at desc
      )
      from (
        select k.title, k.content, k.source_url, k.created_at
        from public.knowledge_items k
        where k.workspace_id = p_workspace_id and k.status = 'ready'
          and (k.kind = 'text' or k.source_url is not null)
        order by k.created_at desc
        limit 50
      ) k
    ), '[]'::jsonb),
    'messages', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', t.id,
          'author', case t.author when 'user' then 'lead' else 'agent' end,
          'body', t.body
        )
        order by t.created_at, t.id
      )
      from (
        select m.id, m.author, m.body, m.created_at
        from public.agent_test_messages m
        where m.workspace_id = p_workspace_id and m.user_id = p_user_id
          and m.session_id = p_session_id
        order by m.created_at desc
        limit 40
      ) t
    ), '[]'::jsonb)
  );
end;
$$;

-- Stores the agent's answer in a test chat, and remembers that the agent
-- has been tried. 'stale' when the teammate has typed again meanwhile;
-- 'silent' when the agent had nothing to say (a handoff with no reply).
create function public.agent_test_commit(
  p_workspace_id uuid,
  p_user_id uuid,
  p_session_id uuid,
  p_in_reply_to uuid,
  p_result jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_latest uuid;
  v_reply text := left(btrim(coalesce(p_result ->> 'reply', '')), 4000);
  v_message_id uuid;
begin
  if not exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace_id and m.user_id = p_user_id
  ) then
    return null;
  end if;
  select t.id into v_latest from public.agent_test_messages t
  where t.workspace_id = p_workspace_id and t.user_id = p_user_id
    and t.session_id = p_session_id and t.author = 'user'
  order by t.created_at desc, t.id desc
  limit 1;
  if v_latest is null or v_latest is distinct from p_in_reply_to then
    return jsonb_build_object('status', 'stale');
  end if;

  update public.workspace_setup s
  set tried_agent_at = coalesce(s.tried_agent_at, now())
  where s.workspace_id = p_workspace_id;

  if v_reply = '' then
    return jsonb_build_object('status', 'silent');
  end if;
  insert into public.agent_test_messages
    (workspace_id, user_id, session_id, author, body, metadata)
  values (
    p_workspace_id, p_user_id, p_session_id, 'agent', v_reply,
    jsonb_build_object(
      'outcome', coalesce(p_result ->> 'outcome', 'none'),
      'summary', left(coalesce(p_result ->> 'summary', ''), 1000),
      'handoff', coalesce((p_result ->> 'handoff')::boolean, false),
      'stop_contact', coalesce((p_result ->> 'stop_contact')::boolean, false),
      'model', p_result ->> 'model'
    )
  )
  returning id into v_message_id;
  return jsonb_build_object('status', 'sent', 'message_id', v_message_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- create_workspace, as before, plus: a chat widget from the start, and the
-- checklist's row. Workspaces made before this keep the "Create the chat"
-- button in Settings.
-- ---------------------------------------------------------------------------
create or replace function public.create_workspace(
  p_name text,
  p_timezone text default 'UTC',
  p_website text default null,
  p_what_you_sell text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_owned integer;
  v_has_scale boolean;
  v_name text := btrim(coalesce(p_name, ''));
  v_slug text;
  v_id uuid;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if char_length(v_name) < 1 or char_length(v_name) > 120 then
    raise exception 'workspace name must be 1 to 120 characters' using errcode = '22023';
  end if;

  select count(*), coalesce(bool_or(w.plan = 'scale'), false)
    into v_owned, v_has_scale
  from public.workspace_members m
  join public.workspaces w on w.id = m.workspace_id
  where m.user_id = v_user and m.role = 'owner';

  if v_owned >= 5 or (v_owned >= 1 and not v_has_scale) then
    raise exception 'workspace limit reached for this plan' using errcode = 'P0001';
  end if;

  v_slug := btrim(left(regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g'), 40), '-');
  if char_length(v_slug) < 1 then
    v_slug := 'workspace';
  end if;
  v_slug := v_slug || '-' || left(replace(gen_random_uuid()::text, '-', ''), 8);

  insert into public.workspaces (name, slug, timezone, website, created_by)
  values (
    v_name,
    v_slug,
    coalesce(nullif(btrim(p_timezone), ''), 'UTC'),
    nullif(btrim(p_website), ''),
    v_user
  )
  returning id into v_id;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_id, v_user, 'owner');

  insert into public.agents (workspace_id, name, role, channel) values
    (v_id, 'Inbound agent', 'inbound', 'chat'),
    (v_id, 'Outbound agent', 'outbound', 'email'),
    (v_id, 'Closing agent', 'closing', 'chat'),
    (v_id, 'Expansion agent', 'expansion', 'email');

  insert into public.lead_forms (workspace_id, name, created_by)
  values (v_id, 'Website form', v_user);

  insert into public.chat_widgets (workspace_id, name, created_by)
  values (v_id, 'Website chat', v_user);

  insert into public.workspace_setup (workspace_id) values (v_id);

  if nullif(btrim(p_what_you_sell), '') is not null then
    insert into public.knowledge_items (workspace_id, title, kind, content, status, created_by)
    values (v_id, 'What we sell', 'text', left(btrim(p_what_you_sell), 100000), 'ready', v_user);
  end if;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Who may call what.
-- ---------------------------------------------------------------------------
revoke all on function public.chat_widget_seen(text, text) from public, authenticated;
grant execute on function public.chat_widget_seen(text, text) to anon, service_role;

revoke all on function public.chat_billing_state(text) from public, anon, authenticated;
revoke all on function public.claim_team_alerts(text, uuid) from public, anon, authenticated;
revoke all on function public.finish_team_alert(uuid, boolean, integer) from public, anon, authenticated;
revoke all on function public.agent_test_begin(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.agent_test_commit(uuid, uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.chat_billing_state(text) to service_role;
grant execute on function public.claim_team_alerts(text, uuid) to service_role;
grant execute on function public.finish_team_alert(uuid, boolean, integer) to service_role;
grant execute on function public.agent_test_begin(uuid, uuid, uuid, text) to service_role;
grant execute on function public.agent_test_commit(uuid, uuid, uuid, uuid, jsonb) to service_role;
