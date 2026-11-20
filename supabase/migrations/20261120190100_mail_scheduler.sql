-- Slice 3b, part 2: the scheduler. Sending and reading replies must happen
-- with nobody's browser open, so the database itself knocks on the app once
-- a minute (pg_cron) with an HTTP call (pg_net):
--
--   POST <app>/api/mail/step?job=send    schedule and send what is due
--   POST <app>/api/mail/step?job=poll    read connected mailboxes' inboxes
--   POST <app>/api/mail/step?job=write   classify replies, draft follow-ups
--
-- Each call does one short step and returns; every step claims its work in
-- the database first, so a call that dies, repeats or overlaps is harmless.
--
-- The calls carry a random token. It is made here, kept in Supabase Vault,
-- and checked by the app through mail_cron_token_ok(), which only the
-- secret key may call. So the app needs no new environment variable, and
-- the token never appears in code or in a log.
--
-- Where the app lives is a Vault entry too ('dialvo_app_url'). To point the
-- scheduler somewhere else, update that entry; nothing else changes.

select vault.create_secret(
  replace(gen_random_uuid()::text || gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  'dialvo_cron_token',
  'The token the scheduler sends with each call to the app''s mail steps.'
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
create function public.mail_cron_token_ok(p_token text)
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
revoke all on function public.mail_cron_token_ok(text) from public, anon, authenticated;
grant execute on function public.mail_cron_token_ok(text) to service_role;

-- One tick. It calls the app only when there is something a step could do:
-- no connected mailbox, no reply to read and no alert waiting means no call.
create function private.mail_cron_tick()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_token text;
  v_headers jsonb;
  v_job text;
begin
  if not exists (select 1 from public.mailboxes m where m.status = 'active')
     and not exists (select 1 from public.mail_received r where r.kind = 'reply' and r.classification is null)
     and not exists (select 1 from public.team_alerts t
                     where t.status = 'pending' and t.kind in ('reply_interested', 'mailbox_paused')
                       and t.created_at > now() - interval '15 minutes') then
    return;
  end if;
  select s.decrypted_secret into v_url from vault.decrypted_secrets s where s.name = 'dialvo_app_url';
  select s.decrypted_secret into v_token from vault.decrypted_secrets s where s.name = 'dialvo_cron_token';
  if v_url is null or v_token is null then
    return;
  end if;
  v_headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_token);
  foreach v_job in array array['send', 'poll', 'write'] loop
    perform net.http_post(
      url := rtrim(v_url, '/') || '/api/mail/step?job=' || v_job,
      body := '{}'::jsonb,
      headers := v_headers,
      timeout_milliseconds := 58000
    );
  end loop;
end;
$$;
revoke all on function private.mail_cron_tick() from public;

-- The extensions and the job itself. Skipped where pg_cron doesn't exist
-- (the in-memory Postgres the tests run on).
do $do$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    execute 'create extension if not exists pg_cron with schema pg_catalog';
    execute 'create extension if not exists pg_net with schema extensions';
    execute $job$
      select cron.schedule('dialvo-mail-steps', '* * * * *', 'select private.mail_cron_tick()')
    $job$;
  end if;
end;
$do$;
