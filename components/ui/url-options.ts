/*
 * Plain data helpers for the URL-driven selects (UrlSelect, StationSelect, WeekSelect).
 * Not a client module, so server components can build options with them.
 */
import { formatTanggalPendek } from "@/lib/dates";
import { bmiCheckDate, weekStart, type Settings } from "@/lib/rules";

export type UrlOption = {
  /** Stable value, e.g. a station code, "semua", or a week number as text. */
  value: string;
  /** Visible text, e.g. "SUB (15 SDM)" or "Minggu ke-2 · 12 Okt". */
  label: string;
  /** Internal path built with hrefs(access).to(...), never user input. */
  href: string;
};

/** Value of the "Semua stasiun" option (a station code is never lower case). */
export const ALL_STATIONS = "semua";

/** Builds 1..count options: numberedOptions(10, (n) => `Minggu ke-${n}`, (n) => links.to("performa", { minggu: n })). */
export function numberedOptions(count: number, label: (n: number) => string, href: (n: number) => string): UrlOption[] {
  return Array.from({ length: count }, (_, i) => ({ value: String(i + 1), label: label(i + 1), href: href(i + 1) }));
}


/** "Minggu ke-2 · 19 Okt" for weeks 1..settings.weeks, for WeekSelect. */
export function weekOptions(settings: Settings, href: (week: number) => string): UrlOption[] {
  return numberedOptions(settings.weeks, (n) => `Minggu ke-${n} · ${formatTanggalPendek(weekStart(n, settings))}`, href);
}

/** "Periode 2 · 26 Okt" for BMI periods 1..settings.bmiPeriods, for WeekSelect. */
export function bmiPeriodOptions(settings: Settings, href: (period: number) => string): UrlOption[] {
  return numberedOptions(settings.bmiPeriods, (n) => `Periode ${n} · ${formatTanggalPendek(bmiCheckDate(n, settings))}`, href);
}
