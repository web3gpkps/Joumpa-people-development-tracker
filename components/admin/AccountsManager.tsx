"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { DataTable, DataTableEmpty, Td, Th, Tr } from "@/components/ui/DataTable";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Select } from "@/components/ui/Field";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Tabs } from "@/components/ui/Tabs";
import { branchLabel } from "@/lib/accounts/rules";
import { deleteAccount, updateAccount } from "./account-actions";
import {
  TAB_LABEL,
  TAB_ORDER,
  accountCounts,
  approvalBranch,
  defaultTab,
  matchesSearch,
  needsBranch,
  rowsForTab,
  type AccountRow,
  type AccountTab,
} from "./account-view";
import { formatWaktu } from "./format";

type Props = {
  title: string;
  accounts: AccountRow[];
  /** "KPS" first, then the stations from public.stations. */
  branches: string[];
};

type Feedback = { tone: "ok" | "error"; text: string } | null;

const EMPTY_COPY: Record<AccountTab, string> = {
  pending: "Tidak ada akun yang menunggu persetujuan.",
  active: "Belum ada akun cabang yang aktif.",
  inactive: "Tidak ada akun yang dinonaktifkan.",
};

/**
 * Akun Cabang: the owner approves, deactivates, moves or removes the accounts people registered.
 * Waiting accounts open first. The branch is chosen per row (an unassigned sign-up must get one
 * before it can be approved); every change goes through a Server Action that re-checks the owner.
 */
