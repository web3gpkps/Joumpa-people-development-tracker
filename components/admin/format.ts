/** Owner-area display helpers: timestamps as people in Jakarta read them. */
import { formatJam, formatTanggal, toIsoDate } from "@/lib/dates";

/** `8 Okt 2026, 14.05` (WIB). Null or unparsable → null. */
export function formatWaktu(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${formatTanggal(toIsoDate(date))}, ${formatJam(date)}`;
}

/** `3 menit lalu`, `2 jam lalu`, `5 hari lalu` relative to `now`; future times say `dalam …`. */
export function formatRelatif(value: string | null | undefined, now: Date): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const seconds = Math.round((now.getTime() - date.getTime()) / 1000);
  const abs = Math.abs(seconds);
  let text: string;
  if (abs < 60) text = `${abs} detik`;
  else if (abs < 3600) text = `${Math.floor(abs / 60)} menit`;
  else if (abs < 86_400) text = `${Math.floor(abs / 3600)} jam`;
  else text = `${Math.floor(abs / 86_400)} hari`;
  return seconds >= 0 ? `${text} lalu` : `dalam ${text}`;
}
