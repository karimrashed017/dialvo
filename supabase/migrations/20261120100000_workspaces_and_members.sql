-- Slice 1, part 1: people, workspaces and who belongs to which.
--
-- Rules every table in this schema follows:
--   * row-level security is switched on in the migration that creates it;
--   * policies decide by workspace membership, through the helper functions
--     in the `private` schema (security definer, empty search_path), and wrap
--     auth.uid() and the helpers in (select ...) so Postgres runs them once
--     per statement instead of once per row;
--   * the anon role gets no table access at all. The one thing it may do is
--     call public.capture_lead(), the public lead form's write;
--   * child tables point at their parent with (parent_id, workspace_id), so a
--     row can never hang off another workspace's parent.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Shared trigger: keep updated_at honest.
-- ---------------------------------------------------------------------------
create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles: one row per auth user (name and picture).
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null default '' check (char_length(name) <= 120),
  avatar_url text check (avatar_url is null or char_length(avatar_url) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- workspaces
-- ---------------------------------------------------------------------------
create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  plan text not null default 'starter' check (plan in ('starter', 'pro', 'scale')),
  timezone text not null default 'UTC' check (char_length(timezone) <= 64),
  website text check (website is null or char_length(website) <= 300),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.workspaces enable row level security;
create index workspaces_created_by_idx on public.workspaces (created_by);

create trigger workspaces_set_updated_at
  before update on public.workspaces
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- workspace_members
-- ---------------------------------------------------------------------------
create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
alter table public.workspace_members enable row level security;
-- "Which workspaces am I in?" is asked on every request.
create index workspace_members_user_id_idx on public.workspace_members (user_id);

-- ---------------------------------------------------------------------------
-- Membership helpers. Security definer so a policy on workspace_members can
-- ask about workspace_members without recursing into itself.
-- ---------------------------------------------------------------------------
create function private.is_workspace_member(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = (select auth.uid())
  );
$$;

create function private.is_workspace_admin(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws
      and m.user_id = (select auth.uid())
      and m.role in ('owner', 'admin')
  );
$$;

create function private.shares_workspace_with(other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members mine
    join public.workspace_members theirs using (workspace_id)
    where mine.user_id = (select auth.uid()) and theirs.user_id = other
  );
$$;

revoke all on function private.set_updated_at() from public;
revoke all on function private.is_workspace_member(uuid) from public;
revoke all on function private.is_workspace_admin(uuid) from public;
revoke all on function private.shares_workspace_with(uuid) from public;
grant execute on function private.is_workspace_member(uuid) to authenticated, service_role;
grant execute on function private.is_workspace_admin(uuid) to authenticated, service_role;
grant execute on function private.shares_workspace_with(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- invitations: an admin invites an email address. Sending the email comes in a
-- later slice; until then the invited person sees the invitation after signing
-- up with that address (public.my_invitations) and accepts it there.
-- ---------------------------------------------------------------------------
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email text not null check (email = lower(email) and char_length(email) between 3 and 254),
  role text not null default 'member' check (role in ('admin', 'member')),
  token text not null unique
    default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz
);
alter table public.invitations enable row level security;
create index invitations_workspace_id_idx on public.invitations (workspace_id);
create index invitations_email_idx on public.invitations (email) where status = 'pending';
create index invitations_invited_by_idx on public.invitations (invited_by);
-- One open invitation per address per workspace.
create unique index invitations_one_pending_idx
  on public.invitations (workspace_id, email) where status = 'pending';

-- ---------------------------------------------------------------------------
-- Grants. Nothing for anon. Signed-in people get only the columns they may
-- change: the plan, the slug and who created a workspace are not theirs to
-- edit, and a membership row's only editable column is the role.
-- ---------------------------------------------------------------------------
revoke all on public.profiles, public.workspaces, public.workspace_members, public.invitations
  from anon, authenticated;
grant all on public.profiles, public.workspaces, public.workspace_members, public.invitations
  to service_role;

grant select on public.profiles to authenticated;
grant update (name, avatar_url) on public.profiles to authenticated;

grant select on public.workspaces to authenticated;
grant update (name, timezone, website) on public.workspaces to authenticated;

grant select, delete on public.workspace_members to authenticated;
grant update (role) on public.workspace_members to authenticated;

grant select, delete on public.invitations to authenticated;
grant insert (workspace_id, email, role, invited_by) on public.invitations to authenticated;
grant update (status) on public.invitations to authenticated;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------
create policy "People see themselves and their teammates"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select private.shares_workspace_with(id)));

create policy "People edit their own profile"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy "Members see their workspaces"
  on public.workspaces for select to authenticated
  using ((select private.is_workspace_member(id)));

create policy "Admins edit their workspace"
  on public.workspaces for update to authenticated
  using ((select private.is_workspace_admin(id)))
  with check ((select private.is_workspace_admin(id)));

create policy "Members see who is in their workspaces"
  on public.workspace_members for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));

-- Nobody inserts a membership directly: public.create_workspace() and
-- public.accept_invitation() do it. An admin may move someone else between
-- admin and member. Nobody changes their own role, and the owner role is
-- never handed out or taken away here.
create policy "Admins change other people's roles, never to or from owner"
  on public.workspace_members for update to authenticated
  using (
    (select private.is_workspace_admin(workspace_id))
    and user_id <> (select auth.uid())
    and role <> 'owner'
  )
  with check (
    (select private.is_workspace_admin(workspace_id))
    and user_id <> (select auth.uid())
    and role in ('admin', 'member')
  );

create policy "Admins remove people; anyone but the owner can leave"
  on public.workspace_members for delete to authenticated
  using (
    role <> 'owner'
    and (
      user_id = (select auth.uid())
      or (select private.is_workspace_admin(workspace_id))
    )
  );

create policy "Admins see invitations"
  on public.invitations for select to authenticated
  using ((select private.is_workspace_admin(workspace_id)));

create policy "Admins invite"
  on public.invitations for insert to authenticated
  with check (
    (select private.is_workspace_admin(workspace_id))
    and invited_by = (select auth.uid())
  );

create policy "Admins revoke invitations"
  on public.invitations for update to authenticated
  using ((select private.is_workspace_admin(workspace_id)) and status = 'pending')
  with check ((select private.is_workspace_admin(workspace_id)) and status = 'revoked');

create policy "Admins delete invitations"
  on public.invitations for delete to authenticated
  using ((select private.is_workspace_admin(workspace_id)));

-- ---------------------------------------------------------------------------
-- A profile for every new auth user.
-- ---------------------------------------------------------------------------
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, name)
  values (new.id, left(coalesce(new.raw_user_meta_data ->> 'name', ''), 120))
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke all on function private.handle_new_user() from public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();
