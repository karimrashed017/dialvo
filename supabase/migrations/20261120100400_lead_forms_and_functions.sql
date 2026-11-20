-- Slice 1, part 5: lead-capture forms, and the three functions the app calls:
-- create_workspace (onboarding), my_invitations / accept_invitation, and
-- capture_lead (the public form endpoint).

create table public.lead_forms (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  -- The public part of the form's address. Unguessable, not secret: it sits
  -- in the customer's page source. It only lets someone add a lead.
  token text not null unique
    default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  enabled boolean not null default true,
  -- Where a plain HTML form sends the visitor afterwards (optional).
  redirect_url text check (redirect_url is null or (redirect_url ~ '^https?://' and char_length(redirect_url) <= 500)),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id)
);
alter table public.lead_forms enable row level security;
create index lead_forms_workspace_idx on public.lead_forms (workspace_id);
create index lead_forms_created_by_idx on public.lead_forms (created_by);

create trigger lead_forms_set_updated_at
  before update on public.lead_forms
  for each row execute function private.set_updated_at();

revoke all on public.lead_forms from anon, authenticated;
grant all on public.lead_forms to service_role;
grant select, delete on public.lead_forms to authenticated;
grant insert (workspace_id, name, redirect_url, created_by) on public.lead_forms to authenticated;
grant update (name, enabled, redirect_url) on public.lead_forms to authenticated;

create policy "Members read lead forms" on public.lead_forms for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));
create policy "Admins add lead forms" on public.lead_forms for insert to authenticated
  with check ((select private.is_workspace_admin(workspace_id)) and created_by = (select auth.uid()));
create policy "Admins edit lead forms" on public.lead_forms for update to authenticated
  using ((select private.is_workspace_admin(workspace_id)))
  with check ((select private.is_workspace_admin(workspace_id)));
create policy "Admins delete lead forms" on public.lead_forms for delete to authenticated
  using ((select private.is_workspace_admin(workspace_id)));

