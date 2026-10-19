import { DataTable, Td, Th, Tr } from "@/components/ui/DataTable";
import { StatusChip } from "@/components/ui/StatusChip";
import { cx } from "@/components/ui/cx";
import type { PeriodSummary as Summary } from "./monthly-view";

function Count({ part, whole, tone }: { part: number; whole: number; tone?: "critical" | "warning" | "good" }) {
  // Nothing to count yet (e.g. no % Sesuai reported): a dash, never "0/0".
  if (whole === 0) return <span className="text-ink-muted">–</span>;
  return (
    <span className="tabular-nums">
      <span className={cx(tone === "critical" && part > 0 && "font-semibold text-critical", tone === "good" && whole > 0 && part === whole && "text-good")}>
        {part}
      </span>
      <span className="text-ink-muted">/{whole}</span>
    </span>
  );
}

/**
 * One line per period, oldest first: how many Cabang reported, on time, and at the ≥ 90% target.
 * "Capai target" counts only reports whose % Sesuai is known. Phones get one entry per period.
 */
export function PeriodSummary({ rows }: { rows: Summary[] }) {
  return (
    <>
      <div className="hidden md:block">
        <DataTable caption="Ringkasan per periode" stickyHeader={false} minWidth="760px">
          <thead>
            <tr>
              <Th>Periode</Th>
              <Th numeric>Diterima</Th>
              <Th numeric>Tepat waktu</Th>
              <Th numeric>Terlambat</Th>
              <Th numeric>Capai target ≥ 90%</Th>
              <Th numeric>Keluhan</Th>
              <Th numeric>Belum semua direspons</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <Tr key={s.period}>
                <Th scope="row" className="font-semibold whitespace-nowrap text-ink">
                  {s.label}
                </Th>
                <Td numeric>
                  <Count part={s.received} whole={s.reports} tone="good" />
                </Td>
                <Td numeric>
                  <Count part={s.onTime} whole={s.reports} tone="good" />
                </Td>
                <Td numeric>
                  <Count part={s.late} whole={s.reports} tone="critical" />
                </Td>
                <Td numeric>
                  <Count part={s.targetMet} whole={s.measured} tone="good" />
                </Td>
                <Td numeric className={cx(s.complaints > 0 && "font-semibold text-critical")}>{s.complaints}</Td>
                <Td numeric className={cx(s.unresponded > 0 && "font-semibold text-warning")}>{s.unresponded}</Td>
              </Tr>
            ))}
          </tbody>
        </DataTable>
      </div>

      <ul className="flex flex-col divide-y divide-line md:hidden" aria-label="Ringkasan per periode">
        {rows.map((s) => (
          <li key={s.period} className="flex flex-col gap-1.5 px-4 py-3">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-sm font-semibold text-ink">{s.label}</span>
              {s.late > 0 ? <StatusChip label={`${s.late} terlambat`} tone="critical" /> : null}
              {s.complaints > 0 ? <StatusChip label={`${s.complaints} keluhan`} tone="critical" /> : null}
            </span>
            <span className="text-sm text-ink-muted tabular-nums">
              Diterima {s.received}/{s.reports} · Tepat waktu {s.onTime}/{s.reports} · Capai target {s.targetMet}/{s.measured}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
