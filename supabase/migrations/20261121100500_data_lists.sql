-- Lists, research columns and saved recipes. Additive.
--
--   data_lists          a spreadsheet-style list of companies or people,
--                       filled from Find leads, a CSV, existing leads or the
--                       CRM-linked leads. A list marked "target" is a list of
--                       target accounts (ABM, see the accounts migration).
--   data_list_rows      one company or person per row. Deduplicated per list
--                       (by domain for companies, by email, else name and
--                       domain, for people). Optional link to a lead.
--   data_list_columns   the list's added columns: a research column (a plain
--                       question answered per row by the model with web
--                       search, as yes/no, a number, a score, text or one of
--                       a few options, with the source and a short reason),
--                       or a data column (work email, email check, title,
--                       company size, industry, technologies, from the
--                       contact database).
--   data_cells          one answer per row and column, and its state. Cells
--                       are queued (with the day's caps checked and the
--                       estimate reserved first), claimed under a lease by
--                       the scheduler's step, and finished once.
--   data_recipes        a research question (or a 0-100 score) saved by name,
--                       to add to any list, to a sourcing schedule, and to
--                       read in playbooks, audiences and lead scoring.
--   data_usage          the day's research cells, model spend and contact
--                       database credits per workspace (UTC), for the caps.
--
-- Members read their workspace's rows; every write goes through the
-- functions below, which check membership themselves. The caps come from
-- src/lib/data/config.ts as arguments.

create table public.data_lists (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  kind text not null check (kind in ('companies', 'people')),
  -- Where its rows first came from (more can be added from anywhere).
  source text not null default 'manual'
    check (source in ('manual', 'csv', 'leads', 'find_leads', 'audience', 'crm', 'sourcing', 'accounts')),
  -- A target account list (companies only).
  is_target boolean not null default false,
  archived_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  check (not is_target or kind = 'companies')
);
alter table public.data_lists enable row level security;
create index data_lists_workspace_idx on public.data_lists (workspace_id, created_at desc);
create index data_lists_created_by_idx on public.data_lists (created_by);
create trigger data_lists_set_updated_at
  before update on public.data_lists
  for each row execute function private.set_updated_at();

create table public.data_list_rows (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  list_id uuid not null,
  position integer not null default 0,
  -- What makes a row unique in its list.
  key text not null check (char_length(key) between 1 and 400),
  name text not null default '' check (char_length(name) <= 200),
  title text not null default '' check (char_length(title) <= 200),
  company text not null default '' check (char_length(company) <= 200),
  domain text check (domain is null or (domain = lower(domain) and char_length(domain) between 3 and 253)),
  email text check (email is null or (email = lower(email) and char_length(email) between 3 and 254)),
  linkedin_url text check (linkedin_url is null or (linkedin_url ~ '^https://' and char_length(linkedin_url) <= 300)),
  country text not null default '' check (char_length(country) <= 80),
  size_range text not null default '' check (char_length(size_range) <= 40),
  -- Extra columns from an import ({ "column": "value" }), and what the
  -- contact database said, kept so a second column doesn't pay again
  -- (keys starting with "_").
  fields jsonb not null default '{}'::jsonb
    check (jsonb_typeof(fields) = 'object' and octet_length(fields::text) <= 20000),
  lead_id uuid,
  created_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (list_id, key),
  foreign key (list_id, workspace_id)
    references public.data_lists (id, workspace_id) on delete cascade,
  foreign key (lead_id, workspace_id)
    references public.leads (id, workspace_id) on delete set null (lead_id)
);
alter table public.data_list_rows enable row level security;
create index data_list_rows_list_idx on public.data_list_rows (list_id, workspace_id, position);
create index data_list_rows_lead_idx on public.data_list_rows (lead_id, workspace_id) where lead_id is not null;
create index data_list_rows_domain_idx on public.data_list_rows (workspace_id, domain) where domain is not null;

create table public.data_recipes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  -- research: a question with a typed answer. score: a 0-100 score.
  kind text not null check (kind in ('research', 'score')),
  applies_to text not null default 'companies' check (applies_to in ('companies', 'people')),
  question text not null check (char_length(btrim(question)) between 5 and 600),
  answer_type text not null check (answer_type in ('yes_no', 'number', 'text', 'pick_one', 'score')),
  options jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  archived_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  check ((kind = 'score') = (answer_type = 'score'))
);
alter table public.data_recipes enable row level security;
create index data_recipes_workspace_idx on public.data_recipes (workspace_id, created_at);
create index data_recipes_created_by_idx on public.data_recipes (created_by);
create trigger data_recipes_set_updated_at
  before update on public.data_recipes
  for each row execute function private.set_updated_at();

create table public.data_list_columns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  list_id uuid not null,
  position integer not null default 0,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  kind text not null check (kind in ('research', 'data')),
  -- research
  question text check (question is null or char_length(btrim(question)) between 5 and 600),
  answer_type text check (answer_type is null or answer_type in ('yes_no', 'number', 'text', 'pick_one', 'score')),
  options jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  recipe_id uuid,
  -- data
  data_field text check (data_field is null or data_field in (
    'work_email', 'verify_email', 'title', 'company_size', 'industry', 'technologies'
  )),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (id, workspace_id),
  check ((kind = 'research' and question is not null and answer_type is not null and data_field is null)
      or (kind = 'data' and data_field is not null and question is null)),
  foreign key (list_id, workspace_id)
    references public.data_lists (id, workspace_id) on delete cascade,
  foreign key (recipe_id, workspace_id)
    references public.data_recipes (id, workspace_id) on delete set null (recipe_id)
);
alter table public.data_list_columns enable row level security;
create index data_list_columns_list_idx on public.data_list_columns (list_id, workspace_id, position);
create index data_list_columns_recipe_idx on public.data_list_columns (recipe_id, workspace_id) where recipe_id is not null;
create index data_list_columns_created_by_idx on public.data_list_columns (created_by);
create index data_list_columns_workspace_idx on public.data_list_columns (workspace_id);

