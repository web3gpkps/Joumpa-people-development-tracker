"use client";

import { useDeferredValue, useState } from "react";
import { formatTanggal } from "@/lib/dates";
import { formatScore } from "@/lib/format";
import { reassessResult, staffFlag } from "@/lib/pd-rules";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { EmptyState } from "@/components/ui/States";
import { StatusChip } from "@/components/ui/StatusChip";
import { type TrackerRow } from "./fields";
import { matchesSearch, needsDecision } from "./rows";

type TrackerCardsProps = {
  rows: TrackerRow[];
  today: string;
  emptyTitle: string;
  emptyHint: string;
  onOpen: (row: TrackerRow) => void;
};

function Chip({ label }: { label: string | null }) {
  return label ? <StatusChip label={label} /> : <span className="text-ink-muted">–</span>;
}

/**
 * Tracker Staf on phones (< 900 px): one card per person with Usulan, Flag, both action
 * statuses, the re-assessment and the decision; "Perbarui" opens every field.
 * A search box filters the cards by name or ID. Client component.
 */
export function TrackerCards({ rows, today, emptyTitle, emptyHint, onOpen }: TrackerCardsProps) {
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const shown = rows.filter((r) => matchesSearch(r, deferred));

  if (rows.length === 0) return <EmptyState title={emptyTitle}>{emptyHint}</EmptyState>;

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="section-label">Cari</span>
        <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nama atau ID" />
      </label>
      {shown.length === 0 ? (
        <EmptyState title={`Tidak ada staf yang cocok dengan “${deferred}”`} layout="inline">
          Ubah kata pencarian.
        </EmptyState>
      ) : (
        <ul className="rounded-panel border border-line bg-surface shadow-card">
          {shown.map((row) => {
            const flag = staffFlag(row, today);
            const result = reassessResult(row.reassessPractice);
            const due =
              [
                [row.mainDue, row.mainStatus],
                [row.extraDue, row.extraStatus],
              ]
                .filter(([d, status]) => d && status !== "Selesai" && status !== "Batal / N.A.")
                .map(([d]) => d as string)
                .sort()[0] ?? null;
            return (
              <li key={row.code} className="flex flex-col gap-3 border-b border-line px-4 py-4 last:border-b-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-base font-semibold text-ink">{row.name}</h3>
                    <p className="text-xs text-ink-muted">
                      <span className="tabular">{row.code}</span> · <span className="station-code">{row.station}</span>
                      {row.reportGroup ? ` · ${row.reportGroup}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Chip label={flag} />
                    {row.proposal ? <Chip label={row.proposal} /> : null}
                  </div>
                </div>

                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <div className="min-w-0">
                    <dt className="section-label">Tindakan utama</dt>
                    <dd>
                      <Chip label={row.mainStatus} />
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="section-label">Tindakan tambahan</dt>
                    <dd>
                      <Chip label={row.extraStatus} />
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="section-label">Praktik ulang</dt>
                    <dd className="tabular font-semibold">
                      {row.reassessPractice !== null ? formatScore(row.reassessPractice) : <span className="font-normal text-ink-muted">–</span>}
                      {row.reassessedOn ? (
                        <span className="font-normal text-ink-muted"> · {formatTanggal(row.reassessedOn)}</span>
                      ) : null}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="section-label">Hasil</dt>
                    <dd>
                      <Chip label={result} />
                    </dd>
                  </div>
                  <div className="col-span-2 min-w-0">
                    <dt className="section-label">Keputusan akhir</dt>
                    <dd>
                      {needsDecision(row) ? (
                        <span className="text-sm font-semibold text-warning">Belum diisi: usulan ganti, isi Diganti</span>
                      ) : (
                        <Chip label={row.finalDecision} />
                      )}
                    </dd>
                  </div>
                </dl>

                {due ? <p className="text-xs text-ink-muted">Batas tindakan terbuka terdekat: {formatTanggal(due)}</p> : null}
                <p className="text-xs text-ink-muted">{row.changedLabel}</p>

                <Button variant="secondary" onClick={() => onOpen(row)} className="self-start">
                  Perbarui<span className="sr-only"> {row.name}</span>
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
