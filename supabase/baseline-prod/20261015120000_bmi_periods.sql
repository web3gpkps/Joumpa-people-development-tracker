-- The number of BMI checks follows Parameter like the Garuda tracker: 1 to 52 checks (two years of
-- checks every two weeks), one interval for everyone (bmi_interval_days). The number of checks cannot
-- be lowered below a check that already has data.

alter table public.settings drop constraint settings_bmi_periods_check;
alter table public.settings add constraint settings_bmi_periods_check check (bmi_periods between 1 and 52);

alter table public.bmi_checks drop constraint bmi_checks_period_check;
alter table public.bmi_checks add constraint bmi_checks_period_check check (period between 1 and 52);

create or replace function private.settings_guard_bmi_periods()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_used smallint;
begin
  if new.bmi_periods < old.bmi_periods then
    select max(c.period) into v_used from public.bmi_checks c;
    if v_used is not null and new.bmi_periods < v_used then
      raise exception using errcode = '23514', message = 'bmi_periods_below_used',
        detail = pg_catalog.format('check %s already has data', v_used);
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.settings_guard_bmi_periods() from public, anon, authenticated;

create trigger settings_guard_bmi_periods
  before update of bmi_periods on public.settings
  for each row execute function private.settings_guard_bmi_periods();
