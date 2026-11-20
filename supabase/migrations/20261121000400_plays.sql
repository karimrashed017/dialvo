-- The plays inside the app (/app/plays): the settings a play keeps, event
-- lists, speed to lead, competitive takeout's technology check and the
-- numbers on Analytics. Additive. Builds on 20261121000100_campaigns.sql.
--
--   play_settings            per workspace and play: on/off, send on its own
--                            or wait for approval (approval is the default),
--                            and the play's few numbers. Members read it;
--                            owners and admins change it (play_settings_save).
--   event_import()           a CSV of registrants or attendees becomes an
--                            'event' campaign: each person is (or becomes) a
--                            lead and gets one draft tailored to whether they
--                            registered, attended or didn't show.
--   speed_to_lead_sweep()    new form and chat leads with an email, since the
--                            play was switched on, get a first reply drafted.
--   play_auto_approve()      only for speed to lead, only when its owner
--                            chose "send without waiting": approves its
--                            waiting drafts with the same checks as a person.
--   mail_threads trigger     the plays written to customers or as a single
--                            touch (onboarding, expansion, events, nurture)
--                            never get the cold follow-ups.
--   outbound_draft_decide    a play's draft (no prospect) is refused for a
--                            do-not-contact lead by its own lead id too.
--   prospect_searches        + play / competitor, for competitive takeout.
--   prospect_add_fact()      the technology check's result, as a sourced
--                            fact on the prospect, under the credit cap.
--   analytics_summary()      the Analytics page's numbers, as the signed-in
--                            person (row-level security applies).

-- ---------------------------------------------------------------------------
-- play_settings
-- ---------------------------------------------------------------------------
create table public.play_settings (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  play text not null check (play in ('speed_to_lead')),
  enabled boolean not null default false,
  -- When it was last switched on: only leads that arrive after this count.
  enabled_at timestamptz,
  -- false: every draft waits for a person (the default). true: drafts are
  -- approved by the play as soon as they are written.
  auto_send boolean not null default false,
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, play)
);
alter table public.play_settings enable row level security;
create index play_settings_updated_by_idx on public.play_settings (updated_by);
create trigger play_settings_set_updated_at
  before update on public.play_settings
  for each row execute function private.set_updated_at();

revoke all on public.play_settings from anon, authenticated;
grant all on public.play_settings to service_role;
grant select on public.play_settings to authenticated;
create policy "Members read play settings" on public.play_settings for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));

