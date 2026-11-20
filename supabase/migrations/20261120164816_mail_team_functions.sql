-- Slice 3b, part 2 of 5: what signed-in people may do about sending.
-- Admins connect, edit and disconnect mailboxes and save the sending
-- settings; members decide on what the agent drafted and reply by hand.
-- Every function checks the caller's role itself.
-- ---------------------------------------------------------------------------
-- Admins: mailboxes and settings
-- ---------------------------------------------------------------------------

-- Connects a mailbox, or replaces the password and settings of one that is
-- already connected with the same address. The server has logged in to SMTP
-- and IMAP with these details before calling this. The password goes
-- straight into Vault; nothing returns it to a signed-in person.
create function public.mailbox_connect(
  p_workspace_id uuid, p_provider text, p_email text, p_sender_name text, p_username text,
  p_smtp_host text, p_smtp_port integer, p_smtp_security text,
  p_imap_host text, p_imap_port integer, p_password text, p_daily_limit integer default 30
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_id uuid;
  v_secret uuid;
  v_limit integer := least(greatest(coalesce(p_daily_limit, 30), 1), 50);
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if not (select private.is_workspace_admin(p_workspace_id)) then
    raise exception 'only an owner or admin can connect a mailbox' using errcode = '42501';
  end if;
  if char_length(coalesce(p_password, '')) < 1 or char_length(p_password) > 500 then
    raise exception 'a password is required' using errcode = '22023';
  end if;
  perform 1 from public.workspaces w where w.id = p_workspace_id for update;

  select m.id, x.secret_id into v_id, v_secret from public.mailboxes m
  join public.mailbox_secrets x on x.mailbox_id = m.id
  where m.workspace_id = p_workspace_id and m.email = v_email and m.status <> 'disconnected';
  if found then
    perform vault.update_secret(v_secret, p_password);
    update public.mailboxes m
    set provider = p_provider, sender_name = btrim(p_sender_name), username = btrim(p_username),
        smtp_host = lower(btrim(p_smtp_host)), smtp_port = p_smtp_port, smtp_security = p_smtp_security,
        imap_host = lower(btrim(p_imap_host)), imap_port = p_imap_port, daily_limit = v_limit,
        status = 'active', pause_reason = null, auth_failures = 0, last_error = null
    where m.id = v_id;
    return v_id;
  end if;

  -- A backstop, not the product's limit: see MAX_MAILBOXES in config.ts.
  if (select count(*) from public.mailboxes m
      where m.workspace_id = p_workspace_id and m.status <> 'disconnected') >= 10 then
    raise exception 'too many mailboxes' using errcode = 'P0001';
  end if;
  v_id := gen_random_uuid();
  v_secret := vault.create_secret(p_password, 'mailbox_' || v_id::text, 'App password of a mailbox connected in Dialvo');
  insert into public.mailboxes (
    id, workspace_id, provider, email, sender_name, username, smtp_host, smtp_port,
    smtp_security, imap_host, imap_port, daily_limit, created_by
  ) values (
    v_id, p_workspace_id, p_provider, v_email, btrim(p_sender_name), btrim(p_username),
    lower(btrim(p_smtp_host)), p_smtp_port, p_smtp_security,
    lower(btrim(p_imap_host)), p_imap_port, v_limit, v_user
  );
  insert into public.mailbox_secrets (mailbox_id, workspace_id, secret_id)
  values (v_id, p_workspace_id, v_secret);
  return v_id;
end;
$$;

-- The sender's name and the daily limit.
create function public.mailbox_update(p_mailbox_id uuid, p_sender_name text, p_daily_limit integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  update public.mailboxes m
  set sender_name = btrim(p_sender_name),
      daily_limit = least(greatest(coalesce(p_daily_limit, m.daily_limit), 1), 50)
  where m.id = p_mailbox_id and m.status <> 'disconnected'
    and (select private.is_workspace_admin(m.workspace_id));
  if not found then
    raise exception 'mailbox not found' using errcode = 'P0002';
  end if;
end;
$$;

-- A paused mailbox is switched back on by an admin (after fixing what was
-- wrong, usually by connecting it again with a new app password).
create function public.mailbox_resume(p_mailbox_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  update public.mailboxes m
  set status = 'active', pause_reason = null, auth_failures = 0
  where m.id = p_mailbox_id and m.status = 'paused'
    and (select private.is_workspace_admin(m.workspace_id));
  if not found then
    raise exception 'mailbox not found' using errcode = 'P0002';
  end if;
end;
$$;

-- Disconnect: the password is deleted from Vault at once. What the mailbox
-- already sent stays as a record. First emails it was going to send go back
-- to waiting for a slot (another mailbox may take them); its follow-ups and
-- replies are cancelled, because they can only leave from the same mailbox.
create function public.mailbox_disconnect(p_mailbox_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_box public.mailboxes%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  select m.* into v_box from public.mailboxes m
  where m.id = p_mailbox_id and m.status <> 'disconnected'
    and (select private.is_workspace_admin(m.workspace_id))
  for update;
  if not found then
    raise exception 'mailbox not found' using errcode = 'P0002';
  end if;
  delete from vault.secrets s
  where s.id in (select x.secret_id from public.mailbox_secrets x where x.mailbox_id = v_box.id);
  delete from public.mailbox_secrets x where x.mailbox_id = v_box.id;
  update public.mailboxes m
  set status = 'disconnected', pause_reason = null, poll_locked_until = null
  where m.id = v_box.id;
  update public.outbound_emails e
  set status = 'queued', mailbox_id = null, scheduled_at = null
  where e.mailbox_id = v_box.id and e.workspace_id = v_box.workspace_id
    and e.kind = 'first' and e.status in ('queued', 'scheduled');
  update public.outbound_emails e
  set status = 'cancelled', cancel_reason = 'mailbox_disconnected'
  where e.workspace_id = v_box.workspace_id and e.kind <> 'first'
    and e.status in ('writing', 'draft', 'queued', 'scheduled')
    and (e.mailbox_id = v_box.id or e.thread_id in (
      select t.id from public.mail_threads t
      where t.mailbox_id = v_box.id and t.workspace_id = v_box.workspace_id));
  update public.mail_threads t
  set status = 'stopped', stop_reason = 'mailbox_disconnected', next_followup_at = null
  where t.mailbox_id = v_box.id and t.workspace_id = v_box.workspace_id and t.status = 'active';
end;
$$;

-- Saves who is sending and how. p_settings may hold any of: business_name,
-- postal_address, confirm_allowed (true records who confirmed and when; it
-- is never un-confirmed here), booking_url, followups_enabled,
-- followup_1_days, followup_2_days, reply_mode, sending_on.
-- Sending can only be switched on once the sender details exist.
create function public.sending_settings_save(p_workspace_id uuid, p_settings jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_row public.workspace_sending%rowtype;
  v_booking text;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if not (select private.is_workspace_admin(p_workspace_id)) then
    raise exception 'only an owner or admin can change this' using errcode = '42501';
  end if;
  insert into public.workspace_sending (workspace_id) values (p_workspace_id)
  on conflict (workspace_id) do nothing;
  select s.* into v_row from public.workspace_sending s
  where s.workspace_id = p_workspace_id for update;

  if p_settings ? 'business_name' then
    v_row.business_name := left(btrim(coalesce(p_settings ->> 'business_name', '')), 200);
  end if;
  if p_settings ? 'postal_address' then
    v_row.postal_address := left(btrim(coalesce(p_settings ->> 'postal_address', '')), 500);
  end if;
  if (p_settings ->> 'confirm_allowed')::boolean is true and v_row.allowed_confirmed_at is null then
    v_row.allowed_confirmed_at := now();
    v_row.allowed_confirmed_by := v_user;
  end if;
  if p_settings ? 'booking_url' then
    v_booking := nullif(btrim(coalesce(p_settings ->> 'booking_url', '')), '');
    if v_booking is not null and (v_booking !~ '^https://[^\s]+$' or char_length(v_booking) > 500) then
      raise exception 'the booking link must start with https://' using errcode = '22023';
    end if;
    v_row.booking_url := v_booking;
  end if;
  if p_settings ? 'followups_enabled' then
    v_row.followups_enabled := coalesce((p_settings ->> 'followups_enabled')::boolean, true);
  end if;
  if p_settings ? 'followup_1_days' then
    v_row.followup_1_days := (p_settings ->> 'followup_1_days')::integer;
  end if;
  if p_settings ? 'followup_2_days' then
    v_row.followup_2_days := (p_settings ->> 'followup_2_days')::integer;
  end if;
  if p_settings ? 'reply_mode' then
    v_row.reply_mode := p_settings ->> 'reply_mode';
  end if;
  if p_settings ? 'sending_on' then
    v_row.sending_on := coalesce((p_settings ->> 'sending_on')::boolean, false);
  end if;
  if v_row.sending_on and (
    btrim(v_row.business_name) = '' or btrim(v_row.postal_address) = '' or v_row.allowed_confirmed_at is null
  ) then
    raise exception 'add the sender details first' using errcode = 'P0001';
  end if;

  update public.workspace_sending s
  set business_name = v_row.business_name, postal_address = v_row.postal_address,
      allowed_confirmed_at = v_row.allowed_confirmed_at, allowed_confirmed_by = v_row.allowed_confirmed_by,
      booking_url = v_row.booking_url, followups_enabled = v_row.followups_enabled,
      followup_1_days = v_row.followup_1_days, followup_2_days = v_row.followup_2_days,
      reply_mode = v_row.reply_mode, sending_on = v_row.sending_on, updated_by = v_user
  where s.workspace_id = p_workspace_id;
  return jsonb_build_object('sending_on', v_row.sending_on);
end;
$$;

-- ---------------------------------------------------------------------------
-- Members: decide on what the agent wrote, and reply by hand
-- ---------------------------------------------------------------------------

-- A follow-up or a reply the agent drafted.
--   'approve': it goes into the queue, with the edits if any.
--   'save':    keep the edits.
--   'discard': drop it. Discarding a follow-up ends that lead's sequence.
create function public.outbound_email_decide(
  p_email_id uuid, p_action text, p_subject text default null, p_body text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_e public.outbound_emails%rowtype;
  v_subject text;
  v_body text;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  select e.* into v_e from public.outbound_emails e
  where e.id = p_email_id and e.status = 'draft'
    and (select private.is_workspace_member(e.workspace_id))
  for update;
  if not found then
    raise exception 'email not found' using errcode = 'P0002';
  end if;
  if p_action = 'discard' then
    update public.outbound_emails e
    set status = 'cancelled', cancel_reason = 'by_person', approved_by = v_user, approved_at = now()
    where e.id = v_e.id;
    if v_e.kind = 'followup' then
      update public.mail_threads t
      set status = 'stopped', stop_reason = 'followup_discarded', next_followup_at = null
      where t.id = v_e.thread_id and t.status = 'active';
    end if;
    return 'cancelled';
  end if;
  if p_action not in ('approve', 'save') then
    raise exception 'unknown action' using errcode = '22023';
  end if;
  -- A follow-up keeps its thread's subject; a reply's can be edited.
  v_subject := case when v_e.kind = 'followup' then v_e.subject else coalesce(
    nullif(btrim(regexp_replace(coalesce(p_subject, ''), '\s+', ' ', 'g')), ''), v_e.subject) end;
  v_body := coalesce(nullif(btrim(coalesce(p_body, '')), ''), v_e.body);
  if char_length(v_subject) > 200 or char_length(v_body) > 5000 then
    raise exception 'the subject or the email is too long' using errcode = '22023';
  end if;
  if p_action = 'approve' then
    if private.outbound_is_suppressed(v_e.workspace_id, v_e.to_email, null) then
      raise exception 'that address is on the suppression list' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.leads l
               where l.id = v_e.lead_id and l.workspace_id = v_e.workspace_id and l.do_not_contact) then
      raise exception 'that lead is marked do not contact' using errcode = 'P0001';
    end if;
  end if;
  update public.outbound_emails e
  set subject = v_subject, body = v_body,
      status = case when p_action = 'approve' then 'queued' else e.status end,
      approved_by = case when p_action = 'approve' then v_user else e.approved_by end,
      approved_at = case when p_action = 'approve' then now() else e.approved_at end
  where e.id = v_e.id;
  return case when p_action = 'approve' then 'queued' else 'draft' end;
end;
$$;

-- A teammate's own reply in an email conversation. It leaves from the same
-- mailbox, in the same thread, the next time the sender runs. A draft the
-- agent had waiting for this conversation is dropped.
create function public.mail_reply_queue(p_conversation_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_t public.mail_threads%rowtype;
  v_body text := btrim(coalesce(p_body, ''));
  v_id uuid;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  select t.* into v_t from public.mail_threads t
  where t.conversation_id = p_conversation_id
    and (select private.is_workspace_member(t.workspace_id))
  for update;
  if not found then
    raise exception 'conversation not found' using errcode = 'P0002';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 5000 then
    raise exception 'a reply must be 1 to 5000 characters' using errcode = '22023';
  end if;
  if private.outbound_is_suppressed(v_t.workspace_id, v_t.to_email, null) then
    raise exception 'that address is on the suppression list' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.leads l
             where l.id = v_t.lead_id and l.workspace_id = v_t.workspace_id and l.do_not_contact) then
    raise exception 'that lead is marked do not contact' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.mailboxes m
                 where m.id = v_t.mailbox_id and m.workspace_id = v_t.workspace_id and m.status <> 'disconnected') then
    raise exception 'the mailbox this conversation used is disconnected' using errcode = 'P0001';
  end if;
  update public.outbound_emails e
  set status = 'cancelled', cancel_reason = 'replaced_by_person'
  where e.thread_id = v_t.id and e.kind = 'reply' and e.written_by = 'agent'
    and e.status in ('writing', 'draft');
  insert into public.outbound_emails (
    workspace_id, lead_id, thread_id, mailbox_id, kind, written_by, author_user_id,
    to_email, subject, body, status, approved_by, approved_at
  ) values (
    v_t.workspace_id, v_t.lead_id, v_t.id, v_t.mailbox_id, 'reply', 'user', v_user,
    v_t.to_email, left('Re: ' || v_t.subject, 200), v_body, 'queued', v_user, now()
  )
  returning id into v_id;
  update public.conversations c
  set status = 'open', assigned_to = coalesce(c.assigned_to, v_user)
  where c.id = v_t.conversation_id;
  return v_id;
end;
$$;

-- Who may call what.
revoke all on function public.mailbox_connect(uuid, text, text, text, text, text, integer, text, text, integer, text, integer) from public, anon;
revoke all on function public.mailbox_update(uuid, text, integer) from public, anon;
revoke all on function public.mailbox_resume(uuid) from public, anon;
revoke all on function public.mailbox_disconnect(uuid) from public, anon;
revoke all on function public.sending_settings_save(uuid, jsonb) from public, anon;
revoke all on function public.outbound_email_decide(uuid, text, text, text) from public, anon;
revoke all on function public.mail_reply_queue(uuid, text) from public, anon;
grant execute on function public.mailbox_connect(uuid, text, text, text, text, text, integer, text, text, integer, text, integer) to authenticated;
grant execute on function public.mailbox_update(uuid, text, integer) to authenticated;
grant execute on function public.mailbox_resume(uuid) to authenticated;
grant execute on function public.mailbox_disconnect(uuid) to authenticated;
grant execute on function public.sending_settings_save(uuid, jsonb) to authenticated;
grant execute on function public.outbound_email_decide(uuid, text, text, text) to authenticated;
grant execute on function public.mail_reply_queue(uuid, text) to authenticated;
