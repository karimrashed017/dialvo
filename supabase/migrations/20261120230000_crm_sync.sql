-- CRM sync: a workspace connects its HubSpot or Pipedrive account, Dialvo
-- pushes its leads, conversations and meetings into it, and pulls the CRM's
-- contact emails and company domains (as hashes) so Dialvo never reaches out
-- to someone who is already in the CRM.
--
-- Everything here is additive. Four new tables:
--   crm_connections     one per workspace: which CRM, its state, the settings
--   crm_sync_jobs       the push queue: one row per thing to write to the CRM
--   crm_lead_links      a Dialvo lead's ids in the CRM (contact, company, deal)
--   crm_known_contacts  "already in your CRM": sha256 of lower-cased emails
--                       and domains, nothing else
--
-- The CRM token lives in Supabase Vault only, under the name
-- 'crm_token:<workspace id>'. It is written by crm_connect and read by
-- crm_credentials, both callable with the secret key only, and deleted by
-- crm_disconnect. No table holds it and nothing returns it to a browser.
--
-- Who writes what:
--   admins (signed in): the settings columns of their connection, retrying
--     failed jobs, "import again" and disconnecting (functions that check the
--     role themselves).
--   the server (secret key only): connecting (after it has verified the token
--     with the CRM), every job and every import.
--   triggers on leads, conversations, messages and meetings: queue jobs, and
--     only for a workspace with a connected CRM.
--
-- The one place the rest of Dialvo learns about the CRM is at the end of this
-- file: private.outbound_is_suppressed() also answers true for anyone known
-- to the CRM. Find leads, drafting, approving and sending all ask it already.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- The one way a value is hashed for crm_known_contacts.
create function private.crm_hash(p_value text)
returns bytea
language sql
immutable
set search_path = ''
as $$
  select sha256(convert_to(lower(btrim(coalesce(p_value, ''))), 'UTF8'));
$$;
revoke all on function private.crm_hash(text) from public;
grant execute on function private.crm_hash(text) to service_role;

-- ---------------------------------------------------------------------------
-- crm_connections
-- ---------------------------------------------------------------------------
create table public.crm_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null unique references public.workspaces (id) on delete cascade,
  provider text not null check (provider in ('hubspot', 'pipedrive')),
  -- active: syncing. error: the CRM refused the token (status_reason says
  -- why); nothing is pushed until it is connected again. disconnected: the
  -- token has been deleted.
  status text not null default 'active' check (status in ('active', 'error', 'disconnected')),
  status_reason text check (status_reason is null or char_length(status_reason) <= 300),
  -- What the CRM calls the account, to show who is connected.
  account_label text not null default '' check (char_length(account_label) <= 200),
  -- Pipedrive's company subdomain (acme in acme.pipedrive.com).
  api_domain text check (api_domain is null or api_domain ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  -- What the token turned out to allow, checked when it was connected.
  can_opt_out boolean not null default false,
  can_deals boolean not null default false,
  -- Who to leave out of outreach: anyone in the CRM, or only customers and
  -- people or companies with an open deal.
  skip_rule text not null default 'any_contact'
    check (skip_rule in ('any_contact', 'customers_and_open_deals')),
  -- Create a deal in the CRM when a lead is qualified or a meeting is
  -- booked. Off by default.
  deal_trigger text not null default 'off' check (deal_trigger in ('off', 'qualified', 'meeting_booked')),
  deal_pipeline_id text check (deal_pipeline_id is null or char_length(deal_pipeline_id) between 1 and 64),
  deal_stage_id text check (deal_stage_id is null or char_length(deal_stage_id) between 1 and 64),
  -- The import of the CRM's contacts. queued: waiting for the scheduler.
  -- running: being read in short steps (pull_locked_until is the lease).
  -- done / capped: finished (capped: stopped at the import limit).
  pull_status text not null default 'queued'
    check (pull_status in ('idle', 'queued', 'running', 'done', 'capped', 'failed')),
  pull_cursor jsonb not null default '{}'::jsonb check (jsonb_typeof(pull_cursor) = 'object'),
  pull_generation integer not null default 0,
  pull_seen integer not null default 0,
  pull_locked_until timestamptz,
  pull_started_at timestamptz,
  pull_failed_at timestamptz,
  last_pull_at timestamptz,
  last_pull_error text check (last_pull_error is null or char_length(last_pull_error) <= 300),
  known_count integer not null default 0,
  last_push_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 300),
  last_error_at timestamptz,
  connected_by uuid references auth.users (id) on delete set null,
  connected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  check (deal_trigger = 'off' or deal_pipeline_id is not null)
);
alter table public.crm_connections enable row level security;
create index crm_connections_connected_by_idx on public.crm_connections (connected_by);
create index crm_connections_pull_idx on public.crm_connections (pull_status) where status = 'active';

