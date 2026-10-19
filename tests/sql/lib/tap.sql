-- A pgTAP-compatible subset in plain SQL (PGlite has no pgTAP): ok, is, isnt, throws_ok,
-- lives_ok, results_eq, has_table, has_trigger, skip, no_plan, finish. Same names and argument
-- order as pgTAP, so the test files also run under `supabase test db` where pgTAP exists.
-- Every assertion appends a row to tap.results; finish() raises when any of them failed.
create schema tap;
grant usage on schema tap to public;

create table tap.results (
  n           integer generated always as identity primary key,
  ok          boolean not null,
  description text,
  diag        text
);
grant select, insert on table tap.results to public;

create function tap.no_plan() returns setof boolean
language sql as $$ select true $$;

create function tap.record(p_ok boolean, p_description text, p_diag text default null) returns text
language plpgsql as $$
declare
  v_ok boolean := coalesce(p_ok, false);
begin
  insert into tap.results (ok, description, diag) values (v_ok, p_description, case when not v_ok then p_diag end);
  return (case when v_ok then 'ok - ' else 'not ok - ' end) || coalesce(p_description, '');
end;
$$;

create function tap.ok(p_ok boolean, p_description text default null) returns text
language sql as $$ select tap.record(p_ok, p_description, case when p_ok is null then 'got NULL' end) $$;

create function tap.is(p_have anyelement, p_want anyelement, p_description text default null) returns text
language plpgsql as $$
begin
  return tap.record(p_have is not distinct from p_want, p_description,
    format('have: %s, want: %s', coalesce(p_have::text, 'NULL'), coalesce(p_want::text, 'NULL')));
end;
$$;

create function tap.isnt(p_have anyelement, p_want anyelement, p_description text default null) returns text
language plpgsql as $$
begin
  return tap.record(p_have is distinct from p_want, p_description,
    format('have: %s, must differ from it', coalesce(p_have::text, 'NULL')));
end;
$$;

create function tap.throws_ok(p_sql text, p_errcode text, p_errmsg text, p_description text default null) returns text
language plpgsql as $$
begin
  execute p_sql;
  return tap.record(false, p_description, 'no exception was raised');
exception when others then
  return tap.record(
    (p_errcode is null or sqlstate = p_errcode) and (p_errmsg is null or sqlerrm = p_errmsg),
    p_description,
    format('caught %s: %s (wanted %s: %s)', sqlstate, sqlerrm, coalesce(p_errcode, 'any'), coalesce(p_errmsg, 'any')));
end;
$$;

create function tap.lives_ok(p_sql text, p_description text default null) returns text
language plpgsql as $$
begin
  execute p_sql;
  return tap.record(true, p_description);
exception when others then
  return tap.record(false, p_description, format('died %s: %s', sqlstate, sqlerrm));
end;
$$;

create function tap.results_eq(p_have text, p_want text, p_description text default null) returns text
language plpgsql as $$
declare
  v_have text[];
  v_want text[];
begin
  execute format('select coalesce(array_agg(t::text), ''{}'') from (%s) t', p_have) into v_have;
  execute format('select coalesce(array_agg(t::text), ''{}'') from (%s) t', p_want) into v_want;
  return tap.record(v_have = v_want, p_description, format('have: %s, want: %s', v_have, v_want));
end;
$$;

create function tap.has_table(p_schema name, p_table name, p_description text default null) returns text
language sql as $$
  select tap.record(pg_catalog.to_regclass(format('%I.%I', p_schema, p_table)) is not null, p_description,
                    format('%s.%s does not exist', p_schema, p_table))
$$;

create function tap.has_trigger(p_schema name, p_table name, p_trigger name, p_description text default null) returns text
language sql as $$
  select tap.record(exists (
    select 1 from pg_catalog.pg_trigger tg
      join pg_catalog.pg_class c on c.oid = tg.tgrelid
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = p_schema and c.relname = p_table and tg.tgname = p_trigger
  ), p_description, format('no trigger %s on %s.%s', p_trigger, p_schema, p_table))
$$;

create function tap.skip(p_why text, p_count integer default 1) returns text
language plpgsql as $$
begin
  for i in 1 .. p_count loop
    insert into tap.results (ok, description) values (true, 'skip: ' || p_why);
  end loop;
  return 'ok - skip ' || p_why;
end;
$$;

create function tap.finish() returns setof text
language plpgsql as $$
declare
  v_total integer;
  v_failed text;
begin
  select count(*) into v_total from tap.results;
  select string_agg(format('  not ok %s - %s%s', n, coalesce(description, ''), coalesce(' (' || diag || ')', '')), E'\n' order by n)
    into v_failed
    from tap.results
   where not ok;
  if v_failed is not null then
    raise exception using errcode = 'P0001', message = 'tap_failed',
      detail = format('%s of %s assertions failed:', (select count(*) from tap.results where not ok), v_total) || E'\n' || v_failed;
  end if;
  return next format('%s assertions passed', v_total);
end;
$$;

grant execute on all functions in schema tap to public;
