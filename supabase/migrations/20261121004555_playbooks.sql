-- Playbooks: a play a workspace writes itself. Additive. Builds on the
-- campaigns, plays and sequences migrations.
--
--   playbooks            who to pick (filters over the workspace's own leads:
--                        stage, time since anything happened, where they came
--                        from, how recently they were added), what the first
--                        email is for (in the team's words), the sequence
--                        that follows it, its language and its approval mode.
--                        Members read; owners and admins save.
--   playbook_preview()   how many leads it would pick now.
--   playbook_start()     like play_start: an outbound campaign (kind
--                        'playbook') with the leads it picks, each with its
--                        "why now". Their emails are written by the usual
--                        "Write emails" step and go out through the usual
--                        engine, with every rule a built-in play has.
--   playbook_auto_approve() only for a playbook an owner or admin set to send
--                        on its own: approves its waiting drafts with the same
--                        checks as a person's approval.
--
-- Every playbook keeps the rules every built-in play keeps (see
-- private.play_candidates): never anyone without an email, do not contact,
-- unsubscribed or on the never-contact list; never someone with an email
-- waiting, scheduled or sending; never someone who answered "not
-- interested", "unsubscribe" or "wrong person". A customer (won) is only
-- picked if they agreed to email or have written to the team before.

create table public.playbooks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  -- { "statuses": ["new", ...], "inactive_days": n | null, "sources": [...],
  --   "added_within_days": n | null }. Empty or missing: any.
  filters jsonb not null default '{}'::jsonb check (jsonb_typeof(filters) = 'object'),
  -- What the first email is for, in the team's words. Read by the writer as
  -- the team's instructions, never above the rules.
  goal text not null check (char_length(btrim(goal)) between 1 and 1500),
  sequence_id uuid,
  language text not null default 'auto' check (language ~ '^(auto|[a-z]{2})$'),
  -- approve_first: every first email waits for a person. auto: approved as
  -- soon as it is written (an owner or admin chose this).
  approval_mode text not null default 'approve_first' check (approval_mode in ('approve_first', 'auto')),
  -- Nobody is picked by the same playbook twice within this many days.
  repeat_days integer not null default 90 check (repeat_days between 7 and 365),
  archived_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (sequence_id, workspace_id)
    references public.sequences (id, workspace_id) on delete set null (sequence_id)
);
alter table public.playbooks enable row level security;
create index playbooks_workspace_idx on public.playbooks (workspace_id, created_at);
create index playbooks_sequence_idx on public.playbooks (sequence_id, workspace_id) where sequence_id is not null;
create index playbooks_created_by_idx on public.playbooks (created_by);
create index playbooks_updated_by_idx on public.playbooks (updated_by);
create trigger playbooks_set_updated_at
  before update on public.playbooks
  for each row execute function private.set_updated_at();

revoke all on public.playbooks from anon, authenticated;
grant all on public.playbooks to service_role;
grant select on public.playbooks to authenticated;
create policy "Members read playbooks" on public.playbooks for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));

-- A playbook's run is a campaign; its drafts say so.
alter table public.outbound_campaigns drop constraint outbound_campaigns_kind_check;
alter table public.outbound_campaigns add constraint outbound_campaigns_kind_check check (kind in (
  'accounts', 'lookalike', 'signals', 'reactivation', 'closed_lost', 'plg', 'expansion',
  'nurture', 'onboarding', 'event', 'speed_to_lead', 'playbook'
));
alter table public.outbound_campaigns
  add column playbook_id uuid,
  add foreign key (playbook_id, workspace_id)
    references public.playbooks (id, workspace_id) on delete set null (playbook_id);
create index outbound_campaigns_playbook_idx on public.outbound_campaigns (playbook_id, workspace_id) where playbook_id is not null;

alter table public.outbound_drafts drop constraint outbound_drafts_play_check;
alter table public.outbound_drafts add constraint outbound_drafts_play_check check (play is null or play in (
  'accounts', 'lookalike', 'signal', 'reactivation', 'closed_lost', 'plg', 'expansion',
  'nurture', 'onboarding', 'event_registration', 'event_followup', 'event_no_show',
  'speed_to_lead', 'takeout', 'playbook'
));

