-- Automated meeting scheduling in the website chat. Additive.
--
--   booking_links          each time the chat offers the workspace's booking
--                          link, a link of Dialvo's own is made for that
--                          conversation (/api/book/<token>). Opening it
--                          records that and goes on to the booking page.
--                          When the booking page sends the visitor back after
--                          they book (the "redirect after booking" every
--                          common scheduling tool has, set to
--                          /api/book/done), the booking is recorded: the
--                          lead becomes "meeting booked", their timeline
--                          says so, a meeting is added when the booking page
--                          passed its time, and the team (or the lead's
--                          owner) is told. Members read everything but the
--                          token; only the server writes.
--   chat_booking_url()     the booking link, for the chat agent's prompt.
--   chat_booking_offer()   a new link for one conversation.
--   booking_open()         the link was opened: where to send them.
--   booking_done()         they booked.

create table public.booking_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  conversation_id uuid not null,
  lead_id uuid not null,
  -- 64 hex characters from two random UUIDs. Never shown in the app.
  token text not null unique check (token ~ '^[0-9a-f]{64}$'),
  opened_at timestamptz,
  booked_at timestamptz,
  meeting_id uuid,
  created_at timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (conversation_id, workspace_id)
    references public.conversations (id, workspace_id) on delete cascade,
  foreign key (lead_id, workspace_id)
    references public.leads (id, workspace_id) on delete cascade,
  foreign key (meeting_id, workspace_id)
    references public.meetings (id, workspace_id) on delete set null (meeting_id)
);
alter table public.booking_links enable row level security;
create index booking_links_conversation_idx on public.booking_links (conversation_id, workspace_id, created_at desc);
create index booking_links_lead_idx on public.booking_links (lead_id, workspace_id);
create index booking_links_meeting_idx on public.booking_links (meeting_id, workspace_id) where meeting_id is not null;
create index booking_links_recent_idx on public.booking_links (workspace_id, created_at desc);

revoke all on public.booking_links from anon, authenticated;
grant all on public.booking_links to service_role;
grant select (id, workspace_id, conversation_id, lead_id, opened_at, booked_at, meeting_id, created_at)
  on public.booking_links to authenticated;
create policy "Members read booking links" on public.booking_links for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));

