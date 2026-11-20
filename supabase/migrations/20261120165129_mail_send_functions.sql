-- Slice 3b, part 3 of 5: the server's side of sending (secret key only).
-- Scheduling, claiming and recording a send, and settling an email whose
-- fate is unknown. Every limit is passed in from src/lib/mail/config.ts.
--
-- ---------------------------------------------------------------------------
-- The server's side (secret key only)
-- ---------------------------------------------------------------------------

-- How many emails a mailbox may send today: a new one starts low and climbs
-- to its limit.
create function private.mailbox_allowance(
  p_daily_limit integer, p_connected_at timestamptz, p_tz text, p_ramp_start integer, p_ramp_step integer
)
returns integer
language sql
stable
set search_path = ''
as $$
  select least(
    p_daily_limit,
    greatest(p_ramp_start, 1) + greatest(p_ramp_step, 0) * greatest(
      (now() at time zone private.safe_tz(p_tz))::date
        - (p_connected_at at time zone private.safe_tz(p_tz))::date, 0)
  );
$$;
revoke all on function private.mailbox_allowance(integer, timestamptz, text, integer, integer) from public;

-- Emails a mailbox has sent today (or may have: claimed ones count).
create function private.mailbox_used_today(p_mailbox_id uuid, p_workspace_id uuid, p_day_start timestamptz)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from public.outbound_emails e
  where e.mailbox_id = p_mailbox_id and e.workspace_id = p_workspace_id
    and e.status in ('sent', 'sending', 'needs_check')
    and coalesce(e.sent_at, e.claimed_at) >= p_day_start;
$$;
revoke all on function private.mailbox_used_today(uuid, uuid, timestamptz) from public;

-- The mailbox's settings with its password, for the server to log in with.
-- This is the only way the password is ever read back.
create function public.mail_mailbox_secret(p_workspace_id uuid, p_mailbox_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', m.id, 'email', m.email, 'sender_name', m.sender_name, 'username', m.username,
    'smtp_host', m.smtp_host, 'smtp_port', m.smtp_port, 'smtp_security', m.smtp_security,
    'imap_host', m.imap_host, 'imap_port', m.imap_port, 'status', m.status,
    'password', s.decrypted_secret
  )
  from public.mailboxes m
  join public.mailbox_secrets x on x.mailbox_id = m.id and x.workspace_id = m.workspace_id
  join vault.decrypted_secrets s on s.id = x.secret_id
  where m.id = p_mailbox_id and m.workspace_id = p_workspace_id and m.status <> 'disconnected';
$$;

-- What happened when the server logged in to a mailbox. A refused login is
-- counted; p_pause_after of them in a row pause the mailbox and queue an
-- alert for the team. A login that works resets the count.
--   { "paused": bool, "newly_paused": bool }
create function public.mail_mailbox_result(
  p_workspace_id uuid, p_mailbox_id uuid, p_outcome text, p_error text, p_pause_after integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_box public.mailboxes%rowtype;
  v_newly boolean := false;
begin
  select m.* into v_box from public.mailboxes m
  where m.id = p_mailbox_id and m.workspace_id = p_workspace_id and m.status <> 'disconnected'
  for update;
  if not found then
    return jsonb_build_object('paused', true, 'newly_paused', false);
  end if;
  if p_outcome = 'ok' then
    update public.mailboxes m set auth_failures = 0, last_error = null where m.id = v_box.id;
  elsif p_outcome = 'auth_failed' then
    v_newly := v_box.status = 'active' and v_box.auth_failures + 1 >= greatest(p_pause_after, 1);
    update public.mailboxes m
    set auth_failures = m.auth_failures + 1, last_error = left(p_error, 500),
        status = case when v_newly then 'paused' else m.status end,
        pause_reason = case when v_newly then 'login_refused' else m.pause_reason end
    where m.id = v_box.id;
    if v_newly then
      insert into public.team_alerts (workspace_id, conversation_id, kind, summary)
      values (p_workspace_id, null, 'mailbox_paused', left(
        'Dialvo paused sending from ' || v_box.email || ' because its mail server refused the login '
        || greatest(p_pause_after, 1) || ' times in a row. Connect it again with a new app password.', 1000));
    end if;
  else
    update public.mailboxes m set last_error = left(p_error, 500) where m.id = v_box.id;
  end if;
  return jsonb_build_object(
    'paused', v_newly or v_box.status = 'paused', 'newly_paused', v_newly);
end;
$$;

-- Workspaces with something for the sender or the writer to do: sending is
-- on and at least one mailbox is active.
create function public.mail_work_list()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(s.workspace_id order by s.workspace_id), '{}'::uuid[])
  from public.workspace_sending s
  where s.sending_on and (select private.sending_ready(s.workspace_id))
    and exists (select 1 from public.mailboxes m
                where m.workspace_id = s.workspace_id and m.status = 'active');
