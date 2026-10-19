-- profiles.email is a copy of auth.users.email (shown on the Akun Cabang page). It was only written at
-- sign-up, so changing an account's e-mail left the copy stale. Keep it in step, and fix existing rows.

create or replace function private.sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles p
     set email = coalesce(new.email, '')
   where p.id = new.id
     and p.email is distinct from coalesce(new.email, '');
  return new;
end;
$$;

revoke all on function private.sync_profile_email() from public, anon, authenticated;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function private.sync_profile_email();

update public.profiles p
   set email = coalesce(u.email, '')
  from auth.users u
 where u.id = p.id
   and p.email is distinct from coalesce(u.email, '');
