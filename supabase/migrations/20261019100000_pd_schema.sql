-- JOUMPA People Development tracker (v2): its own tables, next to the Uplifting tracker (v1) in the
-- same database. Everything v2 owns is prefixed pd_ (tables, RPCs, private helpers), so v1 is never
-- altered. Shared with v1 and only read here: auth.users, public.profiles (branch accounts),
-- public.stations, public.admins and public.is_admin(). supabase/baseline-prod/ holds v1's
-- migrations; tests apply them first, then these.
--
-- Workbook "Tracker Tindak Lanjut People Development JOUMPA" + Cek BMI:
--   pd_staff           Tracker Staf (+ L/P, NIPP, BMI note from Cek BMI)
--   pd_bmi_checks      Cek BMI (long format)
--   pd_replacements    Penggantian SDM
--   pd_action_plans    Rencana Aksi (archived, never deleted, from the app)
--   pd_monthly_reports Laporan Bulanan
--   pd_areas           Rencana Aksi areas (dropdown)
--   pd_settings        Parameter BMI
-- Derived values (Hasil penilaian ulang, Lulus training?, Flag, % Sesuai, ...) are computed in
-- lib/pd-rules.ts and by the sheet's own formulas, never stored.

-- ---------------------------------------------------------------- private helpers (v2 copies)
create or replace function private.pd_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

-- Attribution: pd_share_begin_write puts the link id in this setting for the transaction.
create or replace function private.pd_stamp_link()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_by_link := nullif(pg_catalog.current_setting('joumpa_pd.share_link_id', true), '')::uuid;
  return new;
end;
$$;

create or replace function private.pd_check_report_group()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.report_group is not null
     and not exists (select 1 from public.stations s where s.report_group = new.report_group) then
    raise exception using errcode = '23514', message = 'unknown_report_group',
      detail = pg_catalog.format('%s is not a report group in stations', new.report_group);
  end if;
  return new;
end;
$$;

revoke all on function private.pd_set_updated_at(), private.pd_stamp_link(), private.pd_check_report_group()
  from public, anon, authenticated;


-- ---------------------------------------------------------------- pd_settings (tab "Parameter BMI")
create table public.pd_settings (
  id                    smallint primary key default 1,
  bmi_first_check       date     not null,
  bmi_interval_days     smallint not null,
  bmi_periods           smallint not null,
  bmi_underweight_below numeric  not null,
  bmi_normal_max        numeric  not null,
  bmi_overweight_max    numeric  not null,
  min_height_female     numeric,
  min_height_male       numeric,
  updated_at            timestamptz not null default now(),
  constraint pd_settings_singleton check (id = 1),
  constraint pd_settings_bmi_interval_days_check check (bmi_interval_days between 1 and 90),
  constraint pd_settings_bmi_periods_check check (bmi_periods between 1 and 52),
  constraint pd_settings_bmi_thresholds_check check (
    bmi_underweight_below > 0
    and bmi_underweight_below <= bmi_normal_max
    and bmi_normal_max <= bmi_overweight_max
    and bmi_overweight_max <= 100
  ),
  constraint pd_settings_min_height_female_check check (min_height_female between 120 and 210),
  constraint pd_settings_min_height_male_check check (min_height_male between 120 and 210)
);

-- Same values as v1's Parameter on 19 Okt 2026; the cut-over copies v1's row again.
insert into public.pd_settings (
  id, bmi_first_check, bmi_interval_days, bmi_periods,
  bmi_underweight_below, bmi_normal_max, bmi_overweight_max, min_height_female, min_height_male
) values (1, date '2026-10-12', 14, 5, 18.5, 25, 27, null, null);

create trigger pd_settings_set_updated_at
  before update on public.pd_settings
  for each row execute function private.pd_set_updated_at();


-- ---------------------------------------------------------------- pd_areas (Rencana Aksi "Area")
create table public.pd_areas (
  name text primary key,
  sort smallint not null default 0,
  constraint pd_areas_name_check check (btrim(name) <> '' and name = btrim(name) and char_length(name) <= 80)
);

insert into public.pd_areas (name, sort) values
  ('Penggantian SDM', 1),
  ('Coaching assessment', 2),
  ('Coaching intensif', 3),
  ('Pembinaan on the job', 4),
  ('Product knowledge & SOP', 5),
  ('Grooming', 6),
  ('BMI', 7),
  ('Seragam & atribut', 8),
  ('Komunikasi touch point', 9),
  ('Bahasa Inggris & reservasi', 10),
  ('Training susulan', 11),
  ('Evaluasi & pelaporan', 12);


