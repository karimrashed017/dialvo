-- Channels, part 1 of 2: the phone agent, consented outbound calls, phone
-- numbers and SMS, on Twilio (src/lib/phone).
--
-- Everything here is additive. New tables:
--   workspace_phone    the phone agent's settings, the call window, the caps
--                      and the SMS registration status. One row per workspace.
--   phone_numbers      numbers the workspace's owner bought, with their own
--                      daily call cap and health (spam label, caller name,
--                      call signing).
--   phone_opt_outs     the do-not-call list and the texting opt-outs.
--   call_batches       a list of consented leads to call, which waits for an
--                      owner's or admin's approval before any call is made.
--   call_batch_leads   each lead in a batch: waiting, calling, called or
--                      skipped (with the reason).
--   sms_log            every text sent or received, with what the carrier said.
-- plus new columns on calls (the Twilio call, the number, the outcome) and
-- leads.time_zone, and the functions the app and the webhooks go through.
--
-- Who writes what:
--   admins (signed in): the phone settings, a number's cap and health
--     statuses, approving or cancelling a batch.
--   members (signed in): create a batch, add to the do-not-call list.
--   the server (secret key only): buying and releasing numbers (an owner
--     asked, checked again here), everything a Twilio webhook reports, and
--     claiming the calls and texts that are due.
--
-- THE RULES FOR AN OUTBOUND CALL, all checked here at the moment a call is
-- claimed, not only when a batch is made: the lead agreed to be called
-- (consent_call with its source), isn't marked do not contact or
-- unsubscribed, isn't on the do-not-call list, the call window is open in
-- every time zone the lead could be in, the batch was approved, the
-- workspace's outbound calling is on, and neither the workspace's nor the
-- number's daily cap is reached.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- A phone number in international (E.164) form, or null. Spaces, dashes,
-- dots and brackets are dropped and a leading 00 becomes +.
create function private.e164(p_phone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when v ~ '^\+[1-9][0-9]{6,14}$' then v end
  from (select regexp_replace(regexp_replace(btrim(coalesce(p_phone, '')), '[\s().-]', '', 'g'), '^00', '+') as v) x;
$$;
revoke all on function private.e164(text) from public;

-- Every time zone a phone number could be in. The lead's own zone when it is
-- recorded; otherwise the zones of the number's country, so the call window
-- has to be open in all of them (a US number with no zone recorded can only
-- be called when it is inside the window from New York to Los Angeles).
-- Empty for a country not listed: such a lead is called only once a person
-- sets their time zone.
create function private.phone_zones(p_phone text, p_lead_tz text)
returns text[]
language plpgsql
stable
set search_path = ''
as $$
declare
  v text := private.e164(p_phone);
begin
  if p_lead_tz is not null and private.safe_tz(p_lead_tz) = p_lead_tz then
    return array[p_lead_tz];
  end if;
  if v is null then
    return '{}';
  end if;
  return case
    when v ~ '^\+1808' then array['Pacific/Honolulu']
    when v ~ '^\+1907' then array['America/Anchorage']
    when v ~ '^\+1(787|939)' then array['America/Puerto_Rico']
    when v ~ '^\+1(902|782|506|709|879)' then array['America/Halifax', 'America/St_Johns']
    when v ~ '^\+1' then array['America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles']
    when v ~ '^\+44' then array['Europe/London']
    when v ~ '^\+353' then array['Europe/Dublin']
    when v ~ '^\+351' then array['Europe/Lisbon', 'Atlantic/Azores']
    when v ~ '^\+358' then array['Europe/Helsinki']
    when v ~ '^\+33' then array['Europe/Paris']
    when v ~ '^\+49' then array['Europe/Berlin']
    when v ~ '^\+34' then array['Europe/Madrid', 'Atlantic/Canary']
    when v ~ '^\+39' then array['Europe/Rome']
    when v ~ '^\+31' then array['Europe/Amsterdam']
    when v ~ '^\+32' then array['Europe/Brussels']
    when v ~ '^\+41' then array['Europe/Zurich']
    when v ~ '^\+43' then array['Europe/Vienna']
    when v ~ '^\+45' then array['Europe/Copenhagen']
    when v ~ '^\+46' then array['Europe/Stockholm']
    when v ~ '^\+47' then array['Europe/Oslo']
    when v ~ '^\+48' then array['Europe/Warsaw']
    when v ~ '^\+61' then array['Australia/Perth', 'Australia/Adelaide', 'Australia/Sydney']
    when v ~ '^\+64' then array['Pacific/Auckland']
    when v ~ '^\+65' then array['Asia/Singapore']
    when v ~ '^\+81' then array['Asia/Tokyo']
    when v ~ '^\+91' then array['Asia/Kolkata']
    when v ~ '^\+971' then array['Asia/Dubai']
    when v ~ '^\+972' then array['Asia/Jerusalem']
    when v ~ '^\+27' then array['Africa/Johannesburg']
    when v ~ '^\+52' then array['America/Tijuana', 'America/Mexico_City', 'America/Cancun']
    when v ~ '^\+55' then array['America/Sao_Paulo', 'America/Manaus', 'America/Rio_Branco']
    else '{}'::text[]
  end;
end;
$$;
revoke all on function private.phone_zones(text, text) from public;

-- Is the window ({ "days": [1..7], "start": "09:00", "end": "20:00" }) open
-- at this instant in every one of these zones? False for no zones.
create function private.call_window_open(p_window jsonb, p_zones text[], p_at timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(bool_and(private.in_send_window(p_window, z, p_at)), false)
  from unnest(coalesce(p_zones, '{}'::text[])) z;
$$;
revoke all on function private.call_window_open(jsonb, text[], timestamptz) from public;

-- ---------------------------------------------------------------------------
-- leads: the time zone, for the call window
-- ---------------------------------------------------------------------------
alter table public.leads
  add column time_zone text check (time_zone is null or char_length(time_zone) between 1 and 64);
-- Matching a caller to a lead by number.
create index leads_workspace_phone_e164_idx
  on public.leads (workspace_id, private.e164(phone)) where phone is not null;

-- ---------------------------------------------------------------------------
-- workspace_phone
-- ---------------------------------------------------------------------------
create table public.workspace_phone (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  -- The agent answers the workspace's numbers. Off: calls go to the
  -- transfer number, or the caller hears that the team will call back.
  agent_on boolean not null default false,
  -- The agent's first words after the recording notice. Empty: the default.
  greeting text not null default '' check (char_length(greeting) <= 300),
  voice text not null default 'Polly.Joanna-Neural' check (char_length(voice) between 1 and 60),
  language text not null default 'en-US' check (language ~ '^[a-z]{2,3}-[A-Z]{2}$'),
  -- Where a call goes when the caller wants a person.
  transfer_number text check (transfer_number is null or transfer_number ~ '^\+[1-9][0-9]{6,14}$'),
  -- Audio recording. The call is always transcribed and the caller is
  -- always told so first; this adds the audio.
  recording_on boolean not null default false,
  -- The switch for outbound calls. Nothing is dialled while it is off.
  outbound_on boolean not null default false,
  -- When outbound calls and texts may reach a lead, in the lead's time.
  call_window jsonb not null
    default '{"days": [1, 2, 3, 4, 5], "start": "09:00", "end": "20:00"}'::jsonb
    check (jsonb_typeof(call_window) = 'object'),
  daily_call_cap integer not null default 50 check (daily_call_cap between 1 and 300),
  max_call_minutes integer not null default 10 check (max_call_minutes between 1 and 30),
  -- Texts as a sequence step.
  sms_on boolean not null default false,
  sms_daily_cap integer not null default 100 check (sms_daily_cap between 1 and 500),
  -- US texting from a local number needs an approved A2P 10DLC brand and
  -- campaign. Recorded by an admin from what Twilio's console says.
  a2p_brand_status text not null default 'not_started'
    check (a2p_brand_status in ('not_started', 'submitted', 'approved', 'rejected')),
  a2p_campaign_status text not null default 'not_started'
    check (a2p_campaign_status in ('not_started', 'submitted', 'approved', 'rejected')),
  messaging_service_sid text check (messaging_service_sid is null or messaging_service_sid ~ '^MG[0-9a-f]{32}$'),
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.workspace_phone enable row level security;
create index workspace_phone_updated_by_idx on public.workspace_phone (updated_by);
create trigger workspace_phone_set_updated_at
  before update on public.workspace_phone
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- phone_numbers
-- ---------------------------------------------------------------------------
create table public.phone_numbers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  e164 text not null check (e164 ~ '^\+[1-9][0-9]{6,14}$'),
  -- Twilio's id for the number (PN...), set once it is bought.
  provider_sid text check (provider_sid is null or provider_sid ~ '^PN[0-9a-f]{32}$'),
  country text not null check (country ~ '^[A-Z]{2}$'),
  number_type text not null default 'local' check (number_type in ('local', 'toll_free', 'mobile')),
  -- What Twilio said it costs a month, in millionths of the currency.
  monthly_price_micros bigint check (monthly_price_micros is null or monthly_price_micros >= 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  -- buying: reserved while Twilio is asked. released: given back.
  status text not null default 'buying' check (status in ('buying', 'active', 'released')),
  daily_call_cap integer not null default 40 check (daily_call_cap between 1 and 200),
  -- Health, recorded by an admin from a check of the number.
  spam_status text not null default 'unknown' check (spam_status in ('unknown', 'clean', 'flagged')),
  spam_checked_at timestamptz,
  cnam_status text not null default 'not_started' check (cnam_status in ('not_started', 'submitted', 'approved')),
  shaken_status text not null default 'not_started' check (shaken_status in ('not_started', 'submitted', 'approved')),
  bought_by uuid references auth.users (id) on delete set null,
  bought_at timestamptz not null default now(),
  released_by uuid references auth.users (id) on delete set null,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id)
);
alter table public.phone_numbers enable row level security;
-- A number belongs to one workspace at a time: the webhooks route by it.
create unique index phone_numbers_live_e164_idx on public.phone_numbers (e164) where status <> 'released';
create index phone_numbers_workspace_idx on public.phone_numbers (workspace_id, status);
create index phone_numbers_bought_by_idx on public.phone_numbers (bought_by);
create index phone_numbers_released_by_idx on public.phone_numbers (released_by);
create trigger phone_numbers_set_updated_at
  before update on public.phone_numbers
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- phone_opt_outs: the do-not-call list (channel 'call') and the people who
-- texted STOP (channel 'sms'). Checked before every call and text.
-- ---------------------------------------------------------------------------
create table public.phone_opt_outs (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  phone text not null check (phone ~ '^\+[1-9][0-9]{6,14}$'),
  channel text not null check (channel in ('call', 'sms')),
  -- person: added in the app. call: asked on a call. sms_stop: texted STOP.
  -- carrier: the carrier refused a text because they opted out.
  source text not null check (source in ('person', 'call', 'sms_stop', 'carrier')),
  note text not null default '' check (char_length(note) <= 200),
  added_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, phone, channel)
);
alter table public.phone_opt_outs enable row level security;
create index phone_opt_outs_added_by_idx on public.phone_opt_outs (added_by);

-- ---------------------------------------------------------------------------
-- call_batches and call_batch_leads
-- ---------------------------------------------------------------------------
create table public.call_batches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  -- What the calls are for, in the team's words: the agent's brief.
  purpose text not null default '' check (char_length(purpose) <= 2000),
  status text not null default 'waiting_approval'
    check (status in ('waiting_approval', 'approved', 'done', 'cancelled')),
  lead_count integer not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id)
);
alter table public.call_batches enable row level security;
create index call_batches_workspace_idx on public.call_batches (workspace_id, created_at desc);
create index call_batches_created_by_idx on public.call_batches (created_by);
create index call_batches_approved_by_idx on public.call_batches (approved_by);
create trigger call_batches_set_updated_at
  before update on public.call_batches
  for each row execute function private.set_updated_at();