-- Saves a play's settings, for an owner or admin, signed in.
create function public.play_settings_save(
  p_workspace_id uuid, p_play text, p_enabled boolean, p_auto_send boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if not (select private.is_workspace_admin(p_workspace_id)) then
    raise exception 'only an owner or admin can change this' using errcode = '42501';
  end if;
  if p_play not in ('speed_to_lead') then
    raise exception 'unknown play' using errcode = '22023';
  end if;
  insert into public.play_settings as s (workspace_id, play, enabled, enabled_at, auto_send, updated_by)
  values (p_workspace_id, p_play, coalesce(p_enabled, false),
          case when coalesce(p_enabled, false) then now() end, coalesce(p_auto_send, false), v_user)
  on conflict (workspace_id, play) do update
  set enabled = excluded.enabled,
      enabled_at = case when excluded.enabled and not s.enabled then now() else s.enabled_at end,
      auto_send = excluded.auto_send,
      updated_by = v_user;
end;
$$;
revoke all on function public.play_settings_save(uuid, text, boolean, boolean) from public, anon;
grant execute on function public.play_settings_save(uuid, text, boolean, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Event lists
-- ---------------------------------------------------------------------------

-- A list of registrants or attendees, already read and checked by the
-- server: [{ "name", "email", "company", "attended": true | false | null }],
-- at most p_max rows. p_audience picks who is written to:
--   registered  everyone on the list        -> 'event_registration'
--   attended    those who attended          -> 'event_followup'
--   no_show     those who didn't attend     -> 'event_no_show'
-- Each person is matched to a lead by email, or becomes one (source
-- "event: <name>"). Nobody is added who is marked do not contact,
-- unsubscribed or on the never-contact list.
--   { "status": "created", "campaign_id", "selected", "new_leads", "skipped" }
--   { "status": "empty" | "invalid" | "not_found" }
create function public.event_import(
  p_workspace_id uuid, p_user_id uuid, p_event text, p_link text, p_date text,
  p_audience text, p_rows jsonb, p_max integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event text := left(btrim(regexp_replace(coalesce(p_event, ''), '[\u0000-\u001f\u007f<>]', ' ', 'g')), 120);
  v_link text := btrim(coalesce(p_link, ''));
  v_date text := left(btrim(coalesce(p_date, '')), 40);
  v_play text;
  v_campaign uuid;
  v_selected integer := 0;
  v_new integer := 0;
  v_skipped integer := 0;
  r record;
  v_email text;
  v_lead public.leads%rowtype;
  v_fact text;
begin
  if not exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace_id and m.user_id = p_user_id
  ) then
    return jsonb_build_object('status', 'not_found');
  end if;
  v_play := case p_audience
    when 'registered' then 'event_registration'
    when 'attended' then 'event_followup'
    when 'no_show' then 'event_no_show' end;
  if v_play is null or v_event = ''
    or (v_link <> '' and (v_link !~ '^https://[^\s<>"]+$' or char_length(v_link) > 500))
    or jsonb_typeof(coalesce(p_rows, 'null'::jsonb)) <> 'array'
    or jsonb_array_length(p_rows) > greatest(p_max, 0) then
    return jsonb_build_object('status', 'invalid');
  end if;
  perform 1 from public.workspaces w where w.id = p_workspace_id for update;

  insert into public.outbound_campaigns (workspace_id, kind, name, settings, created_by)
  values (p_workspace_id, 'event', left(v_event || ' (' || replace(p_audience, '_', '-') || ')', 120),
          jsonb_build_object('event', v_event, 'link', v_link, 'date', v_date, 'audience', p_audience),
          p_user_id)
  returning id into v_campaign;

  for r in
    select x.item ->> 'name' as name, x.item ->> 'email' as email, x.item ->> 'company' as company,
           case when jsonb_typeof(x.item -> 'attended') = 'boolean' then (x.item ->> 'attended')::boolean end as attended,
           x.ord
    from jsonb_array_elements(p_rows) with ordinality as x(item, ord)
  loop
    v_email := lower(btrim(coalesce(r.email, '')));
    if v_email !~ '^[^\s@<>]+@[a-z0-9-]+(\.[a-z0-9-]+)+$' or char_length(v_email) > 254 then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    -- Who this audience is.
    if (p_audience = 'attended' and r.attended is not true)
       or (p_audience = 'no_show' and r.attended is not false) then
      continue;
    end if;
    if private.outbound_is_suppressed(p_workspace_id, v_email, split_part(v_email, '@', 2)) then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    select l.* into v_lead from public.leads l
    where l.workspace_id = p_workspace_id and l.email = v_email;
    if not found then
      insert into public.leads (workspace_id, name, email, company, source)
      values (
        p_workspace_id,
        left(btrim(regexp_replace(coalesce(r.name, ''), '[\u0000-\u001f\u007f<>]', ' ', 'g')), 200),
        v_email,
        nullif(left(btrim(regexp_replace(coalesce(r.company, ''), '[\u0000-\u001f\u007f<>]', ' ', 'g')), 200), ''),
        left('event: ' || v_event, 80)
      )
      returning * into v_lead;
      v_new := v_new + 1;
    end if;
    if v_lead.do_not_contact or v_lead.status = 'unsubscribed' then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    v_fact := case v_play
      when 'event_registration' then 'Registered for ' || v_event
      when 'event_followup' then 'Attended ' || v_event
      else 'Registered for ' || v_event || ' but didn''t attend' end
      || case when v_date <> '' then ' (' || v_date || ')' else '' end;
    insert into public.outbound_campaign_targets (workspace_id, campaign_id, position, lead_id, status, why_now)
    values (p_workspace_id, v_campaign, r.ord, v_lead.id, 'selected',
            jsonb_build_object('fact', v_fact, 'source', 'your event list', 'play', v_play, 'at', now()))
    on conflict (campaign_id, lead_id) where lead_id is not null do nothing;
    if found then
      v_selected := v_selected + 1;
    end if;
  end loop;

  if v_selected = 0 then
    -- Nothing to write: no empty campaign is left behind. (Leads made from
    -- the list stay: they are the team's own list.)
    delete from public.outbound_campaigns c where c.id = v_campaign;
    return jsonb_build_object('status', 'empty', 'new_leads', v_new, 'skipped', v_skipped);
  end if;
  return jsonb_build_object('status', 'created', 'campaign_id', v_campaign,
                            'selected', v_selected, 'new_leads', v_new, 'skipped', v_skipped);
end;
$$;
revoke all on function public.event_import(uuid, uuid, text, text, text, text, jsonb, integer) from public, anon, authenticated;
grant execute on function public.event_import(uuid, uuid, text, text, text, text, jsonb, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Speed to lead
-- ---------------------------------------------------------------------------

-- The workspaces with speed to lead on, and who switched it on (the first
-- emails are signed as them).
create function public.speed_to_lead_worklist()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('workspace_id', s.workspace_id, 'user_id', s.updated_by)), '[]'::jsonb)
  from public.play_settings s
  where s.play = 'speed_to_lead' and s.enabled and s.updated_by is not null
    and exists (select 1 from public.workspace_members m
                where m.workspace_id = s.workspace_id and m.user_id = s.updated_by);
$$;

-- Adds the workspace's new form and chat leads with an email (arrived in the
-- last 48 hours and since the play was switched on) to its speed-to-lead
-- campaign, at most p_max at a time. Never someone already emailed, marked
-- do not contact, unsubscribed, lost, won, or on the never-contact list.
-- Returns how many were added.
create function public.speed_to_lead_sweep(p_workspace_id uuid, p_max integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_set public.play_settings%rowtype;
  v_campaign uuid;
  v_added integer;
begin
  select s.* into v_set from public.play_settings s
  where s.workspace_id = p_workspace_id and s.play = 'speed_to_lead' and s.enabled;
  if not found then
    return 0;
  end if;
  perform 1 from public.workspaces w where w.id = p_workspace_id for update;
  select c.id into v_campaign from public.outbound_campaigns c
  where c.workspace_id = p_workspace_id and c.kind = 'speed_to_lead' and c.status = 'active'
  order by c.created_at limit 1;
  if v_campaign is null then
    insert into public.outbound_campaigns (workspace_id, kind, name, created_by)
    values (p_workspace_id, 'speed_to_lead', 'Speed to lead', v_set.updated_by)
    returning id into v_campaign;
  end if;
  with picked as (
    select l.id, l.source, l.created_at
    from public.leads l
    where l.workspace_id = p_workspace_id
      and l.email is not null
      and (l.source like 'form:%' or l.source like 'chat:%')
      and l.created_at > greatest(now() - interval '48 hours', coalesce(v_set.enabled_at, now()))
      and not l.do_not_contact
      and l.status not in ('unsubscribed', 'lost', 'won')
      and not private.outbound_is_suppressed(l.workspace_id, l.email, private.site_domain(l.website))
      and not exists (select 1 from public.outbound_emails e
                      where e.workspace_id = l.workspace_id and e.to_email = l.email)
      and not exists (select 1 from public.mail_threads t
                      where t.workspace_id = l.workspace_id and t.to_email = l.email)
      and not exists (select 1 from public.outbound_campaign_targets ct
                      join public.outbound_campaigns c on c.id = ct.campaign_id and c.workspace_id = ct.workspace_id
                      where ct.workspace_id = l.workspace_id and ct.lead_id = l.id and c.kind = 'speed_to_lead')
    order by l.created_at
    limit greatest(p_max, 0)
  )
  insert into public.outbound_campaign_targets (workspace_id, campaign_id, position, lead_id, status, why_now)
  select p_workspace_id, v_campaign, 0, p.id, 'selected',
         jsonb_build_object(
           'fact', case when p.source like 'form:%'
             then 'Filled in your form "' || btrim(substr(p.source, 6)) || '" on '
             else 'Left their email in your website chat on ' end
             || to_char(p.created_at at time zone 'utc', 'FMDD Mon YYYY'),
           'source', 'your website', 'play', 'speed_to_lead', 'at', p.created_at)
  from picked p
  on conflict (campaign_id, lead_id) where lead_id is not null do nothing;
  get diagnostics v_added = row_count;
  return v_added;
end;
$$;

-- Speed to lead set to "send without waiting": approves its waiting drafts,
-- refusing exactly what a person's approval refuses (never-contact list, do
-- not contact). Approved by the person who switched it on. Returns how many.
create function public.play_auto_approve(p_workspace_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_set public.play_settings%rowtype;
  v_count integer;
begin
  select s.* into v_set from public.play_settings s
  where s.workspace_id = p_workspace_id and s.play = 'speed_to_lead' and s.enabled and s.auto_send;
  if not found then
    return 0;
  end if;
  update public.outbound_drafts d
  set status = 'approved', decided_by = v_set.updated_by, decided_at = now()
  where d.workspace_id = p_workspace_id and d.status = 'draft' and d.play = 'speed_to_lead'
    and d.created_at >= coalesce(v_set.enabled_at, now())
    and not (select private.outbound_is_suppressed(d.workspace_id, d.to_email, null))
    and not exists (
      select 1 from public.leads l
      where l.workspace_id = d.workspace_id and l.do_not_contact
        and (l.id = d.lead_id or l.email = d.to_email));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.speed_to_lead_worklist() from public, anon, authenticated;
revoke all on function public.speed_to_lead_sweep(uuid, integer) from public, anon, authenticated;
revoke all on function public.play_auto_approve(uuid) from public, anon, authenticated;
grant execute on function public.speed_to_lead_worklist() to service_role;
grant execute on function public.speed_to_lead_sweep(uuid, integer) to service_role;
grant execute on function public.play_auto_approve(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- No cold follow-ups after a single-touch play
-- ---------------------------------------------------------------------------

-- A thread starts when a first email is sent (private.mail_mark_sent). If
-- that email came from a play written to a customer or as a single touch,
-- the thread starts finished: replies still land, no follow-up is written.
create function private.mail_thread_play_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.outbound_emails e
    join public.outbound_drafts d on d.id = e.draft_id and d.workspace_id = e.workspace_id
    where e.workspace_id = new.workspace_id and e.lead_id = new.lead_id and e.to_email = new.to_email
      and e.kind = 'first' and e.status = 'sent' and e.thread_id is null
      and d.play in ('onboarding', 'expansion', 'nurture', 'event_registration', 'event_followup', 'event_no_show')
  ) then
    new.status := 'finished';
    new.stop_reason := 'single_touch_play';
    new.next_followup_at := null;
  end if;
  return new;
end;
$$;
revoke all on function private.mail_thread_play_rules() from public;
create trigger mail_threads_play_rules
  before insert on public.mail_threads
  for each row execute function private.mail_thread_play_rules();

-- ---------------------------------------------------------------------------
-- Competitive takeout
-- ---------------------------------------------------------------------------
alter table public.prospect_searches
  add column play text check (play is null or play in ('takeout')),
  add column competitor text check (competitor is null or char_length(competitor) between 1 and 80);

-- Reserves (p_credits > 0) or gives back (< 0) Findymail credits from the
-- workspace's daily cap, for a lookup a person started (the technology
-- check). True when reserved.
create function public.contact_credits_reserve(p_workspace_id uuid, p_credits integer, p_max_per_day integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(p_credits, 0) < 0 then
    perform private.contact_credits_give_back(p_workspace_id, -p_credits);
    return true;
  end if;
  return private.contact_credits_take(p_workspace_id, p_credits, p_max_per_day);
end;
$$;

-- Adds one sourced fact to a prospect (the technology check: "Uses X,
-- detected on ..."), once. p_fact: { "fact", "quote", "source_url", "kind" }.
create function public.prospect_add_fact(p_workspace_id uuid, p_prospect_id uuid, p_fact jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fact text := left(btrim(coalesce(p_fact ->> 'fact', '')), 300);
begin
  if v_fact = '' then
    return false;
  end if;
  update public.prospects p
  set facts = coalesce(p.facts, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
    'fact', v_fact,
    'quote', left(coalesce(p_fact ->> 'quote', v_fact), 300),
    'source_url', left(coalesce(p_fact ->> 'source_url', ''), 300),
    'kind', left(coalesce(p_fact ->> 'kind', 'technology'), 20)))
  where p.id = p_prospect_id and p.workspace_id = p_workspace_id
    and not exists (select 1 from jsonb_array_elements(coalesce(p.facts, '[]'::jsonb)) f
                    where f ->> 'fact' = v_fact);
  return found;
end;
$$;
revoke all on function public.contact_credits_reserve(uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.prospect_add_fact(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.contact_credits_reserve(uuid, integer, integer) to service_role;
grant execute on function public.prospect_add_fact(uuid, uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- outbound_draft_decide: the same, with the play's own lead in the check
-- ---------------------------------------------------------------------------
-- Approve, edit or discard a first email.
--   'approve': a waiting draft becomes ready to send, with the edits if any.
--   'save':    keep the edits, don't change whether it is approved.
--   'discard': a waiting or approved draft is dropped.
--   'reopen':  an approved draft goes back to waiting.
-- Approving is refused when the address is on the suppression list or the
-- lead is marked do not contact.
create or replace function public.outbound_draft_decide(
  p_draft_id uuid, p_action text, p_subject text default null, p_body text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_d public.outbound_drafts%rowtype;
  v_p public.prospects%rowtype;
  v_subject text;
  v_body text;
  v_edited boolean;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  select d.* into v_d from public.outbound_drafts d
  where d.id = p_draft_id and d.status in ('draft', 'approved')
    and (select private.is_workspace_member(d.workspace_id))
  for update;
  if not found then
    raise exception 'draft not found' using errcode = 'P0002';
  end if;
  select p.* into v_p from public.prospects p
  where p.id = v_d.prospect_id and p.workspace_id = v_d.workspace_id;

  if p_action = 'discard' then
    update public.outbound_drafts d
    set status = 'discarded', discard_reason = 'by_person', decided_by = v_user, decided_at = now()
    where d.id = v_d.id;
    return 'discarded';
  end if;
  if p_action = 'reopen' then
    update public.outbound_drafts d
    set status = 'draft', decided_by = null, decided_at = null
    where d.id = v_d.id and d.status = 'approved';
    return 'draft';
  end if;
  if p_action not in ('approve', 'save') then
    raise exception 'unknown action' using errcode = '22023';
  end if;

  -- One line for the subject; plain text for the body.
  v_subject := coalesce(
    nullif(btrim(regexp_replace(coalesce(p_subject, ''), '\s+', ' ', 'g')), ''), v_d.subject);
  v_body := coalesce(nullif(btrim(coalesce(p_body, '')), ''), v_d.body);
  if char_length(v_subject) > 200 or char_length(v_body) > 5000 then
    raise exception 'the subject or the email is too long' using errcode = '22023';
  end if;
  v_edited := v_d.edited or v_subject is distinct from v_d.subject or v_body is distinct from v_d.body;

  if p_action = 'approve' then
    if private.outbound_is_suppressed(v_d.workspace_id, v_d.to_email, v_p.domain) then
      raise exception 'that address is on the suppression list' using errcode = 'P0001';
    end if;
    if exists (
      select 1 from public.leads l
      where l.workspace_id = v_d.workspace_id and l.do_not_contact
        and (l.id = v_p.lead_id or l.id = v_d.lead_id or l.email = v_d.to_email)
    ) then
      raise exception 'that lead is marked do not contact' using errcode = 'P0001';
    end if;
  end if;

  update public.outbound_drafts d
  set subject = v_subject, body = v_body, edited = v_edited,
      status = case when p_action = 'approve' then 'approved' else d.status end,
      decided_by = case when p_action = 'approve' then v_user else d.decided_by end,
      decided_at = case when p_action = 'approve' then now() else d.decided_at end
  where d.id = v_d.id;
  return case when p_action = 'approve' then 'approved' else v_d.status end;
end;
$$;

-- ---------------------------------------------------------------------------
-- The numbers: Analytics and each play's counts
-- ---------------------------------------------------------------------------
-- Both run as the signed-in person (security invoker): row-level security
-- decides what they can count, and each also checks membership itself.

-- The Analytics page over the last p_days days (1 to 365). Only what the
-- database holds; nothing estimated.
create function public.analytics_summary(p_workspace_id uuid, p_days integer)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_since timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 365));
begin
  if not (select private.is_workspace_member(p_workspace_id)) then
    return null;
  end if;
  return jsonb_build_object(
    'since', v_since,
    'totals', jsonb_build_object(
      'leads_found', (select count(*) from public.prospects p
        where p.workspace_id = p_workspace_id and p.research_status = 'found' and p.created_at >= v_since),
      'emails_sent', (select count(*) from public.outbound_emails e
        where e.workspace_id = p_workspace_id and e.status = 'sent' and e.sent_at >= v_since),
      'first_emails_sent', (select count(*) from public.outbound_emails e
        where e.workspace_id = p_workspace_id and e.status = 'sent' and e.kind = 'first' and e.sent_at >= v_since),
      'replies', (select count(*) from public.mail_received r
        where r.workspace_id = p_workspace_id and r.kind = 'reply' and r.received_at >= v_since),
      'positive_replies', (select count(*) from public.mail_received r
        where r.workspace_id = p_workspace_id and r.kind = 'reply' and r.received_at >= v_since
          and r.classification in ('interested', 'question')),
      'meetings_booked', (select count(*) from public.meetings m
        where m.workspace_id = p_workspace_id and m.created_at >= v_since and m.status <> 'cancelled'),
      'chats', (select count(*) from public.conversations c
        where c.workspace_id = p_workspace_id and c.widget_id is not null and c.created_at >= v_since),
      'chats_answered', (select count(*) from public.conversations c
        where c.workspace_id = p_workspace_id and c.widget_id is not null and c.created_at >= v_since
          and exists (select 1 from public.messages m
                      where m.conversation_id = c.id and m.workspace_id = c.workspace_id and m.direction = 'out')),
      'qualified_leads', (select count(distinct a.lead_id) from public.activity_events a
        where a.workspace_id = p_workspace_id and a.created_at >= v_since
          and a.kind = 'lead_status_changed' and a.metadata ->> 'to' in ('qualified', 'meeting_booked', 'won'))
    ),
    -- One row per day: first emails and follow-ups sent, replies received.
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object('day', d.day, 'sent', d.sent, 'replies', d.replies) order by d.day)
      from (
        select g.day::date as day,
          (select count(*) from public.outbound_emails e
           where e.workspace_id = p_workspace_id and e.status = 'sent'
             and e.sent_at >= g.day and e.sent_at < g.day + interval '1 day') as sent,
          (select count(*) from public.mail_received r
           where r.workspace_id = p_workspace_id and r.kind = 'reply'
             and r.received_at >= g.day and r.received_at < g.day + interval '1 day') as replies
        from generate_series(date_trunc('day', v_since), date_trunc('day', now()), interval '1 day') g(day)
      ) d
    ), '[]'::jsonb),
    -- Where the first emails came from: a play, or a saved search.
    'by_source', coalesce((
      select jsonb_agg(x order by x ->> 'sent' desc)
      from (
        select jsonb_build_object(
          'play', s.play, 'search_id', s.search_id,
          'search_name', (select ps.name from public.prospect_searches ps where ps.id = s.search_id),
          'sent', count(*),
          'replied', count(*) filter (where s.replied),
          'positive', count(*) filter (where s.positive),
          'meetings', count(*) filter (where s.meeting)
        ) as x
        from (
          select d.play, p.search_id,
            t.last_reply_at is not null as replied,
            exists (select 1 from public.mail_received r
                    where r.thread_id = t.id and r.workspace_id = t.workspace_id and r.kind = 'reply'
                      and r.classification in ('interested', 'question')) as positive,
            exists (select 1 from public.meetings m
                    where m.lead_id = e.lead_id and m.workspace_id = e.workspace_id
                      and m.created_at >= e.sent_at and m.status <> 'cancelled') as meeting
          from public.outbound_emails e
          left join public.outbound_drafts d on d.id = e.draft_id and d.workspace_id = e.workspace_id
          left join public.prospects p on p.id = e.prospect_id and p.workspace_id = e.workspace_id
          left join public.mail_threads t on t.id = e.thread_id and t.workspace_id = e.workspace_id
          where e.workspace_id = p_workspace_id and e.kind = 'first' and e.status = 'sent' and e.sent_at >= v_since
        ) s
        group by s.play, s.search_id
      ) y
    ), '[]'::jsonb),
    -- Each mailbox: what it sent, and its bounces and unsubscribes.
    'by_mailbox', coalesce((
      select jsonb_agg(jsonb_build_object(
        'mailbox_id', m.id, 'email', m.email, 'status', m.status,
        'sent', (select count(*) from public.outbound_emails e
                 where e.mailbox_id = m.id and e.workspace_id = m.workspace_id
                   and e.status = 'sent' and e.sent_at >= v_since),
        'replies', (select count(*) from public.mail_received r
                    where r.mailbox_id = m.id and r.workspace_id = m.workspace_id
                      and r.kind = 'reply' and r.received_at >= v_since),
        'bounces', (select count(*) from public.mail_received r
                    where r.mailbox_id = m.id and r.workspace_id = m.workspace_id
                      and r.kind = 'bounce' and r.received_at >= v_since),
        'unsubscribes', (select count(*) from public.mail_threads t
                         where t.mailbox_id = m.id and t.workspace_id = m.workspace_id
                           and t.status = 'unsubscribed' and t.updated_at >= v_since)
      ) order by m.created_at)
      from public.mailboxes m
      where m.workspace_id = p_workspace_id
    ), '[]'::jsonb)
  );
end;
$$;

-- Each play's counts since it started: people targeted, drafted, approved,
-- sent, replied and meetings booked after the email.
create function public.play_counts(p_workspace_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not (select private.is_workspace_member(p_workspace_id)) then
    return null;
  end if;
  return coalesce((
    select jsonb_object_agg(k.play, k.counts)
    from (
      select x.play, jsonb_build_object(
        'targeted', (select count(*) from public.outbound_campaign_targets ct
                     join public.outbound_campaigns c on c.id = ct.campaign_id and c.workspace_id = ct.workspace_id
                     where ct.workspace_id = p_workspace_id
                       and coalesce(nullif(ct.why_now ->> 'play', ''),
                                    case c.kind when 'accounts' then 'accounts' when 'lookalike' then 'lookalike'
                                                when 'signals' then 'signal' else c.kind end) = x.play),
        'drafted', count(d.id) filter (where d.status in ('draft', 'approved')),
        'waiting', count(d.id) filter (where d.status = 'draft'),
        'approved', count(d.id) filter (where d.status = 'approved'),
        'sent', count(e.id) filter (where e.status = 'sent'),
        'replied', count(e.id) filter (where e.status = 'sent' and t.last_reply_at is not null),
        'meetings', count(e.id) filter (where e.status = 'sent' and exists (
          select 1 from public.meetings m
          where m.lead_id = e.lead_id and m.workspace_id = e.workspace_id
            and m.created_at >= e.sent_at and m.status <> 'cancelled'))
      ) as counts
      from (
        select distinct d0.play from public.outbound_drafts d0
        where d0.workspace_id = p_workspace_id and d0.play is not null
        union
        select distinct coalesce(nullif(ct.why_now ->> 'play', ''),
                                 case c.kind when 'signals' then 'signal' else c.kind end)
        from public.outbound_campaign_targets ct
        join public.outbound_campaigns c on c.id = ct.campaign_id and c.workspace_id = ct.workspace_id
        where ct.workspace_id = p_workspace_id
      ) x
      left join public.outbound_drafts d on d.workspace_id = p_workspace_id and d.play = x.play
      left join public.outbound_emails e on e.draft_id = d.id and e.workspace_id = d.workspace_id and e.kind = 'first'
      left join public.mail_threads t on t.id = e.thread_id and t.workspace_id = e.workspace_id
      where x.play is not null
      group by x.play
    ) k
  ), '{}'::jsonb);
end;
$$;
revoke all on function public.analytics_summary(uuid, integer) from public, anon;
revoke all on function public.play_counts(uuid) from public, anon;
grant execute on function public.analytics_summary(uuid, integer) to authenticated, service_role;
grant execute on function public.play_counts(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- A first email to a prospect remembers which play found them
-- ---------------------------------------------------------------------------
-- Target accounts, lookalike, buying signals (the prospect's play) and
-- competitive takeout (its search's play), so each play's counts and the
-- writer's instructions can tell them apart.
create function private.outbound_draft_play()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.play is null and new.prospect_id is not null then
    select coalesce(p.play, s.play) into new.play
    from public.prospects p
    left join public.prospect_searches s on s.id = p.search_id and s.workspace_id = p.workspace_id
    where p.id = new.prospect_id and p.workspace_id = new.workspace_id;
  end if;
  return new;
end;
$$;
revoke all on function private.outbound_draft_play() from public;
create trigger outbound_drafts_play
  before insert on public.outbound_drafts
  for each row execute function private.outbound_draft_play();

-- ---------------------------------------------------------------------------
-- A target-account or lookalike run that can't look up more companies today
-- ---------------------------------------------------------------------------
-- (the day's credit cap, or Findymail refused): what it found so far still
-- has its sites read, and the rest of the list waits for the next run. A run
-- that found nothing stops with the reason. Returns the run's new status.
create function public.campaign_run_wrap(p_run_id uuid, p_workspace_id uuid, p_reason text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  -- Companies handed out but not looked up go back to the list.
  update public.outbound_campaign_targets t set status = 'pending'
  from public.prospect_runs r
  where r.id = p_run_id and r.workspace_id = p_workspace_id
    and t.campaign_id = r.campaign_id and t.workspace_id = r.workspace_id and t.status = 'working';
  update public.prospect_runs r
  set status = case when exists (select 1 from public.prospects p
                                 where p.run_id = r.id and p.workspace_id = r.workspace_id)
                    then 'researching' else 'stopped' end,
      stop_reason = left(p_reason, 60),
      finished_at = case when exists (select 1 from public.prospects p
                                      where p.run_id = r.id and p.workspace_id = r.workspace_id)
                         then null else now() end,
      locked_until = null
  where r.id = p_run_id and r.workspace_id = p_workspace_id
    and r.campaign_id is not null and r.status = 'searching'
  returning r.status into v_status;
  return v_status;
end;
$$;
revoke all on function public.campaign_run_wrap(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.campaign_run_wrap(uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- Sequences: how many follow-ups (none, one or two)
-- ---------------------------------------------------------------------------
-- The sending engine writes at most two follow-ups (20261120164719). This
-- lets a workspace stop after one: once a thread has sent as many as the
-- workspace wants, it is finished. (None is followups_enabled = false.)
alter table public.workspace_sending
  add column followup_count integer not null default 2 check (followup_count between 0 and 2);

create function private.mail_thread_followup_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'active' and new.followups_sent > old.followups_sent
     and new.followups_sent >= coalesce((
       select s.followup_count from public.workspace_sending s where s.workspace_id = new.workspace_id), 2) then
    new.status := 'finished';
    new.next_followup_at := null;
  end if;
  return new;
end;
$$;
revoke all on function private.mail_thread_followup_count() from public;
create trigger mail_threads_followup_count
  before update on public.mail_threads
  for each row execute function private.mail_thread_followup_count();

-- Saves the sequence settings, for an owner or admin, signed in: the number
-- of follow-ups, the days after the first email each goes, and whether they
-- wait for approval (the outbound agent's approval mode, which is also what
-- the follow-ups already obey).
create function public.sequence_settings_save(
  p_workspace_id uuid, p_count integer, p_first_days integer, p_second_days integer, p_approval text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if not (select private.is_workspace_admin(p_workspace_id)) then
    raise exception 'only an owner or admin can change this' using errcode = '42501';
  end if;
  if p_count not between 0 and 2 or p_first_days not between 1 and 30
     or p_second_days not between 2 and 60 or p_second_days <= p_first_days
     or p_approval not in ('approve_first', 'auto') then
    raise exception 'those settings are out of range' using errcode = '22023';
  end if;
  insert into public.workspace_sending (workspace_id) values (p_workspace_id)
  on conflict (workspace_id) do nothing;
  update public.workspace_sending s
  set followups_enabled = p_count > 0, followup_count = p_count,
      followup_1_days = p_first_days, followup_2_days = p_second_days, updated_by = v_user
  where s.workspace_id = p_workspace_id;
  update public.agents a set approval_mode = p_approval
  where a.workspace_id = p_workspace_id and a.role = 'outbound';
end;
$$;
revoke all on function public.sequence_settings_save(uuid, integer, integer, integer, text) from public, anon;
grant execute on function public.sequence_settings_save(uuid, integer, integer, integer, text) to authenticated;
