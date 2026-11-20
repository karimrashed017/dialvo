-- Slice 1, part 2: leads, the conversations with them and every message.

-- Lets child tables reference a member of the same workspace.
-- (workspace_members' primary key is already (workspace_id, user_id).)

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null default '' check (char_length(name) <= 200),
  email text check (email is null or (email = lower(email) and char_length(email) between 3 and 254)),
  phone text check (phone is null or char_length(phone) between 3 and 40),
  company text check (company is null or char_length(company) <= 200),
  website text check (website is null or char_length(website) <= 300),
  source text not null default 'manual' check (char_length(source) <= 80),
  status text not null default 'new' check (
    status in ('new', 'engaged', 'qualified', 'meeting_booked', 'won', 'lost', 'unsubscribed')
  ),
  owner_id uuid,
  -- Consent per channel: whether, when and where it was given.
  consent_call boolean not null default false,
  consent_call_at timestamptz,
  consent_call_source text check (consent_call_source is null or char_length(consent_call_source) <= 120),
  consent_sms boolean not null default false,
  consent_sms_at timestamptz,
  consent_sms_source text check (consent_sms_source is null or char_length(consent_sms_source) <= 120),
  consent_whatsapp boolean not null default false,
  consent_whatsapp_at timestamptz,
  consent_whatsapp_source text check (consent_whatsapp_source is null or char_length(consent_whatsapp_source) <= 120),
  consent_email boolean not null default false,
  consent_email_at timestamptz,
  consent_email_source text check (consent_email_source is null or char_length(consent_email_source) <= 120),
  do_not_contact boolean not null default false,
  do_not_contact_at timestamptz,
  custom_fields jsonb not null default '{}'::jsonb check (jsonb_typeof(custom_fields) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (workspace_id, owner_id)
    references public.workspace_members (workspace_id, user_id)
    on delete set null (owner_id)
);
alter table public.leads enable row level security;
-- One lead per email address in a workspace: imports and the capture form
-- rely on it to avoid duplicates.
create unique index leads_workspace_email_idx on public.leads (workspace_id, email) where email is not null;
create index leads_workspace_phone_idx on public.leads (workspace_id, phone) where phone is not null;
create index leads_workspace_status_idx on public.leads (workspace_id, status);
create index leads_workspace_created_idx on public.leads (workspace_id, created_at desc);
create index leads_owner_idx on public.leads (workspace_id, owner_id) where owner_id is not null;

create trigger leads_set_updated_at
  before update on public.leads
  for each row execute function private.set_updated_at();

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  lead_id uuid not null,
  channel text not null check (channel in ('voice', 'email', 'chat', 'social', 'sms', 'whatsapp')),
  status text not null default 'open' check (status in ('open', 'waiting_for_you', 'closed')),
  assigned_to uuid,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (lead_id, workspace_id)
    references public.leads (id, workspace_id) on delete cascade,
  foreign key (workspace_id, assigned_to)
    references public.workspace_members (workspace_id, user_id)
    on delete set null (assigned_to)
);
alter table public.conversations enable row level security;
create index conversations_lead_idx on public.conversations (lead_id, workspace_id);
create index conversations_inbox_idx
  on public.conversations (workspace_id, status, last_message_at desc nulls last);
create index conversations_assigned_idx
  on public.conversations (workspace_id, assigned_to) where assigned_to is not null;

create trigger conversations_set_updated_at
  before update on public.conversations
  for each row execute function private.set_updated_at();

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  conversation_id uuid not null,
  direction text not null check (direction in ('in', 'out')),
  author text not null check (author in ('agent', 'user', 'lead')),
  -- The teammate who wrote it, when author = 'user'.
  author_user_id uuid references auth.users (id) on delete set null,
  body text not null check (char_length(body) between 1 and 20000),
  -- What happened to an outgoing message. Until a channel is connected,
  -- replies are stored and honestly marked 'not_delivered'.
  delivery_status text not null default 'not_delivered' check (
    delivery_status in ('received', 'not_delivered', 'queued', 'sent', 'delivered', 'failed')
  ),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  foreign key (conversation_id, workspace_id)
    references public.conversations (id, workspace_id) on delete cascade,
  check ((direction = 'in') = (author = 'lead'))
);
alter table public.messages enable row level security;
create index messages_conversation_idx on public.messages (conversation_id, workspace_id, sent_at);
create index messages_workspace_sent_idx on public.messages (workspace_id, sent_at desc);
create index messages_author_user_idx on public.messages (author_user_id) where author_user_id is not null;

revoke all on public.leads, public.conversations, public.messages from anon, authenticated;
grant all on public.leads, public.conversations, public.messages to service_role;
grant select, insert, update, delete on public.leads to authenticated;
grant select, insert, update, delete on public.conversations to authenticated;
-- Messages are a record: people add to it, nobody rewrites it.
grant select, insert on public.messages to authenticated;

create policy "Members read leads" on public.leads for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));
create policy "Members add leads" on public.leads for insert to authenticated
  with check ((select private.is_workspace_member(workspace_id)));
create policy "Members edit leads" on public.leads for update to authenticated
  using ((select private.is_workspace_member(workspace_id)))
  with check ((select private.is_workspace_member(workspace_id)));
create policy "Members delete leads" on public.leads for delete to authenticated
  using ((select private.is_workspace_member(workspace_id)));

create policy "Members read conversations" on public.conversations for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));
create policy "Members add conversations" on public.conversations for insert to authenticated
  with check ((select private.is_workspace_member(workspace_id)));
create policy "Members edit conversations" on public.conversations for update to authenticated
  using ((select private.is_workspace_member(workspace_id)))
  with check ((select private.is_workspace_member(workspace_id)));
create policy "Members delete conversations" on public.conversations for delete to authenticated
  using ((select private.is_workspace_member(workspace_id)));

create policy "Members read messages" on public.messages for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));
-- A person can only write as themselves, and never as the lead or an agent.
create policy "Members write their own replies" on public.messages for insert to authenticated
  with check (
    (select private.is_workspace_member(workspace_id))
    and direction = 'out'
    and author = 'user'
    and author_user_id = (select auth.uid())
    and delivery_status = 'not_delivered'
  );