-- New columns on calls, before call_batch_leads refers to them.
alter table public.calls
  add column phone_number_id uuid,
  add column batch_id uuid,
  -- Twilio's id for the call (CA...).
  add column provider_sid text check (provider_sid is null or provider_sid ~ '^CA[0-9a-f]{32}$'),
  add column from_number text check (from_number is null or char_length(from_number) <= 40),
  add column to_number text check (to_number is null or char_length(to_number) <= 40),
  -- qualified, not_qualified, needs_human, transferred, opted_out,
  -- no_answer, voicemail, none.
  add column outcome text check (outcome is null or char_length(outcome) <= 40),
  add column ended_at timestamptz,
  -- When the caller was told the call is transcribed (and recorded).
  add column disclosed_at timestamptz,
  add column recording_sid text check (recording_sid is null or recording_sid ~ '^RE[0-9a-f]{32}$'),
  add column handoff_requested boolean not null default false,
  add column turns integer not null default 0 check (turns >= 0),
  add column error text check (error is null or char_length(error) <= 300),
  add constraint calls_phone_number_fk foreign key (phone_number_id, workspace_id)
    references public.phone_numbers (id, workspace_id) on delete set null (phone_number_id),
  add constraint calls_batch_fk foreign key (batch_id, workspace_id)
    references public.call_batches (id, workspace_id) on delete set null (batch_id);
create unique index calls_provider_sid_idx on public.calls (provider_sid) where provider_sid is not null;
create index calls_phone_number_idx on public.calls (phone_number_id, workspace_id, created_at desc) where phone_number_id is not null;
create index calls_batch_idx on public.calls (batch_id, workspace_id) where batch_id is not null;
create index calls_workspace_created_idx on public.calls (workspace_id, created_at desc);

create table public.call_batch_leads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  batch_id uuid not null,
  lead_id uuid not null,
  -- The number to call, as it was when the batch was made.
  phone text check (phone is null or phone ~ '^\+[1-9][0-9]{6,14}$'),
  status text not null default 'waiting'
    check (status in ('waiting', 'calling', 'called', 'skipped', 'cancelled')),
  skip_reason text check (skip_reason is null or char_length(skip_reason) <= 80),
  call_id uuid,
  attempts integer not null default 0 check (attempts >= 0),
  next_try_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (batch_id, lead_id),
  foreign key (batch_id, workspace_id)
    references public.call_batches (id, workspace_id) on delete cascade,
  foreign key (lead_id, workspace_id)
    references public.leads (id, workspace_id) on delete cascade,
  foreign key (call_id, workspace_id)
    references public.calls (id, workspace_id) on delete set null (call_id)
);
alter table public.call_batch_leads enable row level security;
create index call_batch_leads_workspace_idx on public.call_batch_leads (workspace_id, status);
create index call_batch_leads_batch_idx on public.call_batch_leads (batch_id, workspace_id);
create index call_batch_leads_lead_idx on public.call_batch_leads (lead_id, workspace_id);
create index call_batch_leads_call_idx on public.call_batch_leads (call_id, workspace_id) where call_id is not null;
create index call_batch_leads_due_idx on public.call_batch_leads (next_try_at) where status = 'waiting';
create trigger call_batch_leads_set_updated_at
  before update on public.call_batch_leads
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- sms_log
-- ---------------------------------------------------------------------------
create table public.sms_log (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  lead_id uuid not null,
  conversation_id uuid not null,
  phone_number_id uuid,
  direction text not null check (direction in ('out', 'in')),
  to_number text not null check (char_length(to_number) <= 40),
  from_number text not null check (char_length(from_number) <= 40),
  body text not null check (char_length(body) between 1 and 1600),
  -- Twilio's id for the message (SM... or MM...).
  provider_sid text check (provider_sid is null or provider_sid ~ '^(SM|MM)[0-9a-f]{32}$'),
  -- sending: claimed by a server. sent: accepted by Twilio. delivered /
  -- undelivered / failed: what the carrier said. received: incoming.
  status text not null check (status in ('sending', 'sent', 'delivered', 'undelivered', 'failed', 'received')),
  error_code integer,
  -- Why it went: a sequence step, or a caller asked for the booking link.
  reason text not null default 'sequence' check (reason in ('sequence', 'booking_link', 'reply')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (lead_id, workspace_id)
    references public.leads (id, workspace_id) on delete cascade,
  foreign key (conversation_id, workspace_id)
    references public.conversations (id, workspace_id) on delete cascade,
  foreign key (phone_number_id, workspace_id)
    references public.phone_numbers (id, workspace_id) on delete set null (phone_number_id)
);
alter table public.sms_log enable row level security;
create unique index sms_log_provider_sid_idx on public.sms_log (provider_sid) where provider_sid is not null;
create index sms_log_lead_idx on public.sms_log (lead_id, workspace_id);
create index sms_log_conversation_idx on public.sms_log (conversation_id, workspace_id);
create index sms_log_number_idx on public.sms_log (phone_number_id, workspace_id) where phone_number_id is not null;
create index sms_log_workspace_idx on public.sms_log (workspace_id, created_at desc);
create trigger sms_log_set_updated_at
  before update on public.sms_log
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Grants and policies. People read; every write goes through a function,
-- except the do-not-call list, which members add to themselves.
-- ---------------------------------------------------------------------------
revoke all on public.workspace_phone, public.phone_numbers, public.phone_opt_outs,
  public.call_batches, public.call_batch_leads, public.sms_log from anon, authenticated;
grant all on public.workspace_phone, public.phone_numbers, public.phone_opt_outs,
  public.call_batches, public.call_batch_leads, public.sms_log to service_role;
grant select on public.workspace_phone, public.phone_numbers, public.phone_opt_outs,
  public.call_batches, public.call_batch_leads, public.sms_log to authenticated;
grant insert, delete on public.phone_opt_outs to authenticated;

create policy "Members read phone settings" on public.workspace_phone for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));
create policy "Members read phone numbers" on public.phone_numbers for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));
create policy "Members read opt-outs" on public.phone_opt_outs for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));
-- Anyone on the team can put a number on the list, as themselves.
create policy "Members add to the do-not-call list" on public.phone_opt_outs for insert to authenticated
  with check (
    (select private.is_workspace_member(workspace_id))
    and source = 'person' and added_by = (select auth.uid())
  );
