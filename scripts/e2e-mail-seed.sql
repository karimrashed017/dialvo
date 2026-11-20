-- Test rows for scripts/e2e-mail.mjs. Run once in the Supabase SQL editor,
-- with the email address of the first test account in place of :owner_email
-- (the script prints this file with the address filled in).
--
-- It builds its scene with the real functions, exactly as the app would:
-- six made-up companies on .example domains with approved first emails; one
-- stays scheduled, the rest are claimed and reported as sent, failed or
-- unknown; one gets a reply (classified "interested", with a draft answer),
-- one bounces, one has a follow-up waiting. No email is sent anywhere: the
-- mailbox is a made-up one with no password, and it ends up paused, so the
-- scheduler never touches it. Nothing is deleted. Running it twice does
-- nothing the second time.
do $seed$
declare
  v_ws uuid; v_user uuid; v_box uuid; v_search uuid; v_run uuid; v_p uuid; v_d uuid;
  v_window jsonb; v_claim jsonb; v_e jsonb; v_work jsonb; v_co text; v_i integer;
  v_plans jsonb := '[]'::jsonb;
begin
  select w.id, m.user_id into v_ws, v_user
  from public.workspaces w
  join public.workspace_members m on m.workspace_id = w.id and m.role = 'owner'
  join public.profiles p on p.id = m.user_id
  where p.email = :owner_email
  order by w.created_at limit 1;
  if v_ws is null then raise exception 'no workspace for that account'; end if;
  if exists (select 1 from public.mailboxes where workspace_id = v_ws and email = 'e2e-sender@mailbox.example') then
    return;
  end if;

  insert into public.workspace_sending (workspace_id, business_name, postal_address, allowed_confirmed_at, allowed_confirmed_by, sending_on)
  values (v_ws, 'E2E Test Business', '1 Test Street, Testville', now(), v_user, true)
  on conflict (workspace_id) do update
  set business_name = 'E2E Test Business', postal_address = '1 Test Street, Testville',
      allowed_confirmed_at = coalesce(public.workspace_sending.allowed_confirmed_at, now()), sending_on = true;
  insert into public.mailboxes (workspace_id, provider, email, sender_name, username, smtp_host, smtp_port, imap_host, imap_port, created_by)
  values (v_ws, 'other', 'e2e-sender@mailbox.example', 'E2E Sender', 'e2e-sender@mailbox.example', 'smtp.mailbox.example', 587, 'imap.mailbox.example', 993, v_user)
  returning id into v_box;
  insert into public.prospect_searches (workspace_id, name, description, created_by)
  values (v_ws, 'E2E sending search', 'Made-up companies for the sending check', v_user) returning id into v_search;
  insert into public.prospect_runs (workspace_id, search_id, status, brief, target_count, finished_at)
  values (v_ws, v_search, 'done', '{}'::jsonb, 25, now()) returning id into v_run;

  v_i := 0;
  foreach v_co in array array['scheduled', 'sent', 'replied', 'failed', 'unknown', 'bounced'] loop
    v_i := v_i + 1;
    insert into public.prospects (workspace_id, run_id, search_id, domain, company_name, website, research_status,
      summary, contact_name, email, email_source_url, email_kind, decision, facts)
    values (v_ws, v_run, v_search, 'e2e-mail-' || v_co || '.example', 'E2E ' || initcap(v_co) || ' Co',
      'https://e2e-mail-' || v_co || '.example/', 'found', 'A made-up company for testing.', 'Pat Example',
      'pat@e2e-mail-' || v_co || '.example', 'https://e2e-mail-' || v_co || '.example/contact', 'business', 'kept',
      '[{"fact": "A made-up fact.", "quote": "made up", "source_url": "https://example.com/"}]'::jsonb)
    returning id into v_p;
    insert into public.outbound_drafts (workspace_id, prospect_id, to_email, subject, body, status, decided_by, decided_at)
    values (v_ws, v_p, 'pat@e2e-mail-' || v_co || '.example', 'E2E question for ' || initcap(v_co) || ' Co',
      E'Hi Pat,\n\nThis is a made-up first email for the sending check.\n\nE2E Sender', 'approved', v_user, now())
    returning id into v_d;
    v_plans := v_plans || jsonb_build_object('draft_id', v_d, 'mailbox_id', v_box,
      'send_at', case when v_co = 'scheduled' then now() + interval '3 days' else now() - make_interval(mins => 10 - v_i) end);
  end loop;

  -- The window is opened for the length of this transaction only.
  select a.send_window into v_window from public.agents a where a.workspace_id = v_ws and a.role = 'outbound' limit 1;
  update public.agents set send_window = '{"days": [1,2,3,4,5,6,7], "start": "00:00", "end": "23:59:59"}'::jsonb
  where workspace_id = v_ws and role = 'outbound';
  perform public.mail_schedule_commit(v_ws, v_plans);
  loop
    v_claim := public.mail_send_claim(v_ws, 5, 50, 0, 150, 600);
    exit when jsonb_array_length(v_claim -> 'emails') = 0;
    v_e := v_claim -> 'emails' -> 0;
    perform public.mail_send_result(v_ws, (v_e ->> 'id')::uuid,
      case when v_e ->> 'to' like '%failed%' then 'failed' when v_e ->> 'to' like '%unknown%' then 'unknown' else 'sent' end,
      case when v_e ->> 'to' like '%failed%' then 'The mail server refused the email: 550 5.1.1 No such user (made up for the check)'
           when v_e ->> 'to' like '%unknown%' then 'The connection dropped while the email was being handed over (made up for the check).' end,
      null, 3);
  end loop;

  -- A follow-up waiting for approval on the one that was sent.
  update public.mail_threads set next_followup_at = now() - interval '1 minute'
  where workspace_id = v_ws and to_email = 'pat@e2e-mail-sent.example';
  v_work := public.mail_write_claim(v_ws, 5, 100, 3000000, 2);
  perform public.mail_followup_save(v_ws, (v_work -> 'followups' -> 0 ->> 'email_id')::uuid, true,
    E'Hi Pat,\n\nA made-up follow-up for the sending check.\n\nE2E Sender', 'e2e', 0);

  -- A reply, read as "interested", with the agent's draft answer.
  perform public.mail_inbound_commit(v_ws, v_box, jsonb_build_object(
    'message_id', '<e2e-reply@e2e-mail-replied.example>', 'kind', 'reply', 'from_email', 'pat@e2e-mail-replied.example',
    'subject', 'Re: E2E question for Replied Co', 'body', 'This sounds interesting. Can we talk next week?',
    'references', (select jsonb_agg(e.message_id) from public.outbound_emails e
                   where e.workspace_id = v_ws and e.to_email = 'pat@e2e-mail-replied.example')));
  v_work := public.mail_write_claim(v_ws, 5, 100, 3000000, 2);
  perform public.mail_reply_commit(v_ws, (v_work -> 'replies' -> 0 ->> 'received_id')::uuid, true, jsonb_build_object(
    'class', 'interested', 'summary', 'Wants to talk next week (made up for the check).',
    'reply', E'Hi Pat,\n\nGladly. A made-up answer for the sending check.\n\nE2E Sender', 'model', 'e2e'), 0);
  -- No real alert email for a made-up reply.
  update public.team_alerts set status = 'skipped' where workspace_id = v_ws and kind = 'reply_interested' and status = 'pending';

  perform public.mail_inbound_commit(v_ws, v_box, jsonb_build_object(
    'message_id', '<e2e-bounce@mailbox.example>', 'kind', 'bounce', 'from_email', 'mailer-daemon@mailbox.example',
    'subject', 'Undelivered Mail Returned to Sender', 'failed_recipients', jsonb_build_array('pat@e2e-mail-bounced.example')));

  update public.agents set send_window = v_window where workspace_id = v_ws and role = 'outbound';
  update public.mailboxes set status = 'paused', pause_reason = 'e2e' where id = v_box;
end;
$seed$;