$$;

-- Makes sure a prospect has a lead (replies land on a lead's conversation).
create function private.prospect_ensure_lead(p_prospect_id uuid, p_workspace_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.prospects%rowtype;
  v_lead uuid;
begin
  select pr.* into p from public.prospects pr
  where pr.id = p_prospect_id and pr.workspace_id = p_workspace_id for update;
  if not found then
    return null;
  end if;
  if p.lead_id is not null then
    return p.lead_id;
  end if;
  if p.email is not null then
    select l.id into v_lead from public.leads l
    where l.workspace_id = p_workspace_id and l.email = p.email;
  end if;
  if v_lead is null then
    insert into public.leads (workspace_id, name, email, phone, company, website, source, custom_fields)
    values (
      p_workspace_id, p.contact_name, p.email, p.phone, nullif(p.company_name, ''), p.website,
      'found by Dialvo',
      jsonb_build_object('research', jsonb_build_object(
        'summary', p.summary, 'location', p.location, 'contact_role', p.contact_role,
        'email_source_url', p.email_source_url, 'phone_source_url', p.phone_source_url,
        'facts', p.facts, 'pages', p.pages, 'prospect_id', p.id
      ))
    )
    returning id into v_lead;
    insert into public.activity_events (workspace_id, lead_id, kind, summary, channel, metadata)
    values (p_workspace_id, v_lead, 'lead_created',
            'Found by Dialvo on the web and added to leads when its first email was scheduled.',
            null, jsonb_build_object('prospect_id', p.id, 'via', 'find_leads'));
  end if;
  update public.prospects pr set lead_id = v_lead where pr.id = p.id;
  return v_lead;
end;
$$;
revoke all on function private.prospect_ensure_lead(uuid, uuid) from public;

-- What the planner needs to give waiting emails a time and a mailbox:
--   { "on": bool, "timezone", "window", "sent_today": n,
--     "mailboxes": [{ "id", "allowance", "used", "planned": ["<time>", ...] }],
--     "waiting": [{ "draft_id" } | { "email_id", "mailbox_id", "by_person": bool }] }
-- "waiting" is approved first-email drafts with no email yet, and queued
-- emails (approved follow-ups and replies, and first emails pushed back).
create function public.mail_schedule_context(
  p_workspace_id uuid, p_limit integer, p_ramp_start integer, p_ramp_step integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws public.workspaces%rowtype;
  v_set public.workspace_sending%rowtype;
  v_agent public.agents%rowtype;
  v_day timestamptz;
  v_boxes jsonb;
  v_waiting jsonb;
begin
  select w.* into v_ws from public.workspaces w where w.id = p_workspace_id;
  if not found then
    return null;
  end if;
  select s.* into v_set from public.workspace_sending s where s.workspace_id = p_workspace_id;
  select a.* into v_agent from public.agents a
  where a.workspace_id = p_workspace_id and a.role = 'outbound'
  order by (a.channel = 'email') desc, a.created_at
  limit 1;
  v_day := private.local_day_start(v_ws.timezone);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id,
    'allowance', private.mailbox_allowance(m.daily_limit, m.connected_at, v_ws.timezone, p_ramp_start, p_ramp_step),
    'daily_limit', m.daily_limit,
    'connected_at', m.connected_at,
    'used', private.mailbox_used_today(m.id, m.workspace_id, v_day),
    'planned', coalesce((
      select jsonb_agg(e.scheduled_at order by e.scheduled_at) from public.outbound_emails e
      where e.mailbox_id = m.id and e.workspace_id = m.workspace_id and e.status = 'scheduled'
    ), '[]'::jsonb)
  ) order by m.created_at, m.id), '[]'::jsonb) into v_boxes
  from public.mailboxes m
  where m.workspace_id = p_workspace_id and m.status = 'active';

  select coalesce(jsonb_agg(w.item), '[]'::jsonb) into v_waiting from (
    (select jsonb_build_object('email_id', e.id, 'mailbox_id', coalesce(e.mailbox_id, t.mailbox_id),
                               'by_person', e.written_by = 'user', 'kind', e.kind) as item,
            0 as rank, e.created_at as ts
     from public.outbound_emails e
     left join public.mail_threads t on t.id = e.thread_id and t.workspace_id = e.workspace_id
     where e.workspace_id = p_workspace_id and e.status = 'queued'
     order by e.created_at
     limit greatest(p_limit, 0))
    union all
    (select jsonb_build_object('draft_id', d.id) as item, 1 as rank, d.decided_at as ts
     from public.outbound_drafts d
     where d.workspace_id = p_workspace_id and d.status = 'approved'
       and not exists (select 1 from public.outbound_emails e
                       where e.draft_id = d.id and e.status <> 'cancelled')
     order by d.decided_at, d.id
     limit greatest(p_limit, 0))
    order by rank, ts
    limit greatest(p_limit, 0)
  ) w;

  return jsonb_build_object(
    'on', coalesce(v_set.sending_on, false) and private.sending_ready(p_workspace_id),
    'timezone', private.safe_tz(v_ws.timezone),
    'window', coalesce(v_agent.send_window, '{"days": [1, 2, 3, 4, 5], "start": "09:00", "end": "17:00"}'::jsonb),
    'sent_today', (select count(*) from public.outbound_emails e
                   where e.workspace_id = p_workspace_id and e.status in ('sent', 'sending', 'needs_check')
                     and coalesce(e.sent_at, e.claimed_at) >= v_day),
    'mailboxes', v_boxes,
    'waiting', v_waiting
  );