-- ---------------------------------------------------------------- pd_share_links (/s/<token>)
create table public.pd_share_links (
  id           uuid primary key default gen_random_uuid(),
  token        text not null default encode(extensions.gen_random_bytes(24), 'hex'),
  scope        text not null,
  label        text,
  created_by   uuid default auth.uid() references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  revoked_at   timestamptz,
  last_used_at timestamptz,
  constraint pd_share_links_token_key unique (token),
  constraint pd_share_links_token_check check (token ~ '^[0-9a-f]{48}$'),
  constraint pd_share_links_scope_check check (scope = 'KPS' or scope ~ '^[A-Z0-9]{2,5}$')
);

comment on column public.pd_share_links.token is
  '24 random bytes, hex. Readable by admins only. Link holders reach data only via pd_share_* RPCs.';

create index pd_share_links_created_by_idx on public.pd_share_links (created_by);

create or replace function private.pd_check_link_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.scope <> 'KPS' and not exists (select 1 from public.stations s where s.code = new.scope) then
    raise exception using errcode = '23514', message = 'unknown_scope',
      detail = pg_catalog.format('%s is not KPS or a station in stations', new.scope);
  end if;
  return new;
end;
$$;

revoke all on function private.pd_check_link_scope() from public, anon, authenticated;

create trigger pd_share_links_check_scope
  before insert or update of scope on public.pd_share_links
  for each row execute function private.pd_check_link_scope();


-- ---------------------------------------------------------------- pd_staff (tab "Tracker Staf")
create table public.pd_staff (
  code              text primary key,
  station           text not null references public.stations (code) on update cascade,
  -- "Cabang": always the station's report group (set by trigger, never trusted from input).
  report_group      text,
  name              text not null,
  nipp              text,
  gender            text,
  bmi_note          text,
  proposal          text,
  initial_coaching  text,
  coaching_items    text,
  initial_practice  numeric(4, 2),
  main_action       text,
  main_due          date,
  pic               text,
  main_status       text,
  extra_action      text,
  extra_due         date,
  extra_status      text,
  reassessed_on     date,
  reassess_practice numeric(4, 2),
  recoaching        text,
  final_decision    text,
  progress_notes    text,
  sort_order        integer,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  updated_by_link   uuid references public.pd_share_links (id) on delete set null,
  constraint pd_staff_code_check check (code ~ '^[A-Z0-9]{2,5}-[0-9]{2,4}$'),
  constraint pd_staff_name_check check (btrim(name) <> ''),
  constraint pd_staff_gender_check check (gender in ('L', 'P')),
  constraint pd_staff_proposal_check check (
    proposal in ('Coaching intensif', 'Pembinaan', 'Penggantian', 'Siap bertugas', 'Strong reminder')
  ),
  constraint pd_staff_initial_practice_check check (initial_practice between 1 and 5),
  constraint pd_staff_main_status_check check (main_status in ('Belum Mulai', 'Proses', 'Selesai', 'Batal / N.A.')),
  constraint pd_staff_extra_status_check check (extra_status in ('Belum Mulai', 'Proses', 'Selesai', 'Batal / N.A.')),
  constraint pd_staff_reassess_practice_check check (reassess_practice between 1 and 5),
  constraint pd_staff_recoaching_check check (
    recoaching in ('Siap Bertugas', 'Perlu Pembinaan', 'Tidak Sesuai', 'Belum dinilai')
  ),
  constraint pd_staff_final_decision_check check (
    final_decision in ('Tetap bertugas', 'Lanjut pembinaan', 'Diganti', 'Ditarik dari JOUMPA')
  )
);

create index pd_staff_station_idx on public.pd_staff (station);
create index pd_staff_updated_by_link_idx on public.pd_staff (updated_by_link);

create or replace function private.pd_staff_set_report_group()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select s.report_group into new.report_group from public.stations s where s.code = new.station;
  return new;
end;
$$;

revoke all on function private.pd_staff_set_report_group() from public, anon, authenticated;