-- The workspace's booking link, for the chat behind a widget token.
create function public.chat_booking_url(p_token text, p_conversation_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.booking_url
  from public.conversations c
  join public.chat_widgets w on w.id = c.widget_id and w.workspace_id = c.workspace_id
  join public.workspace_sending s on s.workspace_id = c.workspace_id
  where w.token = p_token and w.enabled and c.id = p_conversation_id;
$$;
revoke all on function public.chat_booking_url(text, uuid) from public, anon, authenticated;
grant execute on function public.chat_booking_url(text, uuid) to service_role;

-- A link for this conversation: its latest one not yet used for a booking,
-- or a new one (at most 5 per conversation). Null without a booking link.
create function public.chat_booking_offer(p_token text, p_conversation_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conv public.conversations%rowtype;
  v_link text;
begin
  select c.* into v_conv
  from public.conversations c
  join public.chat_widgets w on w.id = c.widget_id and w.workspace_id = c.workspace_id
  where w.token = p_token and w.enabled and c.id = p_conversation_id;
  if not found or not exists (
    select 1 from public.workspace_sending s
    where s.workspace_id = v_conv.workspace_id and s.booking_url is not null) then
    return null;
  end if;
  select b.token into v_link from public.booking_links b
  where b.conversation_id = v_conv.id and b.workspace_id = v_conv.workspace_id and b.booked_at is null
  order by b.created_at desc limit 1;
  if v_link is not null then
    return v_link;
  end if;
  if (select count(*) from public.booking_links b
      where b.conversation_id = v_conv.id and b.workspace_id = v_conv.workspace_id) >= 5 then
    return null;
  end if;
  v_link := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.booking_links (workspace_id, conversation_id, lead_id, token)
  values (v_conv.workspace_id, v_conv.id, v_conv.lead_id, v_link);
  insert into public.activity_events (workspace_id, lead_id, kind, summary, channel, metadata)
  values (v_conv.workspace_id, v_conv.lead_id, 'booking_link_offered',
          'The website chat offered your booking link.', 'chat',
          jsonb_build_object('conversation_id', v_conv.id));
  return v_link;
end;
$$;
revoke all on function public.chat_booking_offer(text, uuid) from public, anon, authenticated;
grant execute on function public.chat_booking_offer(text, uuid) to service_role;

-- The link was opened. Returns the booking page to go on to, or null.
create function public.booking_open(p_link text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
begin
  if coalesce(p_link, '') !~ '^[0-9a-f]{64}$' then
    return null;
  end if;
  update public.booking_links b set opened_at = coalesce(b.opened_at, now())
  where b.token = p_link;
  select s.booking_url into v_url
  from public.booking_links b
  join public.workspace_sending s on s.workspace_id = b.workspace_id
  where b.token = p_link;
  return v_url;
end;
$$;
revoke all on function public.booking_open(text) from public, anon, authenticated;
grant execute on function public.booking_open(text) to service_role;

-- They booked: the booking page sent them back to /api/book/done with the
-- link remembered in their browser. p_starts and p_ends are the times the
-- booking page passed, if it did (else null: no meeting row is made, since
-- its time isn't known; the lead's status and timeline still say so).
--   { "status": "booked" | "already" | "invalid" }
create function public.booking_done(p_link text, p_starts timestamptz, p_ends timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b public.booking_links%rowtype;
  v_l public.leads%rowtype;
  v_meeting uuid;
  v_ends timestamptz;
begin
  if coalesce(p_link, '') !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status', 'invalid');
  end if;
  select b.* into v_b from public.booking_links b where b.token = p_link for update;
  if not found then
    return jsonb_build_object('status', 'invalid');
  end if;
  if v_b.booked_at is not null then
    return jsonb_build_object('status', 'already');
  end if;
  select l.* into v_l from public.leads l
  where l.id = v_b.lead_id and l.workspace_id = v_b.workspace_id for update;
  -- A time from the booking page, only when it is believable.
  if p_starts is not null and p_starts between now() - interval '1 day' and now() + interval '400 days' then
    v_ends := case when p_ends > p_starts and p_ends <= p_starts + interval '12 hours'
                   then p_ends else p_starts + interval '30 minutes' end;
    insert into public.meetings (workspace_id, lead_id, title, starts_at, ends_at, booked_by, host_id, channel)
    values (v_b.workspace_id, v_b.lead_id, 'Booked from the website chat', p_starts, v_ends, 'lead',
            v_l.owner_id, 'chat')
    returning id into v_meeting;
  end if;
  update public.booking_links b set booked_at = now(), meeting_id = v_meeting,
    opened_at = coalesce(b.opened_at, now())
  where b.id = v_b.id;
  if v_l.status in ('new', 'engaged', 'qualified') then
    update public.leads l set status = 'meeting_booked' where l.id = v_l.id;
    insert into public.activity_events (workspace_id, lead_id, kind, summary, channel, metadata)
    values (v_b.workspace_id, v_l.id, 'lead_status_changed',
            'Status changed to meeting booked: they booked through your booking link.', 'chat',
            jsonb_build_object('from', v_l.status, 'to', 'meeting_booked', 'conversation_id', v_b.conversation_id));
  end if;
  insert into public.activity_events (workspace_id, lead_id, kind, summary, channel, metadata)
  values (v_b.workspace_id, v_l.id, 'meeting_booked',
          case when v_meeting is null
            then 'Booked a meeting through your booking link, from the website chat. The time is in your calendar.'
            else 'Booked a meeting through your booking link, from the website chat, for '
                 || to_char(p_starts at time zone 'utc', 'FMDD Mon YYYY HH24:MI') || ' UTC.' end,
          'chat', jsonb_build_object('conversation_id', v_b.conversation_id, 'meeting_id', v_meeting));
  insert into public.team_alerts (workspace_id, conversation_id, lead_id, recipient_user_id, kind, summary)
  values (v_b.workspace_id, v_b.conversation_id, v_l.id, v_l.owner_id, 'meeting_booked',
          left(coalesce(nullif(v_l.name, ''), 'A visitor') || ' booked a meeting through your booking link from the website chat.', 1000));
  return jsonb_build_object('status', 'booked');
end;
$$;
revoke all on function public.booking_done(text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.booking_done(text, timestamptz, timestamptz) to service_role;