create trigger crm_connections_set_updated_at
  before update on public.crm_connections
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- crm_sync_jobs: the push queue. source_key names the Dialvo event a job
-- writes ('contact:<lead>', 'chat:<conversation>:<outcome>', 'msg:<message>',
-- 'meeting:<meeting>', 'deal:<lead>', 'opt_out:<lead>'), and is unique per
-- workspace, so the same event is never queued, or written, twice.
-- ref_id is the conversation, message or meeting the job is about; it has no
-- foreign key on purpose (it points at one of three tables), and a job whose
-- row has gone is skipped.
-- ---------------------------------------------------------------------------
create table public.crm_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  lead_id uuid not null,
  kind text not null check (kind in ('contact', 'note', 'meeting', 'deal', 'opt_out')),
  source_key text not null check (char_length(source_key) between 3 and 200),
  ref_id uuid,
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed', 'skipped')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 300),
  -- The CRM's id for what this job wrote (the note, meeting or deal).
  external_id text check (external_id is null or char_length(external_id) <= 64),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  done_at timestamptz,
  unique (workspace_id, source_key),
  foreign key (lead_id, workspace_id)
    references public.leads (id, workspace_id) on delete cascade
);
alter table public.crm_sync_jobs enable row level security;
create index crm_sync_jobs_lead_idx on public.crm_sync_jobs (lead_id, workspace_id);
create index crm_sync_jobs_due_idx on public.crm_sync_jobs (next_attempt_at)
  where status in ('pending', 'running');
create index crm_sync_jobs_workspace_idx on public.crm_sync_jobs (workspace_id, status, updated_at desc);

create trigger crm_sync_jobs_set_updated_at
  before update on public.crm_sync_jobs
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- crm_lead_links: where a Dialvo lead is in the CRM. contact_created and
-- company_created say Dialvo made the record, so the import doesn't turn
-- Dialvo's own leads into "already in your CRM".
-- ---------------------------------------------------------------------------
create table public.crm_lead_links (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  lead_id uuid not null,
  provider text not null check (provider in ('hubspot', 'pipedrive')),
  contact_id text check (contact_id is null or char_length(contact_id) between 1 and 64),
  company_id text check (company_id is null or char_length(company_id) between 1 and 64),
  deal_id text check (deal_id is null or char_length(deal_id) between 1 and 64),
  contact_created boolean not null default false,
  company_created boolean not null default false,
  company_domain text check (company_domain is null or (company_domain = lower(company_domain) and char_length(company_domain) between 3 and 253)),
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (lead_id, workspace_id, provider),
  foreign key (lead_id, workspace_id)
    references public.leads (id, workspace_id) on delete cascade
);
alter table public.crm_lead_links enable row level security;
create index crm_lead_links_created_domain_idx
  on public.crm_lead_links (workspace_id, company_domain) where company_created;

-- ---------------------------------------------------------------------------
-- crm_known_contacts: one row per email or domain in the CRM, hashed.
-- flagged: a customer, or a person or company with an open deal, as far as
-- the CRM says. generation: which import last saw it, so one that has left
-- the CRM is dropped when the next full import finishes.
-- ---------------------------------------------------------------------------
create table public.crm_known_contacts (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  kind text not null check (kind in ('email', 'domain')),
  value_hash bytea not null check (octet_length(value_hash) = 32),
  flagged boolean not null default false,
  generation integer not null,
  primary key (workspace_id, kind, value_hash)
);
alter table public.crm_known_contacts enable row level security;
create index crm_known_contacts_generation_idx on public.crm_known_contacts (workspace_id, generation);

-- ---------------------------------------------------------------------------
-- Grants and policies
-- ---------------------------------------------------------------------------
revoke all on public.crm_connections, public.crm_sync_jobs, public.crm_lead_links,
  public.crm_known_contacts from anon, authenticated;
grant all on public.crm_connections, public.crm_sync_jobs, public.crm_lead_links,
  public.crm_known_contacts to service_role;

grant select on public.crm_connections to authenticated;
grant update (skip_rule, deal_trigger, deal_pipeline_id, deal_stage_id)
  on public.crm_connections to authenticated;
grant select on public.crm_sync_jobs to authenticated;
grant select on public.crm_lead_links to authenticated;
grant select on public.crm_known_contacts to authenticated;

create policy "Members read the CRM connection" on public.crm_connections for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));
create policy "Admins change the CRM settings" on public.crm_connections for update to authenticated
  using ((select private.is_workspace_admin(workspace_id)))
  with check ((select private.is_workspace_admin(workspace_id)));
create policy "Members read CRM sync jobs" on public.crm_sync_jobs for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));
create policy "Members read CRM links" on public.crm_lead_links for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));
create policy "Members read the CRM exclusion list" on public.crm_known_contacts for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));

