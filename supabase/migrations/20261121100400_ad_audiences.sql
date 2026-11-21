-- Ad audiences: lists of a workspace's own leads or companies, exported as
-- the upload files ad platforms take (LinkedIn contact and company lists,
-- Meta customer lists, Google Ads Customer Match), and suppression lists
-- (customers, do not contact) to exclude in those platforms. Nothing is
-- sent to any ad platform: direct sync needs each platform's partner
-- approval, which Dialvo doesn't have.
--
--   ad_audiences         a saved audience: contacts or companies, picked by
--                        stage, source, country, owner, play and how
--                        recently added; or a suppression list.
--   ad_audience_exports  each download: who, when, which format, how many
--                        rows. A record of where the workspace's data went.
--
-- Leads marked do not contact or unsubscribed, and addresses or companies
-- on the never-contact list, are never in a contact or company audience;
-- customers (won) are left out unless the audience says otherwise.

create table public.ad_audiences (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  kind text not null check (kind in ('contacts', 'companies', 'suppression')),
  -- { "statuses": [...], "sources": [...], "countries": [...], "owner_id",
  --   "campaign_id", "added_within_days", "include_customers",
  --   "preset": "customers" | "do_not_contact" (suppression only) }
  filters jsonb not null default '{}'::jsonb
    check (jsonb_typeof(filters) = 'object' and octet_length(filters::text) <= 4000),
  last_exported_at timestamptz,
  last_export_rows integer,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id)
);
alter table public.ad_audiences enable row level security;
create index ad_audiences_workspace_idx on public.ad_audiences (workspace_id, created_at desc);
create index ad_audiences_created_by_idx on public.ad_audiences (created_by);
create trigger ad_audiences_set_updated_at
  before update on public.ad_audiences
  for each row execute function private.set_updated_at();

create table public.ad_audience_exports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  audience_id uuid not null,
  format text not null check (format in ('linkedin_contacts', 'linkedin_companies', 'meta', 'google', 'plain')),
  hashed boolean not null,
  rows integer not null check (rows >= 0),
  exported_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (audience_id, workspace_id)
    references public.ad_audiences (id, workspace_id) on delete cascade
);
alter table public.ad_audience_exports enable row level security;
create index ad_audience_exports_audience_idx on public.ad_audience_exports (audience_id, workspace_id, created_at desc);
create index ad_audience_exports_recent_idx on public.ad_audience_exports (workspace_id, created_at desc);
create index ad_audience_exports_by_idx on public.ad_audience_exports (exported_by);

revoke all on public.ad_audiences, public.ad_audience_exports from anon, authenticated;
grant all on public.ad_audiences, public.ad_audience_exports to service_role;
grant select, delete on public.ad_audiences to authenticated;
grant insert (workspace_id, name, kind, filters, created_by) on public.ad_audiences to authenticated;
grant update (name, filters) on public.ad_audiences to authenticated;
grant select on public.ad_audience_exports to authenticated;

create policy "Members read audiences" on public.ad_audiences for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));
create policy "Members add audiences" on public.ad_audiences for insert to authenticated
  with check ((select private.is_workspace_member(workspace_id)) and created_by = (select auth.uid()));
create policy "Members edit audiences" on public.ad_audiences for update to authenticated
  using ((select private.is_workspace_member(workspace_id)))
  with check ((select private.is_workspace_member(workspace_id)));
create policy "Members delete audiences" on public.ad_audiences for delete to authenticated
  using ((select private.is_workspace_member(workspace_id)));
create policy "Members read exports" on public.ad_audience_exports for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));

