-- Sheets sync support: lease RPCs (service_role only) and a debounced change-ping.

-- ------------------------------------------------------------------ lease
-- Returns a new lease token, or NULL when another run holds an unexpired lease.
create or replace function public.sync_claim_lease(p_ttl_seconds integer)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_token uuid;
begin
  if p_ttl_seconds is null or p_ttl_seconds < 1 or p_ttl_seconds > 900 then
    raise exception using errcode = '22023', message = 'invalid_input', detail = 'p_ttl_seconds (1..900)';
  end if;

  update public.sync_state s
     set lease_token = pg_catalog.gen_random_uuid(),
         lease_until = pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => p_ttl_seconds)
   where s.id
     and (s.lease_until is null or s.lease_until <= pg_catalog.clock_timestamp())
  returning s.lease_token into v_token;

  return v_token;
end;
$$;

-- Ends the run that holds p_token. Returns false (and changes nothing) if that lease was lost
-- (another run claimed it after expiry).
--   p_error NULL     -> success: last_success_at = now, last_error = NULL, failures = 0,
--                       baseline = p_baseline (if not NULL), initialized = true (if p_baseline not NULL)
--   p_error not NULL -> failure: last_error = p_error, failures + 1,
--                       baseline = p_baseline if not NULL (pass NULL to keep the old one)
create or replace function public.sync_release_lease(
  p_token    uuid,
  p_baseline jsonb default null,
  p_error    text  default null
)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  update public.sync_state s
     set lease_token     = null,
         lease_until     = null,
         baseline        = coalesce(p_baseline, s.baseline),
         initialized     = s.initialized or (p_baseline is not null and p_error is null),
         last_success_at = case when p_error is null then pg_catalog.clock_timestamp() else s.last_success_at end,
         last_error      = p_error,
         failures        = case when p_error is null then 0 else s.failures + 1 end
   where s.id
     and p_token is not null
     and s.lease_token = p_token;

  return found;
end;
$$;

revoke all on function public.sync_claim_lease(integer) from public, anon, authenticated;
revoke all on function public.sync_release_lease(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.sync_claim_lease(integer) to service_role;
grant execute on function public.sync_release_lease(uuid, jsonb, text) to service_role;


-- ------------------------------------------------------------------ change-ping
-- AFTER STATEMENT on synced tables. At most one ping per 10 s, POST to Vault secret
-- `sync_run_url` with `Authorization: Bearer <Vault secret sync_secret>`.
-- Silent no-op when pg_net or either secret is missing (local dev). Never fails the caller's write.
-- Writes made by the sync engine itself (service_role JWT) do not ping.
create or replace function private.sync_ping()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url    text;
  v_secret text;
begin
  begin
    if coalesce(
         nullif(pg_catalog.current_setting('request.jwt.claim.role', true), ''),
         nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
       ) = 'service_role' then
      return null;
    end if;

    if not exists (select 1 from pg_catalog.pg_extension e where e.extname = 'pg_net')
       or pg_catalog.to_regclass('vault.decrypted_secrets') is null then
      return null;
    end if;

    -- Dynamic SQL so this function compiles and lints without vault / pg_net present.
    execute $q$
      select max(d.decrypted_secret) filter (where d.name = 'sync_run_url'),
             max(d.decrypted_secret) filter (where d.name = 'sync_secret')
        from vault.decrypted_secrets d
       where d.name in ('sync_run_url', 'sync_secret')
    $q$ into v_url, v_secret;

    if coalesce(v_url, '') = '' or coalesce(v_secret, '') = '' then
      return null;
    end if;

    -- Debounce. SKIP LOCKED: if another transaction is mid-ping (or the engine holds the row),
    -- don't wait; the every-minute cron run is the backstop.
    perform 1
       from public.sync_state s
      where s.id
        and (s.last_ping_at is null
             or s.last_ping_at < pg_catalog.clock_timestamp() - interval '10 seconds')
        for update skip locked;
    if not found then
      return null;
    end if;

    update public.sync_state s
       set last_ping_at = pg_catalog.clock_timestamp()
     where s.id;

    execute $q$
      select net.http_post(
        url                  := $1,
        body                 := $2,
        headers              := $3,
        timeout_milliseconds := 5000
      )
    $q$
    using v_url,
          pg_catalog.jsonb_build_object('source', 'db', 'table', tg_table_name),
          pg_catalog.jsonb_build_object(
            'Content-Type',  'application/json',
            'Authorization', 'Bearer ' || v_secret
          );
  exception when others then
    raise log 'joumpa sync_ping skipped on %: % (%)', tg_table_name, sqlerrm, sqlstate;
  end;
  return null;
end;
$$;

revoke all on function private.sync_ping() from public, anon, authenticated;

create trigger staff_sync_ping
  after insert or update or delete or truncate on public.staff
  for each statement execute function private.sync_ping();

create trigger weekly_scores_sync_ping
  after insert or update or delete or truncate on public.weekly_scores
  for each statement execute function private.sync_ping();

create trigger bmi_checks_sync_ping
  after insert or update or delete or truncate on public.bmi_checks
  for each statement execute function private.sync_ping();

create trigger action_items_sync_ping
  after insert or update or delete or truncate on public.action_items
  for each statement execute function private.sync_ping();

create trigger replacements_sync_ping
  after insert or update or delete or truncate on public.replacements
  for each statement execute function private.sync_ping();

create trigger settings_sync_ping
  after insert or update or delete or truncate on public.settings
  for each statement execute function private.sync_ping();

create trigger weekly_reports_sync_ping
  after insert or update or delete or truncate on public.weekly_reports
  for each statement execute function private.sync_ping();