-- ---------------------------------------------------------------------------
-- Is this person or company already in the workspace's CRM?
-- An email matches its own hash; a domain (given, or the email's) matches a
-- company domain the CRM has. With the skip rule "customers_and_open_deals"
-- only flagged entries count. A contact or company Dialvo itself created in
-- the CRM doesn't count: those are Dialvo's own leads.
-- The SQL helper other parts of Dialvo can call.
-- ---------------------------------------------------------------------------
create function private.crm_is_known(p_workspace_id uuid, p_email text, p_domain text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_only_flagged boolean;
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_email_domain text;
  v_domain text := private.site_domain(p_domain);
begin
  select c.skip_rule = 'customers_and_open_deals' into v_only_flagged
  from public.crm_connections c
  where c.workspace_id = p_workspace_id and c.status in ('active', 'error');
  if not found then
    return false;
  end if;
  if v_email is not null and position('@' in v_email) > 1 then
    v_email_domain := nullif(split_part(v_email, '@', 2), '');
    if exists (
      select 1 from public.crm_known_contacts k
      where k.workspace_id = p_workspace_id and k.kind = 'email'
        and k.value_hash = private.crm_hash(v_email)
        and (not v_only_flagged or k.flagged)
    ) and not exists (
      select 1 from public.crm_lead_links ll
      join public.leads l on l.id = ll.lead_id and l.workspace_id = ll.workspace_id
      where ll.workspace_id = p_workspace_id and ll.contact_created and l.email = v_email
    ) then
      return true;
    end if;
  end if;
  return exists (
    select 1 from public.crm_known_contacts k
    cross join lateral (values (v_email_domain), (v_domain)) as d (value)
    where d.value is not null
      and k.workspace_id = p_workspace_id and k.kind = 'domain'
      and k.value_hash = private.crm_hash(d.value)
      and (not v_only_flagged or k.flagged)
      and not exists (
        select 1 from public.crm_lead_links ll
        where ll.workspace_id = p_workspace_id and ll.company_created
          and ll.company_domain = d.value
      )
  );
end;
$$;
revoke all on function private.crm_is_known(uuid, text, text) from public;
grant execute on function private.crm_is_known(uuid, text, text) to service_role;

-- The same, for the server (isKnownToCrm in src/lib/crm/known.ts).
create function public.crm_is_known(p_workspace_id uuid, p_email text, p_domain text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.crm_is_known(p_workspace_id, p_email, p_domain);
$$;

-- ---------------------------------------------------------------------------
-- Queueing. Nothing is queued for a workspace without an active connection.
-- p_requeue: an event that may be written again (a lead's details, a
-- meeting's status) goes back in the queue once its last job has finished.
-- Notes, deals and opt-outs are written once, ever.
-- ---------------------------------------------------------------------------
create function private.crm_enqueue(
  p_workspace_id uuid, p_lead_id uuid, p_kind text, p_key text, p_ref uuid, p_requeue boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_lead_id is null or not exists (
    select 1 from public.crm_connections c
    where c.workspace_id = p_workspace_id and c.status = 'active'
  ) then
    return;
  end if;
  insert into public.crm_sync_jobs as j (workspace_id, lead_id, kind, source_key, ref_id)
  values (p_workspace_id, p_lead_id, p_kind, left(p_key, 200), p_ref)
  on conflict (workspace_id, source_key) do update
  set status = 'pending', attempts = 0, next_attempt_at = now(), last_error = null, done_at = null
  where p_requeue and j.status in ('done', 'failed', 'skipped');
end;
$$;
revoke all on function private.crm_enqueue(uuid, uuid, text, text, uuid, boolean) from public;

create function private.crm_on_lead()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deal text;
begin
  if tg_op = 'INSERT' then
    if new.email is not null then
      perform private.crm_enqueue(new.workspace_id, new.id, 'contact', 'contact:' || new.id, null, true);
    end if;
    if new.do_not_contact or new.status = 'unsubscribed' then
      perform private.crm_enqueue(new.workspace_id, new.id, 'opt_out', 'opt_out:' || new.id, null, false);
    end if;
    return null;
  end if;
  if new.email is not null and (
    new.email is distinct from old.email
    or (new.status = 'qualified' and old.status is distinct from 'qualified')
  ) then
    perform private.crm_enqueue(new.workspace_id, new.id, 'contact', 'contact:' || new.id, null, true);
  end if;
  if new.status = 'qualified' and old.status is distinct from 'qualified' then
    select c.deal_trigger into v_deal from public.crm_connections c
    where c.workspace_id = new.workspace_id and c.status = 'active';
    if v_deal = 'qualified' then
      perform private.crm_enqueue(new.workspace_id, new.id, 'deal', 'deal:' || new.id, null, false);
    end if;
  end if;
  if (new.do_not_contact and not old.do_not_contact)
     or (new.status = 'unsubscribed' and old.status is distinct from 'unsubscribed') then
    perform private.crm_enqueue(new.workspace_id, new.id, 'opt_out', 'opt_out:' || new.id, null, false);
  end if;
  return null;
end;
$$;
revoke all on function private.crm_on_lead() from public;

create trigger leads_crm_sync
  after insert or update of email, status, do_not_contact on public.leads
  for each row execute function private.crm_on_lead();

-- A website chat: one note when the agent records an outcome, or, for a chat
-- that ends with no outcome, one when it is closed.
create function private.crm_on_conversation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.channel <> 'chat' then
    return null;
  end if;
  if new.outcome is not null and new.outcome is distinct from old.outcome then
    perform private.crm_enqueue(
      new.workspace_id, new.lead_id, 'note', 'chat:' || new.id || ':' || new.outcome, new.id, false
    );
  elsif new.status = 'closed' and old.status <> 'closed' and new.outcome is null
    and not exists (
      select 1 from public.crm_sync_jobs j
      where j.workspace_id = new.workspace_id and j.ref_id = new.id and j.kind = 'note'
    ) then
    perform private.crm_enqueue(
      new.workspace_id, new.lead_id, 'note', 'chat:' || new.id || ':closed', new.id, false
    );
  end if;
  return null;
end;
$$;
revoke all on function private.crm_on_conversation() from public;

create trigger conversations_crm_sync
  after update of outcome, status on public.conversations
  for each row execute function private.crm_on_conversation();

-- An email sent or received: one note each. Out-of-office replies are left out.
create function private.crm_on_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead uuid;
begin
  if not (new.direction = 'in' or new.delivery_status in ('sent', 'delivered')) then
    return null;
  end if;
  if coalesce(new.metadata ->> 'auto_reply', '') = 'true' then
    return null;
  end if;
  select c.lead_id into v_lead from public.conversations c
  where c.id = new.conversation_id and c.workspace_id = new.workspace_id and c.channel = 'email';
  if v_lead is not null then
    perform private.crm_enqueue(new.workspace_id, v_lead, 'note', 'msg:' || new.id, new.id, false);
  end if;
  return null;
end;
$$;
revoke all on function private.crm_on_message() from public;

create trigger messages_crm_sync
  after insert or update of delivery_status on public.messages
  for each row execute function private.crm_on_message();

-- A meeting: written when it is booked, and again when its time or status
-- changes. A newly booked one can also open a deal.
create function private.crm_on_meeting()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deal text;
begin
  perform private.crm_enqueue(new.workspace_id, new.lead_id, 'meeting', 'meeting:' || new.id, new.id, true);
  if tg_op = 'INSERT' and new.status = 'scheduled' then
    select c.deal_trigger into v_deal from public.crm_connections c
    where c.workspace_id = new.workspace_id and c.status = 'active';
    if v_deal = 'meeting_booked' then
      perform private.crm_enqueue(new.workspace_id, new.lead_id, 'deal', 'deal:' || new.lead_id, null, false);
    end if;
  end if;
  return null;
end;
$$;
revoke all on function private.crm_on_meeting() from public;

create trigger meetings_crm_sync
  after insert or update of status, starts_at, ends_at, title on public.meetings
  for each row execute function private.crm_on_meeting();

-- ---------------------------------------------------------------------------
-- Connecting and disconnecting
-- ---------------------------------------------------------------------------

-- Stores a token the server has already checked with the CRM, on behalf of
-- an admin. A workspace has one CRM: connecting a second one means
-- disconnecting the first.
--   { "status": "connected" } | { "status": "other_connected", "provider" }
--   | { "status": "not_found" }   no such workspace, or not an admin
create function public.crm_connect(
  p_workspace_id uuid, p_user_id uuid, p_provider text, p_token text,
  p_account_label text, p_api_domain text, p_can_opt_out boolean, p_can_deals boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.crm_connections%rowtype;
  v_secret uuid;
  v_name text := 'crm_token:' || p_workspace_id;
begin
  if not exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace_id and m.user_id = p_user_id and m.role in ('owner', 'admin')
  ) then
    return jsonb_build_object('status', 'not_found');
  end if;
  if p_provider not in ('hubspot', 'pipedrive') then
    raise exception 'unknown provider' using errcode = '22023';
  end if;
  if char_length(coalesce(p_token, '')) not between 10 and 500 then
    raise exception 'bad token' using errcode = '22023';
  end if;
  select c.* into v_existing from public.crm_connections c
  where c.workspace_id = p_workspace_id for update;
  if found and v_existing.status <> 'disconnected' and v_existing.provider <> p_provider then
    return jsonb_build_object('status', 'other_connected', 'provider', v_existing.provider);
  end if;

  select s.id into v_secret from vault.secrets s where s.name = v_name;
  if v_secret is null then
    perform vault.create_secret(p_token, v_name, 'The CRM token of one Dialvo workspace.');
  else
    perform vault.update_secret(v_secret, p_token);
  end if;

  insert into public.crm_connections as c (
    workspace_id, provider, status, account_label, api_domain, can_opt_out, can_deals,
    pull_status, connected_by, connected_at
  )
  values (
    p_workspace_id, p_provider, 'active', left(coalesce(p_account_label, ''), 200),
    nullif(lower(btrim(coalesce(p_api_domain, ''))), ''),
    coalesce(p_can_opt_out, false), coalesce(p_can_deals, false), 'queued', p_user_id, now()
  )
  on conflict (workspace_id) do update
  set provider = excluded.provider, status = 'active', status_reason = null,
      account_label = excluded.account_label, api_domain = excluded.api_domain,
      can_opt_out = excluded.can_opt_out, can_deals = excluded.can_deals,
      -- A different CRM, or one reconnected after a disconnect, starts from
      -- the defaults; a new token for the same one keeps its settings.
      skip_rule = case when c.provider = excluded.provider and c.status <> 'disconnected' then c.skip_rule else 'any_contact' end,
      deal_trigger = case when c.provider = excluded.provider and c.status <> 'disconnected' and excluded.can_deals then c.deal_trigger else 'off' end,
      deal_pipeline_id = case when c.provider = excluded.provider and c.status <> 'disconnected' then c.deal_pipeline_id else null end,
      deal_stage_id = case when c.provider = excluded.provider and c.status <> 'disconnected' then c.deal_stage_id else null end,
      pull_status = case when c.pull_status = 'running' then 'running' else 'queued' end,
      last_error = null, last_error_at = null,
      connected_by = excluded.connected_by, connected_at = now();
  return jsonb_build_object('status', 'connected');
end;
$$;

-- The token, for the server's steps only.
create function public.crm_credentials(p_workspace_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'provider', c.provider, 'api_domain', c.api_domain, 'token', s.decrypted_secret
  )
  from public.crm_connections c
  join vault.decrypted_secrets s on s.name = 'crm_token:' || c.workspace_id
  where c.workspace_id = p_workspace_id and c.status in ('active', 'error');
$$;

-- Deletes the token, stops the queue and forgets the imported list. Admins
-- only. What was already written to the CRM stays there.
create function public.crm_disconnect(p_workspace_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if not (select private.is_workspace_admin(p_workspace_id)) then
    return false;
  end if;
  delete from vault.secrets s where s.name = 'crm_token:' || p_workspace_id;
  update public.crm_connections c
  set status = 'disconnected', status_reason = null, pull_status = 'idle',
      pull_cursor = '{}'::jsonb, pull_locked_until = null, known_count = 0, deal_trigger = 'off'
  where c.workspace_id = p_workspace_id;
  update public.crm_sync_jobs j
  set status = 'skipped', last_error = 'The CRM was disconnected.', locked_until = null
  where j.workspace_id = p_workspace_id and j.status in ('pending', 'running', 'failed');
  delete from public.crm_known_contacts k where k.workspace_id = p_workspace_id;
  return true;
end;
$$;

-- "Retry": failed jobs (or one of them) go back in the queue. Admins only.
create function public.crm_retry_jobs(p_workspace_id uuid, p_job_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if (select auth.uid()) is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if not (select private.is_workspace_admin(p_workspace_id)) then
    return 0;
  end if;
  update public.crm_sync_jobs j
  set status = 'pending', attempts = 0, next_attempt_at = now(), last_error = null
  where j.workspace_id = p_workspace_id and j.status = 'failed'
    and (p_job_id is null or j.id = p_job_id)
    and exists (select 1 from public.crm_connections c
                where c.workspace_id = j.workspace_id and c.status = 'active');
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- "Import again": queues a fresh import of the CRM's contacts. Admins only.
create function public.crm_pull_now(p_workspace_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if not (select private.is_workspace_admin(p_workspace_id)) then
    return false;
  end if;
  update public.crm_connections c set pull_status = 'queued'
  where c.workspace_id = p_workspace_id and c.status = 'active'
    and c.pull_status in ('idle', 'done', 'capped', 'failed');
  return found;
end;
$$;

-- ---------------------------------------------------------------------------
-- The push queue, for the server's steps
-- ---------------------------------------------------------------------------

-- Claims up to p_limit jobs that are due (and ones whose step died, once its
-- lease ran out), oldest first, and returns each with what it needs to be
-- written. A job claimed p_max_attempts times is marked failed instead.
-- p_workspace_id narrows it to one workspace ("Sync now").
create function public.crm_jobs_claim(
  p_limit integer, p_lease_seconds integer, p_max_attempts integer, p_workspace_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_out jsonb;
begin
  update public.crm_sync_jobs j
  set status = 'failed', locked_until = null,
      last_error = coalesce(j.last_error, 'It stopped part-way too many times.')
  where j.status = 'running' and j.locked_until < now() and j.attempts >= p_max_attempts
    and (p_workspace_id is null or j.workspace_id = p_workspace_id);

  with picked as (
    select j.id from public.crm_sync_jobs j
    join public.crm_connections c on c.workspace_id = j.workspace_id and c.status = 'active'
    where (p_workspace_id is null or j.workspace_id = p_workspace_id)
      and ((j.status = 'pending' and j.next_attempt_at <= now())
           or (j.status = 'running' and j.locked_until < now()))
    order by j.next_attempt_at, j.created_at
    limit greatest(least(p_limit, 200), 1)
    for update of j skip locked
  ), marked as (
    update public.crm_sync_jobs j
    set status = 'running', attempts = j.attempts + 1,
        locked_until = now() + make_interval(secs => greatest(p_lease_seconds, 1))
    from picked where j.id = picked.id
    returning j.*
  )
  select jsonb_agg(jsonb_build_object(
    'id', m.id, 'workspace_id', m.workspace_id, 'kind', m.kind, 'source_key', m.source_key,
    'attempts', m.attempts, 'external_id', m.external_id,
    'connection', jsonb_build_object(
      'provider', c.provider, 'can_opt_out', c.can_opt_out, 'can_deals', c.can_deals,
      'deal_pipeline_id', c.deal_pipeline_id, 'deal_stage_id', c.deal_stage_id
    ),
    'lead', jsonb_build_object(
      'id', l.id, 'name', l.name, 'email', l.email, 'phone', l.phone, 'company', l.company,
      'website', l.website, 'status', l.status, 'source', l.source,
      'do_not_contact', l.do_not_contact, 'created_at', l.created_at
    ),
    'link', (
      select jsonb_build_object(
        'contact_id', ll.contact_id, 'company_id', ll.company_id, 'deal_id', ll.deal_id,
        'contact_created', ll.contact_created, 'company_created', ll.company_created
      ) from public.crm_lead_links ll
      where ll.lead_id = m.lead_id and ll.workspace_id = m.workspace_id and ll.provider = c.provider
    ),
    'detail', case
      when m.kind = 'note' and m.source_key like 'chat:%' then (
        select jsonb_build_object(
          'type', 'chat', 'outcome', cv.outcome, 'outcome_summary', cv.outcome_summary,
          'started_at', cv.created_at,
          'transcript', (
            select left(string_agg(
              case t.author when 'lead' then 'Visitor' when 'agent' then 'Assistant' else 'Team' end
                || ': ' || left(t.body, 600), E'\n' order by t.sent_at), 6000)
            from (
              select x.author, x.body, x.sent_at from public.messages x
              where x.conversation_id = cv.id and x.workspace_id = cv.workspace_id
              order by x.sent_at desc limit 40
            ) t
          )
        ) from public.conversations cv
        where cv.id = m.ref_id and cv.workspace_id = m.workspace_id
      )
      when m.kind = 'note' and m.source_key like 'msg:%' then (
        select jsonb_build_object(
          'type', 'email', 'direction', x.direction, 'subject', left(coalesce(x.metadata ->> 'subject', ''), 200),
          'body', left(x.body, 4000), 'sent_at', x.sent_at
        ) from public.messages x
        where x.id = m.ref_id and x.workspace_id = m.workspace_id
      )
      when m.kind = 'meeting' then (
        select jsonb_build_object(
          'type', 'meeting', 'title', mt.title, 'starts_at', mt.starts_at, 'ends_at', mt.ends_at,
          'status', mt.status, 'booked_by', mt.booked_by
        ) from public.meetings mt
        where mt.id = m.ref_id and mt.workspace_id = m.workspace_id
      )
      else '{}'::jsonb
    end
  ) order by m.next_attempt_at, m.created_at) into v_out
  from marked m
  join public.crm_connections c on c.workspace_id = m.workspace_id
  join public.leads l on l.id = m.lead_id and l.workspace_id = m.workspace_id;
  return coalesce(v_out, '[]'::jsonb);
end;
$$;

-- Records how one claimed job went. Only a job still marked running can be
-- finished, so a late or repeated call changes nothing.
--   p_outcome: done | retry (after p_delay_seconds) | failed | skipped
--     | auth (the CRM refused the token: the connection goes to 'error' and
--       the job waits, uncounted, for a new token)
--   p_link: { contact_id, company_id, deal_id, contact_created,
--             company_created, company_domain } to store on the lead
create function public.crm_job_finish(
  p_job_id uuid, p_workspace_id uuid, p_outcome text, p_delay_seconds integer,
  p_error text, p_external_id text, p_link jsonb, p_max_attempts integer
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.crm_sync_jobs%rowtype;
  v_provider text;
  v_error text := left(nullif(btrim(coalesce(p_error, '')), ''), 300);
begin
  if p_outcome not in ('done', 'retry', 'failed', 'skipped', 'auth') then
    raise exception 'unknown outcome' using errcode = '22023';
  end if;
  select j.* into v_job from public.crm_sync_jobs j
  where j.id = p_job_id and j.workspace_id = p_workspace_id and j.status = 'running'
  for update;
  if not found then
    return 'ignored';
  end if;
  select c.provider into v_provider from public.crm_connections c where c.workspace_id = p_workspace_id;

  if p_link is not null and jsonb_typeof(p_link) = 'object' and v_provider is not null then
    insert into public.crm_lead_links as ll (
      workspace_id, lead_id, provider, contact_id, company_id, deal_id,
      contact_created, company_created, company_domain
    )
    values (
      p_workspace_id, v_job.lead_id, v_provider,
      left(nullif(p_link ->> 'contact_id', ''), 64), left(nullif(p_link ->> 'company_id', ''), 64),
      left(nullif(p_link ->> 'deal_id', ''), 64),
      coalesce((p_link ->> 'contact_created')::boolean, false),
      coalesce((p_link ->> 'company_created')::boolean, false),
      private.site_domain(p_link ->> 'company_domain')
    )
    on conflict (lead_id, workspace_id, provider) do update
    set contact_id = coalesce(excluded.contact_id, ll.contact_id),
        company_id = coalesce(excluded.company_id, ll.company_id),
        deal_id = coalesce(excluded.deal_id, ll.deal_id),
        contact_created = ll.contact_created or excluded.contact_created,
        company_created = ll.company_created or excluded.company_created,
        company_domain = coalesce(excluded.company_domain, ll.company_domain),
        synced_at = now();
  end if;

  if p_outcome = 'done' then
    update public.crm_sync_jobs j
    set status = 'done', done_at = now(), locked_until = null, last_error = null,
        external_id = coalesce(left(nullif(p_external_id, ''), 64), j.external_id)
    where j.id = v_job.id;
    update public.crm_connections c set last_push_at = now() where c.workspace_id = p_workspace_id;
    return 'done';
  elsif p_outcome = 'skipped' then
    update public.crm_sync_jobs j
    set status = 'skipped', done_at = now(), locked_until = null, last_error = v_error
    where j.id = v_job.id;
    return 'skipped';
  elsif p_outcome = 'auth' then
    update public.crm_sync_jobs j
    set status = 'pending', attempts = greatest(j.attempts - 1, 0), locked_until = null,
        next_attempt_at = now(), last_error = v_error
    where j.id = v_job.id;
    update public.crm_connections c
    set status = 'error', status_reason = v_error, last_error = v_error, last_error_at = now()
    where c.workspace_id = p_workspace_id and c.status = 'active';
    return 'auth';
  elsif p_outcome = 'retry' and v_job.attempts < p_max_attempts then
    update public.crm_sync_jobs j
    set status = 'pending', locked_until = null, last_error = v_error,
        next_attempt_at = now() + make_interval(secs => least(greatest(coalesce(p_delay_seconds, 60), 1), 86400))
    where j.id = v_job.id;
    -- External_id survives a retry: a meeting created on the first try is
    -- updated, not created again.
    if p_external_id is not null then
      update public.crm_sync_jobs j set external_id = left(p_external_id, 64) where j.id = v_job.id;
    end if;
    return 'retry';
  end if;
  update public.crm_sync_jobs j
  set status = 'failed', locked_until = null,
      last_error = coalesce(v_error, 'It could not be written to the CRM.')
  where j.id = v_job.id;
  update public.crm_connections c
  set last_error = coalesce(v_error, 'It could not be written to the CRM.'), last_error_at = now()
  where c.workspace_id = p_workspace_id;
  return 'failed';
end;
$$;

-- ---------------------------------------------------------------------------
-- The import ("already in your CRM"), for the server's steps
-- ---------------------------------------------------------------------------

-- Takes one queued import (or one whose step died) and its lease. A queued
-- one starts a new generation from the first page.
create function public.crm_pull_claim(p_lease_seconds integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.crm_connections%rowtype;
begin
  select c.* into v_c from public.crm_connections c
  where c.status = 'active'
    and (c.pull_status = 'queued'
         or (c.pull_status = 'running' and (c.pull_locked_until is null or c.pull_locked_until < now())))
  order by c.pull_status = 'running' desc, c.updated_at
  limit 1
  for update skip locked;
  if not found then
    return null;
  end if;
  if v_c.pull_status = 'queued' then
    update public.crm_connections c
    set pull_status = 'running', pull_generation = c.pull_generation + 1, pull_seen = 0,
        pull_cursor = '{}'::jsonb, pull_started_at = now(), last_pull_error = null,
        pull_locked_until = now() + make_interval(secs => greatest(p_lease_seconds, 1))
    where c.id = v_c.id
    returning c.* into v_c;
  else
    update public.crm_connections c
    set pull_locked_until = now() + make_interval(secs => greatest(p_lease_seconds, 1))
    where c.id = v_c.id
    returning c.* into v_c;
  end if;
  return jsonb_build_object(
    'workspace_id', v_c.workspace_id, 'provider', v_c.provider, 'generation', v_c.pull_generation,
    'cursor', v_c.pull_cursor, 'seen', v_c.pull_seen
  );
end;
$$;

-- Stores one step of an import and releases the lease.
-- p_entries: [{ "k": "email" | "domain", "v": "lower-cased value", "f": flagged }]
-- (the values are hashed here and never stored as they are).
-- p_done: the CRM has no more pages. The import also ends when it has seen
-- p_cap contacts ('capped'); a capped import keeps what earlier imports
-- found, a complete one drops what the CRM no longer has.
-- p_error: the step failed; the import stops and is tried again later.
create function public.crm_pull_save(
  p_workspace_id uuid, p_generation integer, p_entries jsonb, p_cursor jsonb,
  p_seen integer, p_done boolean, p_cap integer, p_error text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.crm_connections%rowtype;
  v_status text;
begin
  select c.* into v_c from public.crm_connections c
  where c.workspace_id = p_workspace_id and c.pull_generation = p_generation
    and c.pull_status = 'running' and c.status = 'active'
  for update;
  if not found then
    return null;
  end if;

  insert into public.crm_known_contacts as k (workspace_id, kind, value_hash, flagged, generation)
  select p_workspace_id, e.k, private.crm_hash(e.v), bool_or(coalesce(e.f, false)), p_generation
  from jsonb_to_recordset(
    case when jsonb_typeof(p_entries) = 'array' then p_entries else '[]'::jsonb end
  ) as e (k text, v text, f boolean)
  where (e.k = 'email' and char_length(e.v) between 3 and 254 and e.v ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$')
     or (e.k = 'domain' and char_length(e.v) between 3 and 253 and e.v ~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$')
  group by e.k, private.crm_hash(e.v)
  on conflict (workspace_id, kind, value_hash) do update
  set flagged = case when k.generation = excluded.generation then k.flagged or excluded.flagged
                     else excluded.flagged end,
      generation = excluded.generation;

  v_status := case
    when nullif(btrim(coalesce(p_error, '')), '') is not null then 'failed'
    when coalesce(p_done, false) then 'done'
    when v_c.pull_seen + greatest(coalesce(p_seen, 0), 0) >= p_cap then 'capped'
    else 'running'
  end;
  if v_status = 'done' then
    delete from public.crm_known_contacts k
    where k.workspace_id = p_workspace_id and k.generation < p_generation;
  end if;
  update public.crm_connections c
  set pull_seen = c.pull_seen + greatest(coalesce(p_seen, 0), 0),
      pull_cursor = case when jsonb_typeof(p_cursor) = 'object' then p_cursor else c.pull_cursor end,
      pull_status = v_status,
      pull_locked_until = null,
      last_pull_at = case when v_status in ('done', 'capped') then now() else c.last_pull_at end,
      pull_failed_at = case when v_status = 'failed' then now() else c.pull_failed_at end,
      last_pull_error = case when v_status = 'failed' then left(p_error, 300) else null end,
      known_count = (select count(*) from public.crm_known_contacts k where k.workspace_id = p_workspace_id)
  where c.id = v_c.id;
  return v_status;
end;
$$;

-- ---------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------
revoke all on function public.crm_is_known(uuid, text, text) from public, anon, authenticated;
revoke all on function public.crm_connect(uuid, uuid, text, text, text, text, boolean, boolean) from public, anon, authenticated;
revoke all on function public.crm_credentials(uuid) from public, anon, authenticated;
revoke all on function public.crm_jobs_claim(integer, integer, integer, uuid) from public, anon, authenticated;
revoke all on function public.crm_job_finish(uuid, uuid, text, integer, text, text, jsonb, integer) from public, anon, authenticated;
revoke all on function public.crm_pull_claim(integer) from public, anon, authenticated;
revoke all on function public.crm_pull_save(uuid, integer, jsonb, jsonb, integer, boolean, integer, text) from public, anon, authenticated;
grant execute on function public.crm_is_known(uuid, text, text) to service_role;
grant execute on function public.crm_connect(uuid, uuid, text, text, text, text, boolean, boolean) to service_role;
grant execute on function public.crm_credentials(uuid) to service_role;
grant execute on function public.crm_jobs_claim(integer, integer, integer, uuid) to service_role;
grant execute on function public.crm_job_finish(uuid, uuid, text, integer, text, text, jsonb, integer) to service_role;
grant execute on function public.crm_pull_claim(integer) to service_role;
grant execute on function public.crm_pull_save(uuid, integer, jsonb, jsonb, integer, boolean, integer, text) to service_role;

revoke all on function public.crm_disconnect(uuid) from public, anon;
revoke all on function public.crm_retry_jobs(uuid, uuid) from public, anon;
revoke all on function public.crm_pull_now(uuid) from public, anon;
grant execute on function public.crm_disconnect(uuid) to authenticated;
grant execute on function public.crm_retry_jobs(uuid, uuid) to authenticated;
grant execute on function public.crm_pull_now(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- THE SKIP (the one place): never contact anyone already in the CRM.
-- private.outbound_is_suppressed() is what Find leads, first-email drafting,
-- approving and sending all ask before they touch an address or a company.
-- Same body as in 20261120150000_find_leads_and_first_emails.sql, plus the
-- last line. Without a connected CRM that line is always false.
-- ---------------------------------------------------------------------------
create or replace function private.outbound_is_suppressed(p_workspace_id uuid, p_email text, p_domain text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.outbound_suppressions s
    where s.workspace_id = p_workspace_id
      and (
        (s.kind = 'email' and s.value = lower(p_email))
        or (s.kind = 'domain' and (
          lower(split_part(coalesce(p_email, ''), '@', 2)) = s.value
          or lower(split_part(coalesce(p_email, ''), '@', 2)) like '%.' || s.value
          or lower(coalesce(p_domain, '')) = s.value
          or lower(coalesce(p_domain, '')) like '%.' || s.value
        ))
      )
  )
  or private.crm_is_known(p_workspace_id, p_email, p_domain);
$$;