-- The people or companies of one audience, for a member (signed in), at
-- most p_max, and the export is recorded. Rows:
--   contacts / suppression: { "email", "phone", "name", "company", "title", "country", "domain" }
--   companies:              { "company", "domain", "country", "linkedin" }
--   { "status": "ok", "kind", "rows": [...], "truncated" } | { "status": "not_found" }
create function public.ad_audience_rows(p_audience_id uuid, p_format text, p_hashed boolean, p_max integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_a public.ad_audiences%rowtype;
  v_f jsonb;
  v_rows jsonb;
  v_n integer;
  v_days integer;
  v_customers boolean;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  select * into v_a from public.ad_audiences a
  where a.id = p_audience_id and (select private.is_workspace_member(a.workspace_id));
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if p_format not in ('linkedin_contacts', 'linkedin_companies', 'meta', 'google', 'plain') then
    return jsonb_build_object('status', 'not_found');
  end if;
  v_f := v_a.filters;
  v_days := case when coalesce(v_f ->> 'added_within_days', '') ~ '^\d{1,4}$' then (v_f ->> 'added_within_days')::integer end;
  v_customers := coalesce((v_f ->> 'include_customers')::boolean, false);

  with picked as (
    select l.*,
           coalesce(nullif(btrim(coalesce(pr.country, '')), ''), nullif(btrim(l.custom_fields ->> 'country'), '')) as country_text,
           coalesce(nullif(pr.contact_role, ''), nullif(btrim(l.custom_fields ->> 'title'), ''), nullif(btrim(l.custom_fields ->> 'job_title'), '')) as title_text,
           coalesce(private.site_domain(l.website), private.site_domain(pr.website),
                    case when l.email is not null then split_part(l.email, '@', 2) end) as domain_text
    from public.leads l
    left join lateral (
      select p.country, p.contact_role, p.website from public.prospects p
      where p.workspace_id = l.workspace_id and p.lead_id = l.id
      order by p.created_at desc limit 1) pr on true
    where l.workspace_id = v_a.workspace_id
      and case v_a.kind
        when 'suppression' then
          case coalesce(v_f ->> 'preset', 'do_not_contact')
            when 'customers' then l.status = 'won'
            else l.do_not_contact or l.status = 'unsubscribed' end
        else
          not l.do_not_contact and l.status <> 'unsubscribed'
          and not private.outbound_is_suppressed(l.workspace_id, l.email, private.site_domain(l.website))
          and (v_customers or l.status <> 'won')
          and (coalesce(jsonb_array_length(v_f -> 'statuses'), 0) = 0
               or l.status in (select jsonb_array_elements_text(v_f -> 'statuses')))
          and (coalesce(jsonb_array_length(v_f -> 'sources'), 0) = 0
               or lower(l.source) in (select lower(jsonb_array_elements_text(v_f -> 'sources'))))
          and (coalesce(v_f ->> 'owner_id', '') !~ '^[0-9a-f-]{36}$' or l.owner_id = (v_f ->> 'owner_id')::uuid)
          and (v_days is null or l.created_at > now() - make_interval(days => v_days))
          and (coalesce(v_f ->> 'campaign_id', '') !~ '^[0-9a-f-]{36}$' or exists (
                 select 1 from public.outbound_campaign_targets t
                 where t.workspace_id = l.workspace_id and t.campaign_id = (v_f ->> 'campaign_id')::uuid
                   and t.lead_id = l.id))
        end
  ),
  filtered as (
    select * from picked p
    where v_a.kind = 'suppression' or coalesce(jsonb_array_length(v_f -> 'countries'), 0) = 0
       or exists (select 1 from jsonb_array_elements_text(v_f -> 'countries') c(v)
                  where lower(btrim(c.v)) = lower(btrim(coalesce(p.country_text, '')))
                     or (char_length(btrim(c.v)) >= 4 and position(lower(btrim(c.v)) in lower(coalesce(p.country_text, ''))) > 0))
  )
  select
    case when v_a.kind = 'companies' then
      (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
         select distinct on (f.domain_text)
                jsonb_build_object('company', coalesce(nullif(f.company, ''), f.domain_text), 'domain', f.domain_text,
                                   'country', coalesce(f.country_text, ''),
                                   'linkedin', coalesce(f.custom_fields ->> 'linkedin_company_url', '')) as x
         from filtered f
         where f.domain_text is not null
           and f.domain_text not in ('gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com', 'proton.me', 'aol.com', 'live.com')
         order by f.domain_text
         limit greatest(p_max, 0) + 1) t)
    else
      (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
         select jsonb_build_object('email', f.email, 'phone', coalesce(f.phone, ''), 'name', f.name,
                                   'company', coalesce(f.company, ''), 'title', coalesce(f.title_text, ''),
                                   'country', coalesce(f.country_text, ''), 'domain', coalesce(f.domain_text, '')) as x
         from filtered f
         where f.email is not null or (v_a.kind = 'suppression' and f.phone is not null)
         order by f.created_at
         limit greatest(p_max, 0) + 1) t)
    end
  into v_rows;

  v_n := least(jsonb_array_length(v_rows), greatest(p_max, 0));
  insert into public.ad_audience_exports (workspace_id, audience_id, format, hashed, rows, exported_by)
  values (v_a.workspace_id, v_a.id, p_format, coalesce(p_hashed, true), v_n, v_user);
  update public.ad_audiences a set last_exported_at = now(), last_export_rows = v_n where a.id = v_a.id;
  return jsonb_build_object(
    'status', 'ok', 'kind', v_a.kind,
    'truncated', jsonb_array_length(v_rows) > greatest(p_max, 0),
    'rows', coalesce((select jsonb_agg(e) from (select e from jsonb_array_elements(v_rows) e limit greatest(p_max, 0)) z), '[]'::jsonb));
end;
$$;

-- How many an audience holds now, without exporting it (for the list).
create function public.ad_audience_count(p_audience_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_a public.ad_audiences%rowtype;
  v_f jsonb;
  v_n integer;
begin
  select * into v_a from public.ad_audiences a
  where a.id = p_audience_id and (select private.is_workspace_member(a.workspace_id));
  if not found then
    return null;
  end if;
  v_f := v_a.filters;
  select count(*) into v_n from public.leads l
  where l.workspace_id = v_a.workspace_id
    and case v_a.kind
      when 'suppression' then
        case coalesce(v_f ->> 'preset', 'do_not_contact')
          when 'customers' then l.status = 'won' else l.do_not_contact or l.status = 'unsubscribed' end
      else
        not l.do_not_contact and l.status <> 'unsubscribed' and l.email is not null
        and (coalesce((v_f ->> 'include_customers')::boolean, false) or l.status <> 'won')
        and (coalesce(jsonb_array_length(v_f -> 'statuses'), 0) = 0
             or l.status in (select jsonb_array_elements_text(v_f -> 'statuses')))
        and (coalesce(jsonb_array_length(v_f -> 'sources'), 0) = 0
             or lower(l.source) in (select lower(jsonb_array_elements_text(v_f -> 'sources'))))
    end;
  return v_n;
end;
$$;

revoke all on function public.ad_audience_rows(uuid, text, boolean, integer) from public, anon;
revoke all on function public.ad_audience_count(uuid) from public, anon;
grant execute on function public.ad_audience_rows(uuid, text, boolean, integer) to authenticated;
grant execute on function public.ad_audience_count(uuid) to authenticated;
