"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { DataTable, DataTableEmpty, Td, Th, Tr } from "@/components/ui/DataTable";
import { SaveStatus, type SaveState } from "@/components/ui/SaveStatus";
import { markConflictResolved } from "@/app/admin/sinkronisasi/actions";
import { formatWaktu } from "./format";
import { RESOLUTION_LABEL, TABLE_LABEL, columnLabel, jsonText } from "./sync-labels";

export type ConflictRow = {
  id: number;
  createdAt: string;
  tableName: string;
  rowKey: string | null;
  columnName: string | null;
  baseline: unknown;
  sheetValue: unknown;
  dbValue: unknown;
  resolution: string | null;
  resolvedAt: string | null;
};

type ConflictTableProps = {
  caption: string;
  rows: ConflictRow[];
  /** Open rows get "Tandai selesai"; reviewed rows show when they were reviewed. */
  mode: "open" | "resolved";
  emptyTitle: string;
};

function Value({ value }: { value: unknown }) {
  const text = jsonText(value);
  if (text === null) return <span className="text-ink-muted">kosong</span>;
  return <span className="wrap-break-word whitespace-pre-wrap">{text}</span>;
}

/** Sync conflicts, newest first; the first column holds the row identity and the action. */
export function ConflictTable({ caption, rows, mode, emptyTitle }: ConflictTableProps) {
  const [states, setStates] = useState<Record<number, SaveState>>({});
  const [, startTransition] = useTransition();
  const busy = Object.values(states).some((s) => s.status === "saving");

  function resolve(id: number) {
    setStates((s) => ({ ...s, [id]: { status: "saving" } }));
    startTransition(async () => {
      try {
        const result = await markConflictResolved(id);
        setStates((s) => ({
          ...s,
          [id]: result.ok ? { status: "saved", at: result.resolvedAt } : { status: "error", message: result.message },
        }));
      } catch {
        setStates((s) => ({ ...s, [id]: { status: "error", message: "Server tidak menjawab. Coba lagi." } }));
      }
    });
  }

  return (
    <DataTable caption={caption} minWidth="1120px">
      <thead>
        <tr>
          <Th className="w-56">Data</Th>
          <Th>Isian</Th>
          <Th>Di Google Sheet</Th>
          <Th>Di aplikasi</Th>
          <Th>Nilai sebelumnya</Th>
          <Th>Keputusan</Th>
          <Th>{mode === "open" ? "Dicatat" : "Ditinjau"}</Th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <DataTableEmpty colSpan={7} title={emptyTitle} />
        ) : (
          rows.map((r) => {
            const state = states[r.id] ?? { status: "idle" };
            return (
              <Tr key={r.id} selected={state.status === "saved"}>
                <Th scope="row" className="w-56 align-top font-normal">
                  <span className="block font-semibold text-ink">{TABLE_LABEL[r.tableName] ?? r.tableName}</span>
                  <span className="block text-sm whitespace-normal text-ink">
                    {r.rowKey ?? <span className="text-ink-muted">tanpa ID baris</span>}
                  </span>
                  {mode === "open" ? (
                    <span className="mt-2 flex flex-col items-start gap-1">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy || state.status === "saved"}
                        onClick={() => resolve(r.id)}
                        aria-label={`Tandai selesai: ${TABLE_LABEL[r.tableName] ?? r.tableName} ${r.rowKey ?? ""} ${r.columnName ?? ""}`}
                      >
                        {state.status === "saving" ? "Menyimpan…" : "Tandai selesai"}
                      </Button>
                      <SaveStatus state={state} />
                    </span>
                  ) : null}
                </Th>
                <Td className="align-top">
                  {r.columnName === null ? (
                    <span className="text-ink-muted">seluruh baris</span>
                  ) : (
                    columnLabel(r.tableName, r.columnName, r.rowKey)
                  )}
                </Td>
                <Td className="max-w-72 min-w-48 align-top">
                  <Value value={r.sheetValue} />
                </Td>
                <Td className="max-w-72 min-w-48 align-top">
                  <Value value={r.dbValue} />
                </Td>
                <Td className="max-w-72 min-w-40 align-top">
                  <Value value={r.baseline} />
                </Td>
                <Td className="min-w-56 align-top">
                  {r.resolution ? (RESOLUTION_LABEL[r.resolution] ?? "Lainnya") : <span className="text-ink-muted">–</span>}
                </Td>
                <Td className="tabular align-top whitespace-nowrap">
                  {formatWaktu(mode === "open" ? r.createdAt : r.resolvedAt)}
                </Td>
              </Tr>
            );
          })
        )}
      </tbody>
    </DataTable>
  );
}

/** Reviewed conflicts, hidden until asked for. */
export function ResolvedConflicts({ rows, count }: { rows: ConflictRow[]; count: number }) {
  const [shown, setShown] = useState(false);
  if (count === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Button variant="ghost" aria-expanded={shown} onClick={() => setShown((v) => !v)}>
          {shown ? "Sembunyikan yang sudah ditinjau" : `Tampilkan yang sudah ditinjau (${count})`}
        </Button>
      </div>
      {shown ? (
        <div className="rounded-panel border border-line bg-surface">
          <ConflictTable caption="Konflik yang sudah ditinjau" rows={rows} mode="resolved" emptyTitle="Belum ada" />
        </div>
      ) : null}
    </div>
  );
}
