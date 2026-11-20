-- Sending the plays' first emails. A play (lead reactivation, closed-lost
-- check-in, trial users ready to buy, customer expansion) writes to one of
-- the workspace's own leads, so its draft has a lead and no prospect (see
-- the campaigns migration). Four existing functions learn that, each
-- otherwise unchanged line for line:
--
--   outbound_suppression_added  adding to the never-contact list also
--                               discards a play's waiting drafts to that
--                               address or domain (it joined prospects, so
--                               it missed drafts without one)
--   outbound_drafts_approve     "Approve all" also approves a play's drafts,
--                               with the same never-contact and
--                               do-not-contact checks
--   mail_schedule_commit        a play's approved draft is scheduled on its
--                               own lead (there is no prospect to make one
--                               from)
--   mail_send_claim             two checks at send time are relaxed for a
--                               play's first email, and only for it: an
--                               earlier conversation with the lead no longer
--                               cancels it ("already contacted" is the point
--                               of a check-in), and a closed-lost check-in
--                               may go to a lead marked lost. Every other
--                               check stays: never-contact, do not contact,
--                               unsubscribed, still approved, the caps and
--                               the send window.

-- ---------------------------------------------------------------------------
-- outbound_suppression_added
-- ---------------------------------------------------------------------------
create or replace function private.outbound_suppression_added()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.outbound_drafts d
  set status = 'discarded', discard_reason = 'suppressed', decided_at = now()
  where d.workspace_id = new.workspace_id
    and d.status in ('drafting', 'draft', 'approved', 'failed')
    and (select private.outbound_is_suppressed(
      d.workspace_id, d.to_email,
      (select p.domain from public.prospects p
       where p.id = d.prospect_id and p.workspace_id = d.workspace_id)));
  return new;
end;
$$;
revoke all on function private.outbound_suppression_added() from public;

-- ---------------------------------------------------------------------------
-- outbound_drafts_approve
-- ---------------------------------------------------------------------------
create or replace function public.outbound_drafts_approve(p_draft_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_count integer;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  update public.outbound_drafts d
  set status = 'approved', decided_by = v_user, decided_at = now()
  where d.id = any (coalesce(p_draft_ids, '{}'::uuid[])) and d.status = 'draft'
    and (select private.is_workspace_member(d.workspace_id))
    and not (select private.outbound_is_suppressed(
      d.workspace_id, d.to_email,
      (select p.domain from public.prospects p
       where p.id = d.prospect_id and p.workspace_id = d.workspace_id)))
    and not exists (
      select 1 from public.leads l
      where l.workspace_id = d.workspace_id and l.do_not_contact
        and (l.id = d.lead_id
             or l.id = (select p.lead_id from public.prospects p
                        where p.id = d.prospect_id and p.workspace_id = d.workspace_id)
             or l.email = d.to_email)
    );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- mail_schedule_commit
-- ---------------------------------------------------------------------------
create or replace function public.mail_schedule_commit(p_workspace_id uuid, p_plans jsonb)
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
    v_p := null;
    select p.* into v_p from public.prospects p
    where p.id = v_d.prospect_id and p.workspace_id = p_workspace_id;
    continue when private.outbound_is_suppressed(p_workspace_id, v_d.to_email, v_p.domain);
    -- A play's first email is to one of the workspace's own leads already.
    if v_d.prospect_id is null then
      select l.id into v_lead from public.leads l
      where l.id = v_d.lead_id and l.workspace_id = p_workspace_id;
    else
      v_lead := private.prospect_ensure_lead(v_d.prospect_id, p_workspace_id);
    end if;
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

-- ---------------------------------------------------------------------------
-- mail_send_claim
-- ---------------------------------------------------------------------------
create or replace function public.mail_send_claim(
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
    v_d := null;
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
    -- A closed-lost check-in is written to a lead marked lost, on purpose.
    if v_cancel is null and (v_l.status = 'unsubscribed' or (v_l.status = 'lost' and not (
      v_e.kind = 'first' and coalesce(v_d.play, '') = 'closed_lost'))) then
      v_cancel := 'lead_closed';
    end if;
    -- A cold email to someone who is already talking to the team is noise.
    -- (Not for a play's email to the workspace's own lead: talking to them
    -- before is the point of it.)
    if v_cancel is null and v_e.kind = 'first' and v_d.lead_id is null and exists (
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
