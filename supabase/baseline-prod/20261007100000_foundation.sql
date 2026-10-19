-- Foundation: extensions, a private schema for internals, default privileges, shared trigger functions.

create extension if not exists pgcrypto with schema extensions;

-- Internal helpers live here. Not exposed through the Data API (only `public` is in config.toml
-- api.schemas) and no API role gets USAGE on it.
create schema if not exists private;
revoke all on schema private from public;
revoke all on schema private from anon, authenticated;

-- Defense in depth: objects created by `postgres` in `public` must never silently grant `anon`.
-- (Supabase's stock default privileges grant ALL to anon/authenticated/service_role.)
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke all on functions from anon;
-- Logged-in users never need these on our tables (TRUNCATE in particular bypasses RLS).
alter default privileges for role postgres in schema public
  revoke truncate, references, trigger on tables from authenticated;

-- updated_at maintenance for every mutable table that has the column.
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

revoke all on function private.set_updated_at() from public, anon, authenticated;
