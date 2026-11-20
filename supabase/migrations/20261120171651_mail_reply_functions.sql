-- Slice 3b, part 4 of 5: reading the inbox, the model's follow-ups and
-- replies, team alerts, and the public unsubscribe function. All but the
-- last are for the server only (secret key).

-- ---------------------------------------------------------------------------
-- Reading the inbox
-- ---------------------------------------------------------------------------

-- Takes up to p_limit active mailboxes that haven't been read for
-- p_interval_seconds, and a lease on each so two readers never overlap.
create function public.mail_poll_claim(p_limit integer, p_interval_seconds integer, p_lease_seconds integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_out jsonb;
begin
  with picked as (
    select m.id from public.mailboxes m
    where m.status = 'active'
      and (m.last_polled_at is null
           or m.last_polled_at < now() - make_interval(secs => greatest(p_interval_seconds, 30)))
      and (m.poll_locked_until is null or m.poll_locked_until < now())
    order by m.last_polled_at nulls first, m.id
    limit greatest(p_limit, 1)
    for update skip locked
  ), marked as (
    update public.mailboxes m
    set poll_locked_until = now() + make_interval(secs => greatest(p_lease_seconds, 30))
    from picked where m.id = picked.id
    returning m.id, m.workspace_id, m.imap_uidvalidity, m.imap_last_uid, m.connected_at
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'mailbox_id', k.id, 'workspace_id', k.workspace_id, 'uidvalidity', k.imap_uidvalidity,
    'last_uid', k.imap_last_uid, 'connected_at', k.connected_at
  )), '[]'::jsonb) into v_out from marked k;
  return v_out;
end;
$$;

