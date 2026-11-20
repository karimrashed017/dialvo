-- Slice 2a: the website chat widget and the inbound agent's replies.
--
-- Everything here is additive. Two new tables (chat_widgets, message_drafts),
-- a few new columns, and the functions the chat goes through:
--
--   visitors (anon, like capture_lead): chat_widget_info, chat_start,
--     chat_post, chat_poll. Each is scoped to the workspace behind the
--     widget's public token, and a conversation can only be read or written
--     with the random key its visitor was given when it started.
--   teammates (signed in): send_chat_reply, approve_chat_draft,
--     discard_chat_draft. Each checks workspace membership itself.
--   the server (secret key only): chat_agent_context, chat_agent_commit.
--     What the agent reads and writes. Never callable from a browser.

-- ---------------------------------------------------------------------------
-- New columns
-- ---------------------------------------------------------------------------

-- The questions an agent should work into the conversation, one per line.
alter table public.agents
  add column qualifying_questions text not null default ''
    check (char_length(qualifying_questions) <= 4000);
grant update (qualifying_questions) on public.agents to authenticated;

-- Where a knowledge item's text was read from, when it came from a web page.
alter table public.knowledge_items
  add column source_url text
    check (source_url is null or (source_url ~ '^https://' and char_length(source_url) <= 2000));
grant update (source_url) on public.knowledge_items to authenticated;

-- ---------------------------------------------------------------------------
-- chat_widgets: one per place the chat is embedded. Like a lead form, the
-- token is public (it sits in the customer's page source) and only lets
-- someone start a chat.
-- ---------------------------------------------------------------------------
create table public.chat_widgets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  token text not null unique
    default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  enabled boolean not null default true,
  -- What visitors see at the top of the chat, and its first line.
  title text not null default 'Chat with us' check (char_length(title) between 1 and 60),
  welcome text not null default 'Hi. How can we help?' check (char_length(welcome) <= 300),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id)
);
alter table public.chat_widgets enable row level security;
create index chat_widgets_workspace_idx on public.chat_widgets (workspace_id);
create index chat_widgets_created_by_idx on public.chat_widgets (created_by);

create trigger chat_widgets_set_updated_at
  before update on public.chat_widgets
  for each row execute function private.set_updated_at();

revoke all on public.chat_widgets from anon, authenticated;
grant all on public.chat_widgets to service_role;
grant select, delete on public.chat_widgets to authenticated;
grant insert (workspace_id, name, title, welcome, created_by) on public.chat_widgets to authenticated;
grant update (name, enabled, title, welcome) on public.chat_widgets to authenticated;

create policy "Members read chat widgets" on public.chat_widgets for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));
create policy "Admins add chat widgets" on public.chat_widgets for insert to authenticated
  with check ((select private.is_workspace_admin(workspace_id)) and created_by = (select auth.uid()));
create policy "Admins edit chat widgets" on public.chat_widgets for update to authenticated
  using ((select private.is_workspace_admin(workspace_id)))
  with check ((select private.is_workspace_admin(workspace_id)));
create policy "Admins delete chat widgets" on public.chat_widgets for delete to authenticated
  using ((select private.is_workspace_admin(workspace_id)));

-- ---------------------------------------------------------------------------
-- conversations: what a website chat needs.
-- ---------------------------------------------------------------------------
alter table public.conversations
  add column widget_id uuid,
  -- sha256 of the random key the visitor's browser holds. The key itself is
  -- never stored.
  add column visitor_key_hash text check (visitor_key_hash is null or char_length(visitor_key_hash) = 64),
  -- True while a person has taken the conversation over, or the agent has
  -- handed it to one. The agent stays silent until it is handed back.
  add column agent_paused boolean not null default false,
  -- What the agent concluded, and why in a sentence or two.
  add column outcome text check (outcome is null or outcome in ('qualified', 'not_qualified', 'needs_human')),
  add column outcome_summary text check (outcome_summary is null or char_length(outcome_summary) <= 1000),
  add foreign key (widget_id, workspace_id)
    references public.chat_widgets (id, workspace_id) on delete set null (widget_id);