-- Only an owner or admin can take a number off, and never a STOP: that
-- person has to text START themselves.
create policy "Admins remove from the do-not-call list" on public.phone_opt_outs for delete to authenticated
  using ((select private.is_workspace_admin(workspace_id)) and source <> 'sms_stop' and source <> 'carrier');
create policy "Members read call batches" on public.call_batches for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));
create policy "Members read call batch leads" on public.call_batch_leads for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));
create policy "Members read texts" on public.sms_log for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));

-- ---------------------------------------------------------------------------
-- Settings (signed in)
-- ---------------------------------------------------------------------------

-- Saves the phone settings, for an owner or admin. p_settings has every key;
-- the app has checked them, and the table's checks hold the line again.
create function public.phone_settings_save(p_workspace_id uuid, p_settings jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_window jsonb := p_settings -> 'call_window';
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if not (select private.is_workspace_admin(p_workspace_id)) then
    raise exception 'only an owner or admin can change this' using errcode = '42501';
  end if;
  if jsonb_typeof(v_window -> 'days') <> 'array' or jsonb_array_length(v_window -> 'days') = 0
     or (v_window ->> 'start') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     or (v_window ->> 'end') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     or (v_window ->> 'start')::time >= (v_window ->> 'end')::time
     -- No earlier than 8 in the morning or later than 9 at night, ever.
     or (v_window ->> 'start')::time < '08:00' or (v_window ->> 'end')::time > '21:00' then
    raise exception 'the call window is out of range' using errcode = '22023';
  end if;
  insert into public.workspace_phone (workspace_id) values (p_workspace_id)
  on conflict (workspace_id) do nothing;
  update public.workspace_phone p set
    agent_on = coalesce((p_settings ->> 'agent_on')::boolean, p.agent_on),
    greeting = left(btrim(coalesce(p_settings ->> 'greeting', p.greeting)), 300),
    voice = coalesce(p_settings ->> 'voice', p.voice),
    language = coalesce(p_settings ->> 'language', p.language),
    transfer_number = private.e164(p_settings ->> 'transfer_number'),
    recording_on = coalesce((p_settings ->> 'recording_on')::boolean, p.recording_on),
    outbound_on = coalesce((p_settings ->> 'outbound_on')::boolean, p.outbound_on),
    call_window = jsonb_build_object(
      'days', v_window -> 'days', 'start', v_window ->> 'start', 'end', v_window ->> 'end'),
    daily_call_cap = coalesce((p_settings ->> 'daily_call_cap')::integer, p.daily_call_cap),
    max_call_minutes = coalesce((p_settings ->> 'max_call_minutes')::integer, p.max_call_minutes),
    sms_on = coalesce((p_settings ->> 'sms_on')::boolean, p.sms_on),
    sms_daily_cap = coalesce((p_settings ->> 'sms_daily_cap')::integer, p.sms_daily_cap),
    a2p_brand_status = coalesce(p_settings ->> 'a2p_brand_status', p.a2p_brand_status),
    a2p_campaign_status = coalesce(p_settings ->> 'a2p_campaign_status', p.a2p_campaign_status),
    messaging_service_sid = nullif(btrim(coalesce(p_settings ->> 'messaging_service_sid', '')), ''),
    updated_by = v_user
  where p.workspace_id = p_workspace_id;
end;
$$;
revoke all on function public.phone_settings_save(uuid, jsonb) from public, anon;
grant execute on function public.phone_settings_save(uuid, jsonb) to authenticated;

-- A number's daily cap and health statuses, for an owner or admin.
create function public.phone_number_update(
  p_number_id uuid, p_daily_cap integer, p_spam text, p_cnam text, p_shaken text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid;
begin
  select n.workspace_id into v_ws from public.phone_numbers n
  where n.id = p_number_id and n.status = 'active';
  if v_ws is null or not (select private.is_workspace_admin(v_ws)) then
    return false;
  end if;
  update public.phone_numbers n set
    daily_call_cap = p_daily_cap,
    spam_status = p_spam,
    spam_checked_at = case when p_spam <> n.spam_status then now() else n.spam_checked_at end,
    cnam_status = p_cnam,
    shaken_status = p_shaken
  where n.id = p_number_id;
  return true;
end;
$$;
revoke all on function public.phone_number_update(uuid, integer, text, text, text) from public, anon;
grant execute on function public.phone_number_update(uuid, integer, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Buying and releasing numbers (secret key only; the app has checked the
-- session, and the owner is checked again here)
-- ---------------------------------------------------------------------------
create function private.is_owner(p_workspace_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace_id and m.user_id = p_user_id and m.role = 'owner'
  );
$$;
revoke all on function private.is_owner(uuid, uuid) from public;

-- Holds a number for this workspace while Twilio is asked to buy it, within
-- the cap on numbers per workspace. 'ok' with the row's id, 'not_owner',
-- 'cap' or 'taken'.
create function public.phone_number_reserve(
  p_workspace_id uuid, p_user_id uuid, p_e164 text, p_country text, p_type text,
  p_price_micros bigint, p_currency text, p_max_numbers integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not private.is_owner(p_workspace_id, p_user_id) then
    return jsonb_build_object('status', 'not_owner');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('phone_numbers:' || p_workspace_id::text, 0));
  if (select count(*) from public.phone_numbers n
      where n.workspace_id = p_workspace_id and n.status <> 'released') >= p_max_numbers then
    return jsonb_build_object('status', 'cap');
  end if;
  begin
    insert into public.phone_numbers (workspace_id, e164, country, number_type, monthly_price_micros, currency, bought_by)
    values (p_workspace_id, private.e164(p_e164), p_country, p_type, p_price_micros, p_currency, p_user_id)
    returning id into v_id;
  exception when unique_violation or not_null_violation then
    return jsonb_build_object('status', 'taken');
  end;
  return jsonb_build_object('status', 'ok', 'id', v_id);
end;
$$;

-- Twilio bought it: the number is live. Or it didn't: the hold goes.
create function public.phone_number_bought(p_workspace_id uuid, p_number_id uuid, p_sid text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_sid is null then
    delete from public.phone_numbers n
    where n.id = p_number_id and n.workspace_id = p_workspace_id and n.status = 'buying';
    return;
  end if;
  update public.phone_numbers n set status = 'active', provider_sid = p_sid, bought_at = now()
  where n.id = p_number_id and n.workspace_id = p_workspace_id and n.status = 'buying';
  insert into public.workspace_phone (workspace_id) values (p_workspace_id)
  on conflict (workspace_id) do nothing;
end;
$$;

-- The owner released it (Twilio has already let it go).
create function public.phone_number_released(p_workspace_id uuid, p_user_id uuid, p_number_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_owner(p_workspace_id, p_user_id) then
    return false;
  end if;
  update public.phone_numbers n
  set status = 'released', released_at = now(), released_by = p_user_id
  where n.id = p_number_id and n.workspace_id = p_workspace_id and n.status = 'active';
  return found;
end;
$$;

-- ---------------------------------------------------------------------------
-- Calls (secret key only: the Twilio webhooks, after checking Twilio's
-- signature)
-- ---------------------------------------------------------------------------

-- Everything the agent needs for its next turn on a call, or null.
create function public.call_context(p_call_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_call public.calls%rowtype;
  v_ws public.workspaces%rowtype;
  v_phone public.workspace_phone%rowtype;
  v_agent public.agents%rowtype;
  v_lead public.leads%rowtype;
  v_batch public.call_batches%rowtype;
begin
  select * into v_call from public.calls c where c.id = p_call_id;
  if not found then
    return null;
  end if;
  select * into v_ws from public.workspaces w where w.id = v_call.workspace_id;
  select * into v_phone from public.workspace_phone p where p.workspace_id = v_call.workspace_id;
  select * into v_lead from public.leads l where l.id = v_call.lead_id and l.workspace_id = v_call.workspace_id;
  select * into v_batch from public.call_batches b where b.id = v_call.batch_id and b.workspace_id = v_call.workspace_id;
  -- The website chat's inbound agent holds the team's instructions and
  -- qualifying questions; the phone agent follows the same ones.
  select a.* into v_agent from public.agents a
  where a.workspace_id = v_call.workspace_id and a.role = 'inbound'
  order by (a.channel = 'chat') desc, a.created_at
  limit 1;
  return jsonb_build_object(
    'call', jsonb_build_object(
      'id', v_call.id, 'workspace_id', v_call.workspace_id, 'lead_id', v_call.lead_id,
      'conversation_id', v_call.conversation_id, 'direction', v_call.direction,
      'status', v_call.status, 'provider_sid', v_call.provider_sid,
      'from_number', v_call.from_number, 'to_number', v_call.to_number,
      'started_at', v_call.started_at, 'turns', v_call.turns, 'outcome', v_call.outcome,
      'transcript', v_call.transcript, 'purpose', coalesce(v_batch.purpose, '')
    ),
    'workspace', jsonb_build_object('name', v_ws.name, 'website', v_ws.website, 'timezone', v_ws.timezone),
    'phone', jsonb_build_object(
      'agent_on', coalesce(v_phone.agent_on, false), 'greeting', coalesce(v_phone.greeting, ''),
      'voice', coalesce(v_phone.voice, 'Polly.Joanna-Neural'), 'language', coalesce(v_phone.language, 'en-US'),
      'transfer_number', v_phone.transfer_number, 'recording_on', coalesce(v_phone.recording_on, false),
      'max_call_minutes', coalesce(v_phone.max_call_minutes, 10),
      'sms_ready', coalesce(v_phone.sms_on, false)
    ),
    'agent', jsonb_build_object(
      'instructions', coalesce(v_agent.instructions, ''),
      'qualifying_questions', coalesce(v_agent.qualifying_questions, '')
    ),
    'booking_url', (select s.booking_url from public.workspace_sending s where s.workspace_id = v_call.workspace_id),
    'lead', jsonb_build_object(
      'name', v_lead.name, 'company', v_lead.company, 'phone', v_lead.phone,
      'sms_opted_out', exists (
        select 1 from public.phone_opt_outs o
        where o.workspace_id = v_call.workspace_id and o.phone = private.e164(v_lead.phone) and o.channel = 'sms')
    ),
    'knowledge', coalesce((
      select jsonb_agg(jsonb_build_object('title', k.title, 'content', k.content, 'source_url', k.source_url)
                       order by k.created_at desc)
      from (
        select k.title, k.content, k.source_url, k.created_at
        from public.knowledge_items k
        where k.workspace_id = v_call.workspace_id and k.status = 'ready'
          and (k.kind = 'text' or k.source_url is not null)
        order by k.created_at desc
        limit 50
      ) k
    ), '[]'::jsonb)
  );
end;
$$;

-- An incoming call to one of a workspace's numbers. Finds the caller's lead
-- by number (or makes one), opens a voice conversation and the call. The
-- same Twilio call twice (a retried webhook) returns the same call.
-- Null when the number isn't any workspace's. Over p_daily_cap answered
-- calls today, 'over_cap' is true and the agent doesn't answer.
create function public.call_inbound_begin(
  p_to text, p_from text, p_sid text, p_daily_cap integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_number public.phone_numbers%rowtype;
  v_call uuid;
  v_lead uuid;
  v_conv uuid;
  v_from text := private.e164(p_from);
  v_ws public.workspaces%rowtype;
  v_today integer;
begin
  select c.id into v_call from public.calls c where c.provider_sid = p_sid;
  if v_call is not null then
    return jsonb_build_object('call_id', v_call, 'over_cap', false, 'repeat', true);
  end if;
  select n.* into v_number from public.phone_numbers n
  where n.e164 = private.e164(p_to) and n.status = 'active';
  if not found then
    return null;
  end if;
  select * into v_ws from public.workspaces w where w.id = v_number.workspace_id;
  if v_from is not null then
    select l.id into v_lead from public.leads l
    where l.workspace_id = v_number.workspace_id and private.e164(l.phone) = v_from
    order by l.created_at
    limit 1;
  end if;
  if v_lead is null then
    insert into public.leads (workspace_id, name, phone, source)
    values (v_number.workspace_id, '',
            coalesce(v_from, case when char_length(btrim(coalesce(p_from, ''))) between 3 and 40 then btrim(p_from) end),
            'phone')
    returning id into v_lead;
    insert into public.activity_events (workspace_id, lead_id, kind, summary, channel, metadata)
    values (v_number.workspace_id, v_lead, 'lead_created', 'New lead from a phone call', 'voice', '{}'::jsonb);
  end if;
  insert into public.conversations (workspace_id, lead_id, channel, status, last_message_at)
  values (v_number.workspace_id, v_lead, 'voice', 'open', now())
  returning id into v_conv;
  select count(*) into v_today from public.calls c
  where c.workspace_id = v_number.workspace_id and c.direction = 'inbound'
    and c.created_at >= private.local_day_start(v_ws.timezone);
  insert into public.calls (
    workspace_id, lead_id, conversation_id, direction, status, started_at,
    provider_sid, from_number, to_number, phone_number_id
  ) values (
    v_number.workspace_id, v_lead, v_conv, 'inbound', 'in_progress', now(),
    p_sid, left(coalesce(p_from, ''), 40), v_number.e164, v_number.id
  ) returning id into v_call;
  insert into public.activity_events (workspace_id, lead_id, kind, summary, channel, metadata)
  values (v_number.workspace_id, v_lead, 'call_received',
          'Incoming call to ' || v_number.e164, 'voice',
          jsonb_build_object('conversation_id', v_conv, 'call_id', v_call));
  return jsonb_build_object('call_id', v_call, 'over_cap', v_today >= p_daily_cap, 'repeat', false);
end;
$$;

-- The caller has been told the call is transcribed (and recorded). An
-- outbound call is answered here too: it becomes in progress, and the
-- answering machine's verdict is kept.
create function public.call_answered(p_call_id uuid, p_sid text, p_machine boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.calls c set
    provider_sid = coalesce(c.provider_sid, p_sid),
    status = case when p_machine then 'voicemail' when c.status in ('queued', 'ringing') then 'in_progress' else c.status end,
    started_at = coalesce(c.started_at, now()),
    disclosed_at = case when p_machine then c.disclosed_at else coalesce(c.disclosed_at, now()) end,
    outcome = case when p_machine then 'voicemail' else c.outcome end
  where c.id = p_call_id and (c.provider_sid is null or c.provider_sid = p_sid);
  return found;
end;
$$;

-- One turn of the conversation: what the caller said and what the agent
-- answered, with the agent's reading of the call so far.
--   p_result: { outcome, summary, handoff, stop_calls, stop_contact,
--               caller_name, caller_email }
-- Returns { status, alert_to: [emails] } where alert_to is set the first
-- time a call needs a person, for the team's alert email.
create function public.call_turn_commit(p_call_id uuid, p_heard text, p_said text, p_result jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_call public.calls%rowtype;
  v_lead public.leads%rowtype;
  v_heard text := left(btrim(coalesce(p_heard, '')), 4000);
  v_said text := left(btrim(coalesce(p_said, '')), 4000);
  v_outcome text := coalesce(nullif(p_result ->> 'outcome', ''), 'none');
  v_summary text := left(btrim(coalesce(p_result ->> 'summary', '')), 1000);
  v_handoff boolean := coalesce((p_result ->> 'handoff')::boolean, false);
  v_stop_calls boolean := coalesce((p_result ->> 'stop_calls')::boolean, false);
  v_stop boolean := coalesce((p_result ->> 'stop_contact')::boolean, false);
  v_name text := nullif(left(btrim(coalesce(p_result ->> 'caller_name', '')), 200), '');
  v_email text := nullif(lower(btrim(coalesce(p_result ->> 'caller_email', ''))), '');
  v_t integer;
  v_entries jsonb := '[]'::jsonb;
  v_first_handoff boolean;
  v_alert jsonb := '[]'::jsonb;
  v_phone text;
begin
  if v_outcome not in ('none', 'qualified', 'not_qualified', 'needs_human') then
    raise exception 'unknown outcome' using errcode = '22023';
  end if;
  select * into v_call from public.calls c where c.id = p_call_id for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  select * into v_lead from public.leads l
  where l.id = v_call.lead_id and l.workspace_id = v_call.workspace_id for update;
  v_t := greatest(0, extract(epoch from now() - coalesce(v_call.started_at, now()))::integer);
  if v_heard <> '' then
    v_entries := v_entries || jsonb_build_object('t', v_t, 'speaker', 'lead', 'text', v_heard);
    insert into public.messages (workspace_id, conversation_id, direction, author, body, delivery_status, metadata)
    values (v_call.workspace_id, v_call.conversation_id, 'in', 'lead', v_heard, 'received',
            jsonb_build_object('via', 'voice', 'call_id', v_call.id));
  end if;
  if v_said <> '' then
    v_entries := v_entries || jsonb_build_object('t', v_t, 'speaker', 'agent', 'text', v_said);
    insert into public.messages (workspace_id, conversation_id, direction, author, body, delivery_status, metadata)
    values (v_call.workspace_id, v_call.conversation_id, 'out', 'agent', v_said, 'delivered',
            jsonb_build_object('via', 'voice', 'call_id', v_call.id));
  end if;
  v_stop_calls := v_stop_calls or v_stop;
  v_handoff := v_handoff or v_outcome = 'needs_human';
  v_first_handoff := v_handoff and not v_call.handoff_requested;
  update public.calls c set
    transcript = (case when jsonb_array_length(c.transcript) < 400 then c.transcript || v_entries else c.transcript end),
    turns = c.turns + 1,
    summary = coalesce(nullif(v_summary, ''), c.summary),
    outcome = case
      when v_stop_calls then 'opted_out'
      when v_outcome <> 'none' then v_outcome
      else c.outcome end,
    handoff_requested = c.handoff_requested or v_handoff
  where c.id = v_call.id;
  update public.conversations c set
    last_message_at = now(),
    status = case when v_handoff then 'waiting_for_you' else c.status end,
    outcome = case when v_outcome <> 'none' then v_outcome else c.outcome end,
    outcome_summary = coalesce(nullif(v_summary, ''), c.outcome_summary)
  where c.id = v_call.conversation_id and c.workspace_id = v_call.workspace_id;

  if v_name is not null and v_lead.name in ('', 'Website visitor') then
    update public.leads l set name = v_name where l.id = v_lead.id;
  end if;
  if v_email is not null and v_lead.email is null and char_length(v_email) <= 254
     and v_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$'
     and not exists (select 1 from public.leads o where o.workspace_id = v_call.workspace_id and o.email = v_email) then
    update public.leads l set email = v_email where l.id = v_lead.id;
  end if;
  if v_outcome = 'qualified' and v_lead.status in ('new', 'engaged')
     and v_call.outcome is distinct from 'qualified' then
    update public.leads l set status = 'qualified' where l.id = v_lead.id;
    insert into public.activity_events (workspace_id, lead_id, kind, summary, channel, metadata)
    values (v_call.workspace_id, v_lead.id, 'lead_status_changed',
            left('Qualified on a call' || case when v_summary <> '' then ': ' || v_summary else '' end, 5000),
            'voice', jsonb_build_object('from', v_lead.status, 'to', 'qualified', 'conversation_id', v_call.conversation_id));
  end if;
  v_phone := coalesce(private.e164(v_lead.phone), private.e164(v_call.from_number), private.e164(v_call.to_number));
  if v_stop_calls then
    update public.leads l set consent_call = false, consent_call_at = null, consent_call_source = null
    where l.id = v_lead.id;
    if v_phone is not null then
      insert into public.phone_opt_outs (workspace_id, phone, channel, source, note)
      values (v_call.workspace_id, v_phone, 'call', 'call', 'Asked on a call not to be called again')
      on conflict do nothing;
    end if;
    insert into public.activity_events (workspace_id, lead_id, kind, summary, channel, metadata)
    values (v_call.workspace_id, v_lead.id, 'call_opt_out', 'Asked on a call not to be called again', 'voice',
            jsonb_build_object('conversation_id', v_call.conversation_id, 'call_id', v_call.id));
  end if;
  if v_stop and not v_lead.do_not_contact then
    update public.leads l set do_not_contact = true, do_not_contact_at = now() where l.id = v_lead.id;
    insert into public.activity_events (workspace_id, lead_id, kind, summary, channel, metadata)
    values (v_call.workspace_id, v_lead.id, 'do_not_contact', 'Asked on a call not to be contacted again', 'voice',
            jsonb_build_object('conversation_id', v_call.conversation_id));
  end if;
  if v_first_handoff then
    insert into public.activity_events (workspace_id, lead_id, kind, summary, channel, metadata)
    values (v_call.workspace_id, v_lead.id, 'handoff_requested',
            left('A call needs a person' || case when v_summary <> '' then ': ' || v_summary else '' end, 5000),
            'voice', jsonb_build_object('conversation_id', v_call.conversation_id, 'call_id', v_call.id));
    select coalesce(jsonb_agg(p.email order by p.email), '[]'::jsonb) into v_alert
    from public.workspace_members m join public.profiles p on p.id = m.user_id
    where m.workspace_id = v_call.workspace_id and p.alert_emails and p.email <> '';
  end if;
  return jsonb_build_object('status', 'ok', 'alert_to', v_alert);
end;
$$;

-- The live transfer to a person: whether anyone picked up.
create function public.call_transfer_result(p_call_id uuid, p_connected boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_call public.calls%rowtype;
begin
  update public.calls c set outcome = case when p_connected then 'transferred' else coalesce(c.outcome, 'needs_human') end,
    handoff_requested = true
  where c.id = p_call_id
  returning * into v_call;
  if not found then
    return;
  end if;
  update public.conversations c
  set status = case when p_connected then c.status else 'waiting_for_you' end
  where c.id = v_call.conversation_id and c.workspace_id = v_call.workspace_id;
  insert into public.activity_events (workspace_id, lead_id, kind, summary, channel, metadata)
  values (v_call.workspace_id, v_call.lead_id, case when p_connected then 'call_transferred' else 'call_transfer_missed' end,
          case when p_connected then 'Call transferred to the team' else 'Nobody picked up the transfer: call them back' end,
          'voice', jsonb_build_object('conversation_id', v_call.conversation_id, 'call_id', v_call.id));
end;
$$;

-- What Twilio's status callback said when the call ended (or a recording
-- became ready). Only moves forward: an ended call stays ended.
create function public.call_status(
  p_sid text, p_status text, p_duration integer, p_recording_sid text, p_error text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_call public.calls%rowtype;
  v_status text;
begin
  select * into v_call from public.calls c where c.provider_sid = p_sid for update;
  if not found then
    return;
  end if;
  if p_recording_sid is not null then
    update public.calls c set recording_sid = p_recording_sid where c.id = v_call.id;
  end if;
  if p_status is null then
    return;
  end if;
  v_status := case p_status
    when 'completed' then case
      when v_call.status = 'voicemail' then 'voicemail'
      when v_call.direction = 'outbound' and v_call.status in ('queued', 'ringing') then 'missed'
      else 'completed' end
    when 'busy' then 'missed'
    when 'no-answer' then 'missed'
    when 'canceled' then 'missed'
    when 'failed' then 'failed'
    when 'ringing' then 'ringing'
    when 'in-progress' then 'in_progress'
    else null end;
  if v_status is null or v_call.ended_at is not null then
    return;
  end if;
  if v_status in ('ringing', 'in_progress') then
    update public.calls c set status = v_status where c.id = v_call.id and c.status in ('queued', 'ringing');
    return;
  end if;
  update public.calls c set
    status = v_status,
    ended_at = now(),
    duration_seconds = greatest(0, coalesce(p_duration, 0)),
    outcome = coalesce(c.outcome, case v_status when 'missed' then 'no_answer' when 'voicemail' then 'voicemail' else 'none' end),
    error = left(p_error, 300)
  where c.id = v_call.id;
  update public.call_batch_leads i set status = 'called'
  where i.call_id = v_call.id and i.workspace_id = v_call.workspace_id and i.status = 'calling';
  -- A missed inbound call, or one nobody but the agent heard and that ended
  -- with a wish for a person, waits in the Inbox.
  if v_call.direction = 'inbound' and v_call.turns = 0 then
    update public.conversations c set status = 'waiting_for_you'
    where c.id = v_call.conversation_id and c.workspace_id = v_call.workspace_id;
  end if;
  insert into public.activity_events (workspace_id, lead_id, kind, summary, channel, metadata)
  values (v_call.workspace_id, v_call.lead_id, 'call_ended',
          left(case v_status
            when 'completed' then 'Call ended after ' || greatest(0, coalesce(p_duration, 0)) || ' seconds'
              || coalesce(': ' || nullif(v_call.summary, ''), '')
            when 'missed' then case when v_call.direction = 'outbound' then 'No answer' else 'Missed call' end
            when 'voicemail' then 'Reached voicemail; no message was left'
            else 'The call failed' end, 5000),
          'voice', jsonb_build_object('conversation_id', v_call.conversation_id, 'call_id', v_call.id));
  -- Every batch lead is called or skipped: the batch is done.
  if v_call.batch_id is not null and not exists (
    select 1 from public.call_batch_leads i
    where i.batch_id = v_call.batch_id and i.workspace_id = v_call.workspace_id and i.status in ('waiting', 'calling')
  ) then
    update public.call_batches b set status = 'done'
    where b.id = v_call.batch_id and b.workspace_id = v_call.workspace_id and b.status = 'approved';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Outbound call batches
-- ---------------------------------------------------------------------------

-- Why this lead can't be called right now, or null when they can. Checked
-- when a batch is made and again for every call.
create function private.call_block_reason(p_workspace_id uuid, p_lead public.leads)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_lead.do_not_contact then 'Marked do not contact'
    when p_lead.status = 'unsubscribed' then 'Unsubscribed'
    when not p_lead.consent_call or nullif(btrim(coalesce(p_lead.consent_call_source, '')), '') is null
      then 'No recorded consent to be called'
    when private.e164(p_lead.phone) is null then 'No phone number in international form (+1...)'
    when exists (select 1 from public.phone_opt_outs o
                 where o.workspace_id = p_workspace_id and o.phone = private.e164(p_lead.phone) and o.channel = 'call')
      then 'On the do-not-call list'
    when cardinality(private.phone_zones(p_lead.phone, p_lead.time_zone)) = 0
      then 'Time zone unknown: set it on the lead'
  end;
$$;
revoke all on function private.call_block_reason(uuid, public.leads) from public;

-- A member makes a batch from chosen leads. Leads that can't be called are
-- kept with the reason, so the person approving sees who is left out. The
-- batch waits for an owner's or admin's approval. Returns its id.
create function public.call_batch_create(
  p_workspace_id uuid, p_name text, p_purpose text, p_lead_ids uuid[], p_max_leads integer, p_max_open integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_batch uuid;
  v_lead public.leads%rowtype;
  v_reason text;
  v_count integer := 0;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if not (select private.is_workspace_member(p_workspace_id)) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  if cardinality(coalesce(p_lead_ids, '{}'::uuid[])) = 0 then
    raise exception 'choose at least one lead' using errcode = '22023';
  end if;
  if cardinality(p_lead_ids) > p_max_leads then
    raise exception 'too many leads for one batch' using errcode = '22023';
  end if;
  if (select count(*) from public.call_batches b
      where b.workspace_id = p_workspace_id and b.status in ('waiting_approval', 'approved')) >= p_max_open then
    raise exception 'too many open batches' using errcode = 'DV429';
  end if;
  insert into public.call_batches (workspace_id, name, purpose, created_by)
  values (p_workspace_id, left(btrim(p_name), 120), left(btrim(coalesce(p_purpose, '')), 2000), v_user)
  returning id into v_batch;
  for v_lead in
    select l.* from public.leads l
    where l.workspace_id = p_workspace_id and l.id = any (p_lead_ids)
  loop
    v_reason := private.call_block_reason(p_workspace_id, v_lead);
    insert into public.call_batch_leads (workspace_id, batch_id, lead_id, phone, status, skip_reason)
    values (p_workspace_id, v_batch, v_lead.id, private.e164(v_lead.phone),
            case when v_reason is null then 'waiting' else 'skipped' end, v_reason);
    v_count := v_count + 1;
  end loop;
  update public.call_batches b set lead_count = v_count where b.id = v_batch;
  return v_batch;
end;
$$;
revoke all on function public.call_batch_create(uuid, text, text, uuid[], integer, integer) from public, anon;
grant execute on function public.call_batch_create(uuid, text, text, uuid[], integer, integer) to authenticated;

-- An owner or admin approves a batch (calls may start inside the call
-- window) or cancels it (nothing more is dialled). False when not allowed.
create function public.call_batch_decide(p_batch_id uuid, p_approve boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_batch public.call_batches%rowtype;
begin
  select * into v_batch from public.call_batches b where b.id = p_batch_id for update;
  if not found or v_user is null or not (select private.is_workspace_admin(v_batch.workspace_id)) then
    return false;
  end if;
  if p_approve then
    if v_batch.status <> 'waiting_approval' then
      return false;
    end if;
    update public.call_batches b set status = 'approved', approved_by = v_user, approved_at = now()
    where b.id = v_batch.id;
  else
    if v_batch.status not in ('waiting_approval', 'approved') then
      return false;
    end if;
    update public.call_batches b set status = 'cancelled', cancelled_at = now() where b.id = v_batch.id;
    update public.call_batch_leads i set status = 'cancelled'
    where i.batch_id = v_batch.id and i.workspace_id = v_batch.workspace_id and i.status = 'waiting';
  end if;
  return true;
end;
$$;
revoke all on function public.call_batch_decide(uuid, boolean) from public, anon;
grant execute on function public.call_batch_decide(uuid, boolean) to authenticated;

-- A number is resting when its recent answer rate is so low that carriers
-- are probably labelling it: at least p_min_calls outbound calls in three
-- days, and under p_min_rate of them answered.
create function private.number_resting(p_number_id uuid, p_min_calls integer, p_min_rate numeric)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) >= p_min_calls
     and (count(*) filter (where c.status = 'completed' and coalesce(c.duration_seconds, 0) >= 10))::numeric
         / greatest(count(*), 1) < p_min_rate
  from public.calls c
  where c.phone_number_id = p_number_id and c.direction = 'outbound'
    and c.created_at > now() - interval '3 days' and c.ended_at is not null;
$$;
revoke all on function private.number_resting(uuid, integer, numeric) from public;

-- Hands the server the outbound calls it may place now, at most p_limit,
-- each with a fresh calls row ('queued') and the number to call from. Every
-- rule in the header is checked here, under row locks, so two servers can't
-- both place the same call or pass a cap.
create function public.call_claim(p_limit integer, p_rest_min_calls integer, p_rest_min_rate numeric)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item record;
  v_lead public.leads%rowtype;
  v_phone public.workspace_phone%rowtype;
  v_ws public.workspaces%rowtype;
  v_reason text;
  v_number public.phone_numbers%rowtype;
  v_conv uuid;
  v_call uuid;
  v_out jsonb := '[]'::jsonb;
  v_n integer := 0;
begin
  for v_item in
    select i.id, i.workspace_id, i.lead_id, i.batch_id
    from public.call_batch_leads i
    join public.call_batches b on b.id = i.batch_id and b.workspace_id = i.workspace_id and b.status = 'approved'
    join public.workspace_phone p on p.workspace_id = i.workspace_id and p.outbound_on
    where i.status = 'waiting' and i.next_try_at <= now()
    order by i.next_try_at, i.created_at
    limit greatest(p_limit, 0) * 5
    for update of i skip locked
  loop
    exit when v_n >= p_limit;
    select * into v_lead from public.leads l where l.id = v_item.lead_id and l.workspace_id = v_item.workspace_id;
    select * into v_phone from public.workspace_phone p where p.workspace_id = v_item.workspace_id;
    select * into v_ws from public.workspaces w where w.id = v_item.workspace_id;
    v_reason := private.call_block_reason(v_item.workspace_id, v_lead);
    if v_reason is not null then
      update public.call_batch_leads i set status = 'skipped', skip_reason = v_reason where i.id = v_item.id;
      continue;
    end if;
    if not private.call_window_open(v_phone.call_window, private.phone_zones(v_lead.phone, v_lead.time_zone), now()) then
      update public.call_batch_leads i set next_try_at = now() + interval '15 minutes' where i.id = v_item.id;
      continue;
    end if;
    -- The workspace's cap for today, counted in its own time zone.
    perform pg_advisory_xact_lock(hashtextextended('calls_out:' || v_item.workspace_id::text, 0));
    if (select count(*) from public.calls c
        where c.workspace_id = v_item.workspace_id and c.direction = 'outbound'
          and c.created_at >= private.local_day_start(v_ws.timezone)) >= v_phone.daily_call_cap then
      update public.call_batch_leads i set next_try_at = private.local_day_start(v_ws.timezone) + interval '1 day'
      where i.id = v_item.id;
      continue;
    end if;
    -- A number under its own cap that isn't resting; one with the lead's
    -- country code first.
    select n.* into v_number from public.phone_numbers n
    where n.workspace_id = v_item.workspace_id and n.status = 'active' and n.spam_status <> 'flagged'
      and (select count(*) from public.calls c
           where c.phone_number_id = n.id and c.direction = 'outbound'
             and c.created_at >= private.local_day_start(v_ws.timezone)) < n.daily_call_cap
      and not private.number_resting(n.id, p_rest_min_calls, p_rest_min_rate)
    order by (left(n.e164, 2) = left(private.e164(v_lead.phone), 2)) desc, n.bought_at
    limit 1;
    if not found then
      update public.call_batch_leads i set next_try_at = now() + interval '1 hour' where i.id = v_item.id;
      continue;
    end if;
    insert into public.conversations (workspace_id, lead_id, channel, status, last_message_at)
    values (v_item.workspace_id, v_lead.id, 'voice', 'open', now())
    returning id into v_conv;
    insert into public.calls (workspace_id, lead_id, conversation_id, direction, status, from_number, to_number, phone_number_id, batch_id)
    values (v_item.workspace_id, v_lead.id, v_conv, 'outbound', 'queued', v_number.e164, private.e164(v_lead.phone), v_number.id, v_item.batch_id)
    returning id into v_call;
    update public.call_batch_leads i set status = 'calling', call_id = v_call, attempts = i.attempts + 1
    where i.id = v_item.id;
    v_out := v_out || jsonb_build_object(
      'call_id', v_call, 'workspace_id', v_item.workspace_id, 'from', v_number.e164,
      'to', private.e164(v_lead.phone), 'max_minutes', v_phone.max_call_minutes,
      'recording_on', v_phone.recording_on);
    v_n := v_n + 1;
  end loop;
  return v_out;
end;
$$;

-- Twilio accepted the call (its sid) or refused it (the error).
create function public.call_placed(p_call_id uuid, p_workspace_id uuid, p_sid text, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_call public.calls%rowtype;
begin
  if p_sid is not null then
    update public.calls c set provider_sid = coalesce(c.provider_sid, p_sid),
      status = case when c.status = 'queued' then 'ringing' else c.status end
    where c.id = p_call_id and c.workspace_id = p_workspace_id
    returning * into v_call;
    if found then
      insert into public.activity_events (workspace_id, lead_id, kind, summary, channel, metadata)
      values (v_call.workspace_id, v_call.lead_id, 'call_placed', 'Calling ' || coalesce(v_call.to_number, ''), 'voice',
              jsonb_build_object('conversation_id', v_call.conversation_id, 'call_id', v_call.id));
    end if;
    return;
  end if;
  update public.calls c set status = 'failed', ended_at = now(), error = left(coalesce(p_error, 'failed'), 300), outcome = 'none'
  where c.id = p_call_id and c.workspace_id = p_workspace_id and c.status = 'queued';
  update public.call_batch_leads i set status = 'skipped', skip_reason = left('The call could not be placed: ' || coalesce(p_error, ''), 80)
  where i.call_id = p_call_id and i.workspace_id = p_workspace_id and i.status = 'calling';
end;
$$;

-- ---------------------------------------------------------------------------
-- SMS
-- ---------------------------------------------------------------------------

-- An incoming text to a workspace's number. STOP (and its synonyms) opts
-- the number out of texts for good, until it texts START; START opts it
-- back in. Anything else is a message in the lead's SMS conversation,
-- waiting for the team. Returns { kind: stop | start | help | message } or
-- null when the number isn't any workspace's. A repeated webhook does
-- nothing twice.
create function public.sms_inbound(p_to text, p_from text, p_body text, p_sid text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_number public.phone_numbers%rowtype;
  v_from text := private.e164(p_from);
  v_lead uuid;
  v_conv uuid;
  v_word text := upper(regexp_replace(btrim(coalesce(p_body, '')), '[^A-Za-z]', '', 'g'));
  v_kind text;
  v_body text := left(coalesce(nullif(btrim(coalesce(p_body, '')), ''), '(empty text)'), 1600);
begin
  if exists (select 1 from public.sms_log s where s.provider_sid = p_sid) then
    return jsonb_build_object('kind', 'repeat');
  end if;
  select n.* into v_number from public.phone_numbers n
  where n.e164 = private.e164(p_to) and n.status = 'active';
  if not found or v_from is null then
    return null;
  end if;
  v_kind := case
    when v_word in ('STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'REVOKE', 'OPTOUT') then 'stop'
    when v_word in ('START', 'UNSTOP', 'YES') then 'start'
    when v_word in ('HELP', 'INFO') then 'help'
    else 'message' end;
  select l.id into v_lead from public.leads l
  where l.workspace_id = v_number.workspace_id and private.e164(l.phone) = v_from
  order by l.created_at limit 1;
  if v_lead is null then
    insert into public.leads (workspace_id, name, phone, source)
    values (v_number.workspace_id, '', v_from, 'sms')
    returning id into v_lead;
  end if;
  select c.id into v_conv from public.conversations c
  where c.workspace_id = v_number.workspace_id and c.lead_id = v_lead and c.channel = 'sms'
  order by c.created_at desc limit 1;
  if v_conv is null then
    insert into public.conversations (workspace_id, lead_id, channel, status, last_message_at)
    values (v_number.workspace_id, v_lead, 'sms', 'open', now())
    returning id into v_conv;
  end if;
  insert into public.sms_log (workspace_id, lead_id, conversation_id, phone_number_id, direction, to_number, from_number, body, provider_sid, status, reason)
  values (v_number.workspace_id, v_lead, v_conv, v_number.id, 'in', v_number.e164, v_from, v_body, p_sid, 'received', 'reply');
  insert into public.messages (workspace_id, conversation_id, direction, author, body, delivery_status, metadata)
  values (v_number.workspace_id, v_conv, 'in', 'lead', v_body, 'received', jsonb_build_object('via', 'sms', 'keyword', v_kind));
  update public.conversations c set last_message_at = now(),
    status = case when v_kind = 'message' then 'waiting_for_you' else c.status end
  where c.id = v_conv;
  if v_kind = 'stop' then
    insert into public.phone_opt_outs (workspace_id, phone, channel, source, note)
    values (v_number.workspace_id, v_from, 'sms', 'sms_stop', 'Texted ' || left(v_word, 20))
    on conflict (workspace_id, phone, channel) do update set source = 'sms_stop', note = excluded.note, created_at = now();
    update public.leads l set consent_sms = false, consent_sms_at = null, consent_sms_source = null
    where l.id = v_lead;
    insert into public.activity_events (workspace_id, lead_id, kind, summary, channel, metadata)
    values (v_number.workspace_id, v_lead, 'sms_opt_out', 'Texted ' || left(v_word, 20) || ': no more texts', 'sms',
            jsonb_build_object('conversation_id', v_conv));
  elsif v_kind = 'start' then
    delete from public.phone_opt_outs o
    where o.workspace_id = v_number.workspace_id and o.phone = v_from and o.channel = 'sms';
    update public.leads l set consent_sms = true, consent_sms_at = now(),
      consent_sms_source = 'Texted ' || left(v_word, 20) || ' to ' || v_number.e164
    where l.id = v_lead;
    insert into public.activity_events (workspace_id, lead_id, kind, summary, channel, metadata)
    values (v_number.workspace_id, v_lead, 'consent_changed', 'Texted ' || left(v_word, 20) || ': texts allowed again', 'sms',
            jsonb_build_object('conversation_id', v_conv, 'channel', 'sms', 'on', true));
  else
    insert into public.activity_events (workspace_id, lead_id, kind, summary, channel, metadata)
    values (v_number.workspace_id, v_lead, 'sms_received', left('Text received: ' || v_body, 5000), 'sms',
            jsonb_build_object('conversation_id', v_conv));
  end if;
  return jsonb_build_object('kind', v_kind, 'workspace_id', v_number.workspace_id, 'lead_id', v_lead);
end;
$$;

-- Why a text can't go to this lead now, or null. Consent is not needed for
-- the one text a caller asked for (the booking link).
create function private.sms_block_reason(p_workspace_id uuid, p_lead public.leads, p_need_consent boolean)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_lead.do_not_contact then 'Marked do not contact'
    when p_lead.status = 'unsubscribed' then 'Unsubscribed'
    when p_need_consent and (not p_lead.consent_sms or nullif(btrim(coalesce(p_lead.consent_sms_source, '')), '') is null)
      then 'No recorded consent to be texted'
    when private.e164(p_lead.phone) is null then 'No phone number in international form (+1...)'
    when exists (select 1 from public.phone_opt_outs o
                 where o.workspace_id = p_workspace_id and o.phone = private.e164(p_lead.phone) and o.channel = 'sms')
      then 'Texted STOP'
  end;
$$;
revoke all on function private.sms_block_reason(uuid, public.leads, boolean) from public;

-- Sets up one text to a lead: checks every rule, the call window and the
-- workspace's daily cap, picks the number, and records the text as
-- 'sending' with its message in the SMS conversation. Returns
-- { status: 'ok', sms_id, from, to, messaging_service_sid } or
-- { status: <why not>, retry_at? }.
create function private.sms_prepare(
  p_workspace_id uuid, p_lead_id uuid, p_body text, p_reason text, p_need_consent boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead public.leads%rowtype;
  v_phone public.workspace_phone%rowtype;
  v_ws public.workspaces%rowtype;
  v_number public.phone_numbers%rowtype;
  v_reason text;
  v_conv uuid;
  v_sms uuid;
  v_body text := left(btrim(coalesce(p_body, '')), 1600);
begin
  select * into v_lead from public.leads l where l.id = p_lead_id and l.workspace_id = p_workspace_id;
  select * into v_phone from public.workspace_phone p where p.workspace_id = p_workspace_id;
  select * into v_ws from public.workspaces w where w.id = p_workspace_id;
  if v_lead.id is null or v_body = '' then
    return jsonb_build_object('status', 'skipped', 'reason', 'Nothing to send');
  end if;
  if v_phone.workspace_id is null or not v_phone.sms_on then
    return jsonb_build_object('status', 'off', 'reason', 'Texting is switched off');
  end if;
  v_reason := private.sms_block_reason(p_workspace_id, v_lead, p_need_consent);
  if v_reason is not null then
    return jsonb_build_object('status', 'skipped', 'reason', v_reason);
  end if;
  if p_need_consent and not private.call_window_open(v_phone.call_window, private.phone_zones(v_lead.phone, v_lead.time_zone), now()) then
    return jsonb_build_object('status', 'later', 'retry_at', now() + interval '15 minutes');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('sms_out:' || p_workspace_id::text, 0));
  if (select count(*) from public.sms_log s
      where s.workspace_id = p_workspace_id and s.direction = 'out'
        and s.created_at >= private.local_day_start(v_ws.timezone)) >= v_phone.sms_daily_cap then
    return jsonb_build_object('status', 'later', 'retry_at', private.local_day_start(v_ws.timezone) + interval '1 day');
  end if;
  select n.* into v_number from public.phone_numbers n
  where n.workspace_id = p_workspace_id and n.status = 'active'
  order by (left(n.e164, 2) = left(private.e164(v_lead.phone), 2)) desc, n.bought_at
  limit 1;
  if not found then
    return jsonb_build_object('status', 'off', 'reason', 'No phone number');
  end if;
  -- US local numbers can only text once the A2P 10DLC campaign is approved.
  if v_number.e164 ~ '^\+1' and v_number.number_type = 'local' and v_phone.a2p_campaign_status <> 'approved' then
    return jsonb_build_object('status', 'off', 'reason', 'A2P 10DLC registration isn''t approved yet');
  end if;
  select c.id into v_conv from public.conversations c
  where c.workspace_id = p_workspace_id and c.lead_id = v_lead.id and c.channel = 'sms'
  order by c.created_at desc limit 1;
  if v_conv is null then
    insert into public.conversations (workspace_id, lead_id, channel, status, last_message_at)
    values (p_workspace_id, v_lead.id, 'sms', 'open', now())
    returning id into v_conv;
  end if;
  insert into public.sms_log (workspace_id, lead_id, conversation_id, phone_number_id, direction, to_number, from_number, body, status, reason)
  values (p_workspace_id, v_lead.id, v_conv, v_number.id, 'out', private.e164(v_lead.phone), v_number.e164, v_body, 'sending', p_reason)
  returning id into v_sms;
  insert into public.messages (workspace_id, conversation_id, direction, author, body, delivery_status, metadata)
  values (p_workspace_id, v_conv, 'out', 'agent', v_body, 'queued', jsonb_build_object('via', 'sms', 'sms_id', v_sms));
  update public.conversations c set last_message_at = now() where c.id = v_conv;
  return jsonb_build_object('status', 'ok', 'sms_id', v_sms, 'from', v_number.e164,
    'to', private.e164(v_lead.phone), 'messaging_service_sid', v_phone.messaging_service_sid);
end;
$$;
revoke all on function private.sms_prepare(uuid, uuid, text, text, boolean) from public;

-- The booking link a caller asked for on a call, by text.
create function public.sms_booking_link(p_call_id uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_call public.calls%rowtype;
begin
  select * into v_call from public.calls c where c.id = p_call_id;
  if not found then
    return jsonb_build_object('status', 'skipped', 'reason', 'No such call');
  end if;
  if exists (select 1 from public.sms_log s
             where s.workspace_id = v_call.workspace_id and s.lead_id = v_call.lead_id
               and s.reason = 'booking_link' and s.created_at > now() - interval '1 day') then
    return jsonb_build_object('status', 'skipped', 'reason', 'Already sent today');
  end if;
  return private.sms_prepare(v_call.workspace_id, v_call.lead_id, p_body, 'booking_link', false);
end;
$$;

-- What Twilio said when the text was handed over: its sid, or the error.
-- Error 21610 means the person texted STOP to that number before.
create function public.sms_sent(p_sms_id uuid, p_workspace_id uuid, p_sid text, p_error_code integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sms public.sms_log%rowtype;
begin
  update public.sms_log s set
    provider_sid = coalesce(p_sid, s.provider_sid),
    status = case when p_sid is not null then 'sent' else 'failed' end,
    error_code = p_error_code
  where s.id = p_sms_id and s.workspace_id = p_workspace_id and s.status = 'sending'
  returning * into v_sms;
  if not found then
    return;
  end if;
  update public.messages m set delivery_status = case when p_sid is not null then 'sent' else 'failed' end
  where m.workspace_id = p_workspace_id and m.conversation_id = v_sms.conversation_id
    and m.metadata ->> 'sms_id' = v_sms.id::text;
  if p_error_code = 21610 then
    insert into public.phone_opt_outs (workspace_id, phone, channel, source, note)
    values (p_workspace_id, v_sms.to_number, 'sms', 'carrier', 'The carrier says they opted out')
    on conflict do nothing;
  end if;
  if p_sid is not null then
    insert into public.activity_events (workspace_id, lead_id, kind, summary, channel, metadata)
    values (p_workspace_id, v_sms.lead_id, 'sms_sent', left('Text sent: ' || v_sms.body, 5000), 'sms',
            jsonb_build_object('conversation_id', v_sms.conversation_id, 'sms_id', v_sms.id));
  end if;
end;
$$;

-- The carrier's later word on a text: delivered, undelivered or failed.
create function public.sms_status(p_sid text, p_status text, p_error_code integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sms public.sms_log%rowtype;
  v_status text := case p_status
    when 'delivered' then 'delivered' when 'undelivered' then 'undelivered'
    when 'failed' then 'failed' when 'sent' then 'sent' else null end;
begin
  if v_status is null then
    return;
  end if;
  update public.sms_log s set status = v_status, error_code = coalesce(p_error_code, s.error_code)
  where s.provider_sid = p_sid and s.direction = 'out' and s.status in ('sending', 'sent')
  returning * into v_sms;
  if not found then
    return;
  end if;
  update public.messages m set delivery_status = case v_status
      when 'delivered' then 'delivered' when 'sent' then 'sent' else 'failed' end
  where m.workspace_id = v_sms.workspace_id and m.conversation_id = v_sms.conversation_id
    and m.metadata ->> 'sms_id' = v_sms.id::text;
  if p_error_code = 21610 then
    insert into public.phone_opt_outs (workspace_id, phone, channel, source, note)
    values (v_sms.workspace_id, v_sms.to_number, 'sms', 'carrier', 'The carrier says they opted out')
    on conflict do nothing;
  end if;
end;
$$;

-- Server-only grants.
do $grants$
declare
  f text;
begin
  foreach f in array array[
    'public.phone_number_reserve(uuid, uuid, text, text, text, bigint, text, integer)',
    'public.phone_number_bought(uuid, uuid, text)',
    'public.phone_number_released(uuid, uuid, uuid)',
    'public.call_context(uuid)',
    'public.call_inbound_begin(text, text, text, integer)',
    'public.call_answered(uuid, text, boolean)',
    'public.call_turn_commit(uuid, text, text, jsonb)',
    'public.call_transfer_result(uuid, boolean)',
    'public.call_status(text, text, integer, text, text)',
    'public.call_claim(integer, integer, numeric)',
    'public.call_placed(uuid, uuid, text, text)',
    'public.sms_inbound(text, text, text, text)',
    'public.sms_booking_link(uuid, text)',
    'public.sms_sent(uuid, uuid, text, integer)',
    'public.sms_status(text, text, integer)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$grants$;