-- Whether a playbook's filters are well formed. Internal; used by the save.
create function private.playbook_filters_ok(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p) = 'object'
    and (not p ? 'statuses' or (
      jsonb_typeof(p -> 'statuses') = 'array' and jsonb_array_length(p -> 'statuses') <= 6
      and not exists (select 1 from jsonb_array_elements_text(p -> 'statuses') s
                      where s not in ('new', 'engaged', 'qualified', 'meeting_booked', 'won', 'lost'))))
    and (not p ? 'sources' or (
      jsonb_typeof(p -> 'sources') = 'array' and jsonb_array_length(p -> 'sources') <= 10
      and not exists (select 1 from jsonb_array_elements(p -> 'sources') s
                      where jsonb_typeof(s) <> 'string' or char_length(s #>> '{}') not between 1 and 80)))
    and (not p ? 'inactive_days' or jsonb_typeof(p -> 'inactive_days') = 'null' or (
      jsonb_typeof(p -> 'inactive_days') = 'number' and (p ->> 'inactive_days')::numeric between 1 and 730))
    and (not p ? 'added_within_days' or jsonb_typeof(p -> 'added_within_days') = 'null' or (
      jsonb_typeof(p -> 'added_within_days') = 'number' and (p ->> 'added_within_days')::numeric between 1 and 730));
$$;
revoke all on function private.playbook_filters_ok(jsonb) from public;

-- Saves a playbook, for an owner or admin, signed in. p_id null makes a new
-- one (at most 20 per workspace). Returns its id.
create function public.playbook_save(
  p_workspace_id uuid, p_id uuid, p_name text, p_filters jsonb, p_goal text,
  p_sequence_id uuid, p_language text, p_approval text, p_repeat_days integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_id uuid;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if not (select private.is_workspace_admin(p_workspace_id)) then
    raise exception 'only an owner or admin can change this' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 80
     or char_length(btrim(coalesce(p_goal, ''))) not between 1 and 1500
     or not private.playbook_filters_ok(coalesce(p_filters, 'null'::jsonb))
     or coalesce(p_language, '') !~ '^(auto|[a-z]{2})$'
     or coalesce(p_approval, '') not in ('approve_first', 'auto')
     or coalesce(p_repeat_days, 0) not between 7 and 365 then
    raise exception 'those settings are out of range' using errcode = '22023';
  end if;
  if p_sequence_id is not null and not exists (
    select 1 from public.sequences s
    where s.id = p_sequence_id and s.workspace_id = p_workspace_id and s.archived_at is null) then
    raise exception 'sequence not found' using errcode = 'P0002';
  end if;
  if p_id is null then
    perform 1 from public.workspaces w where w.id = p_workspace_id for update;
    if (select count(*) from public.playbooks b
        where b.workspace_id = p_workspace_id and b.archived_at is null) >= 20 then
      raise exception 'too many playbooks' using errcode = 'P0001';
    end if;
    insert into public.playbooks (workspace_id, name, filters, goal, sequence_id, language,
                                  approval_mode, repeat_days, created_by, updated_by)
    values (p_workspace_id, btrim(p_name), p_filters, btrim(p_goal), p_sequence_id, p_language,
            p_approval, p_repeat_days, v_user, v_user)
    returning id into v_id;
  else
    update public.playbooks b
    set name = btrim(p_name), filters = p_filters, goal = btrim(p_goal), sequence_id = p_sequence_id,
        language = p_language, approval_mode = p_approval, repeat_days = p_repeat_days, updated_by = v_user
    where b.id = p_id and b.workspace_id = p_workspace_id and b.archived_at is null
    returning b.id into v_id;
    if v_id is null then
      raise exception 'playbook not found' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end;
$$;
revoke all on function public.playbook_save(uuid, uuid, text, jsonb, text, uuid, text, text, integer) from public, anon;
grant execute on function public.playbook_save(uuid, uuid, text, jsonb, text, uuid, text, text, integer) to authenticated;

create function public.playbook_archive(p_workspace_id uuid, p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if not (select private.is_workspace_admin(p_workspace_id)) then
    raise exception 'only an owner or admin can change this' using errcode = '42501';
  end if;
  update public.playbooks b set archived_at = now(), updated_by = (select auth.uid())
  where b.id = p_id and b.workspace_id = p_workspace_id and b.archived_at is null;
  if not found then
    raise exception 'playbook not found' using errcode = 'P0002';
  end if;
  -- Its running campaigns stop: nothing more is written for them.
  update public.outbound_campaigns c set status = 'stopped'
  where c.workspace_id = p_workspace_id and c.playbook_id = p_id and c.status = 'active';
end;
$$;
revoke all on function public.playbook_archive(uuid, uuid) from public, anon;
grant execute on function public.playbook_archive(uuid, uuid) to authenticated;

-- Which leads a playbook would write to now, and why. The same base rules as
-- private.play_candidates, then the playbook's own filters. Internal.
--   [{ "lead_id", "fact", "at" }], oldest activity first, at most p_limit.
create function private.playbook_candidates(p_workspace_id uuid, p_playbook_id uuid, p_limit integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with pb as (
    select b.* from public.playbooks b
    where b.id = p_playbook_id and b.workspace_id = p_workspace_id and b.archived_at is null
  ),
  base as (
    select l.*, private.lead_last_activity(l.workspace_id, l.id) as last_at
    from public.leads l, pb
    where l.workspace_id = p_workspace_id
      and l.email is not null
      and not l.do_not_contact
      and l.status <> 'unsubscribed'
      and not private.outbound_is_suppressed(l.workspace_id, l.email, private.site_domain(l.website))
      and not exists (
        select 1 from public.mail_threads t
        where t.workspace_id = l.workspace_id and (t.lead_id = l.id or t.to_email = l.email)
          and (t.reply_class in ('not_interested', 'unsubscribe', 'wrong_person')
               or t.status in ('unsubscribed', 'active')))
      and not exists (
        select 1 from public.outbound_emails e
        where e.workspace_id = l.workspace_id and e.to_email = l.email
          and e.status in ('queued', 'scheduled', 'sending', 'needs_check'))
      and not exists (
        select 1 from public.outbound_drafts d
        where d.workspace_id = l.workspace_id and d.to_email = l.email
          and (d.status in ('drafting', 'draft')
               or (d.status = 'approved' and not exists (
                     select 1 from public.outbound_emails e2 where e2.draft_id = d.id))))
      and not exists (
        select 1 from public.outbound_campaign_targets ct
        join public.outbound_campaigns c on c.id = ct.campaign_id and c.workspace_id = ct.workspace_id
        where ct.workspace_id = l.workspace_id and ct.lead_id = l.id and c.playbook_id = pb.id
          and ct.created_at > now() - make_interval(days => pb.repeat_days))
      -- Stage.
      and (coalesce(jsonb_array_length(pb.filters -> 'statuses'), 0) = 0
           or l.status in (select jsonb_array_elements_text(pb.filters -> 'statuses')))
      -- Where they came from (case doesn't matter).
      and (coalesce(jsonb_array_length(pb.filters -> 'sources'), 0) = 0
           or lower(l.source) in (select lower(s) from jsonb_array_elements_text(pb.filters -> 'sources') s))
      -- Added recently.
      and (jsonb_typeof(pb.filters -> 'added_within_days') is distinct from 'number'
           or l.created_at > now() - make_interval(days => (pb.filters ->> 'added_within_days')::integer))
      -- A customer only with their email consent or a conversation.
      and (l.status <> 'won' or l.consent_email or exists (
            select 1 from public.messages m
            join public.conversations c on c.id = m.conversation_id and c.workspace_id = m.workspace_id
            where c.lead_id = l.id and c.workspace_id = l.workspace_id and m.direction = 'in'))
  ),
  picked as (
    select b.id as lead_id, b.last_at as at,
           case when jsonb_typeof(pb.filters -> 'inactive_days') = 'number'
             then 'No activity since ' || to_char(b.last_at at time zone 'utc', 'FMDD Mon YYYY')
                  || ' (' || extract(day from now() - b.last_at)::int || ' days)'
             else 'Matches your playbook "' || pb.name || '" (' || b.status
                  || coalesce(', from ' || nullif(b.source, ''), '') || ')'
           end as fact
    from base b, pb
    where jsonb_typeof(pb.filters -> 'inactive_days') is distinct from 'number'
       or b.last_at < now() - make_interval(days => (pb.filters ->> 'inactive_days')::integer)
  )
  select coalesce(jsonb_agg(jsonb_build_object('lead_id', p.lead_id, 'fact', p.fact, 'at', p.at)
                            order by p.at, p.lead_id), '[]'::jsonb)
  from (select * from picked order by at, lead_id limit greatest(p_limit, 0)) p;
$$;
revoke all on function private.playbook_candidates(uuid, uuid, integer) from public;

-- How many leads a playbook would write to now. Server only, for a member.
create function public.playbook_preview(p_workspace_id uuid, p_user_id uuid, p_playbook_id uuid, p_limit integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_list jsonb;
begin
  if not exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace_id and m.user_id = p_user_id
  ) then
    return null;
  end if;
  v_list := private.playbook_candidates(p_workspace_id, p_playbook_id, p_limit);
  return jsonb_build_object('count', jsonb_array_length(v_list));
end;
$$;
revoke all on function public.playbook_preview(uuid, uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.playbook_preview(uuid, uuid, uuid, integer) to service_role;

-- Starts a playbook for a member: a campaign with the leads it picks now.
--   { "status": "created", "campaign_id", "selected" } | { "status": "empty" | "not_found" }
create function public.playbook_start(p_workspace_id uuid, p_user_id uuid, p_playbook_id uuid, p_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pb public.playbooks%rowtype;
  v_list jsonb;
  v_campaign uuid;
begin
  if not exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace_id and m.user_id = p_user_id
  ) then
    return jsonb_build_object('status', 'not_found');
  end if;
  perform 1 from public.workspaces w where w.id = p_workspace_id for update;
  select b.* into v_pb from public.playbooks b
  where b.id = p_playbook_id and b.workspace_id = p_workspace_id and b.archived_at is null;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  v_list := private.playbook_candidates(p_workspace_id, p_playbook_id, p_limit);
  if jsonb_array_length(v_list) = 0 then
    return jsonb_build_object('status', 'empty');
  end if;
  insert into public.outbound_campaigns (workspace_id, kind, name, settings, created_by,
                                         playbook_id, sequence_id, language)
  values (p_workspace_id, 'playbook',
          left(v_pb.name || ', ' || to_char(now() at time zone 'utc', 'FMDD Mon'), 120),
          jsonb_build_object('guidance', v_pb.goal, 'playbook_id', v_pb.id),
          p_user_id, v_pb.id, v_pb.sequence_id, v_pb.language)
  returning id into v_campaign;
  insert into public.outbound_campaign_targets (workspace_id, campaign_id, position, lead_id, status, why_now)
  select p_workspace_id, v_campaign, x.ord, (x.item ->> 'lead_id')::uuid, 'selected',
         jsonb_build_object('fact', x.item ->> 'fact', 'at', x.item ->> 'at', 'source', 'your leads')
  from jsonb_array_elements(v_list) with ordinality as x(item, ord);
  return jsonb_build_object('status', 'created', 'campaign_id', v_campaign,
                            'selected', jsonb_array_length(v_list));
end;
$$;
revoke all on function public.playbook_start(uuid, uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.playbook_start(uuid, uuid, uuid, integer) to service_role;

-- A playbook set to send on its own: approves its waiting drafts, refusing
-- what a person's approval refuses (never-contact list, do not contact).
-- Approved by whoever last saved the playbook (an owner or admin). Server
-- only. Returns how many.
create function public.playbook_auto_approve(p_workspace_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.outbound_drafts d
  set status = 'approved', decided_by = b.updated_by, decided_at = now()
  from public.outbound_campaigns c
  join public.playbooks b on b.id = c.playbook_id and b.workspace_id = c.workspace_id
  where d.workspace_id = p_workspace_id and d.status = 'draft' and d.play = 'playbook'
    and c.id = d.campaign_id and c.workspace_id = d.workspace_id and c.status = 'active'
    and b.approval_mode = 'auto' and b.archived_at is null and b.updated_by is not null
    -- Still an owner or admin of this workspace.
    and exists (select 1 from public.workspace_members m
                where m.workspace_id = b.workspace_id and m.user_id = b.updated_by
                  and m.role in ('owner', 'admin'))
    and not (select private.outbound_is_suppressed(d.workspace_id, d.to_email, null))
    and not exists (
      select 1 from public.leads l
      where l.workspace_id = d.workspace_id and l.do_not_contact
        and (l.id = d.lead_id or l.email = d.to_email));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.playbook_auto_approve(uuid) from public, anon, authenticated;
grant execute on function public.playbook_auto_approve(uuid) to service_role;