-- A row inserted without a code (the Sheets sync, for a person typed into Tracker Staf without an
-- ID) gets the station's next code, e.g. BPN-06. The RPC assigns codes itself.
create or replace function private.pd_staff_assign_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if new.code is null and new.station is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('joumpa_pd.staff_code.' || new.station));
    select coalesce(max(pg_catalog.substring(s.code, '-([0-9]+)$')::integer), 0) + 1
      into v_n
      from public.pd_staff s
     where s.code like new.station || '-%';
    new.code := new.station || '-' || pg_catalog.lpad(v_n::text, 2, '0');
  end if;
  return new;
end;
$$;

revoke all on function private.pd_staff_assign_code() from public, anon, authenticated;

create trigger pd_staff_assign_code
  before insert on public.pd_staff
  for each row execute function private.pd_staff_assign_code();
create trigger pd_staff_set_report_group
  before insert or update on public.pd_staff
  for each row execute function private.pd_staff_set_report_group();
create trigger pd_staff_set_updated_at
  before insert or update on public.pd_staff
  for each row execute function private.pd_set_updated_at();
create trigger pd_staff_stamp_link
  before insert or update on public.pd_staff
  for each row execute function private.pd_stamp_link();


-- ---------------------------------------------------------------- pd_bmi_checks (tab "Cek BMI")
create table public.pd_bmi_checks (
  id              bigint generated by default as identity primary key,
  staff_code      text not null references public.pd_staff (code) on delete cascade on update cascade,
  period          smallint not null,
  check_date      date,
  height_cm       numeric(5, 1) not null,
  weight_kg       numeric(5, 1) not null,
  updated_at      timestamptz not null default now(),
  updated_by_user uuid references auth.users (id) on delete set null,
  updated_by_link uuid references public.pd_share_links (id) on delete set null,
  constraint pd_bmi_checks_staff_period_key unique (staff_code, period),
  constraint pd_bmi_checks_period_check check (period between 1 and 52),
  constraint pd_bmi_checks_height_cm_check check (height_cm between 120 and 210),
  constraint pd_bmi_checks_weight_kg_check check (weight_kg between 30 and 200)
);

create index pd_bmi_checks_updated_by_user_idx on public.pd_bmi_checks (updated_by_user);
create index pd_bmi_checks_updated_by_link_idx on public.pd_bmi_checks (updated_by_link);

-- Via a link: updated_by_link = link id, updated_by_user NULL. Otherwise the signed-in user
-- (NULL for the service role / Sheets sync / SQL).
create or replace function private.pd_stamp_bmi_check_author()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_link text := nullif(pg_catalog.current_setting('joumpa_pd.share_link_id', true), '');
begin
  if v_link is not null then
    new.updated_by_link := v_link::uuid;
    new.updated_by_user := null;
  else
    new.updated_by_link := null;
    new.updated_by_user := auth.uid();
  end if;
  return new;
end;
$$;

revoke all on function private.pd_stamp_bmi_check_author() from public, anon, authenticated;

create trigger pd_bmi_checks_set_updated_at
  before insert or update on public.pd_bmi_checks
  for each row execute function private.pd_set_updated_at();
create trigger pd_bmi_checks_stamp_author
  before insert or update on public.pd_bmi_checks
  for each row execute function private.pd_stamp_bmi_check_author();

-- Lowering the number of periods below one that already holds data would orphan it.
create or replace function private.pd_settings_guard_bmi_periods()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_used smallint;
begin
  if new.bmi_periods < old.bmi_periods then
    select max(c.period) into v_used from public.pd_bmi_checks c;
    if v_used is not null and new.bmi_periods < v_used then
      raise exception using errcode = '23514', message = 'bmi_periods_below_used',
        detail = pg_catalog.format('check %s already has data', v_used);
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.pd_settings_guard_bmi_periods() from public, anon, authenticated;

create trigger pd_settings_guard_bmi_periods
  before update of bmi_periods on public.pd_settings
  for each row execute function private.pd_settings_guard_bmi_periods();