-- ---------------------------------------------------------------------------
-- create_workspace: onboarding. Makes the workspace, makes the caller its
-- owner, adds the four agents (switched off) and a first lead form, and
-- stores "what you sell" as the first knowledge item.
--
-- How many workspaces one person may own follows the plan: one, or five when
-- one of theirs is on Scale. The plan itself is only ever set by the server.
-- ---------------------------------------------------------------------------
create function public.create_workspace(
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

  if nullif(btrim(p_what_you_sell), '') is not null then
    insert into public.knowledge_items (workspace_id, title, kind, content, status, created_by)
    values (v_id, 'What we sell', 'text', left(btrim(p_what_you_sell), 100000), 'ready', v_user);
  end if;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Invitations, from the invited person's side. Both functions match on the
-- caller's own confirmed email address, so knowing an invitation's id is
-- never enough to join.
-- ---------------------------------------------------------------------------
create function public.my_invitations()
returns table (id uuid, workspace_id uuid, workspace_name text, role text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.workspace_id, w.name, i.role, i.created_at
  from public.invitations i
  join public.workspaces w on w.id = i.workspace_id
  join auth.users u on lower(u.email) = i.email
  where u.id = (select auth.uid())
    and u.email_confirmed_at is not null
    and i.status = 'pending'
    and i.expires_at > now()
  order by i.created_at;
$$;

create function public.accept_invitation(p_invitation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_inv public.invitations%rowtype;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  select i.* into v_inv
  from public.invitations i
  join auth.users u on lower(u.email) = i.email
  where i.id = p_invitation_id
    and u.id = v_user
    and u.email_confirmed_at is not null
    and i.status = 'pending'
    and i.expires_at > now()
  for update of i;

  if not found then
    raise exception 'invitation not found' using errcode = 'P0002';
  end if;

  -- Already in the workspace: keep the role they have.
  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_inv.workspace_id, v_user, v_inv.role)
  on conflict (workspace_id, user_id) do nothing;

  update public.invitations
  set status = 'accepted', accepted_at = now()
  where id = v_inv.id;

  return v_inv.workspace_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- capture_lead: the public form endpoint's one write, and the only thing the
-- anon role can do in this database. The route handler validates and
-- rate-limits per visitor, then calls this (with the secret key when the
-- server has one, otherwise as anon). Because the publishable key lets anyone
-- call it directly, it trusts nothing: it checks every field again and has
-- its own brake (30 captures a minute and 2,000 a day per form, SQLSTATE
-- DV429), and it returns nothing about the lead. Everything is scoped to the
-- workspace that owns the form token, in one transaction: the lead (matched by email, then phone), a conversation waiting for the
-- team, the visitor's message if there was one, and a feed event.
--
-- Consent is only ever switched on here, and only for the channels the
-- payload says the visitor agreed to. A missing or false value changes
-- nothing.
--
-- p_lead: { name, email, phone, company, website, message,
--           consent: { call, sms, whatsapp, email } }
-- Returns null when the token matches no enabled form.
-- ---------------------------------------------------------------------------
create function public.capture_lead(p_token text, p_lead jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_form public.lead_forms%rowtype;
  v_email text := nullif(lower(btrim(p_lead ->> 'email')), '');
  v_phone text := nullif(btrim(p_lead ->> 'phone'), '');
  v_name text := left(coalesce(btrim(p_lead ->> 'name'), ''), 200);
  v_company text := nullif(left(btrim(p_lead ->> 'company'), 200), '');
  v_website text := nullif(left(btrim(p_lead ->> 'website'), 300), '');
  v_message text := nullif(left(btrim(p_lead ->> 'message'), 5000), '');
  v_consent jsonb := coalesce(p_lead -> 'consent', '{}'::jsonb);
  v_source text;
  v_lead_id uuid;
  v_created boolean := false;
  v_conversation_id uuid;
  v_channel text;
begin
  select * into v_form from public.lead_forms f where f.token = p_token and f.enabled;
  if not found then
    return null;
  end if;
  if v_email is null and v_phone is null then
    raise exception 'an email or a phone number is required' using errcode = '22023';
  end if;
  if v_email is not null
     and (char_length(v_email) > 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$') then
    raise exception 'that email address is not valid' using errcode = '22023';
  end if;
  if v_phone is not null and v_phone !~ '^\+?[0-9]{6,15}$' then
    raise exception 'that phone number is not valid' using errcode = '22023';
  end if;
  if jsonb_typeof(v_consent) <> 'object'
     or exists (
       select 1 from jsonb_each(v_consent) c
       where c.key not in ('call', 'sms', 'whatsapp', 'email')
          or jsonb_typeof(c.value) <> 'boolean'
     ) then
    raise exception 'consent must be true or false per channel' using errcode = '22023';
  end if;

  -- The brake. Serialised per form so a burst can't slip through together.
  perform pg_advisory_xact_lock(hashtextextended(v_form.id::text, 0));
  if (
    select count(*) from public.activity_events e
    where e.workspace_id = v_form.workspace_id
      and e.kind = 'lead_captured'
      and e.metadata ->> 'form_id' = v_form.id::text
      and e.created_at > now() - interval '1 minute'
  ) >= 30 or (
    select count(*) from public.activity_events e
    where e.workspace_id = v_form.workspace_id
      and e.kind = 'lead_captured'
      and e.metadata ->> 'form_id' = v_form.id::text
      and e.created_at > now() - interval '1 day'
  ) >= 2000 then
    raise exception 'too many submissions for this form' using errcode = 'DV429';
  end if;
  v_source := left('form: ' || v_form.name, 80);

  if v_email is not null then
    select l.id into v_lead_id from public.leads l
    where l.workspace_id = v_form.workspace_id and l.email = v_email
    for update;
  end if;
  if v_lead_id is null and v_phone is not null then
    select l.id into v_lead_id from public.leads l
    where l.workspace_id = v_form.workspace_id and l.phone = v_phone
    order by l.created_at
    limit 1
    for update;
  end if;

  if v_lead_id is null then
    insert into public.leads (workspace_id, name, email, phone, company, website, source)
    values (v_form.workspace_id, v_name, v_email, v_phone, v_company, v_website, v_source)
    on conflict (workspace_id, email) where email is not null do nothing
    returning id into v_lead_id;
    if v_lead_id is null then
      -- Two submissions for one new address at the same moment.
      select l.id into v_lead_id from public.leads l
      where l.workspace_id = v_form.workspace_id and l.email = v_email;
    else
      v_created := true;
    end if;
  else
    -- A known lead: fill in what was missing, never overwrite.
    update public.leads l set
      name = case when l.name = '' then v_name else l.name end,
      email = coalesce(l.email, v_email),
      phone = coalesce(l.phone, v_phone),
      company = coalesce(l.company, v_company),
      website = coalesce(l.website, v_website)
    where l.id = v_lead_id;
  end if;

  update public.leads l set
    consent_call = l.consent_call or coalesce((v_consent ->> 'call')::boolean, false),
    consent_call_at = case when not l.consent_call and coalesce((v_consent ->> 'call')::boolean, false) then now() else l.consent_call_at end,
    consent_call_source = case when not l.consent_call and coalesce((v_consent ->> 'call')::boolean, false) then v_source else l.consent_call_source end,
    consent_sms = l.consent_sms or coalesce((v_consent ->> 'sms')::boolean, false),
    consent_sms_at = case when not l.consent_sms and coalesce((v_consent ->> 'sms')::boolean, false) then now() else l.consent_sms_at end,
    consent_sms_source = case when not l.consent_sms and coalesce((v_consent ->> 'sms')::boolean, false) then v_source else l.consent_sms_source end,
    consent_whatsapp = l.consent_whatsapp or coalesce((v_consent ->> 'whatsapp')::boolean, false),
    consent_whatsapp_at = case when not l.consent_whatsapp and coalesce((v_consent ->> 'whatsapp')::boolean, false) then now() else l.consent_whatsapp_at end,
    consent_whatsapp_source = case when not l.consent_whatsapp and coalesce((v_consent ->> 'whatsapp')::boolean, false) then v_source else l.consent_whatsapp_source end,
    consent_email = l.consent_email or coalesce((v_consent ->> 'email')::boolean, false),
    consent_email_at = case when not l.consent_email and coalesce((v_consent ->> 'email')::boolean, false) then now() else l.consent_email_at end,
    consent_email_source = case when not l.consent_email and coalesce((v_consent ->> 'email')::boolean, false) then v_source else l.consent_email_source end
  where l.id = v_lead_id
    and (v_consent ? 'call' or v_consent ? 'sms' or v_consent ? 'whatsapp' or v_consent ? 'email');

  -- The conversation sits on the channel a reply would go out on.
  v_channel := case when v_email is not null then 'email' else 'sms' end;
  insert into public.conversations (workspace_id, lead_id, channel, status, last_message_at)
  values (v_form.workspace_id, v_lead_id, v_channel, 'waiting_for_you', now())
  returning id into v_conversation_id;

  if v_message is not null then
    insert into public.messages
      (workspace_id, conversation_id, direction, author, body, delivery_status, metadata)
    values (
      v_form.workspace_id, v_conversation_id, 'in', 'lead', v_message, 'received',
      jsonb_build_object('via', 'form', 'form_id', v_form.id)
    );
  end if;

  insert into public.activity_events (workspace_id, lead_id, kind, summary, channel, metadata)
  values (
    v_form.workspace_id,
    v_lead_id,
    'lead_captured',
    case when v_created then 'New lead from the form "' else 'Known lead filled in the form "' end
      || v_form.name || '"',
    v_channel,
    jsonb_build_object('form_id', v_form.id, 'conversation_id', v_conversation_id)
  );

  -- Nothing about the lead goes back: not even whether it was new, which
  -- would tell a stranger whether an address is already on the list.
  return jsonb_build_object('ok', true, 'redirect_url', v_form.redirect_url);
end;
$$;

revoke all on function public.create_workspace(text, text, text, text) from public, anon;
revoke all on function public.my_invitations() from public, anon;
revoke all on function public.accept_invitation(uuid) from public, anon;
revoke all on function public.capture_lead(text, jsonb) from public, authenticated;
grant execute on function public.create_workspace(text, text, text, text) to authenticated;
grant execute on function public.my_invitations() to authenticated;
grant execute on function public.accept_invitation(uuid) to authenticated;
grant execute on function public.capture_lead(text, jsonb) to anon, service_role;