create index conversations_widget_idx
  on public.conversations (widget_id, workspace_id, created_at desc) where widget_id is not null;

-- ---------------------------------------------------------------------------
-- message_drafts: replies an agent wrote that wait for a person's yes
-- ("approve first"). Approving one turns it into a message; the draft stays
-- as the record of who decided. People read drafts here and decide through
-- approve_chat_draft / discard_chat_draft; only the server writes them.
-- ---------------------------------------------------------------------------
create table public.message_drafts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  conversation_id uuid not null,
  agent_id uuid,
  body text not null check (char_length(body) between 1 and 10000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'discarded')),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (conversation_id, workspace_id)
    references public.conversations (id, workspace_id) on delete cascade,
  foreign key (agent_id, workspace_id)
    references public.agents (id, workspace_id) on delete set null (agent_id)
);
alter table public.message_drafts enable row level security;
create index message_drafts_conversation_idx on public.message_drafts (conversation_id, workspace_id);
create index message_drafts_waiting_idx on public.message_drafts (workspace_id, status, created_at desc);
create index message_drafts_agent_idx on public.message_drafts (agent_id, workspace_id) where agent_id is not null;
create index message_drafts_decided_by_idx on public.message_drafts (decided_by) where decided_by is not null;
-- One draft waiting per conversation: a newer one replaces it.
create unique index message_drafts_one_pending_idx
  on public.message_drafts (conversation_id) where status = 'pending';

revoke all on public.message_drafts from anon, authenticated;
grant all on public.message_drafts to service_role;
grant select on public.message_drafts to authenticated;

create policy "Members read drafts" on public.message_drafts for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));

-- ---------------------------------------------------------------------------
-- Visitors' side
-- ---------------------------------------------------------------------------

create function private.chat_key_hash(p_key text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(coalesce(p_key, ''), 'UTF8')), 'hex');
$$;
revoke all on function private.chat_key_hash(text) from public;

-- What the widget shows before anyone has typed. Null for an unknown or
-- switched-off widget.
create function public.chat_widget_info(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('title', w.title, 'welcome', w.welcome)
  from public.chat_widgets w
  where w.token = p_token and w.enabled;
$$;

-- A visitor's first message: a lead, a chat conversation waiting for the
-- team, the message and a feed event, all in the widget's workspace. Returns
-- the conversation's id and the key the visitor's browser must send from now
-- on. The brake: 20 new chats a minute and 1,000 a day per widget (DV429).
create function public.chat_start(p_token text, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_widget public.chat_widgets%rowtype;
  v_body text := btrim(coalesce(p_body, ''));
  v_key text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_lead_id uuid;
  v_conversation_id uuid;
  v_message_id uuid;
begin
  select * into v_widget from public.chat_widgets w where w.token = p_token and w.enabled;
  if not found then
    return null;
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 2000 then
    raise exception 'a message must be 1 to 2000 characters' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_widget.id::text, 0));
  if (
    select count(*) from public.conversations c
    where c.widget_id = v_widget.id and c.workspace_id = v_widget.workspace_id
      and c.created_at > now() - interval '1 minute'
  ) >= 20 or (
    select count(*) from public.conversations c
    where c.widget_id = v_widget.id and c.workspace_id = v_widget.workspace_id
      and c.created_at > now() - interval '1 day'
  ) >= 1000 then
    raise exception 'too many new chats on this widget' using errcode = 'DV429';
  end if;

  insert into public.leads (workspace_id, name, source)
  values (v_widget.workspace_id, 'Website visitor', left('chat: ' || v_widget.name, 80))
  returning id into v_lead_id;

  insert into public.conversations
    (workspace_id, lead_id, channel, status, last_message_at, widget_id, visitor_key_hash)
  values (
    v_widget.workspace_id, v_lead_id, 'chat', 'waiting_for_you', now(),
    v_widget.id, private.chat_key_hash(v_key)
  )
  returning id into v_conversation_id;

  insert into public.messages
    (workspace_id, conversation_id, direction, author, body, delivery_status, metadata)
  values (
    v_widget.workspace_id, v_conversation_id, 'in', 'lead', v_body, 'received',
    jsonb_build_object('via', 'chat', 'widget_id', v_widget.id)
  )
  returning id into v_message_id;

  insert into public.activity_events (workspace_id, lead_id, kind, summary, channel, metadata)
  values (
    v_widget.workspace_id, v_lead_id, 'chat_started',
    'New chat on "' || v_widget.name || '"', 'chat',
    jsonb_build_object('widget_id', v_widget.id, 'conversation_id', v_conversation_id)
  );

  return jsonb_build_object(
    'conversation_id', v_conversation_id,
    'visitor_key', v_key,
    'message_id', v_message_id
  );