-- ---------------------------------------------------------------- pd_replacements (tab "Penggantian SDM")
create table public.pd_replacements (
  id                bigint generated by default as identity primary key,
  staff_code        text references public.pd_staff (code) on delete set null on update cascade,
  -- "Nama" / "Cabang": copied from pd_staff by trigger while staff_code is set.
  name              text not null,
  report_group      text,
  category          text,
  basis             text,
  withdraw_due      date,
  director_approval text,
  withdrawn_on      date,
  withdraw_status   text,
  replacement_name  text,
  selected_on       date,
  post_test         numeric(5, 2),
  practice          numeric(4, 2),
  training_due      date,
  started_on        date,
  notes             text,
  sort_order        integer,
  updated_at        timestamptz not null default now(),
  updated_by_link   uuid references public.pd_share_links (id) on delete set null,
  constraint pd_replacements_name_check check (btrim(name) <> ''),
  constraint pd_replacements_category_check check (category in ('Penggantian', 'Strong reminder')),
  constraint pd_replacements_director_approval_check check (director_approval in ('Ya', 'Belum', 'Tidak')),
  constraint pd_replacements_withdraw_status_check check (
    withdraw_status in ('Belum Mulai', 'Proses', 'Selesai', 'Batal / N.A.')
  ),
  constraint pd_replacements_post_test_check check (post_test between 0 and 100),
  constraint pd_replacements_practice_check check (practice between 1 and 5)
);

create index pd_replacements_staff_code_idx on public.pd_replacements (staff_code);
create index pd_replacements_updated_by_link_idx on public.pd_replacements (updated_by_link);

create or replace function private.pd_replacements_copy_staff()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff public.pd_staff;
begin
  if new.staff_code is not null then
    select s.* into v_staff from public.pd_staff s where s.code = new.staff_code;
    if found then
      new.name := v_staff.name;
      new.report_group := v_staff.report_group;
    end if;
  end if;
  return new;
end;
$$;

-- A withdrawal marked Selesai for a replacement: the staff member's final decision becomes
-- "Diganti" unless one was already recorded. The replacement person is added to Tracker Staf by
-- hand (the app reminds while "Nama pengganti" has no staff row).
create or replace function private.pd_replacements_mark_replaced()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.staff_code is not null
     and new.category = 'Penggantian'
     and new.withdraw_status = 'Selesai'
     and (tg_op = 'INSERT' or old.withdraw_status is distinct from 'Selesai') then
    update public.pd_staff s
       set final_decision = 'Diganti'
     where s.code = new.staff_code
       and s.final_decision is null;
  end if;
  return null;
end;
$$;

revoke all on function private.pd_replacements_copy_staff(), private.pd_replacements_mark_replaced()
  from public, anon, authenticated;

create trigger pd_replacements_before_copy_staff
  before insert or update on public.pd_replacements
  for each row execute function private.pd_replacements_copy_staff();
create trigger pd_replacements_check_report_group
  before insert or update of report_group on public.pd_replacements
  for each row execute function private.pd_check_report_group();
create trigger pd_replacements_set_updated_at
  before insert or update on public.pd_replacements
  for each row execute function private.pd_set_updated_at();
create trigger pd_replacements_stamp_link
  before insert or update on public.pd_replacements
  for each row execute function private.pd_stamp_link();
create trigger pd_replacements_mark_replaced
  after insert or update of withdraw_status, category, staff_code on public.pd_replacements
  for each row execute function private.pd_replacements_mark_replaced();

-- A staff rename / move reaches their Penggantian row (the copy trigger runs on that update).
create or replace function private.pd_staff_refresh_replacements()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.name is distinct from old.name or new.report_group is distinct from old.report_group then
    update public.pd_replacements r
       set name = new.name, report_group = new.report_group
     where r.staff_code = new.code
       and (r.name is distinct from new.name or r.report_group is distinct from new.report_group);
  end if;
  return null;
end;
$$;

revoke all on function private.pd_staff_refresh_replacements() from public, anon, authenticated;

create trigger pd_staff_refresh_replacements
  after update of name, station, report_group on public.pd_staff
  for each row execute function private.pd_staff_refresh_replacements();


-- ---------------------------------------------------------------- pd_action_plans (tab "Rencana Aksi")
create table public.pd_action_plans (
  id              bigint generated by default as identity primary key,
  item_no         text,
  area            text not null references public.pd_areas (name) on update cascade,
  action          text not null,
  report_group    text not null,
  target          text,
  due_date        date,
  pic             text,
  status          text not null default 'Belum Mulai',
  progress        smallint not null default 0,
  done_on         date,
  evidence        text,
  notes           text,
  -- "Hapus" from the app archives; the owner can restore. Archived rows are absent from the sheet.
  archived_at     timestamptz,
  sort_order      integer,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by_link uuid references public.pd_share_links (id) on delete set null,
  constraint pd_action_plans_item_no_check check (char_length(item_no) <= 10),
  constraint pd_action_plans_action_check check (btrim(action) <> ''),
  constraint pd_action_plans_status_check check (status in ('Belum Mulai', 'Proses', 'Selesai', 'Batal / N.A.')),
  constraint pd_action_plans_progress_check check (progress between 0 and 100)
);

