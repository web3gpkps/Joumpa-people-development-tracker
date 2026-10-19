-- The parts of a Supabase database the migrations expect, for PGlite (tests/sql/run.ts).
-- Mirrors Supabase's stock setup: API roles, the auth/extensions schemas, auth.users, auth.uid()
-- reading the JWT claims GUCs, and the default privileges that grant everything in public to
-- the API roles (the migrations revoke what anon must not have).
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

create schema auth;
create schema extensions;

grant usage on schema public, extensions, auth to anon, authenticated, service_role;

alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;

create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);

create function auth.uid() returns uuid
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$$;

create function auth.role() returns text
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  )
$$;

grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role;