-- Ends a read: where it got to, and the lease is released. With p_ok false
-- nothing moves, so the next read starts from the same place.
create function public.mail_poll_done(
  p_workspace_id uuid, p_mailbox_id uuid, p_ok boolean, p_uidvalidity bigint, p_last_uid bigint
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.mailboxes m
  set poll_locked_until = null,
      last_polled_at = now(),
      imap_uidvalidity = case when p_ok then coalesce(p_uidvalidity, m.imap_uidvalidity) else m.imap_uidvalidity end,
      imap_last_uid = case when p_ok then coalesce(p_last_uid, m.imap_last_uid) else m.imap_last_uid end
  where m.id = p_mailbox_id and m.workspace_id = p_workspace_id;
$$;

-- One incoming email. p_message:
--   { "message_id", "from_email", "subject", "kind": reply|bounce|auto_reply,
--     "body", "received_at", "references": ["<id>", ...],
--     "failed_recipients": ["a@b.c"], "asks_to_stop": bool }
-- Matching: first by the ids it refers to (In-Reply-To / References, or the
-- original's id inside a bounce), then by who it is from and its subject;
-- a bounce also by the address that failed. Only this mailbox's own threads
-- are considered. Returns:
--   'unmatched'  not about anything Dialvo sent: nothing is stored.
--   'duplicate'  seen before.
--   'reply'      stored on the lead's conversation; the sequence stops.
--   'bounce'     the address is marked bad; the sequence stops.
--   'auto_reply' stored, and nothing else changes.
--   'stopped'    a reply that plainly asked to stop: handled at once.
create function public.mail_inbound_commit(p_workspace_id uuid, p_mailbox_id uuid, p_message jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text := p_message ->> 'kind';
  v_mid text := left(btrim(coalesce(p_message ->> 'message_id', '')), 300);
  v_from text := lower(btrim(coalesce(p_message ->> 'from_email', '')));
  v_subject text := left(coalesce(p_message ->> 'subject', ''), 300);
  v_body text := left(btrim(coalesce(p_message ->> 'body', '')), 20000);
  v_refs text[] := array(select jsonb_array_elements_text(coalesce(p_message -> 'references', '[]'::jsonb)));
  v_failed text[] := array(select lower(x) from jsonb_array_elements_text(coalesce(p_message -> 'failed_recipients', '[]'::jsonb)) x);
  v_at timestamptz := coalesce((p_message ->> 'received_at')::timestamptz, now());
  v_t public.mail_threads%rowtype;
  v_email uuid;
  v_received uuid;
begin
  if v_mid = '' or v_kind not in ('reply', 'bounce', 'auto_reply') then
    return 'unmatched';
  end if;
  if not exists (select 1 from public.mailboxes m
                 where m.id = p_mailbox_id and m.workspace_id = p_workspace_id) then
    return 'unmatched';
  end if;
  if exists (select 1 from public.mail_received r
             where r.mailbox_id = p_mailbox_id and r.message_id = v_mid) then
    return 'duplicate';
  end if;

  -- By the ids it refers to.
  select e.id, e.thread_id into v_email, v_t.id from public.outbound_emails e
  where e.workspace_id = p_workspace_id and e.mailbox_id = p_mailbox_id
    and e.message_id = any (v_refs) and e.thread_id is not null
  order by e.sent_at desc nulls last
  limit 1;
  if v_t.id is null and v_kind = 'bounce' and cardinality(v_failed) > 0 then
    select t.id into v_t.id from public.mail_threads t
    where t.workspace_id = p_workspace_id and t.mailbox_id = p_mailbox_id
      and t.to_email = any (v_failed) and t.last_sent_at > now() - interval '30 days'
    order by t.last_sent_at desc
    limit 1;
  end if;
  if v_t.id is null and v_kind <> 'bounce' and v_from <> '' then
    select t.id into v_t.id from public.mail_threads t
    where t.workspace_id = p_workspace_id and t.mailbox_id = p_mailbox_id
      and t.to_email = v_from
      and private.mail_norm_subject(t.subject) = private.mail_norm_subject(v_subject)
    order by t.last_sent_at desc nulls last
    limit 1;
  end if;
  if v_t.id is null then
    return 'unmatched';
  end if;
  select t.* into v_t from public.mail_threads t where t.id = v_t.id for update;
  if v_body = '' then
    v_body := '(No text.)';
  end if;

  insert into public.mail_received (
    workspace_id, mailbox_id, thread_id, message_id, from_email, subject, kind, body, received_at,
    classification, classified_at
  ) values (
    p_workspace_id, p_mailbox_id, v_t.id, v_mid, left(v_from, 254), v_subject, v_kind, v_body, v_at,
    null, null
  )
  on conflict (mailbox_id, message_id) do nothing
  returning id into v_received;
  if v_received is null then
    return 'duplicate';
  end if;

  if v_kind = 'bounce' then
    update public.outbound_emails e set bounced_at = now()
    where e.thread_id = v_t.id and e.status = 'sent' and e.bounced_at is null;
    update public.outbound_emails e set status = 'cancelled', cancel_reason = 'bounced'
    where e.thread_id = v_t.id and e.status in ('writing', 'draft', 'queued', 'scheduled');
    update public.mail_threads t
    set status = 'bounced', stop_reason = 'bounced', next_followup_at = null
    where t.id = v_t.id and t.status not in ('unsubscribed');
    -- The address is bad: never write to it again. The lead stays, and can
    -- still be reached another way.
    insert into public.outbound_suppressions (workspace_id, kind, value, note)
    values (p_workspace_id, 'email', v_t.to_email, 'Bounced: the address did not accept email')
    on conflict (workspace_id, kind, value) do nothing;
    update public.leads l
    set custom_fields = l.custom_fields || jsonb_build_object('email_bounced_at', now())
    where l.id = v_t.lead_id and l.workspace_id = p_workspace_id;
    insert into public.activity_events (workspace_id, lead_id, kind, summary, channel, metadata)
    values (p_workspace_id, v_t.lead_id, 'email_bounced',
            'The email to ' || v_t.to_email || ' bounced. The address is on the never-contact list and no follow-up will be sent.',
            'email', jsonb_build_object('conversation_id', v_t.conversation_id));
    return 'bounce';
  end if;

  insert into public.messages
    (workspace_id, conversation_id, direction, author, body, delivery_status, metadata, sent_at)
  values (
    p_workspace_id, v_t.conversation_id, 'in', 'lead', v_body, 'received',
    jsonb_build_object('via', 'email', 'received_id', v_received, 'subject', v_subject,
                       'from', v_from, 'auto_reply', v_kind = 'auto_reply'),
    v_at
  );

  if v_kind = 'auto_reply' then
    -- An out-of-office isn't an answer: the sequence carries on.
    update public.conversations c set last_message_at = now() where c.id = v_t.conversation_id;
    return 'auto_reply';
  end if;

  -- A real reply: the sequence stops, whatever it says.
  update public.outbound_emails e set status = 'cancelled', cancel_reason = 'replied'
  where e.thread_id = v_t.id and e.kind = 'followup' and e.status in ('writing', 'draft', 'queued', 'scheduled');
  update public.mail_threads t
  set status = case when t.status in ('active', 'finished', 'stopped') then 'replied' else t.status end,
      stop_reason = case when t.status in ('active', 'finished', 'stopped') then 'replied' else t.stop_reason end,
      next_followup_at = null, last_reply_at = v_at
  where t.id = v_t.id;
  update public.conversations c
  set status = 'waiting_for_you', last_message_at = now() where c.id = v_t.conversation_id;
  update public.leads l set status = 'engaged'
  where l.id = v_t.lead_id and l.workspace_id = p_workspace_id and l.status = 'new';
  insert into public.activity_events (workspace_id, lead_id, kind, summary, channel, metadata)
  values (p_workspace_id, v_t.lead_id, 'email_reply', 'Replied by email. Follow-ups have stopped.',
          'email', jsonb_build_object('conversation_id', v_t.conversation_id, 'received_id', v_received));

  if (p_message ->> 'asks_to_stop')::boolean is true then
    update public.mail_received r
    set classification = 'unsubscribe', classified_at = now(),
        class_summary = 'Asked not to be contacted again.'
    where r.id = v_received;
    update public.mail_threads t set reply_class = 'unsubscribe' where t.id = v_t.id;
    perform private.mail_stop_contact(
      p_workspace_id, v_t.lead_id, v_t.to_email, 'unsubscribed', 'asked_to_stop', 'unsubscribed',
      'Asked by email not to be contacted again. Added to the never-contact list.');
    if v_from <> v_t.to_email and v_from ~ '^[^\s@]+@[a-z0-9-]+(\.[a-z0-9-]+)+$' then
      insert into public.outbound_suppressions (workspace_id, kind, value, note)
      values (p_workspace_id, 'email', v_from, 'Asked by email not to be contacted again')
      on conflict (workspace_id, kind, value) do nothing;
    end if;
    update public.conversations c set status = 'closed' where c.id = v_t.conversation_id;
    return 'stopped';
  end if;
  return 'reply';
end;
$$;

-- ---------------------------------------------------------------------------
-- The writer: classify replies, draft answers, draft follow-ups
-- ---------------------------------------------------------------------------

-- Hands out the next replies to classify and the next follow-ups to write,
-- at most p_limit together, and counts them against the day's cap on
-- model-written emails (p_max_writes_per_day) and the day's spend.
--   { "capped": bool, "context": { workspace, business_name, instructions,
--       knowledge, booking_url }, "replies": [...], "followups": [...] }
-- A reply is leased for two minutes; a follow-up is reserved as a 'writing'
-- row. Either is handed out again if its writer died, up to p_max_attempts.
create function public.mail_write_claim(
  p_workspace_id uuid, p_limit integer, p_max_writes_per_day integer,
  p_max_cost_micros_per_day bigint, p_max_attempts integer
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
  v_usage jsonb;
  v_room integer;
  v_replies jsonb := '[]'::jsonb;
  v_followups jsonb := '[]'::jsonb;
  v_id uuid;
  r record;
  t record;
begin
  select w.* into v_ws from public.workspaces w where w.id = p_workspace_id for update;
  if not found then
    return null;
  end if;
  select s.* into v_set from public.workspace_sending s where s.workspace_id = p_workspace_id;
  select a.* into v_agent from public.agents a
  where a.workspace_id = p_workspace_id and a.role = 'outbound'
  order by (a.channel = 'email') desc, a.created_at
  limit 1;
  v_usage := private.outbound_usage_json(p_workspace_id);
  v_room := least(greatest(p_limit, 0), p_max_writes_per_day - coalesce((
    select u.mail_writes from public.outbound_usage u
    where u.workspace_id = p_workspace_id and u.day = (now() at time zone 'utc')::date), 0));
  if (v_usage ->> 'cost_micros')::bigint >= p_max_cost_micros_per_day then
    v_room := 0;
  end if;

  -- Give up on what has been tried too often: a person reads the reply.
  update public.mail_received x
  set classification = 'unclear', classified_at = now(),
      class_summary = 'Dialvo could not read this reply. Please read it yourself.'
  where x.workspace_id = p_workspace_id and x.kind = 'reply' and x.classification is null
    and x.class_attempts >= greatest(p_max_attempts, 1)
    and (x.class_locked_until is null or x.class_locked_until < now());
  update public.outbound_emails e
  set status = 'cancelled', cancel_reason = 'could_not_write'
  where e.workspace_id = p_workspace_id and e.status = 'writing'
    and e.attempts >= greatest(p_max_attempts, 1) and e.updated_at < now() - interval '2 minutes';

  for r in
    select x.*, th.subject as thread_subject, th.conversation_id, th.to_email, th.lead_id as t_lead,
           mb.sender_name
    from public.mail_received x
    join public.mail_threads th on th.id = x.thread_id and th.workspace_id = x.workspace_id
    join public.mailboxes mb on mb.id = th.mailbox_id and mb.workspace_id = th.workspace_id
    where x.workspace_id = p_workspace_id and x.kind = 'reply' and x.classification is null
      and (x.class_locked_until is null or x.class_locked_until < now())
    order by x.received_at, x.id
    limit greatest(v_room, 0)
    for update of x skip locked
  loop
    update public.mail_received x
    set class_locked_until = now() + interval '2 minutes', class_attempts = x.class_attempts + 1
    where x.id = r.id;
    v_replies := v_replies || jsonb_build_object(
      'received_id', r.id, 'subject', r.thread_subject, 'body', r.body, 'sender_name', r.sender_name,
      'lead', (select jsonb_build_object('name', l.name, 'company', coalesce(l.company, ''))
               from public.leads l where l.id = r.t_lead and l.workspace_id = p_workspace_id),
      -- The conversation so far, oldest first, without the reply itself.
      'history', coalesce((
        select jsonb_agg(jsonb_build_object('from', h.who, 'body', h.body) order by h.sent_at)
        from (
          select case when m.direction = 'in' then 'them' else 'us' end as who, m.body, m.sent_at
          from public.messages m
          where m.conversation_id = r.conversation_id and m.workspace_id = p_workspace_id
            and coalesce(m.metadata ->> 'received_id', '') <> r.id::text
          order by m.sent_at desc
          limit 6
        ) h
      ), '[]'::jsonb)
    );
  end loop;
  v_room := v_room - jsonb_array_length(v_replies);

  if coalesce(v_set.sending_on, false) and coalesce(v_set.followups_enabled, false) then
    for t in
      select th.*, w.id as writing_id, m.sender_name
      from public.mail_threads th
      join public.mailboxes m on m.id = th.mailbox_id and m.workspace_id = th.workspace_id and m.status = 'active'
      left join public.outbound_emails w
        on w.thread_id = th.id and w.kind = 'followup' and w.step = th.followups_sent + 1 and w.status <> 'cancelled'
      where th.workspace_id = p_workspace_id and th.status = 'active'
        and th.followups_sent < 2 and th.next_followup_at <= now()
        and (w.id is null or (w.status = 'writing' and w.updated_at < now() - interval '2 minutes'
                              and w.attempts < greatest(p_max_attempts, 1)))
      order by th.next_followup_at, th.id
      limit greatest(v_room, 0)
      for update of th skip locked
    loop
      if t.writing_id is null then
        insert into public.outbound_emails (
          workspace_id, lead_id, thread_id, mailbox_id, kind, step, written_by, to_email, subject, status, attempts
        ) values (
          p_workspace_id, t.lead_id, t.id, t.mailbox_id, 'followup', t.followups_sent + 1, 'agent',
          t.to_email, left('Re: ' || t.subject, 200), 'writing', 1
        )
        returning id into v_id;
      else
        update public.outbound_emails e set attempts = e.attempts + 1 where e.id = t.writing_id
        returning e.id into v_id;
      end if;
      v_followups := v_followups || jsonb_build_object(
        'email_id', v_id, 'step', t.followups_sent + 1, 'subject', t.subject, 'sender_name', t.sender_name,
        'lead', (select jsonb_build_object('name', l.name, 'company', coalesce(l.company, ''))
                 from public.leads l where l.id = t.lead_id and l.workspace_id = p_workspace_id),
        'prospect', (select jsonb_build_object('summary', p.summary, 'facts', p.facts)
                     from public.outbound_emails f
                     join public.prospects p on p.id = f.prospect_id and p.workspace_id = f.workspace_id
                     where f.thread_id = t.id and f.kind = 'first' limit 1),
        'sent', coalesce((
          select jsonb_agg(jsonb_build_object('step', s.step, 'body', s.body) order by s.sent_at)
          from public.outbound_emails s
          where s.thread_id = t.id and s.status = 'sent' and s.kind in ('first', 'followup')
        ), '[]'::jsonb)
      );
    end loop;
  end if;

  insert into public.outbound_usage as u (workspace_id, day, mail_writes)
  values (p_workspace_id, (now() at time zone 'utc')::date,
          jsonb_array_length(v_replies) + jsonb_array_length(v_followups))
  on conflict (workspace_id, day) do update set mail_writes = u.mail_writes + excluded.mail_writes;

  return jsonb_build_object(
    'capped', v_room <= 0 and jsonb_array_length(v_replies) + jsonb_array_length(v_followups) = 0,
    'replies', v_replies,
    'followups', v_followups,
    'context', jsonb_build_object(
      'workspace', jsonb_build_object('name', v_ws.name, 'website', v_ws.website),
      'business_name', coalesce(v_set.business_name, ''),
      'booking_url', v_set.booking_url,
      'instructions', coalesce(v_agent.instructions, ''),
      'knowledge', coalesce((
        select jsonb_agg(
          jsonb_build_object('title', k.title, 'content', k.content, 'source_url', k.source_url)
          order by k.created_at desc)
        from (
          select k.title, k.content, k.source_url, k.created_at
          from public.knowledge_items k
          where k.workspace_id = p_workspace_id and k.status = 'ready'
            and (k.kind = 'text' or k.source_url is not null)
          order by k.created_at desc
          limit 50
        ) k
      ), '[]'::jsonb)
    )
  );
end;
$$;

-- Stores a written follow-up on the row reserved for it. It waits for a
-- person unless the outbound agent is set to send on its own. With p_ok
-- false the row stays 'writing' and is tried again later.
create function public.mail_followup_save(
  p_workspace_id uuid, p_email_id uuid, p_ok boolean, p_body text, p_model text, p_cost_micros bigint
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ok boolean := coalesce(p_ok, false) and char_length(btrim(coalesce(p_body, ''))) between 1 and 5000;
  v_auto boolean;
  v_status text;
begin
  perform private.outbound_usage_add(p_workspace_id, p_cost_micros, 0, 0);
  if not v_ok then
    return 'retry';
  end if;
  select coalesce((
    select a.approval_mode = 'auto' from public.agents a
    where a.workspace_id = p_workspace_id and a.role = 'outbound'
    order by (a.channel = 'email') desc, a.created_at limit 1), false) into v_auto;
  v_status := case when v_auto then 'queued' else 'draft' end;
  update public.outbound_emails e
  set status = v_status, body = btrim(p_body), model = left(p_model, 80)
  where e.id = p_email_id and e.workspace_id = p_workspace_id and e.status = 'writing'
    and exists (select 1 from public.mail_threads t where t.id = e.thread_id and t.status = 'active');
  if not found then
    return 'ignored';
  end if;
  return v_status;
end;
$$;

-- Stores what the model made of one reply, and acts on it. p_result:
--   { "class": interested|question|not_now|not_interested|wrong_person|
--              unsubscribe|unclear, "summary": "...", "reply": "..." , "model" }
--   unsubscribe, not_interested: never-contact list and do not contact, now.
--   not_now, wrong_person, unclear: the sequence has stopped already; the
--     conversation waits for a person.
--   interested, question: the agent's answer is stored as a draft, or
--     queued when replies are set to go on their own. "interested" queues
--     an alert for the team.
-- The answer always goes to the thread's own address. With p_ok false the
-- reply is released to be tried again.
create function public.mail_reply_commit(
  p_workspace_id uuid, p_received_id uuid, p_ok boolean, p_result jsonb, p_cost_micros bigint
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r public.mail_received%rowtype;
  v_t public.mail_threads%rowtype;
  v_set public.workspace_sending%rowtype;
  v_class text := p_result ->> 'class';
  v_summary text := left(btrim(coalesce(p_result ->> 'summary', '')), 600);
  v_reply text := left(btrim(coalesce(p_result ->> 'reply', '')), 5000);
begin
  perform private.outbound_usage_add(p_workspace_id, p_cost_micros, 0, 0);
  select x.* into v_r from public.mail_received x
  where x.id = p_received_id and x.workspace_id = p_workspace_id
    and x.kind = 'reply' and x.classification is null
  for update;
  if not found then
    return 'ignored';
  end if;
  if not coalesce(p_ok, false) or v_class is null or v_class not in
     ('interested', 'question', 'not_now', 'not_interested', 'wrong_person', 'unsubscribe', 'unclear') then
    update public.mail_received x set class_locked_until = null where x.id = v_r.id;
    return 'retry';
  end if;
  select t.* into v_t from public.mail_threads t where t.id = v_r.thread_id for update;
  select s.* into v_set from public.workspace_sending s where s.workspace_id = p_workspace_id;

  update public.mail_received x
  set classification = v_class, class_summary = nullif(v_summary, ''), classified_at = now(),
      class_locked_until = null
  where x.id = v_r.id;
  update public.mail_threads t set reply_class = v_class where t.id = v_t.id;
  update public.conversations c
  set outcome_summary = nullif(v_summary, '') where c.id = v_t.conversation_id;

  if v_class in ('unsubscribe', 'not_interested') then
    perform private.mail_stop_contact(
      p_workspace_id, v_t.lead_id, v_t.to_email, 'unsubscribed',
      case when v_class = 'unsubscribe' then 'asked_to_stop' else 'not_interested' end,
      case when v_class = 'unsubscribe' then 'unsubscribed' else 'lost' end,
      case when v_class = 'unsubscribe'
        then 'Asked by email not to be contacted again. Added to the never-contact list.'
        else 'Replied that they are not interested. Added to the never-contact list.' end);
    if v_r.from_email <> v_t.to_email and v_r.from_email ~ '^[^\s@]+@[a-z0-9-]+(\.[a-z0-9-]+)+$' then
      insert into public.outbound_suppressions (workspace_id, kind, value, note)
      values (p_workspace_id, 'email', v_r.from_email, 'Asked by email not to be contacted again')
      on conflict (workspace_id, kind, value) do nothing;
    end if;
    update public.conversations c set status = 'closed' where c.id = v_t.conversation_id;
    return v_class;
  end if;

  if v_class in ('interested', 'question') and v_reply <> ''
     and v_t.status not in ('bounced', 'unsubscribed')
     and not private.outbound_is_suppressed(p_workspace_id, v_t.to_email, null)
     and not exists (select 1 from public.leads l where l.id = v_t.lead_id and l.do_not_contact)
     -- A person may have answered already.
     and not exists (select 1 from public.outbound_emails e
                     where e.thread_id = v_t.id and e.kind = 'reply'
                       and e.created_at > v_r.created_at and e.status <> 'cancelled') then
    insert into public.outbound_emails (
      workspace_id, lead_id, thread_id, mailbox_id, kind, written_by, to_email, subject, body,
      status, answers_received_id, model
    ) values (
      p_workspace_id, v_t.lead_id, v_t.id, v_t.mailbox_id, 'reply', 'agent', v_t.to_email,
      left('Re: ' || v_t.subject, 200), v_reply,
      case when coalesce(v_set.reply_mode, 'approve_first') = 'auto' then 'queued' else 'draft' end,
      v_r.id, left(p_result ->> 'model', 80)
    );
  end if;
  if v_class = 'interested' then
    insert into public.team_alerts (workspace_id, conversation_id, kind, summary)
    values (p_workspace_id, v_t.conversation_id, 'reply_interested',
            left(coalesce(nullif(v_summary, ''), 'A lead replied to your email and sounds interested.'), 1000));
  end if;
  return v_class;
end;
$$;

-- Hands the server the email alerts waiting for one workspace (an
-- interested reply, a paused mailbox), with who to email. Like
-- claim_team_alerts: each alert is handed out once, at most 20 an hour per
-- workspace, and nothing older than 15 minutes.
create function public.mail_claim_team_alerts(p_workspace_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws public.workspaces%rowtype;
  v_recipients text[];
  v_sent integer;
  v_alert record;
  v_alerts jsonb := '[]'::jsonb;
begin
  select * into v_ws from public.workspaces w where w.id = p_workspace_id;
  if not found then
    return null;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('team_alerts:' || v_ws.id::text, 0));
  select array_agg(p.email order by p.email) into v_recipients
  from public.workspace_members m
  join public.profiles p on p.id = m.user_id
  where m.workspace_id = v_ws.id and p.alert_emails and p.email <> '';
  select count(*) into v_sent from public.team_alerts t
  where t.workspace_id = v_ws.id and t.status in ('sending', 'sent')
    and t.created_at > now() - interval '1 hour';
  for v_alert in
    select t.id, t.kind, t.summary, t.conversation_id,
           (select l.name from public.conversations c
            join public.leads l on l.id = c.lead_id and l.workspace_id = c.workspace_id
            where c.id = t.conversation_id) as lead
    from public.team_alerts t
    where t.workspace_id = v_ws.id and t.kind in ('reply_interested', 'mailbox_paused')
      and t.status = 'pending' and t.created_at > now() - interval '15 minutes'
    order by t.created_at
    for update
  loop
    if v_recipients is null or v_sent >= 20 then
      update public.team_alerts t set status = 'skipped' where t.id = v_alert.id;
    else
      update public.team_alerts t set status = 'sending' where t.id = v_alert.id;
      v_sent := v_sent + 1;
      v_alerts := v_alerts || jsonb_build_object(
        'id', v_alert.id, 'kind', v_alert.kind, 'summary', v_alert.summary,
        'conversation_id', v_alert.conversation_id, 'lead', coalesce(v_alert.lead, ''));
    end if;
  end loop;
  return jsonb_build_object(
    'workspace', v_ws.name,
    'recipients', to_jsonb(coalesce(v_recipients, array[]::text[])),
    'alerts', v_alerts
  );
end;
$$;

-- Workspaces with a team alert of ours waiting.
create function public.mail_alert_work_list()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct t.workspace_id), '{}'::uuid[])
  from public.team_alerts t
  where t.status = 'pending' and t.kind in ('reply_interested', 'mailbox_paused')
    and t.created_at > now() - interval '15 minutes';
$$;

-- Workspaces with a reply to classify (whether or not sending is on: a
-- reply is read even after sending was switched off).
create function public.mail_write_work_list()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct x.workspace_id), '{}'::uuid[]) from (
    select r.workspace_id from public.mail_received r
    where r.kind = 'reply' and r.classification is null
    union all
    select t.workspace_id from public.mail_threads t
    join public.workspace_sending s on s.workspace_id = t.workspace_id and s.sending_on and s.followups_enabled
    where t.status = 'active' and t.followups_sent < 2 and t.next_followup_at <= now()
  ) x;
$$;

-- ---------------------------------------------------------------------------
-- Unsubscribe: the link in every email. No login; the signed token is the
-- proof. With p_confirm false it only says whether the link is good (the
-- page a person sees first); with true it stops all contact.
--   { "status": "invalid" } | { "status": "ok" | "done", "business": "..." }
-- ---------------------------------------------------------------------------
create function public.mail_unsubscribe(p_token text, p_confirm boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_e public.outbound_emails%rowtype;
  v_business text;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[0-9a-f]{64}$' then
    return jsonb_build_object('status', 'invalid');
  end if;
  v_id := split_part(p_token, '.', 1)::uuid;
  if private.mail_unsub_token(v_id) is distinct from p_token then
    return jsonb_build_object('status', 'invalid');
  end if;
  select e.* into v_e from public.outbound_emails e where e.id = v_id;
  if not found then
    return jsonb_build_object('status', 'invalid');
  end if;
  select coalesce(nullif(s.business_name, ''), w.name) into v_business
  from public.workspaces w
  left join public.workspace_sending s on s.workspace_id = w.id
  where w.id = v_e.workspace_id;
  if not coalesce(p_confirm, false) then
    return jsonb_build_object('status', 'ok', 'business', v_business);
  end if;
  if not private.outbound_is_suppressed(v_e.workspace_id, v_e.to_email, null) then
    perform private.mail_stop_contact(
      v_e.workspace_id, v_e.lead_id, v_e.to_email, 'unsubscribed', 'unsubscribe_link', 'unsubscribed',
      'Unsubscribed with the link in an email. Added to the never-contact list.');
  end if;
  return jsonb_build_object('status', 'done', 'business', v_business);
end;
$$;

-- Who may call what. The unsubscribe link works for anyone who holds it.
revoke all on function public.mail_write_work_list() from public, anon, authenticated;
revoke all on function public.mail_alert_work_list() from public, anon, authenticated;
revoke all on function public.mail_poll_claim(integer, integer, integer) from public, anon, authenticated;
revoke all on function public.mail_poll_done(uuid, uuid, boolean, bigint, bigint) from public, anon, authenticated;
revoke all on function public.mail_inbound_commit(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.mail_write_claim(uuid, integer, integer, bigint, integer) from public, anon, authenticated;
revoke all on function public.mail_followup_save(uuid, uuid, boolean, text, text, bigint) from public, anon, authenticated;
revoke all on function public.mail_reply_commit(uuid, uuid, boolean, jsonb, bigint) from public, anon, authenticated;
revoke all on function public.mail_claim_team_alerts(uuid) from public, anon, authenticated;
grant execute on function public.mail_write_work_list() to service_role;
grant execute on function public.mail_alert_work_list() to service_role;
grant execute on function public.mail_poll_claim(integer, integer, integer) to service_role;
grant execute on function public.mail_poll_done(uuid, uuid, boolean, bigint, bigint) to service_role;
grant execute on function public.mail_inbound_commit(uuid, uuid, jsonb) to service_role;
grant execute on function public.mail_write_claim(uuid, integer, integer, bigint, integer) to service_role;
grant execute on function public.mail_followup_save(uuid, uuid, boolean, text, text, bigint) to service_role;
grant execute on function public.mail_reply_commit(uuid, uuid, boolean, jsonb, bigint) to service_role;
grant execute on function public.mail_claim_team_alerts(uuid) to service_role;
revoke all on function public.mail_unsubscribe(text, boolean) from public;
grant execute on function public.mail_unsubscribe(text, boolean) to anon, authenticated, service_role;