create index pd_action_plans_report_group_idx on public.pd_action_plans (report_group);
create index pd_action_plans_area_idx on public.pd_action_plans (area);
create index pd_action_plans_updated_by_link_idx on public.pd_action_plans (updated_by_link);

create trigger pd_action_plans_check_report_group
  before insert or update of report_group on public.pd_action_plans
  for each row execute function private.pd_check_report_group();
create trigger pd_action_plans_set_updated_at
  before insert or update on public.pd_action_plans
  for each row execute function private.pd_set_updated_at();
create trigger pd_action_plans_stamp_link
  before insert or update on public.pd_action_plans
  for each row execute function private.pd_stamp_link();


-- ---------------------------------------------------------------- pd_monthly_reports (tab "Laporan Bulanan")
create table public.pd_monthly_reports (
  report_group    text not null,
  -- First day of the reported month ("Okt 2026" in the sheet).
  period          date not null,
  due_on          date,
  received_on     date,
  active_staff    integer,
  compliant_staff integer,
  complaints      integer,
  responded       text,
  satisfaction    numeric(3, 2),
  notes           text,
  updated_at      timestamptz not null default now(),
  updated_by_link uuid references public.pd_share_links (id) on delete set null,
  primary key (report_group, period),
  constraint pd_monthly_reports_period_check check (extract(day from period) = 1),
  constraint pd_monthly_reports_active_staff_check check (active_staff between 0 and 10000),
  constraint pd_monthly_reports_compliant_staff_check check (compliant_staff between 0 and 10000),
  constraint pd_monthly_reports_complaints_check check (complaints between 0 and 10000),
  constraint pd_monthly_reports_responded_check check (responded in ('Ya', 'Belum', 'Tidak')),
  constraint pd_monthly_reports_satisfaction_check check (satisfaction between 0 and 5)
);

create index pd_monthly_reports_updated_by_link_idx on public.pd_monthly_reports (updated_by_link);

create trigger pd_monthly_reports_check_report_group
  before insert or update of report_group on public.pd_monthly_reports
  for each row execute function private.pd_check_report_group();
create trigger pd_monthly_reports_set_updated_at
  before insert or update on public.pd_monthly_reports
  for each row execute function private.pd_set_updated_at();
create trigger pd_monthly_reports_stamp_link
  before insert or update on public.pd_monthly_reports
  for each row execute function private.pd_stamp_link();


-- ---------------------------------------------------------------- RLS: admins only (links use the RPCs)
alter table public.pd_settings        enable row level security;
alter table public.pd_areas           enable row level security;
alter table public.pd_share_links     enable row level security;
alter table public.pd_staff           enable row level security;
alter table public.pd_bmi_checks      enable row level security;
alter table public.pd_replacements    enable row level security;
alter table public.pd_action_plans    enable row level security;
alter table public.pd_monthly_reports enable row level security;

create policy pd_settings_admin_select on public.pd_settings
  as permissive for select to authenticated using ((select public.is_admin()));
create policy pd_settings_admin_update on public.pd_settings
  as permissive for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy pd_areas_admin_all on public.pd_areas
  as permissive for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy pd_share_links_admin_all on public.pd_share_links
  as permissive for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy pd_staff_admin_all on public.pd_staff
  as permissive for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy pd_bmi_checks_admin_all on public.pd_bmi_checks
  as permissive for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy pd_replacements_admin_all on public.pd_replacements
  as permissive for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy pd_action_plans_admin_all on public.pd_action_plans
  as permissive for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy pd_monthly_reports_admin_all on public.pd_monthly_reports
  as permissive for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

revoke all on table
  public.pd_settings, public.pd_areas, public.pd_share_links, public.pd_staff, public.pd_bmi_checks,
  public.pd_replacements, public.pd_action_plans, public.pd_monthly_reports
  from anon;
revoke truncate, references, trigger on table
  public.pd_settings, public.pd_areas, public.pd_share_links, public.pd_staff, public.pd_bmi_checks,
  public.pd_replacements, public.pd_action_plans, public.pd_monthly_reports
  from authenticated;
-- The settings row is edited, never inserted or deleted by the app.
revoke insert, delete on table public.pd_settings from authenticated;
