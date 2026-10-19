-- Configuration tables: the five stations and the single settings row (workbook sheet "Parameter").

create table public.stations (
  code         text primary key,
  report_group text not null,
  sort         smallint not null,
  constraint stations_code_check check (code in ('SUB', 'DPS', 'CGK', 'HLP', 'KNO')),
  constraint stations_report_group_check check (report_group in ('SUB', 'DPS', 'CGK & HLP', 'KNO'))
);

insert into public.stations (code, report_group, sort) values
  ('SUB', 'SUB',       1),
  ('DPS', 'DPS',       2),
  ('CGK', 'CGK & HLP', 3),
  ('HLP', 'CGK & HLP', 4),
  ('KNO', 'KNO',       5);

alter table public.stations enable row level security;

-- Fixed reference data: admins read it; changes go through a migration.
create policy stations_admin_select on public.stations
  as permissive for select to authenticated
  using ((select public.is_admin()));

revoke all on table public.stations from anon;
revoke insert, update, delete, truncate, references, trigger on table public.stations from authenticated;


create table public.settings (
  id                    smallint primary key default 1,
  week1_start           date     not null,
  weeks                 smallint not null,
  bmi_first_check       date     not null,
  bmi_interval_days     smallint not null,
  bmi_periods           smallint not null,
  bmi_underweight_below numeric  not null,
  bmi_normal_max        numeric  not null,
  bmi_overweight_max    numeric  not null,
  min_height_female     numeric,
  min_height_male       numeric,
  pass_avg_min          numeric  not null,
  improve_avg_min       numeric  not null,
  posttest_min          numeric  not null,
  replacement_deadline  date     not null,
  updated_at            timestamptz not null default now(),
  constraint settings_singleton check (id = 1),
  constraint settings_weeks_check check (weeks between 1 and 20),
  constraint settings_bmi_interval_days_check check (bmi_interval_days between 1 and 90),
  constraint settings_bmi_periods_check check (bmi_periods between 1 and 10),
  constraint settings_bmi_thresholds_check check (
    bmi_underweight_below > 0
    and bmi_underweight_below <= bmi_normal_max
    and bmi_normal_max <= bmi_overweight_max
    and bmi_overweight_max <= 100
  ),
  constraint settings_min_height_female_check check (min_height_female between 120 and 210),
  constraint settings_min_height_male_check check (min_height_male between 120 and 210),
  constraint settings_pass_avg_min_check check (pass_avg_min between 1 and 5),
  constraint settings_improve_avg_min_check check (
    improve_avg_min between 1 and 5 and improve_avg_min <= pass_avg_min
  ),
  constraint settings_posttest_min_check check (posttest_min between 0 and 100)
);

insert into public.settings (
  id, week1_start, weeks, bmi_first_check, bmi_interval_days, bmi_periods,
  bmi_underweight_below, bmi_normal_max, bmi_overweight_max,
  min_height_female, min_height_male,
  pass_avg_min, improve_avg_min, posttest_min, replacement_deadline
) values (
  1, date '2026-10-12', 10, date '2026-10-12', 14, 5,
  18.5, 25, 27,
  null, null,
  4, 3, 80, date '2026-10-31'
);

create trigger settings_set_updated_at
  before update on public.settings
  for each row execute function private.set_updated_at();

alter table public.settings enable row level security;

create policy settings_admin_select on public.settings
  as permissive for select to authenticated
  using ((select public.is_admin()));

create policy settings_admin_update on public.settings
  as permissive for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

revoke all on table public.settings from anon;
-- The singleton row is edited, never inserted or deleted by the app.
revoke insert, delete, truncate, references, trigger on table public.settings from authenticated;
