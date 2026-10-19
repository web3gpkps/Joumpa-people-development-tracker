-- Final sweep + guard rails. Re-runs the anon revokes across the whole schema and fails the
-- migration if any public table is left without RLS or still grants anything to anon.

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke truncate, references, trigger on all tables in schema public from authenticated;

do $$
declare
  r record;
begin
  for r in
    select c.relname
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p')
       and not c.relrowsecurity
  loop
    raise exception 'public.% has row level security disabled', r.relname;
  end loop;

  for r in
    select c.relname
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
       and (pg_catalog.has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
            or (c.relkind = 'S' and pg_catalog.has_sequence_privilege('anon', c.oid, 'USAGE, SELECT, UPDATE')))
  loop
    raise exception 'anon still has a privilege on public.%', r.relname;
  end loop;
end;
$$;
