-- Deliverability: each mailbox's DNS check, and pausing a mailbox whose
-- bounces or stop requests run too high. Additive.
--
--   mailboxes          + dns_check, dns_checked_at: the last DNS check of the
--                      mailbox's domain (SPF, DKIM, DMARC, MX), as the app
--                      made it (src/lib/mail/dns.ts). + health_since: what
--                      counts towards the limits starts here (set when a
--                      paused mailbox is resumed, so it gets a fresh start).
--   mailbox_dns_save() a member stores a check they ran.
--   mailbox_health_stats() per mailbox, for the settings page: sent,
--                      bounced and asked-to-stop in the last N days.
--   mail_health_check() the send step, before sending: pauses each active
--                      mailbox over a limit and tells the team. The limits
--                      are arguments, set in src/lib/mail/config.ts.
--
-- "Asked to stop" is an unsubscribe (the link or a reply asking to stop).
-- Spam complaints made through a mailbox provider's own button aren't
-- reported back to the sender's inbox by the big providers, so Dialvo can't
-- count those; asking to stop is the closest signal it has.

alter table public.mailboxes
  add column dns_check jsonb check (dns_check is null or jsonb_typeof(dns_check) = 'object'),
  add column dns_checked_at timestamptz,
  add column health_since timestamptz;

create function private.mailbox_health_reset()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'paused' and new.status = 'active' then
    new.health_since := now();
  end if;
  return new;
end;
$$;
revoke all on function private.mailbox_health_reset() from public;
create trigger mailboxes_health_reset
  before update on public.mailboxes
  for each row execute function private.mailbox_health_reset();

-- Stores the result of a DNS check a member ran (the app looked the records
-- up; there is nothing secret in them).
create function public.mailbox_dns_save(p_mailbox_id uuid, p_result jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if jsonb_typeof(p_result) is distinct from 'object' or pg_column_size(p_result) > 20000 then
    raise exception 'that check is not readable' using errcode = '22023';
  end if;
  update public.mailboxes m
  set dns_check = p_result, dns_checked_at = now()
  where m.id = p_mailbox_id and m.status <> 'disconnected'
    and (select private.is_workspace_member(m.workspace_id));
  if not found then
    raise exception 'mailbox not found' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.mailbox_dns_save(uuid, jsonb) from public, anon;
grant execute on function public.mailbox_dns_save(uuid, jsonb) to authenticated;

-- One mailbox's numbers since p_since (sent first emails and follow-ups and
-- replies, how many bounced, how many people asked to stop). Internal.
create function private.mailbox_health_numbers(p_workspace_id uuid, p_mailbox_id uuid, p_since timestamptz,
  out sent integer, out bounced integer, out stopped integer)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select count(*)::integer from public.outbound_emails e
     where e.workspace_id = p_workspace_id and e.mailbox_id = p_mailbox_id
       and e.status = 'sent' and e.sent_at >= p_since),
    (select count(*)::integer from public.outbound_emails e
     where e.workspace_id = p_workspace_id and e.mailbox_id = p_mailbox_id
       and e.status = 'sent' and e.sent_at >= p_since and e.bounced_at is not null),
    (select count(*)::integer from public.mail_threads t
     where t.workspace_id = p_workspace_id and t.mailbox_id = p_mailbox_id
       and t.first_sent_at >= p_since
       and (t.status = 'unsubscribed' or t.reply_class = 'unsubscribe'));
$$;
revoke all on function private.mailbox_health_numbers(uuid, uuid, timestamptz) from public;

-- For the settings page, as the signed-in person: each mailbox's numbers
-- over the last p_days (from its fresh start, if later).
create function public.mailbox_health_stats(p_workspace_id uuid, p_days integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select private.is_workspace_member(p_workspace_id)) then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'mailbox_id', m.id, 'sent', n.sent, 'bounced', n.bounced, 'stopped', n.stopped,
      'since', greatest(now() - make_interval(days => least(greatest(p_days, 1), 90)),
                        coalesce(m.health_since, '-infinity'::timestamptz))))
    from public.mailboxes m
    cross join lateral private.mailbox_health_numbers(
      m.workspace_id, m.id,
      greatest(now() - make_interval(days => least(greatest(p_days, 1), 90)),
               coalesce(m.health_since, '-infinity'::timestamptz))) n
    where m.workspace_id = p_workspace_id and m.status <> 'disconnected'
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.mailbox_health_stats(uuid, integer) from public, anon;
grant execute on function public.mailbox_health_stats(uuid, integer) to authenticated;

-- Pauses each active mailbox of the workspace whose bounces, or whose
-- people asking to stop, are over the limit in the last p_days: at least
-- p_min_* of them and at least p_*_pct percent of what it sent. The team is
-- told. Server only. Returns how many were paused.
create function public.mail_health_check(
  p_workspace_id uuid, p_days integer,
  p_min_bounces integer, p_bounce_pct numeric,
  p_min_stops integer, p_stop_pct numeric
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  m record;
  v_reason text;
  v_summary text;
  v_paused integer := 0;
begin
  for m in
    select mb.id, mb.email, n.sent, n.bounced, n.stopped
    from public.mailboxes mb
    cross join lateral private.mailbox_health_numbers(
      mb.workspace_id, mb.id,
      greatest(now() - make_interval(days => least(greatest(p_days, 1), 90)),
               coalesce(mb.health_since, '-infinity'::timestamptz))) n
    where mb.workspace_id = p_workspace_id and mb.status = 'active'
    for update of mb
  loop
    v_reason := null;
    if m.bounced >= p_min_bounces and m.bounced * 100 >= p_bounce_pct * greatest(m.sent, 1) then
      v_reason := 'bounce_rate';
      v_summary := m.email || ': ' || m.bounced || ' of the last ' || m.sent
        || ' emails bounced. Sending from it is paused so its reputation isn''t hurt further. '
        || 'Check the addresses you are sending to, then resume it in Mailboxes.';
    elsif m.stopped >= p_min_stops and m.stopped * 100 >= p_stop_pct * greatest(m.sent, 1) then
      v_reason := 'complaint_rate';
      v_summary := m.email || ': ' || m.stopped || ' people asked to stop after ' || m.sent
        || ' emails. Sending from it is paused. Check who you are writing to and what the emails say, then resume it in Mailboxes.';
    end if;
    continue when v_reason is null;
    update public.mailboxes mb set status = 'paused', pause_reason = v_reason where mb.id = m.id;
    insert into public.team_alerts (workspace_id, kind, summary)
    values (p_workspace_id, 'mailbox_health', left(v_summary, 1000));
    v_paused := v_paused + 1;
  end loop;
  return v_paused;
end;
$$;
revoke all on function public.mail_health_check(uuid, integer, integer, numeric, integer, numeric) from public, anon, authenticated;
grant execute on function public.mail_health_check(uuid, integer, integer, numeric, integer, numeric) to service_role;