export function AccountsManager({ title, accounts, branches }: Props) {
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [removing, setRemoving] = useState<AccountRow | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [removePending, startRemove] = useTransition();

  const visible = accounts.filter((row) => matchesSearch(row, query));
  const counts = accountCounts(accounts);

  function run(row: AccountRow, input: { status?: string; branch?: string }) {
    setFeedback(null);
    setBusyId(row.id);
    startTransition(async () => {
      try {
        const result = await updateAccount({ id: row.id, ...input });
        setFeedback({ tone: result.ok ? "ok" : "error", text: result.message });
        if (result.ok) setChosen((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => id !== row.id)));
      } catch {
        setFeedback({ tone: "error", text: "Server tidak menjawab. Coba lagi." });
      } finally {
        setBusyId(null);
      }
    });
  }

  function confirmRemove() {
    if (!removing) return;
    const row = removing;
    setRemoveError(null);
    startRemove(async () => {
      try {
        const result = await deleteAccount(row.id);
        if (!result.ok) {
          setRemoveError(result.message);
          return;
        }
        setRemoving(null);
        setFeedback({ tone: "ok", text: result.message });
      } catch {
        setRemoveError("Server tidak menjawab. Coba lagi.");
      }
    });
  }

  function panel(tab: AccountTab) {
    const rows = rowsForTab(visible, tab);
    return (
      <Panel padding="flush">
        <DataTable caption={`Akun ${TAB_LABEL[tab].toLowerCase()}`} minWidth="860px" stickyHeader={false} stickyFirstColumn={false}>
          <thead>
            <tr>
              <Th>Akun</Th>
              <Th>Cabang</Th>
              <Th>{tab === "pending" ? "Mendaftar" : "Diputuskan"}</Th>
              <Th>
                <span className="sr-only">Aksi</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <DataTableEmpty colSpan={4} title={query.trim() ? "Tidak ada akun yang cocok dengan pencarian" : EMPTY_COPY[tab]} />
            ) : (
              rows.map((row) => {
                const value = chosen[row.id] ?? (needsBranch(row) ? "" : row.branchCode);
                const branch = approvalBranch(row, chosen[row.id]);
                const busy = busyId === row.id;
                const moved = branch !== null && branch !== row.branchCode;
                return (
                  <Tr key={row.id}>
                    <Td className="min-w-56 whitespace-normal">
                      <span className="block font-semibold text-ink">{row.fullName || "Tanpa nama"}</span>
                      <span className="block break-all text-ink-muted">{row.email}</span>
                    </Td>
                    <Td className="w-56">
                      <Select
                        aria-label={`Cabang untuk ${row.fullName || row.email}`}
                        value={value}
                        disabled={busy}
                        onChange={(event) => setChosen((prev) => ({ ...prev, [row.id]: event.target.value }))}
                      >
                        {needsBranch(row) || value === "" ? <option value="">Pilih cabang</option> : null}
                        {branches.map((code) => (
                          <option key={code} value={code}>
                            {branchLabel(code)}
                          </option>
                        ))}
                      </Select>
                      {needsBranch(row) ? (
                        <span className="mt-1 block text-xs text-ink-muted">
                          Pendaftar belum memilih cabang yang valid.
                        </span>
                      ) : null}
                    </Td>
                    <Td className="tabular">
                      {formatWaktu(tab === "pending" ? row.createdAt : (row.decidedAt ?? row.createdAt))}
                    </Td>
                    <Td className="w-0">
                      <div className="flex flex-wrap justify-end gap-2">
                        {tab === "pending" ? (
                          <>
                            <Button
                              size="sm"
                              disabled={branch === null}
                              loading={busy}
                              loadingText="Menyimpan…"
                              onClick={() => run(row, { status: "active", branch: branch ?? undefined })}
                            >
                              Setujui
                            </Button>
                            <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(row, { status: "inactive" })}>
                              Tolak
                            </Button>
                          </>
                        ) : null}
                        {tab === "active" ? (
                          <>
                            {moved ? (
                              <Button size="sm" loading={busy} loadingText="Menyimpan…" onClick={() => run(row, { branch: branch! })}>
                                Simpan cabang
                              </Button>
                            ) : null}
                            <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(row, { status: "inactive" })}>
                              Nonaktifkan
                            </Button>
                          </>
                        ) : null}
                        {tab === "inactive" ? (
                          <Button
                            size="sm"
                            disabled={branch === null}
                            loading={busy}
                            loadingText="Menyimpan…"
                            onClick={() => run(row, { status: "active", branch: branch ?? undefined })}
                          >
                            Aktifkan lagi
                          </Button>
                        ) : null}
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => {
                            setRemoveError(null);
                            setRemoving(row);
                          }}
                        >
                          Hapus
                        </Button>
                      </div>
                    </Td>
                  </Tr>
                );
              })
            )}
          </tbody>
        </DataTable>
      </Panel>
    );
  }

  const meta =
    counts.pending > 0
      ? `${counts.pending} akun menunggu persetujuan · ${counts.active} aktif`
      : `${counts.active} akun aktif · tidak ada yang menunggu`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={title} meta={meta} />

      <p
        role={feedback?.tone === "error" ? "alert" : "status"}
        aria-live="polite"
        className={`text-sm font-semibold empty:hidden ${feedback?.tone === "error" ? "text-critical" : "text-good"}`}
      >
        {feedback?.text}
      </p>

      <div className="max-w-sm">
        <Field label="Cari akun">
          <Input
            type="search"
            value={query}
            placeholder="Nama, email atau cabang"
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
          />
        </Field>
      </div>

      <Tabs
        label="Status akun"
        defaultTab={defaultTab(accounts)}
        items={TAB_ORDER.map((tab) => ({
          id: tab,
          label: `${TAB_LABEL[tab]} (${rowsForTab(visible, tab).length})`,
          panel: panel(tab),
        }))}
      />

      <Dialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        dismissible={!removePending}
        title={removing ? `Hapus akun ${removing.fullName || removing.email}?` : "Hapus akun?"}
        description="Akun dan loginnya dihapus. Data yang pernah diisi akun ini tetap ada. Untuk menghentikan akses saja, pakai Nonaktifkan."
        footer={
          <>
            <Button variant="secondary" disabled={removePending} onClick={() => setRemoving(null)}>
              Batal
            </Button>
            <Button variant="danger" loading={removePending} loadingText="Menghapus…" onClick={confirmRemove}>
              Hapus akun
            </Button>
          </>
        }
      >
        {removeError ? (
          <p role="alert" className="text-sm font-semibold text-critical">
            {removeError}
          </p>
        ) : null}
      </Dialog>
    </div>
  );
}