create table public.data_cells (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  list_id uuid not null,
  row_id uuid not null,
  column_id uuid not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'skipped')),
  -- The typed answer: true/false, a number, a string, or null for "not found".
  value jsonb,
  value_text text not null default '' check (char_length(value_text) <= 600),
  source_url text check (source_url is null or (source_url ~ '^https?://' and char_length(source_url) <= 2000)),
  reason text not null default '' check (char_length(reason) <= 400),
  -- What was reserved for it, and what it really used.
  est_micros integer not null default 0 check (est_micros >= 0),
  est_credits integer not null default 0 check (est_credits >= 0),
  cost_micros integer not null default 0 check (cost_micros >= 0),
  credits integer not null default 0 check (credits >= 0),
  attempts integer not null default 0,
  locked_until timestamptz,
  queued_at timestamptz not null default now(),
  done_at timestamptz,
  primary key (row_id, column_id),
  foreign key (list_id, workspace_id)
    references public.data_lists (id, workspace_id) on delete cascade,
  foreign key (row_id, workspace_id)
    references public.data_list_rows (id, workspace_id) on delete cascade,
  foreign key (column_id, workspace_id)
    references public.data_list_columns (id, workspace_id) on delete cascade
);
alter table public.data_cells enable row level security;
create index data_cells_list_idx on public.data_cells (list_id, workspace_id);
create index data_cells_workspace_idx on public.data_cells (workspace_id, status);
create index data_cells_row_idx on public.data_cells (row_id, workspace_id);
create index data_cells_column_idx on public.data_cells (column_id, workspace_id);
create index data_cells_due_idx on public.data_cells (queued_at) where status in ('queued', 'running');

create table public.data_usage (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  day date not null,
  research_cells integer not null default 0,
  model_micros bigint not null default 0,
  credits integer not null default 0,
  primary key (workspace_id, day)
);
alter table public.data_usage enable row level security;

revoke all on public.data_lists, public.data_list_rows, public.data_recipes, public.data_list_columns,
  public.data_cells, public.data_usage from anon, authenticated;
grant all on public.data_lists, public.data_list_rows, public.data_recipes, public.data_list_columns,
  public.data_cells, public.data_usage to service_role;
grant select on public.data_lists, public.data_list_rows, public.data_recipes, public.data_list_columns,
  public.data_cells, public.data_usage to authenticated;
