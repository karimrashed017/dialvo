-- Teammates need to see each other's email address (the members list, who a
-- conversation is assigned to). auth.users isn't readable through the API, so
-- the address is copied onto the profile and kept in step. It is visible only
-- to the person and the people who share a workspace with them, like the rest
-- of the profile, and nobody can edit it here: it follows the login address.

alter table public.profiles
  add column email text not null default '' check (char_length(email) <= 254);

update public.profiles p
set email = lower(coalesce(u.email, ''))
from auth.users u
where u.id = p.id;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, name, email)
  values (
    new.id,
    left(coalesce(new.raw_user_meta_data ->> 'name', ''), 120),
    lower(coalesce(new.email, ''))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create function private.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
  set email = lower(coalesce(new.email, ''))
  where id = new.id;
  return new;
end;
$$;
revoke all on function private.handle_user_email_change() from public;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function private.handle_user_email_change();
