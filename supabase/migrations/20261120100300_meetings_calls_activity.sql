-- Slice 1, part 4: meetings, calls and the activity feed.

create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  lead_id uuid not null,
  title text not null default '' check (char_length(title) <= 200),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  -- Who booked it: an agent, a teammate, or the lead themselves.
  booked_by text not null default 'user' check (booked_by in ('agent', 'user', 'lead')),
  agent_id uuid,
  -- The teammate whose calendar it is on.
  host_id uuid,
  channel text check (channel is null or channel in ('voice', 'email', 'chat', 'social', 'sms', 'whatsapp')),
  status text not null default 'scheduled' check (status in ('scheduled', 'completed', 'cancelled', 'no_show')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  check (ends_at > starts_at),
  foreign key (lead_id, workspace_id)
    references public.leads (id, workspace_id) on delete cascade,
  foreign key (agent_id, workspace_id)
    references public.agents (id, workspace_id) on delete set null (agent_id),
  foreign key (workspace_id, host_id)
    references public.workspace_members (workspace_id, user_id) on delete set null (host_id)
);
alter table public.meetings enable row level security;
create index meetings_workspace_starts_idx on public.meetings (workspace_id, starts_at);
create index meetings_workspace_created_idx on public.meetings (workspace_id, created_at desc);
create index meetings_lead_idx on public.meetings (lead_id, workspace_id);
create index meetings_agent_idx on public.meetings (agent_id, workspace_id) where agent_id is not null;
create index meetings_host_idx on public.meetings (workspace_id, host_id) where host_id is not null;

create trigger meetings_set_updated_at
  before update on public.meetings
  for each row execute function private.set_updated_at();

create table public.calls (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  lead_id uuid not null,
  conversation_id uuid,
  agent_id uuid,
  direction text not null check (direction in ('inbound', 'outbound')),
  status text not null default 'queued' check (
    status in ('queued', 'ringing', 'in_progress', 'completed', 'missed', 'voicemail', 'failed')
  ),
  started_at timestamptz,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  recording_url text check (recording_url is null or char_length(recording_url) <= 2000),
  -- [{ "t": seconds, "speaker": "agent" | "lead", "text": "..." }]
  transcript jsonb not null default '[]'::jsonb check (jsonb_typeof(transcript) = 'array'),
  summary text check (summary is null or char_length(summary) <= 5000),
  created_at timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (lead_id, workspace_id)
    references public.leads (id, workspace_id) on delete cascade,
  foreign key (conversation_id, workspace_id)
    references public.conversations (id, workspace_id) on delete set null (conversation_id),
  foreign key (agent_id, workspace_id)
    references public.agents (id, workspace_id) on delete set null (agent_id)
);
alter table public.calls enable row level security;
create index calls_workspace_started_idx on public.calls (workspace_id, started_at desc nulls last);
create index calls_lead_idx on public.calls (lead_id, workspace_id);
create index calls_conversation_idx on public.calls (conversation_id, workspace_id) where conversation_id is not null;
create index calls_agent_idx on public.calls (agent_id, workspace_id) where agent_id is not null;

create table public.activity_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  lead_id uuid,
  agent_id uuid,
  -- The teammate who did it, when a person did.
  actor_id uuid references auth.users (id) on delete set null,
  -- e.g. lead_created, lead_captured, lead_imported, lead_status_changed,
  -- note, do_not_contact, reply_saved, conversation_closed.
  kind text not null check (char_length(kind) between 1 and 60),
  summary text not null check (char_length(summary) between 1 and 5000),
  channel text check (channel is null or channel in ('voice', 'email', 'chat', 'social', 'sms', 'whatsapp')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  foreign key (lead_id, workspace_id)
    references public.leads (id, workspace_id) on delete cascade,
  foreign key (agent_id, workspace_id)
    references public.agents (id, workspace_id) on delete set null (agent_id)
);
alter table public.activity_events enable row level security;
create index activity_events_feed_idx on public.activity_events (workspace_id, created_at desc);
create index activity_events_kind_idx on public.activity_events (workspace_id, kind, created_at desc);
create index activity_events_lead_idx on public.activity_events (lead_id, workspace_id, created_at desc) where lead_id is not null;
create index activity_events_agent_idx on public.activity_events (agent_id, workspace_id) where agent_id is not null;
create index activity_events_actor_idx on public.activity_events (actor_id) where actor_id is not null;

revoke all on public.meetings, public.calls, public.activity_events from anon, authenticated;
grant all on public.meetings, public.calls, public.activity_events to service_role;
grant select, insert, update, delete on public.meetings to authenticated;
-- Calls are written by the server when the phone system reports them
-- (a later slice). People read them.
grant select on public.calls to authenticated;
-- The feed is a record: people add to it, nobody rewrites it.
grant select, insert on public.activity_events to authenticated;

create policy "Members read meetings" on public.meetings for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));
create policy "Members add meetings" on public.meetings for insert to authenticated
  with check ((select private.is_workspace_member(workspace_id)));
create policy "Members edit meetings" on public.meetings for update to authenticated
  using ((select private.is_workspace_member(workspace_id)))
  with check ((select private.is_workspace_member(workspace_id)));
create policy "Members delete meetings" on public.meetings for delete to authenticated
  using ((select private.is_workspace_member(workspace_id)));

create policy "Members read calls" on public.calls for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));

create policy "Members read activity" on public.activity_events for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));
-- People log what they did themselves, never on an agent's behalf.
create policy "Members log their own activity" on public.activity_events for insert to authenticated
  with check (
    (select private.is_workspace_member(workspace_id))
    and actor_id = (select auth.uid())
    and agent_id is null
  );