end;
$$;

-- A later message in the same chat. Null when the token, conversation and
-- key don't all match. Brakes: 2,000 characters; 60 visitor messages per
-- conversation (DV413); 10 a minute per conversation and 120 a minute per
-- workspace (DV429).
create function public.chat_post(
  p_token text,
  p_conversation_id uuid,
  p_visitor_key text,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conv public.conversations%rowtype;
  v_body text := btrim(coalesce(p_body, ''));
  v_message_id uuid;
begin
  select c.* into v_conv
  from public.conversations c
  join public.chat_widgets w on w.id = c.widget_id and w.workspace_id = c.workspace_id
  where w.token = p_token and w.enabled
    and c.id = p_conversation_id
    and c.visitor_key_hash = private.chat_key_hash(p_visitor_key)
  for update of c;
  if not found then
    return null;
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 2000 then
    raise exception 'a message must be 1 to 2000 characters' using errcode = '22023';
  end if;

  if (
    select count(*) from public.messages m
    where m.conversation_id = v_conv.id and m.workspace_id = v_conv.workspace_id
      and m.direction = 'in'
  ) >= 60 then
    raise exception 'this chat has reached its length limit' using errcode = 'DV413';
  end if;
  if (
    select count(*) from public.messages m
    where m.conversation_id = v_conv.id and m.workspace_id = v_conv.workspace_id
      and m.direction = 'in' and m.sent_at > now() - interval '1 minute'
  ) >= 10 or (
    select count(*) from public.messages m
    where m.workspace_id = v_conv.workspace_id
      and m.sent_at > now() - interval '1 minute'
      and m.direction = 'in' and m.metadata ->> 'via' = 'chat'
  ) >= 120 then
    raise exception 'too many messages' using errcode = 'DV429';
  end if;

  insert into public.messages
    (workspace_id, conversation_id, direction, author, body, delivery_status, metadata)
  values (
    v_conv.workspace_id, v_conv.id, 'in', 'lead', v_body, 'received',
    jsonb_build_object('via', 'chat', 'widget_id', v_conv.widget_id)
  )
  returning id into v_message_id;

  -- It waits for the team until someone (or the agent) answers.
  update public.conversations c
  set status = 'waiting_for_you', last_message_at = now()
  where c.id = v_conv.id;

  return jsonb_build_object('message_id', v_message_id);
end;
$$;

-- What the visitor's browser shows: their own messages and the replies that
-- were actually sent (never drafts). `state` says who they are talking to:
-- 'open', 'review' (a reply is waiting for a person's yes), 'team' (a person
-- has it) or 'closed'.
create function public.chat_poll(p_token text, p_conversation_id uuid, p_visitor_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_conv public.conversations%rowtype;
begin
  select c.* into v_conv
  from public.conversations c
  join public.chat_widgets w on w.id = c.widget_id and w.workspace_id = c.workspace_id
  where w.token = p_token and w.enabled
    and c.id = p_conversation_id
    and c.visitor_key_hash = private.chat_key_hash(p_visitor_key);
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'state', case
      when v_conv.status = 'closed' then 'closed'
      when v_conv.agent_paused then 'team'
      when exists (
        select 1 from public.message_drafts d
        where d.conversation_id = v_conv.id and d.status = 'pending'
      ) then 'review'
      else 'open'
    end,
    'messages', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', t.id,
          'from', case t.author when 'lead' then 'visitor' when 'agent' then 'agent' else 'team' end,
          'body', t.body,
          'sent_at', t.sent_at
        ) order by t.sent_at, t.created_at, t.id
      )
      from (
        select m.id, m.author, m.body, m.sent_at, m.created_at
        from public.messages m
        where m.conversation_id = v_conv.id and m.workspace_id = v_conv.workspace_id
          and (m.direction = 'in' or m.delivery_status in ('sent', 'delivered'))
        order by m.sent_at desc, m.created_at desc
        limit 200
      ) t
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Teammates' side
-- ---------------------------------------------------------------------------

