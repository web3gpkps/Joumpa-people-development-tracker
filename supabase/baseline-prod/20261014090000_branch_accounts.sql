-- Branch accounts: a person registers with a branch, the owner (public.admins) approves, and the
-- approved account signs in and sees only that branch (docs/SPEC.md "Access model").
--
-- Scope of an account = its branch: a station code from public.stations, or 'KPS' (head office,
-- every station). Data still flows only through the share_* RPCs: a signed-in, approved account
-- calls them with a blank p_token, exactly like the owner, and private.share_resolve_link maps
-- it to its branch scope. Accounts have no table privileges beyond reading their own profile row.

create type public.account_status as enum ('pending', 'active', 'inactive');

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  full_name   text not null default '',
  -- A station code, 'KPS' (head office), or 'UNASSIGNED' when the sign-up named no valid branch.
  branch_code text not null,
  status      public.account_status not null default 'pending',
  created_at  timestamptz not null default now(),
  decided_at  timestamptz,
  decided_by  uuid references auth.users (id) on delete set null,
  constraint profiles_branch_code_check
    check (branch_code in ('KPS', 'UNASSIGNED') or branch_code ~ '^[A-Z0-9]{2,5}$'),
  constraint profiles_full_name_check check (char_length(full_name) <= 200),
  constraint profiles_active_needs_branch check (status <> 'active' or branch_code <> 'UNASSIGNED')
);

create index profiles_status_idx on public.profiles (status, created_at);
create index profiles_decided_by_idx on public.profiles (decided_by);

-- A branch other than KPS / UNASSIGNED must be a listed station (a CHECK cannot look at another table).
create or replace function private.profiles_check_branch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.branch_code not in ('KPS', 'UNASSIGNED')
     and not exists (select 1 from public.stations s where s.code = new.branch_code) then
    raise exception using errcode = '23514', message = 'profiles_branch_code_check',
      detail = 'branch_code must be KPS or a code in public.stations';
  end if;
  return new;
end;
$$;

revoke all on function private.profiles_check_branch() from public, anon, authenticated;

create trigger profiles_check_branch
  before insert or update of branch_code on public.profiles
  for each row execute function private.profiles_check_branch();

-- Whoever flips a status records who and when; callers cannot set these columns (no grant).
create or replace function private.profiles_stamp_decision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    new.decided_at := pg_catalog.now();
    new.decided_by := auth.uid();
  end if;
  return new;
end;
$$;

revoke all on function private.profiles_stamp_decision() from public, anon, authenticated;

create trigger profiles_stamp_decision
  before update on public.profiles
  for each row execute function private.profiles_stamp_decision();

alter table public.profiles enable row level security;

create policy profiles_read_own on public.profiles
  as permissive for select to authenticated
  using (id = (select auth.uid()));

create policy profiles_admin_all on public.profiles
  as permissive for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

revoke all on table public.profiles from anon, authenticated;
grant select on table public.profiles to authenticated;
-- RLS limits updates to the owner; the column list keeps even the owner to the three editable fields.
grant update (full_name, branch_code, status) on table public.profiles to authenticated;

-- Sign-up creates the profile. Role and status are never read from the sign-up metadata: a new
-- account is always pending, and an unknown branch becomes UNASSIGNED (which cannot be activated).
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_branch text := pg_catalog.upper(pg_catalog.btrim(coalesce(new.raw_user_meta_data ->> 'branch_code', '')));
begin
  if v_branch <> 'KPS' and not exists (select 1 from public.stations s where s.code = v_branch) then
    v_branch := 'UNASSIGNED';
  end if;
  insert into public.profiles (id, email, full_name, branch_code)
  values (
    new.id,
    coalesce(new.email, ''),
    pg_catalog.left(pg_catalog.btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), 200),
    v_branch
  );
  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- Removing an account removes the auth.users row; the profile cascades. An RPC, so the app never
-- needs the service role key. Owners cannot be removed this way.
create or replace function public.admin_delete_account(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception using errcode = '42501', message = 'not_authorised';
  end if;
  if exists (select 1 from public.admins a where a.user_id = p_user_id) then
    raise exception using errcode = 'P0001', message = 'cannot_delete_owner';
  end if;
  delete from auth.users u where u.id = p_user_id;
end;
$$;

revoke all on function public.admin_delete_account(uuid) from public, anon;
grant execute on function public.admin_delete_account(uuid) to authenticated;

-- A signed-in, approved account (blank token) is scoped to its branch. The owner keeps priority.
create or replace function private.share_resolve_link(p_token text)
returns public.share_links
language plpgsql
set search_path = ''
as $$
declare
  v_link    public.share_links;
  v_profile public.profiles;
begin
  if nullif(pg_catalog.btrim(p_token), '') is null then
    if public.is_admin() then
      v_link.scope := 'KPS';
      v_link.label := 'Pemilik';
      return v_link;
    end if;

    select p.* into v_profile
      from public.profiles p
     where p.id = auth.uid()
       and p.status = 'active';

    if found and (
         v_profile.branch_code = 'KPS'
         or exists (select 1 from public.stations s where s.code = v_profile.branch_code)
       ) then
      v_link.scope := v_profile.branch_code;
      v_link.label := coalesce(nullif(v_profile.full_name, ''), v_profile.email);
      return v_link;
    end if;
    raise exception using errcode = 'P0001', message = 'invalid_link';
  end if;

  select l.* into v_link
    from public.share_links l
   where l.token = pg_catalog.lower(pg_catalog.btrim(p_token))
     and l.revoked_at is null;

  if not found then
    raise exception using errcode = 'P0001', message = 'invalid_link';
  end if;

  update public.share_links l
     set last_used_at = pg_catalog.now()
   where l.id = v_link.id;

  return v_link;
end;
$$;
