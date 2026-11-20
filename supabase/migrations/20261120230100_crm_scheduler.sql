-- CRM sync, part 2: the scheduler. Pushing to the CRM and importing its
-- contacts must happen with nobody's browser open, so once a minute the
-- database (pg_cron) calls the app (pg_net), only when there is work:
--
--   POST <app>/api/crm/step?job=push   write queued jobs to the CRM
--   POST <app>/api/crm/step?job=pull   import one more batch of CRM contacts
--
-- Each call is one short, leased step; a call that dies, repeats or overlaps
-- is harmless (see src/lib/crm/steps.ts).
--
-- The same mechanism as the mail scheduler (20261120190100_mail_scheduler on
-- the sending branch): the calls carry the random token kept in Supabase
-- Vault as 'dialvo_cron_token', and go to the address in 'dialvo_app_url'.
-- Whichever of the two migrations runs first creates them; the other reuses
-- them. The app checks the token with crm_cron_token_ok(), which only the
-- secret key may call, so no environment variable holds it.
--
-- The nightly import: a connection whose last import finished more than 24
-- hours ago is queued again by the tick (a failed one is retried after an
-- hour).

select vault.create_secret(
  replace(gen_random_uuid()::text || gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  'dialvo_cron_token',
  'The token the scheduler sends with each call to the app''s background steps.'
)
where not exists (select 1 from vault.secrets where name = 'dialvo_cron_token');

select vault.create_secret(
  'https://trydialvo.com',
  'dialvo_app_url',
  'Where the scheduler calls the app. No trailing slash.'
)
where not exists (select 1 from vault.secrets where name = 'dialvo_app_url');

-- Is this the scheduler's token? Compared as hashes, so the comparison
-- takes the same time whatever was sent.
create function public.crm_cron_token_ok(p_token text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select sha256(convert_to(s.decrypted_secret, 'UTF8')) = sha256(convert_to(coalesce(p_token, ''), 'UTF8'))
      and char_length(coalesce(p_token, '')) >= 32
    from vault.decrypted_secrets s
    where s.name = 'dialvo_cron_token'
  ), false);
$$;
revoke all on function public.crm_cron_token_ok(text) from public, anon, authenticated;
grant execute on function public.crm_cron_token_ok(text) to service_role;

-- What a tick would ask the app to do: 'push', 'pull', both or neither.
-- Also queues the imports that are due. Separate from the HTTP call so the
-- tests can check it.
create function private.crm_due_work()
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_jobs text[] := '{}';
begin
  update public.crm_connections c set pull_status = 'queued'
  where c.status = 'active'
    and ((c.pull_status in ('done', 'capped') and c.last_pull_at < now() - interval '24 hours')
         or (c.pull_status = 'failed' and coalesce(c.pull_failed_at, c.updated_at) < now() - interval '1 hour'));
  if exists (
    select 1 from public.crm_sync_jobs j
    join public.crm_connections c on c.workspace_id = j.workspace_id and c.status = 'active'
    where (j.status = 'pending' and j.next_attempt_at <= now())
       or (j.status = 'running' and j.locked_until < now())
  ) then
    v_jobs := v_jobs || 'push'::text;
  end if;
  if exists (
    select 1 from public.crm_connections c
    where c.status = 'active'
      and (c.pull_status = 'queued'
           or (c.pull_status = 'running' and (c.pull_locked_until is null or c.pull_locked_until < now())))
  ) then
    v_jobs := v_jobs || 'pull'::text;
  end if;
  return v_jobs;
end;
$$;
revoke all on function private.crm_due_work() from public;

-- One tick: calls the app only when there is something to do.
create function private.crm_cron_tick()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_jobs text[] := private.crm_due_work();
  v_url text;
  v_token text;
  v_job text;
begin
  if cardinality(v_jobs) = 0 then
    return;
  end if;
  select s.decrypted_secret into v_url from vault.decrypted_secrets s where s.name = 'dialvo_app_url';
  select s.decrypted_secret into v_token from vault.decrypted_secrets s where s.name = 'dialvo_cron_token';
  if v_url is null or v_token is null then
    return;
  end if;
  foreach v_job in array v_jobs loop
    -- Called by name through execute so this function can be created where
    -- pg_net doesn't exist (the in-memory Postgres the tests run on).
    execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := $4)'
    using rtrim(v_url, '/') || '/api/crm/step?job=' || v_job, '{}'::jsonb,
          jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_token),
          58000;
  end loop;
end;
$$;
revoke all on function private.crm_cron_tick() from public;

-- The extensions and the job itself. Skipped where pg_cron doesn't exist.
do $do$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    execute 'create extension if not exists pg_cron with schema pg_catalog';
    execute 'create extension if not exists pg_net with schema extensions';
    execute $job$
      select cron.schedule('dialvo-crm-steps', '* * * * *', 'select private.crm_cron_tick()')
    $job$;
  end if;
end;
$do$;