create policy "Members read lists" on public.data_lists for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));
create policy "Members read list rows" on public.data_list_rows for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));
create policy "Members read recipes" on public.data_recipes for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));
create policy "Members read list columns" on public.data_list_columns for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));
create policy "Members read cells" on public.data_cells for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));
create policy "Members read data usage" on public.data_usage for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Free mailbox providers: an address there says nothing about the company.
-- The same list as src/lib/prospects/domains.ts.
create function private.is_free_mail(p_domain text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select lower(coalesce(p_domain, '')) in (
    'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'yahoo.fr', 'yahoo.de', 'ymail.com',
    'hotmail.com', 'hotmail.co.uk', 'hotmail.fr', 'outlook.com', 'live.com', 'live.co.uk', 'msn.com',
    'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'gmx.de',
    'gmx.net', 'web.de', 'mail.com', 'yandex.com', 'yandex.ru', 'zoho.com', 'btinternet.com', 'sky.com',
    'orange.fr', 'free.fr', 't-online.de', 'libero.it', 'qq.com', '163.com'
  );
$$;
revoke all on function private.is_free_mail(text) from public;

-- A lead's company domain: its website, else its email's domain unless that
-- is a free mailbox.
create function private.lead_domain(p_website text, p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    private.site_domain(p_website),
    case when p_email like '%@%' and not private.is_free_mail(split_part(p_email, '@', 2))
         then lower(split_part(p_email, '@', 2)) end
  );
$$;
revoke all on function private.lead_domain(text, text) from public;

create function private.is_member(p_workspace_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.workspace_members m
                 where m.workspace_id = p_workspace_id and m.user_id = p_user_id);
$$;
revoke all on function private.is_member(uuid, uuid) from public;

create function private.require_member(p_workspace_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if not private.is_member(p_workspace_id, v_user) then
    raise exception 'not a member of this workspace' using errcode = '42501';
  end if;
  return v_user;
end;
$$;
revoke all on function private.require_member(uuid) from public;

-- A research question's answer settings are well formed.
create function private.data_answer_ok(p_type text, p_options jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_type in ('yes_no', 'number', 'text', 'pick_one', 'score')
    and jsonb_typeof(coalesce(p_options, 'null'::jsonb)) = 'array'
    and jsonb_array_length(p_options) <= 8
    and not exists (select 1 from jsonb_array_elements(p_options) o
                    where jsonb_typeof(o) <> 'string' or char_length(btrim(o #>> '{}')) not between 1 and 40)
    and (p_type <> 'pick_one' or jsonb_array_length(p_options) between 2 and 8)
    and (p_type = 'pick_one' or jsonb_array_length(p_options) = 0);
$$;
revoke all on function private.data_answer_ok(text, jsonb) from public;

-- ---------------------------------------------------------------------------
-- Lists
-- ---------------------------------------------------------------------------

-- Makes (p_id null) or renames a list, for a member. At most p_max lists.
create function public.data_list_save(
  p_workspace_id uuid, p_id uuid, p_name text, p_kind text, p_source text, p_target boolean, p_max integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.require_member(p_workspace_id);
  v_id uuid;
begin
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 80 then
    raise exception 'give the list a name' using errcode = '22023';
  end if;
  if p_id is null then
    if coalesce(p_kind, '') not in ('companies', 'people')
       or coalesce(p_source, '') not in ('manual', 'csv', 'leads', 'find_leads', 'audience', 'crm', 'sourcing', 'accounts')
       or (coalesce(p_target, false) and p_kind <> 'companies') then
      raise exception 'those settings are out of range' using errcode = '22023';
    end if;
    perform 1 from public.workspaces w where w.id = p_workspace_id for update;
    if (select count(*) from public.data_lists l
        where l.workspace_id = p_workspace_id and l.archived_at is null) >= p_max then
      raise exception 'too many lists' using errcode = 'P0001';
    end if;
    insert into public.data_lists (workspace_id, name, kind, source, is_target, created_by)
    values (p_workspace_id, btrim(p_name), p_kind, p_source, coalesce(p_target, false), v_user)
    returning id into v_id;
  else
    update public.data_lists l set name = btrim(p_name)
    where l.id = p_id and l.workspace_id = p_workspace_id and l.archived_at is null
    returning l.id into v_id;
    if v_id is null then
      raise exception 'list not found' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end;
$$;
revoke all on function public.data_list_save(uuid, uuid, text, text, text, boolean, integer) from public, anon;
grant execute on function public.data_list_save(uuid, uuid, text, text, text, boolean, integer) to authenticated;

create function public.data_list_archive(p_workspace_id uuid, p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_member(p_workspace_id);
  update public.data_lists l set archived_at = now()
  where l.id = p_id and l.workspace_id = p_workspace_id and l.archived_at is null;
  if not found then
    raise exception 'list not found' using errcode = 'P0002';
  end if;
  -- Nothing more is researched for it.
  update public.data_cells c set status = 'skipped', reason = 'The list was removed.', locked_until = null
  where c.list_id = p_id and c.workspace_id = p_workspace_id and c.status = 'queued';
end;
$$;
revoke all on function public.data_list_archive(uuid, uuid) from public, anon;
grant execute on function public.data_list_archive(uuid, uuid) to authenticated;

-- Adds rows to a list. Internal: the callers below check who is asking.
-- p_rows: [{ name, title, company, domain, email, linkedin_url, country,
-- size_range, fields, lead_id }]. Rows already in the list (same key) and
-- rows past p_max are skipped.
--   { "added": n, "skipped": n, "full": bool }
create function private.data_rows_insert(p_workspace_id uuid, p_list_id uuid, p_rows jsonb, p_max integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_list public.data_lists%rowtype;
  v_count integer;
  v_pos integer;
  v_row jsonb;
  v_email text;
  v_domain text;
  v_name text;
  v_key text;
  v_lead uuid;
  v_link text;
  v_added integer := 0;
  v_skipped integer := 0;
  v_full boolean := false;
begin
  select l.* into v_list from public.data_lists l
  where l.id = p_list_id and l.workspace_id = p_workspace_id and l.archived_at is null for update;
  if not found then
    raise exception 'list not found' using errcode = 'P0002';
  end if;
  if jsonb_typeof(coalesce(p_rows, 'null'::jsonb)) <> 'array' then
    raise exception 'rows must be a list' using errcode = '22023';
  end if;
  select count(*), coalesce(max(r.position), 0) into v_count, v_pos
  from public.data_list_rows r where r.list_id = p_list_id and r.workspace_id = p_workspace_id;
  for v_row in select * from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    v_email := lower(btrim(coalesce(v_row ->> 'email', '')));
    if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' or char_length(v_email) > 254 then
      v_email := null;
    end if;
    v_domain := private.site_domain(left(coalesce(nullif(v_row ->> 'domain', ''), v_row ->> 'website', ''), 300));
    if v_domain is null and v_email is not null and not private.is_free_mail(split_part(v_email, '@', 2)) then
      v_domain := split_part(v_email, '@', 2);
    end if;
    if v_domain is not null and char_length(v_domain) > 253 then
      v_domain := null;
    end if;
    v_name := left(btrim(regexp_replace(coalesce(v_row ->> 'name', ''), '\s+', ' ', 'g')), 200);
    v_key := case
      when v_list.kind = 'companies' then coalesce(v_domain, nullif(lower(left(btrim(coalesce(v_row ->> 'company', '')), 200)), ''))
      else coalesce(v_email, nullif(lower(v_name) || '|' || coalesce(v_domain, lower(left(btrim(coalesce(v_row ->> 'company', '')), 150))), '|'))
    end;
    if v_key is null or v_key = '' or (v_list.kind = 'people' and v_email is null and v_name = '') then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    if v_count >= p_max then
      v_full := true;
      v_skipped := v_skipped + 1;
      continue;
    end if;
    v_lead := null;
    if coalesce(v_row ->> 'lead_id', '') ~ '^[0-9a-f-]{36}$' then
      select l.id into v_lead from public.leads l
      where l.id = (v_row ->> 'lead_id')::uuid and l.workspace_id = p_workspace_id;
    end if;
    v_link := nullif(btrim(coalesce(v_row ->> 'linkedin_url', '')), '');
    if v_link is not null and (v_link !~ '^https://([a-z]+\.)?linkedin\.com/' or char_length(v_link) > 300) then
      v_link := null;
    end if;
    insert into public.data_list_rows (workspace_id, list_id, position, key, name, title, company, domain,
                                       email, linkedin_url, country, size_range, fields, lead_id)
    values (
      p_workspace_id, p_list_id, v_pos + 1, left(v_key, 400), v_name,
      left(btrim(coalesce(v_row ->> 'title', '')), 200),
      left(btrim(coalesce(v_row ->> 'company', '')), 200),
      v_domain, v_email, v_link,
      left(btrim(coalesce(v_row ->> 'country', '')), 80),
      left(btrim(coalesce(v_row ->> 'size_range', '')), 40),
      case when jsonb_typeof(v_row -> 'fields') = 'object' and octet_length((v_row -> 'fields')::text) <= 20000
           then v_row -> 'fields' else '{}'::jsonb end,
      v_lead
    )
    on conflict (list_id, key) do nothing;
    if found then
      v_added := v_added + 1;
      v_count := v_count + 1;
      v_pos := v_pos + 1;
    else
      v_skipped := v_skipped + 1;
    end if;
  end loop;
  update public.data_lists l set updated_at = now() where l.id = p_list_id;
  return jsonb_build_object('added', v_added, 'skipped', v_skipped, 'full', v_full);
end;
$$;
revoke all on function private.data_rows_insert(uuid, uuid, jsonb, integer) from public;

-- Rows from a CSV or typed in, for a member.
create function public.data_rows_add(p_workspace_id uuid, p_list_id uuid, p_rows jsonb, p_max integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_member(p_workspace_id);
  if jsonb_typeof(coalesce(p_rows, 'null'::jsonb)) <> 'array' or jsonb_array_length(p_rows) > 5000 then
    raise exception 'too many rows at once' using errcode = '22023';
  end if;
  return private.data_rows_insert(p_workspace_id, p_list_id, p_rows, p_max);
end;
$$;
revoke all on function public.data_rows_add(uuid, uuid, jsonb, integer) from public, anon;
grant execute on function public.data_rows_add(uuid, uuid, jsonb, integer) to authenticated;

-- Rows from a Find leads search's results (companies found and not removed),
-- for a member. A people list gets the named contact of each.
create function public.data_rows_from_search(p_workspace_id uuid, p_list_id uuid, p_search_id uuid, p_max integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  perform private.require_member(p_workspace_id);
  select coalesce(jsonb_agg(jsonb_build_object(
    'name', p.contact_name, 'title', p.contact_role, 'company', p.company_name, 'domain', p.domain,
    'email', p.email, 'linkedin_url', p.contact_linkedin_url,
    'country', coalesce(nullif(p.country, ''), p.location), 'size_range', p.size_range,
    'lead_id', p.lead_id, 'fields', jsonb_build_object('summary', left(p.summary, 400))
  ) order by p.created_at), '[]'::jsonb) into v_rows
  from public.prospects p
  where p.workspace_id = p_workspace_id and p.search_id = p_search_id
    and p.research_status = 'found' and p.decision <> 'removed';
  return private.data_rows_insert(p_workspace_id, p_list_id, v_rows, p_max);
end;
$$;
revoke all on function public.data_rows_from_search(uuid, uuid, uuid, integer) from public, anon;
grant execute on function public.data_rows_from_search(uuid, uuid, uuid, integer) to authenticated;

-- Rows from existing leads, for a member: the ones named, or with p_crm, the
-- leads linked to a contact in the connected CRM.
create function public.data_rows_from_leads(
  p_workspace_id uuid, p_list_id uuid, p_lead_ids uuid[], p_crm boolean, p_max integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  perform private.require_member(p_workspace_id);
  if coalesce(cardinality(p_lead_ids), 0) > 5000 then
    raise exception 'too many leads at once' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'name', l.name, 'title', coalesce(nullif(l.custom_fields ->> 'title', ''), l.custom_fields #>> '{research,contact_role}', ''),
    'company', coalesce(l.company, ''), 'domain', private.lead_domain(l.website, l.email),
    'email', l.email, 'country', coalesce(l.custom_fields ->> 'country', l.custom_fields #>> '{research,location}', ''),
    'size_range', coalesce(l.custom_fields ->> 'company_size', l.custom_fields ->> 'employees', ''),
    'lead_id', l.id
  ) order by l.created_at), '[]'::jsonb) into v_rows
  from public.leads l
  where l.workspace_id = p_workspace_id
    and ((p_lead_ids is not null and l.id = any (p_lead_ids))
         or (coalesce(p_crm, false) and exists (
               select 1 from public.crm_lead_links k
               where k.lead_id = l.id and k.workspace_id = l.workspace_id and k.contact_id is not null)));
  return private.data_rows_insert(p_workspace_id, p_list_id, v_rows, p_max);
end;
$$;
revoke all on function public.data_rows_from_leads(uuid, uuid, uuid[], boolean, integer) from public, anon;
grant execute on function public.data_rows_from_leads(uuid, uuid, uuid[], boolean, integer) to authenticated;

create function public.data_rows_delete(p_workspace_id uuid, p_list_id uuid, p_row_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform private.require_member(p_workspace_id);
  delete from public.data_list_rows r
  where r.workspace_id = p_workspace_id and r.list_id = p_list_id and r.id = any (coalesce(p_row_ids, '{}'));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.data_rows_delete(uuid, uuid, uuid[]) from public, anon;
grant execute on function public.data_rows_delete(uuid, uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Columns and recipes
-- ---------------------------------------------------------------------------

-- Adds a column to a list (p_id null) or renames/rewrites one, for a member.
-- A column made from a recipe copies its question.
create function public.data_column_save(
  p_workspace_id uuid, p_list_id uuid, p_id uuid, p_name text, p_kind text, p_question text,
  p_answer_type text, p_options jsonb, p_data_field text, p_recipe_id uuid, p_max integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.require_member(p_workspace_id);
  v_recipe public.data_recipes%rowtype;
  v_name text := btrim(coalesce(p_name, ''));
  v_question text := nullif(btrim(coalesce(p_question, '')), '');
  v_type text := p_answer_type;
  v_options jsonb := coalesce(p_options, '[]'::jsonb);
  v_id uuid;
begin
  if not exists (select 1 from public.data_lists l
                 where l.id = p_list_id and l.workspace_id = p_workspace_id and l.archived_at is null) then
    raise exception 'list not found' using errcode = 'P0002';
  end if;
  if p_recipe_id is not null then
    select r.* into v_recipe from public.data_recipes r
    where r.id = p_recipe_id and r.workspace_id = p_workspace_id and r.archived_at is null;
    if not found then
      raise exception 'recipe not found' using errcode = 'P0002';
    end if;
    v_question := v_recipe.question;
    v_type := v_recipe.answer_type;
    v_options := v_recipe.options;
    if v_name = '' then
      v_name := v_recipe.name;
    end if;
  end if;
  if char_length(v_name) not between 1 and 60 then
    raise exception 'give the column a name' using errcode = '22023';
  end if;
  if p_kind = 'research' then
    if v_question is null or char_length(v_question) not between 5 and 600
       or not private.data_answer_ok(v_type, v_options) then
      raise exception 'those settings are out of range' using errcode = '22023';
    end if;
  elsif p_kind = 'data' then
    if coalesce(p_data_field, '') not in ('work_email', 'verify_email', 'title', 'company_size', 'industry', 'technologies') then
      raise exception 'those settings are out of range' using errcode = '22023';
    end if;
  else
    raise exception 'those settings are out of range' using errcode = '22023';
  end if;
  if p_id is null then
    perform 1 from public.data_lists l where l.id = p_list_id for update;
    if (select count(*) from public.data_list_columns c
        where c.list_id = p_list_id and c.workspace_id = p_workspace_id) >= p_max then
      raise exception 'too many columns' using errcode = 'P0001';
    end if;
    insert into public.data_list_columns (workspace_id, list_id, position, name, kind, question, answer_type,
                                          options, recipe_id, data_field, created_by)
    values (p_workspace_id, p_list_id,
            coalesce((select max(c.position) + 1 from public.data_list_columns c where c.list_id = p_list_id), 0),
            v_name, p_kind,
            case when p_kind = 'research' then v_question end,
            case when p_kind = 'research' then v_type end,
            case when p_kind = 'research' then v_options else '[]'::jsonb end,
            case when p_kind = 'research' then p_recipe_id end,
            case when p_kind = 'data' then p_data_field end,
            v_user)
    returning id into v_id;
  else
    -- Changing the question makes the old answers stale: they are cleared.
    delete from public.data_cells x
    using public.data_list_columns c
    where c.id = p_id and c.workspace_id = p_workspace_id and c.kind = 'research' and p_kind = 'research'
      and x.column_id = c.id and x.workspace_id = c.workspace_id
      and x.status in ('done', 'failed', 'skipped')
      and (c.question is distinct from v_question or c.answer_type is distinct from v_type
           or c.options is distinct from v_options);
    update public.data_list_columns c
    set name = v_name,
        question = case when c.kind = 'research' then v_question end,
        answer_type = case when c.kind = 'research' then v_type end,
        options = case when c.kind = 'research' then v_options else '[]'::jsonb end
    where c.id = p_id and c.workspace_id = p_workspace_id and c.list_id = p_list_id and c.kind = p_kind
    returning c.id into v_id;
    if v_id is null then
      raise exception 'column not found' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end;
$$;
revoke all on function public.data_column_save(uuid, uuid, uuid, text, text, text, text, jsonb, text, uuid, integer) from public, anon;
grant execute on function public.data_column_save(uuid, uuid, uuid, text, text, text, text, jsonb, text, uuid, integer) to authenticated;

create function public.data_column_delete(p_workspace_id uuid, p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_member(p_workspace_id);
  delete from public.data_list_columns c where c.id = p_id and c.workspace_id = p_workspace_id;
  if not found then
    raise exception 'column not found' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.data_column_delete(uuid, uuid) from public, anon;
grant execute on function public.data_column_delete(uuid, uuid) to authenticated;

-- Saves a recipe (p_id null: a new one, at most p_max), for a member.
create function public.data_recipe_save(
  p_workspace_id uuid, p_id uuid, p_name text, p_applies_to text, p_question text,
  p_answer_type text, p_options jsonb, p_max integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.require_member(p_workspace_id);
  v_id uuid;
  v_options jsonb := coalesce(p_options, '[]'::jsonb);
begin
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 60
     or char_length(btrim(coalesce(p_question, ''))) not between 5 and 600
     or coalesce(p_applies_to, '') not in ('companies', 'people')
     or not private.data_answer_ok(p_answer_type, v_options) then
    raise exception 'those settings are out of range' using errcode = '22023';
  end if;
  if p_id is null then
    perform 1 from public.workspaces w where w.id = p_workspace_id for update;
    if (select count(*) from public.data_recipes r
        where r.workspace_id = p_workspace_id and r.archived_at is null) >= p_max then
      raise exception 'too many recipes' using errcode = 'P0001';
    end if;
    insert into public.data_recipes (workspace_id, name, kind, applies_to, question, answer_type, options, created_by)
    values (p_workspace_id, btrim(p_name), case when p_answer_type = 'score' then 'score' else 'research' end,
            p_applies_to, btrim(p_question), p_answer_type, v_options, v_user)
    returning id into v_id;
  else
    update public.data_recipes r
    set name = btrim(p_name), kind = case when p_answer_type = 'score' then 'score' else 'research' end,
        applies_to = p_applies_to, question = btrim(p_question), answer_type = p_answer_type, options = v_options
    where r.id = p_id and r.workspace_id = p_workspace_id and r.archived_at is null
    returning r.id into v_id;
    if v_id is null then
      raise exception 'recipe not found' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end;
$$;
revoke all on function public.data_recipe_save(uuid, uuid, text, text, text, text, jsonb, integer) from public, anon;
grant execute on function public.data_recipe_save(uuid, uuid, text, text, text, text, jsonb, integer) to authenticated;

-- Saves a list's research column as a recipe and links the column to it.
create function public.data_recipe_from_column(p_workspace_id uuid, p_column_id uuid, p_max integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_col public.data_list_columns%rowtype;
  v_kind text;
  v_id uuid;
begin
  perform private.require_member(p_workspace_id);
  select c.* into v_col from public.data_list_columns c
  where c.id = p_column_id and c.workspace_id = p_workspace_id and c.kind = 'research';
  if not found then
    raise exception 'column not found' using errcode = 'P0002';
  end if;
  if v_col.recipe_id is not null then
    return v_col.recipe_id;
  end if;
  select l.kind into v_kind from public.data_lists l where l.id = v_col.list_id;
  v_id := public.data_recipe_save(p_workspace_id, null, v_col.name, v_kind, v_col.question,
                                  v_col.answer_type, v_col.options, p_max);
  update public.data_list_columns c set recipe_id = v_id where c.id = v_col.id;
  return v_id;
end;
$$;
revoke all on function public.data_recipe_from_column(uuid, uuid, integer) from public, anon;
grant execute on function public.data_recipe_from_column(uuid, uuid, integer) to authenticated;

create function public.data_recipe_archive(p_workspace_id uuid, p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_member(p_workspace_id);
  update public.data_recipes r set archived_at = now()
  where r.id = p_id and r.workspace_id = p_workspace_id and r.archived_at is null;
  if not found then
    raise exception 'recipe not found' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.data_recipe_archive(uuid, uuid) from public, anon;
grant execute on function public.data_recipe_archive(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Running columns: estimate, queue (caps first), claim, finish
-- ---------------------------------------------------------------------------

-- The (row, column) pairs a run would answer. Internal.
create function private.data_wanted(
  p_workspace_id uuid, p_list_id uuid, p_column_ids uuid[], p_row_ids uuid[], p_rerun boolean
)
returns table (row_id uuid, column_id uuid, kind text, field text)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, c.id, c.kind, c.data_field
  from public.data_list_rows r
  join public.data_list_columns c on c.list_id = r.list_id and c.workspace_id = r.workspace_id
  where r.list_id = p_list_id and r.workspace_id = p_workspace_id
    and c.id = any (coalesce(p_column_ids, '{}'))
    and (p_row_ids is null or r.id = any (p_row_ids))
    and not exists (
      select 1 from public.data_cells x
      where x.row_id = r.id and x.column_id = c.id
        and (x.status in ('queued', 'running') or (x.status = 'done' and not coalesce(p_rerun, false))));
$$;
revoke all on function private.data_wanted(uuid, uuid, uuid[], uuid[], boolean) from public;

-- What running these columns on these rows (null: every row) would take,
-- and, unless p_dry_run, queues it. Server only, for a member (p_user_id).
-- Cells already answered are skipped unless p_rerun. The day's caps are
-- checked against what is used plus what is reserved; the estimate is
-- reserved on data_usage at once, and corrected when each cell finishes.
--   p_est_micros:  estimated model and search spend per research cell
--   p_est_credits: { "work_email": 1, ... } estimated credits per data cell
--   { "status": "queued" | "estimate" | "capped" | "empty" | "not_found",
--     "cells", "research", "credits", "micros",
--     "left_cells", "left_micros", "left_credits" }
create function public.data_cells_queue(
  p_workspace_id uuid, p_user_id uuid, p_list_id uuid, p_column_ids uuid[], p_row_ids uuid[],
  p_rerun boolean, p_dry_run boolean, p_max_cells integer,
  p_day_cells integer, p_day_micros bigint, p_day_credits integer,
  p_est_micros integer, p_est_credits jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day date := (now() at time zone 'utc')::date;
  v_used public.data_usage%rowtype;
  v_cells integer;
  v_research integer;
  v_credits integer;
  v_micros bigint;
  v_left jsonb;
begin
  if not private.is_member(p_workspace_id, p_user_id) then
    return jsonb_build_object('status', 'not_found');
  end if;
  perform 1 from public.data_lists l
  where l.id = p_list_id and l.workspace_id = p_workspace_id and l.archived_at is null for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  select count(*), count(*) filter (where w.kind = 'research'),
         coalesce(sum(case when w.kind = 'data' then coalesce((p_est_credits ->> w.field)::integer, 1) else 0 end), 0)
  into v_cells, v_research, v_credits
  from private.data_wanted(p_workspace_id, p_list_id, p_column_ids, p_row_ids, p_rerun) w;
  v_micros := v_research::bigint * greatest(p_est_micros, 0);

  insert into public.data_usage (workspace_id, day) values (p_workspace_id, v_day)
  on conflict (workspace_id, day) do nothing;
  select u.* into v_used from public.data_usage u
  where u.workspace_id = p_workspace_id and u.day = v_day for update;
  v_left := jsonb_build_object(
    'left_cells', greatest(p_day_cells - v_used.research_cells, 0),
    'left_micros', greatest(p_day_micros - v_used.model_micros, 0),
    'left_credits', greatest(p_day_credits - v_used.credits, 0));

  if v_cells = 0 then
    return jsonb_build_object('status', 'empty', 'cells', 0, 'research', 0, 'credits', 0, 'micros', 0) || v_left;
  end if;
  if v_cells > p_max_cells
     or v_used.research_cells + v_research > p_day_cells
     or v_used.model_micros + v_micros > p_day_micros
     or v_used.credits + v_credits > p_day_credits then
    return jsonb_build_object('status', 'capped', 'cells', v_cells, 'research', v_research,
                              'credits', v_credits, 'micros', v_micros, 'max_cells', p_max_cells) || v_left;
  end if;
  if coalesce(p_dry_run, false) then
    return jsonb_build_object('status', 'estimate', 'cells', v_cells, 'research', v_research,
                              'credits', v_credits, 'micros', v_micros) || v_left;
  end if;

  insert into public.data_cells as x (workspace_id, list_id, row_id, column_id, status, est_micros, est_credits,
                                      attempts, queued_at)
  select p_workspace_id, p_list_id, w.row_id, w.column_id, 'queued',
         case when w.kind = 'research' then greatest(p_est_micros, 0) else 0 end,
         case when w.kind = 'data' then coalesce((p_est_credits ->> w.field)::integer, 1) else 0 end,
         0, now()
  from private.data_wanted(p_workspace_id, p_list_id, p_column_ids, p_row_ids, p_rerun) w
  on conflict (row_id, column_id) do update
  set status = 'queued', est_micros = excluded.est_micros, est_credits = excluded.est_credits,
      cost_micros = 0, credits = 0, attempts = 0, locked_until = null, queued_at = now(), done_at = null;
  update public.data_usage u
  set research_cells = u.research_cells + v_research, model_micros = u.model_micros + v_micros,
      credits = u.credits + v_credits
  where u.workspace_id = p_workspace_id and u.day = v_day;
  return jsonb_build_object('status', 'queued', 'cells', v_cells, 'research', v_research,
                            'credits', v_credits, 'micros', v_micros) || v_left;
end;
$$;
revoke all on function public.data_cells_queue(uuid, uuid, uuid, uuid[], uuid[], boolean, boolean, integer, integer, bigint, integer, integer, jsonb) from public, anon, authenticated;
grant execute on function public.data_cells_queue(uuid, uuid, uuid, uuid[], uuid[], boolean, boolean, integer, integer, bigint, integer, integer, jsonb) to service_role;

-- Gives back a cell's reservation (or the part it didn't use).
create function private.data_usage_settle(p_workspace_id uuid, p_queued_at timestamptz, p_micros bigint, p_credits integer, p_cells integer)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.data_usage u
  set model_micros = greatest(u.model_micros + p_micros, 0),
      credits = greatest(u.credits + p_credits, 0),
      research_cells = greatest(u.research_cells + p_cells, 0)
  where u.workspace_id = p_workspace_id and u.day = (p_queued_at at time zone 'utc')::date;
$$;
revoke all on function private.data_usage_settle(uuid, timestamptz, bigint, integer, integer) from public;

-- Claims up to p_limit queued cells (and ones whose step died), oldest
-- first, with what each needs. A cell tried p_max_attempts times fails and
-- its reservation goes back. Server only.
create function public.data_cells_claim(p_limit integer, p_lease_seconds integer, p_max_attempts integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_out jsonb;
  v_dead record;
begin
  for v_dead in
    update public.data_cells x
    set status = 'failed', locked_until = null, done_at = now(),
        reason = 'It stopped part-way too many times.'
    where ((x.status = 'running' and x.locked_until < now()) or x.status = 'queued')
      and x.attempts >= p_max_attempts
    returning x.workspace_id, x.queued_at, x.est_micros, x.est_credits
  loop
    perform private.data_usage_settle(v_dead.workspace_id, v_dead.queued_at, -v_dead.est_micros,
                                      -v_dead.est_credits, case when v_dead.est_micros > 0 then -1 else 0 end);
  end loop;

  with picked as (
    select x.row_id, x.column_id from public.data_cells x
    join public.data_lists l on l.id = x.list_id and l.workspace_id = x.workspace_id and l.archived_at is null
    where x.status = 'queued' or (x.status = 'running' and x.locked_until < now())
    order by x.queued_at
    limit greatest(least(p_limit, 50), 1)
    for update of x skip locked
  ), marked as (
    update public.data_cells x
    set status = 'running', attempts = x.attempts + 1,
        locked_until = now() + make_interval(secs => greatest(p_lease_seconds, 1))
    from picked where x.row_id = picked.row_id and x.column_id = picked.column_id
    returning x.*
  )
  select jsonb_agg(jsonb_build_object(
    'workspace_id', m.workspace_id, 'list_id', m.list_id, 'row_id', m.row_id, 'column_id', m.column_id,
    'attempts', m.attempts, 'est_micros', m.est_micros, 'est_credits', m.est_credits,
    'list_kind', l.kind,
    'workspace', jsonb_build_object('name', w.name, 'website', w.website),
    'row', jsonb_build_object('name', r.name, 'title', r.title, 'company', r.company, 'domain', r.domain,
                              'email', r.email, 'linkedin_url', r.linkedin_url, 'country', r.country,
                              'size_range', r.size_range, 'fields', r.fields),
    'column', jsonb_build_object('name', c.name, 'kind', c.kind, 'question', c.question,
                                 'answer_type', c.answer_type, 'options', c.options, 'data_field', c.data_field)
  ) order by m.queued_at) into v_out
  from marked m
  join public.data_lists l on l.id = m.list_id
  join public.workspaces w on w.id = m.workspace_id
  join public.data_list_rows r on r.id = m.row_id
  join public.data_list_columns c on c.id = m.column_id;
  return coalesce(v_out, '[]'::jsonb);
end;
$$;
revoke all on function public.data_cells_claim(integer, integer, integer) from public, anon, authenticated;
grant execute on function public.data_cells_claim(integer, integer, integer) to service_role;

-- Records one claimed cell's answer. Only a running cell can be finished,
-- so a late or repeated call changes nothing. p_status 'retry' puts it back
-- in the queue. p_row_patch: what the contact database said, merged into
-- the row (fields starting with "_", and an empty email, title or size).
create function public.data_cell_finish(
  p_workspace_id uuid, p_row_id uuid, p_column_id uuid, p_status text, p_value jsonb, p_text text,
  p_source_url text, p_reason text, p_cost_micros integer, p_credits integer, p_row_patch jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cell public.data_cells%rowtype;
  v_url text := nullif(btrim(coalesce(p_source_url, '')), '');
  v_email text;
begin
  if p_status not in ('done', 'failed', 'skipped', 'retry') then
    raise exception 'unknown outcome' using errcode = '22023';
  end if;
  select x.* into v_cell from public.data_cells x
  where x.row_id = p_row_id and x.column_id = p_column_id and x.workspace_id = p_workspace_id
    and x.status = 'running'
  for update;
  if not found then
    return 'ignored';
  end if;
  if v_url is not null and (v_url !~ '^https?://' or char_length(v_url) > 2000) then
    v_url := null;
  end if;
  if p_status = 'retry' then
    update public.data_cells x set status = 'queued', locked_until = null,
           cost_micros = x.cost_micros + greatest(coalesce(p_cost_micros, 0), 0)
    where x.row_id = p_row_id and x.column_id = p_column_id;
    -- What the failed try spent counts on the day, on top of the estimate.
    perform private.data_usage_settle(p_workspace_id, v_cell.queued_at, greatest(coalesce(p_cost_micros, 0), 0), 0, 0);
    return 'retry';
  end if;
  update public.data_cells x
  set status = p_status, value = case when p_status = 'done' then p_value end,
      value_text = left(coalesce(p_text, ''), 600), source_url = v_url,
      reason = left(coalesce(p_reason, ''), 400),
      cost_micros = x.cost_micros + greatest(coalesce(p_cost_micros, 0), 0),
      credits = greatest(coalesce(p_credits, 0), 0), locked_until = null, done_at = now()
  where x.row_id = p_row_id and x.column_id = p_column_id;
  -- The reservation becomes what was really used.
  perform private.data_usage_settle(
    p_workspace_id, v_cell.queued_at,
    greatest(coalesce(p_cost_micros, 0), 0) - v_cell.est_micros,
    greatest(coalesce(p_credits, 0), 0) - v_cell.est_credits,
    0);
  if p_row_patch is not null and jsonb_typeof(p_row_patch) = 'object' then
    v_email := lower(btrim(coalesce(p_row_patch ->> 'email', '')));
    if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' or char_length(v_email) > 254 then
      v_email := null;
    end if;
    update public.data_list_rows r
    set fields = case when jsonb_typeof(p_row_patch -> 'fields') = 'object'
                       and octet_length((r.fields || (p_row_patch -> 'fields'))::text) <= 20000
                      then r.fields || (p_row_patch -> 'fields') else r.fields end,
        email = coalesce(r.email, v_email),
        title = case when r.title = '' then left(btrim(coalesce(p_row_patch ->> 'title', '')), 200) else r.title end,
        size_range = case when r.size_range = '' then left(btrim(coalesce(p_row_patch ->> 'size_range', '')), 40) else r.size_range end
    where r.id = p_row_id and r.workspace_id = p_workspace_id;
  end if;
  return p_status;
end;
$$;
revoke all on function public.data_cell_finish(uuid, uuid, uuid, text, jsonb, text, text, text, integer, integer, jsonb) from public, anon, authenticated;
grant execute on function public.data_cell_finish(uuid, uuid, uuid, text, jsonb, text, text, text, integer, integer, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Sending rows to Leads
-- ---------------------------------------------------------------------------

-- Makes a lead of each row (or links it to the lead with its email), for a
-- member. A company row becomes a lead for the company, with no person.
--   { "added": n, "linked": n, "skipped": n, "lead_ids": [...] }
create function public.data_rows_to_leads(p_workspace_id uuid, p_list_id uuid, p_row_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.require_member(p_workspace_id);
  v_row public.data_list_rows%rowtype;
  v_lead uuid;
  v_added integer := 0;
  v_linked integer := 0;
  v_skipped integer := 0;
  v_ids uuid[] := '{}';
  v_fields jsonb;
begin
  if coalesce(cardinality(p_row_ids), 0) > 2000 then
    raise exception 'too many rows at once' using errcode = '22023';
  end if;
  for v_row in
    select r.* from public.data_list_rows r
    where r.workspace_id = p_workspace_id and r.list_id = p_list_id and r.id = any (coalesce(p_row_ids, '{}'))
    order by r.position
    for update
  loop
    v_lead := v_row.lead_id;
    if v_lead is null and v_row.email is not null then
      select l.id into v_lead from public.leads l
      where l.workspace_id = p_workspace_id and l.email = v_row.email;
      if v_lead is not null then
        v_linked := v_linked + 1;
      end if;
    elsif v_lead is not null then
      v_linked := v_linked + 1;
    end if;
    if v_lead is null then
      if v_row.email is null and v_row.company = '' and v_row.domain is null then
        v_skipped := v_skipped + 1;
        continue;
      end if;
      v_fields := jsonb_strip_nulls(jsonb_build_object(
        'title', nullif(v_row.title, ''), 'country', nullif(v_row.country, ''),
        'company_size', nullif(v_row.size_range, ''), 'linkedin_url', v_row.linkedin_url,
        'list_id', v_row.list_id));
      insert into public.leads (workspace_id, name, email, company, website, source, custom_fields)
      values (p_workspace_id, v_row.name, v_row.email, nullif(v_row.company, ''),
              case when v_row.domain is not null then 'https://' || v_row.domain end,
              'list', v_fields)
      returning id into v_lead;
      insert into public.activity_events (workspace_id, lead_id, actor_id, kind, summary, metadata)
      values (p_workspace_id, v_lead, v_user, 'lead_created', 'Added from a list.',
              jsonb_build_object('list_id', v_row.list_id, 'row_id', v_row.id));
      v_added := v_added + 1;
    end if;
    update public.data_list_rows r set lead_id = v_lead where r.id = v_row.id;
    v_ids := v_ids || v_lead;
  end loop;
  return jsonb_build_object('added', v_added, 'linked', v_linked, 'skipped', v_skipped,
                            'lead_ids', to_jsonb(v_ids));
end;
$$;
revoke all on function public.data_rows_to_leads(uuid, uuid, uuid[]) from public, anon;
grant execute on function public.data_rows_to_leads(uuid, uuid, uuid[]) to authenticated;
