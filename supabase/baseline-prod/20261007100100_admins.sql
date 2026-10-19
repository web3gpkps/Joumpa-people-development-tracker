-- Admins: a signed-in user is an admin iff they have a row here.

create table public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  email      text,
  created_at timestamptz not null default now()
);

comment on table public.admins is
  'Users allowed to read/write everything. First admin is inserted with the service role or SQL editor.';

-- SECURITY DEFINER so policies on public.admins itself do not recurse.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admins a where a.user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_admin() from public, anon, authenticated;
-- Needed by every RLS policy (policies run as the calling role).
grant execute on function public.is_admin() to authenticated;

alter table public.admins enable row level security;

create policy admins_admin_all on public.admins
  as permissive for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

revoke all on table public.admins from anon;
revoke truncate, references, trigger on table public.admins from authenticated;
