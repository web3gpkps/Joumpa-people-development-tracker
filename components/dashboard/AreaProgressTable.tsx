import { formatTanggal } from "@/lib/dates";
import { formatProgress } from "@/lib/format";
import type { AreaProgress } from "@/lib/pd-rules";
import { DataTable, DataTableEmpty, Td, Th, Tr } from "@/components/ui/DataTable";
import { StatusChip } from "@/components/ui/StatusChip";
import { Dash, Flagged, ShareBar } from "./cells";

/**
 * "Progres rencana aksi per area" (workbook Dashboard rows 20..31), in area order. An area
 * without rows shows dashes, not a 0% average. Phones get one stacked entry per area.
 */
export function AreaProgressTable({ rows }: { rows: AreaProgress[] }) {
  return (
    <>
      <div className="hidden md:block">
        <DataTable caption="Progres rencana aksi per area" stickyHeader={false} minWidth="920px">
          <thead>
            <tr>
              <Th numeric>No</Th>
              <Th>Area</Th>
              <Th numeric>Rencana aksi</Th>
              <Th numeric>Selesai</Th>
              <Th numeric>Proses</Th>
              <Th numeric>Belum mulai</Th>
              <Th numeric>Terlambat</Th>
              <Th numeric>Rata-rata progres (%)</Th>
              <Th numeric>Batas paling awal</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <DataTableEmpty colSpan={9} title="Belum ada area rencana aksi">
                Daftar area diatur oleh pengelola aplikasi.
              </DataTableEmpty>
            ) : (
              rows.map((r, i) => (
                <Tr key={r.area}>
                  <Td numeric className="w-12 text-ink-muted">
                    {i + 1}
                  </Td>
                  <Th scope="row" className="min-w-56 font-semibold whitespace-normal text-ink">
                    {r.area}
                  </Th>
                  <Td numeric>{r.rows}</Td>
                  <Td numeric>{r.done}</Td>
                  <Td numeric>{r.inProgress}</Td>
                  <Td numeric>{r.notStarted}</Td>
                  <Td numeric>
                    <Flagged n={r.late} />
                  </Td>
                  <Td numeric>
                    {r.rows ? (
                      <ShareBar percent={r.avgProgress} label={formatProgress(r.avgProgress)} />
                    ) : (
                      <Dash reason="belum ada rencana aksi" />
                    )}
                  </Td>
                  <Td numeric className="whitespace-nowrap">
                    {r.earliestDue ? formatTanggal(r.earliestDue) : <Dash reason="tanpa batas waktu" />}
                  </Td>
                </Tr>
              ))
            )}
          </tbody>
        </DataTable>
      </div>

      <ol className="flex flex-col divide-y divide-line md:hidden" aria-label="Progres rencana aksi per area">
        {rows.map((r, i) => (
          <li key={r.area} className="flex flex-col gap-2 px-4 py-3">
            <div className="flex items-start gap-3">
              <span className="w-5 shrink-0 pt-px text-right text-sm tabular-nums text-ink-muted">{i + 1}</span>
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-semibold text-ink">{r.area}</span>
                  {r.late > 0 ? <StatusChip label={`${r.late} terlambat`} tone="critical" /> : null}
                </span>
                {r.rows ? (
                  <>
                    <span className="text-sm text-ink-muted tabular-nums">
                      {r.rows} baris · Selesai {r.done} · Proses {r.inProgress} · Belum mulai {r.notStarted}
                    </span>
                    <span className="flex items-center gap-3 text-sm text-ink-muted tabular-nums">
                      <span className="block h-1 flex-1 overflow-hidden rounded-full bg-neutral-tint" aria-hidden="true">
                        <span className="block h-full rounded-full bg-brand" style={{ width: `${Math.min(100, r.avgProgress)}%` }} />
                      </span>
                      <span>
                        Rata-rata {formatProgress(r.avgProgress)}
                        {r.earliestDue ? ` · batas ${formatTanggal(r.earliestDue)}` : ""}
                      </span>
                    </span>
                  </>
                ) : (
                  <span className="text-sm text-ink-muted">Belum ada rencana aksi</span>
                )}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}
