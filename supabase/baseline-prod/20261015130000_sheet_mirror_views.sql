-- Read-only mirror of the Google Sheet in the database: schema "sheet", one view per synced tab, named
-- after the tab, with the tab's header texts as column names in the tab's column order (formula columns
-- computed the way the workbook computes them, see lib/rules.ts). The real tables stay normalized (the
-- sync engine, the RPCs and the app use them); these views are what the owner opens in the Supabase
-- Table Editor (schema "sheet") to see the data the way the sheet shows it.
--
-- "Cek BMI 2 Mingguan" has one group of five columns per check, so it is rebuilt whenever
-- settings.bmi_periods changes (trigger below). Only postgres and service_role can read the schema:
-- it is not exposed to the API, and the views read every station.

create schema if not exists sheet;
revoke all on schema sheet from public, anon, authenticated;
grant usage on schema sheet to service_role;
comment on schema sheet is 'Read-only views that mirror the Google Sheet tabs (same tab names, headers and column order).';

-- ---------------------------------------------------------------------------------------------
-- Helpers (lib/rules.ts)
-- ---------------------------------------------------------------------------------------------

-- The workbook's TODAY() (Parameter "Tanggal acuan"): the Jakarta date.
create or replace function private.sheet_today()
returns date
language sql
stable
set search_path = ''
as $$ select (pg_catalog.now() at time zone 'Asia/Jakarta')::date $$;

-- ROUND(AVERAGE(...), 2) with blanks ignored; NULL when nothing is filled.
create or replace function private.sheet_avg(variadic p numeric[])
returns numeric
language sql
immutable
set search_path = ''
as $$ select pg_catalog.round(pg_catalog.avg(x), 2) from pg_catalog.unnest(p) as x $$;

-- Criteria 6.2 (Master SDM R; Log M without the post-test term: pass p_post_test NULL).
create or replace function private.sheet_criteria(p_avg numeric, p_post_test numeric, s public.settings)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_avg is null then null
    when p_avg < s.improve_avg_min then 'Tidak Sesuai'
    when p_avg >= s.pass_avg_min and (p_post_test is null or p_post_test >= s.posttest_min) then 'Sesuai'
    else 'Perlu Perbaikan'
  end
$$;