-- A person answers in a website chat. The visitor sees it, and the agent
-- goes quiet on this conversation until it is handed back.
create function public.send_chat_reply(p_conversation_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_conv public.conversations%rowtype;
  v_body text := btrim(coalesce(p_body, ''));
  v_message_id uuid;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  select c.* into v_conv from public.conversations c
  where c.id = p_conversation_id
    and (select private.is_workspace_member(c.workspace_id))
  for update;
  if not found then
    raise exception 'conversation not found' using errcode = 'P0002';
  end if;
  if v_conv.channel <> 'chat' or v_conv.widget_id is null then
    raise exception 'not a website chat' using errcode = '22023';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 10000 then
    raise exception 'a reply must be 1 to 10000 characters' using errcode = '22023';
  end if;

  insert into public.messages
    (workspace_id, conversation_id, direction, author, author_user_id, body, delivery_status, metadata)
  values (
    v_conv.workspace_id, v_conv.id, 'out', 'user', v_user, v_body, 'sent',
    jsonb_build_object('via', 'chat')
  )
  returning id into v_message_id;

  update public.message_drafts d
  set status = 'discarded', decided_by = v_user, decided_at = now()
  where d.conversation_id = v_conv.id and d.status = 'pending';

  update public.conversations c
  set agent_paused = true,
      status = 'open',
      last_message_at = now(),
      assigned_to = coalesce(c.assigned_to, v_user)
  where c.id = v_conv.id;

  insert into public.activity_events (workspace_id, lead_id, actor_id, kind, summary, channel, metadata)
  values (
    v_conv.workspace_id, v_conv.lead_id, v_user, 'chat_reply',
    case when v_conv.agent_paused
      then 'Replied in the website chat'
      else 'Replied in the website chat and took the conversation over from the agent'
    end,
    'chat', jsonb_build_object('conversation_id', v_conv.id)
  );
  return v_message_id;
end;
$$;

-- Approve & send a draft, as written or with the person's edits.
create function public.approve_chat_draft(p_draft_id uuid, p_body text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_draft public.message_drafts%rowtype;
  v_conv public.conversations%rowtype;
  v_body text;
  v_message_id uuid;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  select d.* into v_draft from public.message_drafts d
  where d.id = p_draft_id and d.status = 'pending'
    and (select private.is_workspace_member(d.workspace_id))
  for update;
  if not found then
    raise exception 'draft not found' using errcode = 'P0002';
  end if;
  v_body := coalesce(nullif(btrim(coalesce(p_body, '')), ''), v_draft.body);
  if char_length(v_body) > 10000 then
    raise exception 'a reply must be 1 to 10000 characters' using errcode = '22023';
  end if;
  select c.* into v_conv from public.conversations c
  where c.id = v_draft.conversation_id and c.workspace_id = v_draft.workspace_id
  for update;

  insert into public.messages
    (workspace_id, conversation_id, direction, author, body, delivery_status, metadata)
  values (
    v_draft.workspace_id, v_draft.conversation_id, 'out', 'agent', v_body, 'sent',
    jsonb_build_object(
      'via', 'chat', 'agent_id', v_draft.agent_id, 'draft_id', v_draft.id,
      'approved_by', v_user, 'edited', v_body is distinct from v_draft.body
    )
  )
  returning id into v_message_id;

  update public.message_drafts d
  set status = 'approved', decided_by = v_user, decided_at = now()
  where d.id = v_draft.id;

  update public.conversations c
  set status = case when c.agent_paused then c.status else 'open' end,
      last_message_at = now()
  where c.id = v_conv.id;

  insert into public.activity_events (workspace_id, lead_id, actor_id, kind, summary, channel, metadata)
  values (
    v_draft.workspace_id, v_conv.lead_id, v_user, 'draft_approved',
    case when v_body is distinct from v_draft.body
      then 'Edited and sent the agent''s draft reply'
      else 'Approved and sent the agent''s draft reply'
    end,
    'chat', jsonb_build_object('conversation_id', v_conv.id, 'draft_id', v_draft.id)
  );
  return v_message_id;
end;
$$;

-- Throw a draft away. The conversation keeps waiting for a person.
create function public.discard_chat_draft(p_draft_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_draft public.message_drafts%rowtype;
  v_lead_id uuid;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  select d.* into v_draft from public.message_drafts d
  where d.id = p_draft_id and d.status = 'pending'
    and (select private.is_workspace_member(d.workspace_id))
  for update;
  if not found then
    raise exception 'draft not found' using errcode = 'P0002';
  end if;
  update public.message_drafts d
  set status = 'discarded', decided_by = v_user, decided_at = now()
  where d.id = v_draft.id;

  select c.lead_id into v_lead_id from public.conversations c
  where c.id = v_draft.conversation_id and c.workspace_id = v_draft.workspace_id;
  insert into public.activity_events (workspace_id, lead_id, actor_id, kind, summary, channel, metadata)
  values (
    v_draft.workspace_id, v_lead_id, v_user, 'draft_discarded',
    'Discarded the agent''s draft reply', 'chat',
    jsonb_build_object('conversation_id', v_draft.conversation_id, 'draft_id', v_draft.id)
  );
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- The server's side (secret key only)
-- ---------------------------------------------------------------------------

-- Everything the agent needs to write one reply, for one conversation of the
-- workspace behind the widget token: the agent that would answer (the
-- switched-on inbound chat agent, if there is one), the workspace's ready
-- knowledge, and the conversation so far. Null when token and conversation
-- don't match.
create function public.chat_agent_context(p_token text, p_conversation_id uuid)
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
    'workspace', jsonb_build_object('name', v_ws.name, 'website', v_ws.website),
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
    -- Replies the agent wrote in the last day, sent or drafted: the
    -- workspace's daily cap is counted against this.
    'replies_today', (
      select count(*) from public.messages m
      where m.workspace_id = v_conv.workspace_id and m.author = 'agent'
        and m.sent_at > now() - interval '1 day'
        and not (m.metadata ? 'draft_id')
    ) + (
      select count(*) from public.message_drafts d
      where d.workspace_id = v_conv.workspace_id
        and d.created_at > now() - interval '1 day'
    ),
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

-- Stores what the agent decided for one visitor message, in one transaction.
--
-- p_result: { reply, outcome: none|qualified|not_qualified|needs_human,
--             summary, handoff, stop_contact, visitor_name, visitor_email,
--             model }
--
-- It re-checks everything under a lock on the conversation, so a late or
-- repeated call can't send twice or talk over a person:
--   'stale'   a newer visitor message has arrived (its own run will answer);
--   'paused'  a person has the conversation;
--   'off'     the agent was switched off meanwhile;
--   'sent'    the reply went to the visitor (agent on "send on its own");
--   'draft'   the reply waits for a person's yes (agent on "ask me first");
--   'silent'  nothing to say (a handoff with no reply).
create function public.chat_agent_commit(
  p_token text,
  p_conversation_id uuid,
  p_in_reply_to uuid,
  p_result jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conv public.conversations%rowtype;
  v_agent public.agents%rowtype;
  v_lead public.leads%rowtype;
  v_latest uuid;
  v_reply text := left(btrim(coalesce(p_result ->> 'reply', '')), 4000);
  v_outcome text := coalesce(p_result ->> 'outcome', 'none');
  v_summary text := left(btrim(coalesce(p_result ->> 'summary', '')), 1000);
  v_stop boolean := coalesce((p_result ->> 'stop_contact')::boolean, false);
  v_handoff boolean := coalesce((p_result ->> 'handoff')::boolean, false);
  v_name text := nullif(left(btrim(coalesce(p_result ->> 'visitor_name', '')), 200), '');
  v_email text := nullif(lower(btrim(coalesce(p_result ->> 'visitor_email', ''))), '');
  v_status text;
  v_had_draft boolean;
begin
  select c.* into v_conv
  from public.conversations c
  join public.chat_widgets w on w.id = c.widget_id and w.workspace_id = c.workspace_id
  where w.token = p_token and w.enabled and c.id = p_conversation_id
  for update of c;
  if not found then
    return null;
  end if;
  if v_outcome not in ('none', 'qualified', 'not_qualified', 'needs_human') then
    raise exception 'unknown outcome' using errcode = '22023';
  end if;

  select m.id into v_latest from public.messages m
  where m.conversation_id = v_conv.id and m.workspace_id = v_conv.workspace_id
    and m.direction = 'in'
  order by m.sent_at desc, m.created_at desc
  limit 1;
  if v_latest is distinct from p_in_reply_to then
    return jsonb_build_object('status', 'stale');
  end if;
  if v_conv.agent_paused then
    return jsonb_build_object('status', 'paused');
  end if;
  select a.* into v_agent from public.agents a
  where a.workspace_id = v_conv.workspace_id
    and a.role = 'inbound' and a.channel = 'chat' and a.enabled
  order by a.created_at
  limit 1;
  if not found then
    return jsonb_build_object('status', 'off');
  end if;

  v_handoff := v_handoff or v_stop or v_outcome = 'needs_human';
  select l.* into v_lead from public.leads l
  where l.id = v_conv.lead_id and l.workspace_id = v_conv.workspace_id
  for update;

  -- What the visitor told us about themselves. A name replaces only the
  -- placeholder; an address is only taken if no other lead already has it.
  if v_name is not null and v_lead.name in ('', 'Website visitor') then
    update public.leads l set name = v_name where l.id = v_lead.id;
  end if;
  if v_email is not null and v_lead.email is null
     and char_length(v_email) <= 254
     and v_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$' then
    if exists (
      select 1 from public.leads o
      where o.workspace_id = v_conv.workspace_id and o.email = v_email
    ) then
      update public.leads l
      set custom_fields = l.custom_fields || jsonb_build_object('chat_email', v_email)
      where l.id = v_lead.id;
    else
      update public.leads l set email = v_email where l.id = v_lead.id;
    end if;
  end if;

  -- The outcome, once per change.
  if v_outcome <> 'none' and v_outcome is distinct from v_conv.outcome then
    update public.conversations c
    set outcome = v_outcome, outcome_summary = nullif(v_summary, '')
    where c.id = v_conv.id;
    update public.leads l
    set custom_fields = l.custom_fields || jsonb_build_object(
      'qualification', jsonb_build_object(
        'outcome', v_outcome, 'summary', v_summary, 'at', now(),
        'conversation_id', v_conv.id, 'agent_id', v_agent.id
      )
    )
    where l.id = v_lead.id;
    if v_outcome = 'qualified' and v_lead.status in ('new', 'engaged') then
      update public.leads l set status = 'qualified' where l.id = v_lead.id;
      insert into public.activity_events (workspace_id, lead_id, agent_id, kind, summary, channel, metadata)
      values (
        v_conv.workspace_id, v_lead.id, v_agent.id, 'lead_status_changed',
        left('Qualified in the website chat' || case when v_summary <> '' then ': ' || v_summary else '' end, 5000),
        'chat',
        jsonb_build_object('from', v_lead.status, 'to', 'qualified', 'conversation_id', v_conv.id)
      );
    elsif v_outcome = 'not_qualified' then
      insert into public.activity_events (workspace_id, lead_id, agent_id, kind, summary, channel, metadata)
      values (
        v_conv.workspace_id, v_lead.id, v_agent.id, 'lead_not_qualified',
        left('Not a fit, from the website chat' || case when v_summary <> '' then ': ' || v_summary else '' end, 5000),
        'chat', jsonb_build_object('conversation_id', v_conv.id)
      );
    end if;
  end if;

  if v_stop and not v_lead.do_not_contact then
    update public.leads l
    set do_not_contact = true, do_not_contact_at = now()
    where l.id = v_lead.id;
    insert into public.activity_events (workspace_id, lead_id, agent_id, kind, summary, channel, metadata)
    values (
      v_conv.workspace_id, v_lead.id, v_agent.id, 'do_not_contact',
      'Asked in the website chat not to be contacted. Marked do not contact.',
      'chat', jsonb_build_object('conversation_id', v_conv.id)
    );
  end if;

  if v_handoff then
    insert into public.activity_events (workspace_id, lead_id, agent_id, kind, summary, channel, metadata)
    values (
      v_conv.workspace_id, v_lead.id, v_agent.id, 'handoff_requested',
      left('The agent handed the website chat to the team' || case when v_summary <> '' then ': ' || v_summary else '' end, 5000),
      'chat', jsonb_build_object('conversation_id', v_conv.id)
    );
  end if;

  if v_reply = '' then
    v_status := 'silent';
  elsif v_agent.approval_mode = 'auto' then
    insert into public.messages
      (workspace_id, conversation_id, direction, author, body, delivery_status, metadata)
    values (
      v_conv.workspace_id, v_conv.id, 'out', 'agent', v_reply, 'sent',
      jsonb_build_object('via', 'chat', 'agent_id', v_agent.id, 'model', p_result ->> 'model')
    );
    v_status := 'sent';
  else
    update public.message_drafts d
    set status = 'discarded', decided_at = now()
    where d.conversation_id = v_conv.id and d.status = 'pending';
    v_had_draft := found;
    insert into public.message_drafts (workspace_id, conversation_id, agent_id, body)
    values (v_conv.workspace_id, v_conv.id, v_agent.id, v_reply);
    if not v_had_draft then
      insert into public.activity_events (workspace_id, lead_id, agent_id, kind, summary, channel, metadata)
      values (
        v_conv.workspace_id, v_lead.id, v_agent.id, 'draft_waiting',
        'A draft reply in the website chat is waiting for your approval',
        'chat', jsonb_build_object('conversation_id', v_conv.id)
      );
    end if;
    v_status := 'draft';
  end if;

  update public.conversations c
  set agent_paused = c.agent_paused or v_handoff,
      status = case when v_status = 'sent' and not v_handoff then 'open' else 'waiting_for_you' end,
      last_message_at = case when v_status = 'sent' then now() else c.last_message_at end
  where c.id = v_conv.id;

  return jsonb_build_object('status', v_status, 'handoff', v_handoff);
end;
$$;

revoke all on function public.chat_widget_info(text) from public, authenticated;
revoke all on function public.chat_start(text, text) from public, authenticated;
revoke all on function public.chat_post(text, uuid, text, text) from public, authenticated;
revoke all on function public.chat_poll(text, uuid, text) from public, authenticated;
grant execute on function public.chat_widget_info(text) to anon, service_role;
grant execute on function public.chat_start(text, text) to anon, service_role;
grant execute on function public.chat_post(text, uuid, text, text) to anon, service_role;
grant execute on function public.chat_poll(text, uuid, text) to anon, service_role;

revoke all on function public.send_chat_reply(uuid, text) from public, anon;
revoke all on function public.approve_chat_draft(uuid, text) from public, anon;
revoke all on function public.discard_chat_draft(uuid) from public, anon;
grant execute on function public.send_chat_reply(uuid, text) to authenticated;
grant execute on function public.approve_chat_draft(uuid, text) to authenticated;
grant execute on function public.discard_chat_draft(uuid) to authenticated;

revoke all on function public.chat_agent_context(text, uuid) from public, anon, authenticated;
revoke all on function public.chat_agent_commit(text, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.chat_agent_context(text, uuid) to service_role;
grant execute on function public.chat_agent_commit(text, uuid, uuid, jsonb) to service_role;
