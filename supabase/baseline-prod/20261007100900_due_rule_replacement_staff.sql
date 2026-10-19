-- SPEC additions (accepted by lead):
--   action_items.due_rule   rolling due-date rule for items whose workbook due date is computed
--                           from TODAY(); lib/rules.ts effectiveDueDate prefers it over due_date.
--   replacements.staff_code optional link to the staff record (replaced_name stays NOT NULL for
--                           people not in the roster).
-- Columns only: existing RLS policies and grants on both tables cover them unchanged.

alter table public.action_items
  add column due_rule text,
  add constraint action_items_due_rule_check
    check (due_rule in ('bulanan-tgl-5', 'cek-bmi-berikutnya', 'jumat-berikutnya'));

alter table public.replacements
  add column staff_code text references public.staff (code) on delete set null on update cascade;

create index replacements_staff_code_idx on public.replacements (staff_code);