-- BMI: ROUND(weight / (height/100)^2, 1).
create or replace function private.sheet_bmi(p_height numeric, p_weight numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case when p_height > 0 and p_weight is not null
    then pg_catalog.round(p_weight / ((p_height / 100) ^ 2), 1) end
$$;

create or replace function private.sheet_bmi_category(p_bmi numeric, s public.settings)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_bmi is null then null
    when p_bmi < s.bmi_underweight_below then 'Kurus'
    when p_bmi <= s.bmi_normal_max then 'Normal'
    when p_bmi <= s.bmi_overweight_max then 'Overweight'
    else 'Obesitas'
  end
$$;

-- `12 Okt` (lib/dates.ts formatTanggalPendek).
create or replace function private.sheet_short_date(p date)
returns text
language sql
immutable
set search_path = ''
as $$
  select extract(day from p)::int || ' ' ||
    (array['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'])[extract(month from p)::int]
$$;

-- Tindak Lanjut I: a rolling due date (due_rule) is recomputed for today, like the workbook's TODAY() formulas.
create or replace function private.sheet_due_date(p_due date, p_rule text, s public.settings, p_today date)
returns date
language sql
immutable
set search_path = ''
as $$
  select case p_rule
    when 'bulanan-tgl-5' then
      (pg_catalog.date_trunc('month', p_today)
        + pg_catalog.make_interval(months => (extract(day from p_today) > 5)::int))::date + 4
    when 'cek-bmi-berikutnya' then
      least(
        s.bmi_first_check + s.bmi_interval_days * (s.bmi_periods - 1),
        s.bmi_first_check + s.bmi_interval_days * (case when p_today - s.bmi_first_check <= 0 then 0
          else ceil((p_today - s.bmi_first_check)::numeric / s.bmi_interval_days)::int end))
    when 'jumat-berikutnya' then
      least(
        s.week1_start + (s.weeks - 1) * 7 + 4,
        greatest(s.week1_start + 4, p_today + (((5 - extract(dow from p_today)::int) % 7) + 7) % 7))
    else p_due
  end
$$;

revoke all on function private.sheet_today(), private.sheet_avg(numeric[]),
  private.sheet_criteria(numeric, numeric, public.settings), private.sheet_bmi(numeric, numeric),
  private.sheet_bmi_category(numeric, public.settings), private.sheet_short_date(date),
  private.sheet_due_date(date, text, public.settings, date)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Static tabs
-- ---------------------------------------------------------------------------------------------

create or replace view sheet."Parameter" as
select p.ord as "No", p.label as "Parameter", p.value as "Nilai"
from public.settings s
cross join lateral (values
  (1,  'Tanggal mulai Minggu ke-1 (Senin)', pg_catalog.to_char(s.week1_start, 'DD/MM/YYYY')),
  (2,  'Jumlah minggu pemantauan', s.weeks::text),
  (3,  'Tanggal cek BMI periode 1', pg_catalog.to_char(s.bmi_first_check, 'DD/MM/YYYY')),
  (4,  'Interval cek BMI (hari)', s.bmi_interval_days::text),
  (5,  'Jumlah periode cek BMI', s.bmi_periods::text),
  (6,  'BMI kategori Kurus jika <', s.bmi_underweight_below::text),
  (7,  'BMI Normal s.d.', s.bmi_normal_max::text),
  (8,  'BMI Overweight s.d. (di atasnya Obesitas)', s.bmi_overweight_max::text),
  (9,  'Tinggi minimal petugas Perempuan (cm)', s.min_height_female::text),
  (10, 'Tinggi minimal petugas Laki-laki (cm)', s.min_height_male::text),
  (11, 'Rata-rata praktik minimal SESUAI', s.pass_avg_min::text),
  (12, 'Rata-rata praktik minimal PERLU PERBAIKAN', s.improve_avg_min::text),
  (13, 'Post-test minimal', s.posttest_min::text),
  (14, 'Tanggal acuan (hari ini)', pg_catalog.to_char(private.sheet_today(), 'DD/MM/YYYY'))
) as p(ord, label, value)
where s.id = 1
order by p.ord;

create or replace view sheet."Master SDM" as
with st as (
  select t.*, private.sheet_avg(t.score_a, t.score_b, t.score_c, t.score_d, t.score_e, t.score_f) as avg
  from public.staff t
), x as (
  select st.*, private.sheet_criteria(st.avg, st.post_test, s) as crit
  from st left join public.settings s on s.id = 1
)
select
  row_number() over (order by x.sort_order nulls last, x.code) as "No",
  x.code as "ID SDM",
  x.station as "Stasiun",
  case when upper(trim(x.station)) in ('CGK', 'HLP') then 'CGK & HLP' else x.station end as "Laporan",
  x.name as "Nama Petugas",
  x.nipp as "NIPP",
  x.gender as "L/P",
  x.pre_test as "Pre-test",
  x.post_test as "Post-test",
  x.score_a as "A Penampilan",
  x.score_b as "B Grooming",
  x.score_c as "C Postur",
  x.score_d as "D Komunikasi",
  x.score_e as "E Touch Point",
  x.score_f as "F B. Inggris & Reservasi",
  x.avg as "Rata-rata Praktik",
  x.report_conclusion as "Kesimpulan di Laporan",
  x.crit as "Status Menurut Kriteria 6.2",
  case when nullif(trim(x.report_conclusion), '') is null or x.crit is null then null
    when upper(left(x.report_conclusion, 6)) = upper(left(x.crit, 6)) then 'OK'
    else 'Beda – verifikasi' end as "Cek Konsistensi",
  x.assignment_status as "Status Penugasan",
  x.notes as "Catatan"
from x
order by 1;

-- Every staff member x every week, like the pre-made rows of the tab.
create or replace view sheet."Log Performa Mingguan" as
with s as (select * from public.settings where id = 1),
st as (
  select t.code, t.name, t.station, t.sort_order,
    private.sheet_avg(t.score_a, t.score_b, t.score_c, t.score_d, t.score_e, t.score_f) as base_avg
  from public.staff t
)
select
  w.week as "Minggu Ke",
  s.week1_start + (w.week - 1) * 7 as "Mulai (Senin)",
  st.code as "ID SDM",
  st.name as "Nama Petugas",
  st.station as "Stasiun",
  ws.score_a as "A Penampilan",
  ws.score_b as "B Grooming",
  ws.score_c as "C Postur",
  ws.score_d as "D Komunikasi",
  ws.score_e as "E Touch Point",
  ws.score_f as "F B. Inggris & Reservasi",
  a.avg as "Rata-rata",
  private.sheet_criteria(a.avg, null, s) as "Status Minggu Ini",
  a.avg - st.base_avg as "Δ vs Baseline",
  ws.observer as "Observer / Penilai",
  ws.coaching_notes as "Catatan Coaching"
from s
cross join lateral pg_catalog.generate_series(1, s.weeks) as w(week)
cross join st
left join public.weekly_scores ws on ws.staff_code = st.code and ws.week = w.week
cross join lateral (
  select private.sheet_avg(ws.score_a, ws.score_b, ws.score_c, ws.score_d, ws.score_e, ws.score_f) as avg
) a
order by w.week, st.sort_order nulls last, st.code;

create or replace view sheet."Tindak Lanjut" as
with s as (select * from public.settings where id = 1),
x as (
  select t.*, private.sheet_due_date(t.due_date, t.due_rule, s, private.sheet_today()) as due,
    private.sheet_today() as today
  from public.action_items t left join s on true
)
select
  row_number() over (order by x.sort_order nulls last, x.code) as "No",
  x.code as "ID",
  x.report_group as "Laporan",
  x.area as "Area",
  x.action as "Tindakan",
  x.target as "Target / Indikator",
  x.kind as "Jenis",
  x.schedule as "Jadwal",
  x.due as "Batas Waktu",
  x.pic as "PIC",
  x.status as "Status",
  x.progress as "% Progres",
  x.updated_on as "Tgl Update",
  x.evidence as "Realisasi / Bukti",
  x.kps_notes as "Catatan KPS",
  case when x.due is null or upper(trim(x.status)) = 'SELESAI' then null else x.due - x.today end as "Sisa Hari",
  case
    when upper(trim(x.status)) = 'SELESAI' then 'Selesai'
    when x.due is null then null
    when x.due - x.today < 0 then 'OVERDUE'
    when x.due - x.today <= 7 then 'Jatuh tempo ≤ 7 hari'
    when upper(trim(x.kind)) = 'RUTIN' then 'Rutin – pantau'
    else 'On Track'
  end as "Flag"
from x
order by 1;

create or replace view sheet."Penggantian SDM" as
with s as (select * from public.settings where id = 1)
select
  row_number() over (order by r.sort_order nulls last, r.id) as "No",
  r.report_group as "Laporan",
  r.station as "Stasiun",
  r.replaced_name as "Nama SDM Diganti",
  r.reason as "Alasan / Dasar",
  r.withdrawn_on as "Tgl Ditarik",
  r.replacement_name as "Nama SDM Pengganti",
  r.effective_on as "Tgl Efektif",
  r.training_on as "Tgl Training",
  r.post_test as "Post-test",
  r.practice_avg as "Rata-rata Praktik",
  case
    when nullif(trim(r.replacement_name), '') is null then null
    when r.post_test is null or r.practice_avg is null then 'Belum training/dinilai'
    when r.post_test >= s.posttest_min and r.practice_avg >= s.pass_avg_min then 'Lulus – boleh bertugas'
    else 'Belum lulus'
  end as "Status Kelulusan",
  case
    when nullif(trim(r.replaced_name), '') is null then null
    when r.effective_on is null then
      case when private.sheet_today() - s.replacement_deadline > 0 then 'OVERDUE' else 'Menunggu' end
    when r.effective_on <= s.replacement_deadline then 'Tepat waktu'
    else 'Lewat ' || private.sheet_short_date(s.replacement_deadline)
  end as "Ketepatan Waktu",
  r.reported as "Dilaporkan ke OAO/Direksi",
  r.notes as "Catatan",
  r.id as "ID Sistem",
  r.staff_code as "ID SDM"
from public.replacements r
left join s on true
order by 1;

create or replace view sheet."Temuan Mingguan" as
select w.week as "Minggu Ke", w.scope as "Lingkup", w.findings as "Temuan"
from public.weekly_reports w
order by w.week, w.scope;

-- ---------------------------------------------------------------------------------------------
-- "Cek BMI 2 Mingguan": one row per staff member, one group of columns per check
-- ---------------------------------------------------------------------------------------------

create or replace function private.rebuild_sheet_cek_bmi()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_periods int := coalesce((select bmi_periods from public.settings where id = 1), 1);
  v_groups text := '';
  p int;
begin
  for p in 1 .. v_periods loop
    v_groups := v_groups || pg_catalog.format(
      ', c%1$s.check_date as %2$I, c%1$s.height_cm as %3$I, c%1$s.weight_kg as %4$I, '
      'private.sheet_bmi(c%1$s.height_cm, c%1$s.weight_kg) as %5$I, '
      'private.sheet_bmi_category(private.sheet_bmi(c%1$s.height_cm, c%1$s.weight_kg), s) as %6$I',
      p,
      'Cek ke-' || p || ' Tgl Cek', 'Cek ke-' || p || ' Tinggi (cm)', 'Cek ke-' || p || ' Berat (kg)',
      'Cek ke-' || p || ' BMI', 'Cek ke-' || p || ' Kategori');
  end loop;

  drop view if exists sheet."Cek BMI 2 Mingguan";
  execute pg_catalog.format($v$
    create view sheet."Cek BMI 2 Mingguan" as
    with s0 as (select * from public.settings where id = 1),
    last as (
      select c.staff_code,
        (array_agg(c.height_cm order by c.period desc))[1] as height,
        (array_agg(c.weight_kg order by c.period desc))[1] as weight,
        (array_agg(c.weight_kg order by c.period asc))[1] as first_weight
      from public.bmi_checks c, s0
      where c.period between 1 and s0.bmi_periods
      group by c.staff_code
    )
    select
      row_number() over (order by st.sort_order nulls last, st.code) as "No",
      st.code as "ID SDM",
      st.name as "Nama Petugas",
      st.station as "Stasiun",
      st.gender as "L/P"
      %1$s,
      l.height as "Tinggi Terakhir (cm)",
      l.weight as "Berat Terakhir (kg)",
      l.weight - l.first_weight as "Δ Berat vs Cek Pertama (kg)",
      private.sheet_bmi(l.height, l.weight) as "BMI Terakhir",
      private.sheet_bmi_category(private.sheet_bmi(l.height, l.weight), s) as "Kategori Terakhir",
      case
        when l.height is null or nullif(trim(st.gender), '') is null then null
        when (case when upper(trim(st.gender)) = 'P' then s.min_height_female else s.min_height_male end) is null
          then 'Isi standar di Parameter'
        when l.height >= (case when upper(trim(st.gender)) = 'P' then s.min_height_female else s.min_height_male end)
          then 'Memenuhi'
        else 'Tidak Memenuhi'
      end as "Syarat Tinggi Badan",
      st.bmi_note as "Catatan / Program Penyesuaian BB"
    from public.staff st
    left join public.settings s on s.id = 1
    left join last l on l.staff_code = st.code
    %2$s
    order by 1
  $v$, v_groups, (
    select coalesce(string_agg(pg_catalog.format(
      'left join public.bmi_checks c%1$s on c%1$s.staff_code = st.code and c%1$s.period = %1$s', g), ' '), '')
    from pg_catalog.generate_series(1, v_periods) as g));

  revoke all on all tables in schema sheet from public, anon, authenticated;
  grant select on all tables in schema sheet to service_role;
end;
$$;

revoke all on function private.rebuild_sheet_cek_bmi() from public, anon, authenticated;

create or replace function private.settings_rebuild_sheet_views()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.rebuild_sheet_cek_bmi();
  return null;
end;
$$;

revoke all on function private.settings_rebuild_sheet_views() from public, anon, authenticated;

drop trigger if exists settings_rebuild_sheet_views on public.settings;
create trigger settings_rebuild_sheet_views
  after update of bmi_periods on public.settings
  for each row when (old.bmi_periods is distinct from new.bmi_periods)
  execute function private.settings_rebuild_sheet_views();

select private.rebuild_sheet_cek_bmi();
