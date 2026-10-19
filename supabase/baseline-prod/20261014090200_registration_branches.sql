-- The registration form is public, and a signed-out visitor has no table privileges, so the list of
-- branches to choose from comes through this one function: station codes only, nothing else.
create or replace function public.registration_branches()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(pg_catalog.array_agg(s.code order by s.sort), '{}')
    from public.stations s;
$$;

revoke all on function public.registration_branches() from public;
grant execute on function public.registration_branches() to anon, authenticated;