end;
$$;

-- Stores the planner's decisions. p_plans:
--   [{ "draft_id" | "email_id", "mailbox_id", "send_at": "<time>" }, ...]
-- A draft becomes a scheduled email (and its prospect a lead, so a reply
-- has somewhere to land); a queued email gets its time. Anything that has
-- changed meanwhile (no longer approved, suppressed, mailbox gone) is
-- skipped. Returns how many were scheduled.
create function public.mail_schedule_commit(p_workspace_id uuid, p_plans jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
  v_plan record;
  v_d public.outbound_drafts%rowtype;
  v_p public.prospects%rowtype;
  v_lead uuid;
begin
  for v_plan in
    select * from jsonb_to_recordset(coalesce(p_plans, '[]'::jsonb))
      as x(draft_id uuid, email_id uuid, mailbox_id uuid, send_at timestamptz)
  loop
    continue when v_plan.send_at is null or v_plan.mailbox_id is null;
    continue when not exists (
      select 1 from public.mailboxes m
      where m.id = v_plan.mailbox_id and m.workspace_id = p_workspace_id and m.status = 'active');

    if v_plan.email_id is not null then
      update public.outbound_emails e
      set status = 'scheduled', scheduled_at = v_plan.send_at,
          -- A follow-up or a reply keeps its thread's mailbox whatever was asked.
          mailbox_id = coalesce(
            (select t.mailbox_id from public.mail_threads t where t.id = e.thread_id), v_plan.mailbox_id)
      where e.id = v_plan.email_id and e.workspace_id = p_workspace_id and e.status = 'queued';
      if found then
        v_count := v_count + 1;
      end if;
      continue;
    end if;

    select d.* into v_d from public.outbound_drafts d
    where d.id = v_plan.draft_id and d.workspace_id = p_workspace_id and d.status = 'approved'
    for update;
    continue when not found;
    select p.* into v_p from public.prospects p
    where p.id = v_d.prospect_id and p.workspace_id = p_workspace_id;
    continue when private.outbound_is_suppressed(p_workspace_id, v_d.to_email, v_p.domain);
    v_lead := private.prospect_ensure_lead(v_d.prospect_id, p_workspace_id);
    continue when v_lead is null;
    continue when exists (select 1 from public.leads l where l.id = v_lead and l.do_not_contact);
    insert into public.outbound_emails (
      workspace_id, lead_id, prospect_id, draft_id, mailbox_id, kind, written_by,
      to_email, subject, body, status, scheduled_at, model, approved_by, approved_at
    ) values (
      p_workspace_id, v_lead, v_d.prospect_id, v_d.id, v_plan.mailbox_id, 'first', 'agent',
      v_d.to_email, v_d.subject, v_d.body, 'scheduled', v_plan.send_at, v_d.model, v_d.decided_by, v_d.decided_at
    )
    on conflict do nothing;
    if found then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

-- Claims the emails that are due, at most one per mailbox per call, and
-- hands back everything needed to send each one. Before an email is handed
-- out it is checked again, at this moment:
--   * the first email's draft is still approved (its latest text is used);
--   * the address isn't on the never-contact list, the lead isn't marked do
--     not contact, unsubscribed or lost;
--   * a follow-up's sequence is still running (no reply, bounce or stop);
--   * the mailbox is active, inside its allowance for today, and the
--     workspace is under its daily cap, and it is inside the send window.
-- An email that fails a "never" check is cancelled with the reason. One
-- that is only early (cap, allowance, window) goes back to the queue for a
-- new slot. A person's own reply skips the cap, the allowance and the
-- window: someone chose to send it now.
--
-- First, rows left 'sending' for longer than p_stale_seconds become
-- 'needs_check'. They are never handed out again.
create function public.mail_send_claim(
  p_workspace_id uuid, p_limit integer, p_ramp_start integer, p_ramp_step integer,
  p_workspace_cap integer, p_stale_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws public.workspaces%rowtype;
  v_set public.workspace_sending%rowtype;
  v_agent public.agents%rowtype;
  v_window jsonb;
  v_day timestamptz;
  v_sent_today integer;
  v_out jsonb := '[]'::jsonb;
  v_busy uuid[] := '{}'::uuid[];
  v_e public.outbound_emails%rowtype;
  v_d public.outbound_drafts%rowtype;
  v_l public.leads%rowtype;
  v_t public.mail_threads%rowtype;
  v_m public.mailboxes%rowtype;
  v_cancel text;
  v_domain text;
  v_in_reply_to text;
  v_refs text;
  v_free boolean;
begin
  update public.outbound_emails e
  set status = 'needs_check',
      error = 'The step that was sending this stopped before it could say whether it went.'
  where e.workspace_id = p_workspace_id and e.status = 'sending'
    and e.claimed_at < now() - make_interval(secs => greatest(p_stale_seconds, 60));

  select w.* into v_ws from public.workspaces w where w.id = p_workspace_id for update;
  if not found then
    return null;
  end if;
  select s.* into v_set from public.workspace_sending s where s.workspace_id = p_workspace_id;
  if not found or not v_set.sending_on or not private.sending_ready(p_workspace_id) then
    return jsonb_build_object('emails', '[]'::jsonb, 'on', false);
  end if;
  select a.* into v_agent from public.agents a
  where a.workspace_id = p_workspace_id and a.role = 'outbound'
  order by (a.channel = 'email') desc, a.created_at
  limit 1;
  v_window := coalesce(v_agent.send_window, '{"days": [1, 2, 3, 4, 5], "start": "09:00", "end": "17:00"}'::jsonb);
  v_day := private.local_day_start(v_ws.timezone);
  select count(*) into v_sent_today from public.outbound_emails e
  where e.workspace_id = p_workspace_id and e.status in ('sent', 'sending', 'needs_check')
    and coalesce(e.sent_at, e.claimed_at) >= v_day;

  for v_e in
    select e.* from public.outbound_emails e
    where e.workspace_id = p_workspace_id and e.status = 'scheduled' and e.scheduled_at <= now()
    order by e.scheduled_at, e.id
    limit greatest(p_limit, 1) * 5
    for update skip locked
  loop
    exit when jsonb_array_length(v_out) >= greatest(p_limit, 1);
    v_cancel := null;
    v_free := v_e.written_by = 'user';

    select l.* into v_l from public.leads l where l.id = v_e.lead_id and l.workspace_id = p_workspace_id;
    v_domain := null;
    if v_e.prospect_id is not null then
      select p.domain into v_domain from public.prospects p
      where p.id = v_e.prospect_id and p.workspace_id = p_workspace_id;
    end if;
    if v_e.kind = 'first' then
      select d.* into v_d from public.outbound_drafts d
      where d.id = v_e.draft_id and d.workspace_id = p_workspace_id;
      if not found or v_d.status <> 'approved' then
        v_cancel := 'no_longer_approved';
      else
        -- Edits saved after it was scheduled are what goes out.
        v_e.subject := v_d.subject;
        v_e.body := v_d.body;
        v_e.to_email := v_d.to_email;
      end if;
    else
      select t.* into v_t from public.mail_threads t
      where t.id = v_e.thread_id and t.workspace_id = p_workspace_id;
      if not found then
        v_cancel := 'no_thread';
      elsif v_e.kind = 'followup' and v_t.status <> 'active' then
        v_cancel := 'sequence_ended';
      elsif v_t.status in ('bounced', 'unsubscribed') then
        v_cancel := 'sequence_ended';
      end if;
    end if;
    if v_cancel is null and private.outbound_is_suppressed(p_workspace_id, v_e.to_email, v_domain) then
      v_cancel := 'suppressed';
    end if;
    if v_cancel is null and (v_l.do_not_contact or exists (
      select 1 from public.leads l2
      where l2.workspace_id = p_workspace_id and l2.email = v_e.to_email and l2.do_not_contact)) then
      v_cancel := 'do_not_contact';
    end if;
    if v_cancel is null and v_l.status in ('unsubscribed', 'lost') then
      v_cancel := 'lead_closed';
    end if;
    -- A cold email to someone who is already talking to the team is noise.
    if v_cancel is null and v_e.kind = 'first' and exists (
      select 1 from public.mail_threads t2
      where t2.workspace_id = p_workspace_id and t2.to_email = v_e.to_email) then
      v_cancel := 'already_contacted';
    end if;
    if v_cancel is not null then
      update public.outbound_emails e set status = 'cancelled', cancel_reason = v_cancel where e.id = v_e.id;
      continue;
    end if;

    select m.* into v_m from public.mailboxes m
    where m.id = v_e.mailbox_id and m.workspace_id = p_workspace_id
    for update;
    if v_m.status = 'disconnected' then
      if v_e.kind = 'first' then
        update public.outbound_emails e
        set status = 'queued', mailbox_id = null, scheduled_at = null where e.id = v_e.id;
      else
        update public.outbound_emails e
        set status = 'cancelled', cancel_reason = 'mailbox_disconnected' where e.id = v_e.id;
      end if;
      continue;
    end if;
    -- A paused mailbox keeps its emails until it is resumed.
    continue when v_m.status <> 'active';
    -- One per mailbox per call: the next call is the gap between two emails.
    continue when v_m.id = any (v_busy);

    if not v_free and (
      not private.in_send_window(v_window, v_ws.timezone, now())
      or (v_e.kind <> 'reply' and (
        v_sent_today >= p_workspace_cap
        or private.mailbox_used_today(v_m.id, p_workspace_id, v_day)
           >= private.mailbox_allowance(v_m.daily_limit, v_m.connected_at, v_ws.timezone, p_ramp_start, p_ramp_step)
      ))
    ) then
      update public.outbound_emails e
      set status = 'queued', scheduled_at = null,
          mailbox_id = case when e.kind = 'first' then null else e.mailbox_id end
      where e.id = v_e.id;
      continue;
    end if;

    -- Threading: a follow-up answers the first email; a reply answers the
    -- latest email in the thread, whoever sent it.
    v_in_reply_to := null;
    v_refs := null;
    if v_e.kind <> 'first' then
      select string_agg(x.message_id, ' ' order by x.ts) into v_refs from (
        select e2.message_id, e2.sent_at as ts from public.outbound_emails e2
        where e2.thread_id = v_t.id and e2.status = 'sent' and e2.message_id is not null
        union all
        select r.message_id, r.received_at from public.mail_received r
        where r.thread_id = v_t.id and r.kind = 'reply'
        order by ts desc limit 20
      ) x;
      if v_e.kind = 'reply' then
        select x.message_id into v_in_reply_to from (
          select e2.message_id, e2.sent_at as ts from public.outbound_emails e2
          where e2.thread_id = v_t.id and e2.status = 'sent' and e2.message_id is not null
          union all
          select r.message_id, r.received_at from public.mail_received r
          where r.thread_id = v_t.id and r.kind = 'reply'
        ) x order by x.ts desc limit 1;
      else
        select e2.message_id into v_in_reply_to from public.outbound_emails e2
        where e2.thread_id = v_t.id and e2.kind = 'first' and e2.status = 'sent';
      end if;
    end if;

    update public.outbound_emails e
    set status = 'sending', claimed_at = now(), attempts = e.attempts + 1,
        subject = v_e.subject, body = v_e.body, to_email = v_e.to_email,
        message_id = coalesce(e.message_id,
          '<' || replace(gen_random_uuid()::text, '-', '') || '@' || split_part(v_m.email, '@', 2) || '>'),
        in_reply_to = v_in_reply_to, reference_ids = left(v_refs, 4000)
    where e.id = v_e.id
    returning e.* into v_e;
    v_busy := v_busy || v_m.id;
    v_sent_today := v_sent_today + 1;
    v_out := v_out || jsonb_build_object(
      'id', v_e.id, 'kind', v_e.kind, 'mailbox_id', v_m.id, 'attempts', v_e.attempts,
      'to', v_e.to_email, 'subject', v_e.subject, 'body', v_e.body,
      'message_id', v_e.message_id, 'in_reply_to', v_e.in_reply_to, 'references', v_e.reference_ids,
      'from_email', v_m.email, 'sender_name', v_m.sender_name,
      'business_name', v_set.business_name, 'postal_address', v_set.postal_address,
      'unsubscribe_token', private.mail_unsub_token(v_e.id)
    );
  end loop;
  return jsonb_build_object('emails', v_out, 'on', true);
end;
$$;

-- An email went out: the record, the thread, the conversation in the Inbox
-- and the next follow-up's date. Internal; called once per email.
create function private.mail_mark_sent(p_email_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_e public.outbound_emails%rowtype;
  v_set public.workspace_sending%rowtype;
  v_t public.mail_threads%rowtype;
  v_conv uuid;
  v_thread uuid;
begin
  update public.outbound_emails e
  set status = 'sent', sent_at = now(), error = null
  where e.id = p_email_id
  returning e.* into v_e;
  select s.* into v_set from public.workspace_sending s where s.workspace_id = v_e.workspace_id;
  update public.mailboxes m set last_sent_at = now() where m.id = v_e.mailbox_id;

  if v_e.kind = 'first' then
    insert into public.conversations (workspace_id, lead_id, channel, status, last_message_at)
    values (v_e.workspace_id, v_e.lead_id, 'email', 'open', now())
    returning id into v_conv;
    insert into public.mail_threads (
      workspace_id, lead_id, conversation_id, mailbox_id, to_email, subject,
      next_followup_at, first_sent_at, last_sent_at
    ) values (
      v_e.workspace_id, v_e.lead_id, v_conv, v_e.mailbox_id, v_e.to_email, v_e.subject,
      case when coalesce(v_set.followups_enabled, true)
        then now() + make_interval(days => coalesce(v_set.followup_1_days, 3)) end,
      now(), now()
    )
    returning id into v_thread;
    update public.outbound_emails e set thread_id = v_thread where e.id = v_e.id;
  else
    select t.* into v_t from public.mail_threads t where t.id = v_e.thread_id for update;
    v_conv := v_t.conversation_id;
    if v_e.kind = 'followup' then
      update public.mail_threads t
      set followups_sent = greatest(t.followups_sent, v_e.step),
          last_sent_at = now(),
          status = case when t.status = 'active' and v_e.step >= 2 then 'finished' else t.status end,
          next_followup_at = case
            when t.status = 'active' and v_e.step < 2 and coalesce(v_set.followups_enabled, true)
            then greatest(
              t.first_sent_at + make_interval(days => coalesce(v_set.followup_2_days, 7)),
              now() + interval '1 day')
          end
      where t.id = v_t.id;
    else
      update public.mail_threads t set last_sent_at = now() where t.id = v_t.id;
    end if;
    update public.conversations c
    set last_message_at = now(),
        status = case when v_e.kind = 'reply' and c.status = 'waiting_for_you' then 'open' else c.status end
    where c.id = v_conv;
  end if;

  insert into public.messages
    (workspace_id, conversation_id, direction, author, author_user_id, body, delivery_status, metadata)
  values (
    v_e.workspace_id, v_conv, 'out', v_e.written_by,
    case when v_e.written_by = 'user' then v_e.author_user_id end,
    v_e.body, 'sent',
    jsonb_build_object('via', 'email', 'email_id', v_e.id, 'subject', v_e.subject, 'kind', v_e.kind, 'step', v_e.step)
  );
  insert into public.activity_events (workspace_id, lead_id, actor_id, kind, summary, channel, metadata)
  values (
    v_e.workspace_id, v_e.lead_id,
    case when v_e.written_by = 'user' then v_e.author_user_id end,
    'email_sent',
    case v_e.kind
      when 'first' then 'First email sent: ' || v_e.subject
      when 'followup' then 'Follow-up ' || v_e.step || ' sent'
      else 'Reply sent by email' end,
    'email', jsonb_build_object('conversation_id', v_conv, 'email_id', v_e.id)
  );
end;
$$;
revoke all on function private.mail_mark_sent(uuid) from public;

-- What the mail server said about a claimed email. Only a row still
-- 'sending' changes, so a late or repeated call does nothing.
--   'sent'     accepted by the mail server.
--   'retry'    certainly not sent (the server said "try later", or nothing
--              was handed over). Scheduled again for p_retry_at, until
--              p_max_attempts is reached; then it is failed.
--   'failed'   refused for good, with the reason.
--   'unknown'  the connection dropped after the email was handed over.
--              Nobody knows: 'needs_check', never resent on its own.
create function public.mail_send_result(
  p_workspace_id uuid, p_email_id uuid, p_outcome text, p_error text,
  p_retry_at timestamptz, p_max_attempts integer
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_e public.outbound_emails%rowtype;
begin
  select e.* into v_e from public.outbound_emails e
  where e.id = p_email_id and e.workspace_id = p_workspace_id and e.status = 'sending'
  for update;
  if not found then
    return 'ignored';
  end if;
  if p_outcome = 'sent' then
    perform private.mail_mark_sent(v_e.id);
    return 'sent';
  end if;
  if p_outcome = 'retry' and v_e.attempts < greatest(p_max_attempts, 1) then
    update public.outbound_emails e
    set status = 'scheduled', scheduled_at = coalesce(p_retry_at, now() + interval '10 minutes'),
        error = left(p_error, 500)
    where e.id = v_e.id;
    return 'scheduled';
  end if;
  if p_outcome = 'unknown' then
    update public.outbound_emails e
    set status = 'needs_check', error = left(p_error, 500) where e.id = v_e.id;
    return 'needs_check';
  end if;
  update public.outbound_emails e
  set status = 'failed', error = left(coalesce(p_error, 'The mail server did not accept it.'), 500)
  where e.id = v_e.id;
  return 'failed';
end;
$$;

-- A person settles an email that failed or whose fate is unknown.
--   'sent':   (needs_check only) they found it in the mailbox's Sent folder.
--   'resend': queue it again.
--   'cancel': leave it unsent.
create function public.outbound_email_resolve(p_email_id uuid, p_action text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_e public.outbound_emails%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  select e.* into v_e from public.outbound_emails e
  where e.id = p_email_id and e.status in ('failed', 'needs_check')
    and (select private.is_workspace_member(e.workspace_id))
  for update;
  if not found then
    raise exception 'email not found' using errcode = 'P0002';
  end if;
  if p_action = 'sent' and v_e.status = 'needs_check' then
    perform private.mail_mark_sent(v_e.id);
    return 'sent';
  elsif p_action = 'resend' then
    update public.outbound_emails e
    set status = 'queued', scheduled_at = null, attempts = 0, error = null,
        mailbox_id = case when e.kind = 'first' then null else e.mailbox_id end
    where e.id = v_e.id;
    return 'queued';
  elsif p_action = 'cancel' then
    update public.outbound_emails e
    set status = 'cancelled', cancel_reason = 'by_person' where e.id = v_e.id;
    return 'cancelled';
  end if;
  raise exception 'unknown action' using errcode = '22023';
end;
$$;

-- Who may call what.
revoke all on function public.outbound_email_resolve(uuid, text) from public, anon;
grant execute on function public.outbound_email_resolve(uuid, text) to authenticated;
revoke all on function public.mail_mailbox_secret(uuid, uuid) from public, anon, authenticated;
revoke all on function public.mail_mailbox_result(uuid, uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public.mail_work_list() from public, anon, authenticated;
revoke all on function public.mail_schedule_context(uuid, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.mail_schedule_commit(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.mail_send_claim(uuid, integer, integer, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.mail_send_result(uuid, uuid, text, text, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.mail_mailbox_secret(uuid, uuid) to service_role;
grant execute on function public.mail_mailbox_result(uuid, uuid, text, text, integer) to service_role;
grant execute on function public.mail_work_list() to service_role;
grant execute on function public.mail_schedule_context(uuid, integer, integer, integer) to service_role;
grant execute on function public.mail_schedule_commit(uuid, jsonb) to service_role;
grant execute on function public.mail_send_claim(uuid, integer, integer, integer, integer, integer) to service_role;
grant execute on function public.mail_send_result(uuid, uuid, text, text, timestamptz, integer) to service_role;
