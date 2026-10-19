import Link from "next/link";
import { formatRatio } from "@/lib/format";
import type { GroupProgress } from "@/lib/pd-rules";
import type { SheetLinks } from "@/lib/workspace/access";
import { DataTable, Td, Th, Tr } from "@/components/ui/DataTable";
import { StatusChip } from "@/components/ui/StatusChip";
import { Flagged, ShareBar } from "./cells";

type GroupProgressTableProps = {
  /** One row per Cabang, in station order. */
  rows: GroupProgress[];
  total: GroupProgress;
  links: SheetLinks;
};

function Cells({ row }: { row: GroupProgress }) {
  return (
    <>
      <Td numeric>{row.totalStaff}</Td>
      <Td numeric>{row.proposedReplacement}</Td>
      <Td numeric>{row.replacementDone}</Td>
      <Td numeric>{row.intensive}</Td>
      <Td numeric>{row.reassessed}</Td>
      <Td numeric>{row.compliant}</Td>
      <Td numeric>
        <Flagged n={row.notCompliant} />
      </Td>
      <Td numeric>{row.guidance}</Td>
      <Td numeric>{row.completed}</Td>
      <Td numeric>
        <ShareBar percent={row.completedShare * 100} label={formatRatio(row.completedShare)} tone="good" />
      </Td>
      <Td numeric>
        <Flagged n={row.late} />
      </Td>
    </>
  );
}

/** The table's figures as label / value pairs, two columns, under each Cabang on a phone. */
function PhoneFacts({ row }: { row: GroupProgress }) {
  const facts: Array<[string, string]> = [
    ["Total staf", String(row.totalStaff)],
    ["Usulan ganti", String(row.proposedReplacement)],
    ["Ganti selesai", String(row.replacementDone)],
    ["Coaching intensif", String(row.intensive)],
    ["Dinilai ulang", String(row.reassessed)],
    ["Sesuai", String(row.compliant)],
    ["Pembinaan", String(row.guidance)],
    ["Staf tuntas", `${row.completed} (${formatRatio(row.completedShare)})`],
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
      {facts.map(([label, value]) => (
        <div key={label} className="flex min-w-0 justify-between gap-2">
          <dt className="text-ink-muted">{label}</dt>
          <dd className="tabular-nums text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function PhoneChips({ row }: { row: GroupProgress }) {
  return (
    <>
      {row.late > 0 ? <StatusChip label={`${row.late} terlambat`} tone="critical" /> : null}
      {row.notCompliant > 0 ? <StatusChip label={`${row.notCompliant} Tidak Sesuai`} tone="critical" /> : null}
    </>
  );
}

/**
 * "Progres per cabang" (workbook Dashboard rows 10..15): one row per Cabang plus the total. The
 * Cabang name opens Tracker Staf filtered to it. Phones get the same figures stacked per Cabang.
 */
export function GroupProgressTable({ rows, total, links }: GroupProgressTableProps) {
  return (
    <>
      <div className="hidden md:block">
        <DataTable caption="Progres per cabang" stickyHeader={false} minWidth="1040px">
          <thead>
            <tr>
              <Th>Cabang</Th>
              <Th numeric>Total staf</Th>
              <Th numeric>Usulan ganti</Th>
              <Th numeric>Ganti selesai</Th>
              <Th numeric>Coaching intensif</Th>
              <Th numeric>Dinilai ulang</Th>
              <Th numeric>Sesuai</Th>
              <Th numeric>Tidak Sesuai</Th>
              <Th numeric>Pembinaan</Th>
              <Th numeric>Staf tuntas</Th>
              <Th numeric>% tuntas</Th>
              <Th numeric>Terlambat</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Tr key={r.group}>
                <Th scope="row">
                  <Link
                    href={links.to("trackerStaf", { cabang: r.group })}
                    className="station-code whitespace-nowrap text-brand underline decoration-line-strong underline-offset-2 hover:decoration-brand"
                  >
                    {r.group}
                  </Link>
                </Th>
                <Cells row={r} />
              </Tr>
            ))}
            <Tr className="font-semibold [&>*]:bg-surface-sunken">
              <Th scope="row">Total</Th>
              <Cells row={total} />
            </Tr>
          </tbody>
        </DataTable>
      </div>

      <ul className="flex flex-col divide-y divide-line md:hidden" aria-label="Progres per cabang">
        {rows.map((r) => (
          <li key={r.group}>
            <Link
              href={links.to("trackerStaf", { cabang: r.group })}
              className="flex min-h-12 flex-col gap-2 px-4 py-3 transition-colors duration-120 hover:bg-bg"
            >
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="station-code text-sm text-brand">{r.group}</span>
                <PhoneChips row={r} />
              </span>
              <PhoneFacts row={r} />
            </Link>
          </li>
        ))}
        <li className="flex flex-col gap-2 bg-surface-sunken px-4 py-3">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-semibold text-ink">Total</span>
            <PhoneChips row={total} />
          </span>
          <PhoneFacts row={total} />
        </li>
      </ul>
    </>
  );
}
