-- Slice 1, part 3: the agents' settings and what they know.

create table public.agents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  role text not null check (role in ('inbound', 'outbound', 'closing', 'expansion')),
  channel text not null check (channel in ('voice', 'email', 'chat', 'social', 'sms', 'whatsapp')),
  instructions text not null default '' check (char_length(instructions) <= 20000),
  voice text check (voice is null or char_length(voice) <= 80),
  enabled boolean not null default false,
  -- New agents ask before they send.
  approval_mode text not null default 'approve_first' check (approval_mode in ('auto', 'approve_first')),
  -- { "days": [1,2,3,4,5], "start": "09:00", "end": "17:00" } in the
  -- workspace's time zone; days are 1 (Monday) to 7 (Sunday).
  send_window jsonb not null
    default '{"days": [1, 2, 3, 4, 5], "start": "09:00", "end": "17:00"}'::jsonb
    check (jsonb_typeof(send_window) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id)
);
alter table public.agents enable row level security;
create index agents_workspace_idx on public.agents (workspace_id, role);

create trigger agents_set_updated_at
  before update on public.agents
  for each row execute function private.set_updated_at();

create table public.knowledge_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  kind text not null check (kind in ('text', 'url', 'file')),
  -- The text itself, or the address for kind = 'url'.
  content text not null default '' check (char_length(content) <= 100000),
  -- 'ready': usable as is. 'not_fetched': a URL or file whose contents
  -- haven't been read yet. 'processing' and 'failed' are for later slices.
  status text not null default 'ready' check (status in ('ready', 'not_fetched', 'processing', 'failed')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id)
);
alter table public.knowledge_items enable row level security;
create index knowledge_items_workspace_idx on public.knowledge_items (workspace_id, created_at desc);
create index knowledge_items_created_by_idx on public.knowledge_items (created_by);

create trigger knowledge_items_set_updated_at
  before update on public.knowledge_items
  for each row execute function private.set_updated_at();

revoke all on public.agents, public.knowledge_items from anon, authenticated;
grant all on public.agents, public.knowledge_items to service_role;
grant select, insert, delete on public.agents to authenticated;
grant update (name, channel, instructions, voice, enabled, approval_mode, send_window)
  on public.agents to authenticated;
grant select, insert, delete on public.knowledge_items to authenticated;
grant update (title, content, status) on public.knowledge_items to authenticated;

create policy "Members read agents" on public.agents for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));
create policy "Admins add agents" on public.agents for insert to authenticated
  with check ((select private.is_workspace_admin(workspace_id)));
create policy "Admins edit agents" on public.agents for update to authenticated
  using ((select private.is_workspace_admin(workspace_id)))
  with check ((select private.is_workspace_admin(workspace_id)));
create policy "Admins delete agents" on public.agents for delete to authenticated
  using ((select private.is_workspace_admin(workspace_id)));

create policy "Members read knowledge" on public.knowledge_items for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));
create policy "Members add knowledge" on public.knowledge_items for insert to authenticated
  with check ((select private.is_workspace_member(workspace_id)));
create policy "Members edit knowledge" on public.knowledge_items for update to authenticated
  using ((select private.is_workspace_member(workspace_id)))
  with check ((select private.is_workspace_member(workspace_id)));
create policy "Members delete knowledge" on public.knowledge_items for delete to authenticated
  using ((select private.is_workspace_member(workspace_id)));
