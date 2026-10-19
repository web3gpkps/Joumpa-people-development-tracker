"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { Panel } from "@/components/ui/Panel";
import { addArea, deleteArea, moveArea, renameArea, type AreaResult } from "@/app/admin/pengaturan/area-actions";

export type AreaRow = { name: string; rows: number };

/**
 * The Rencana Aksi "Area" list: the dropdown every Cabang picks from and the rows of the
 * dashboard's "Progres rencana aksi per area". Owner only.
 */
export function AreasManager({ areas }: { areas: AreaRow[] }) {
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ name: string; value: string } | null>(null);
  const [message, setMessage] = useState<{ tone: "error" | "ok"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<AreaResult>, done: string, after?: () => void) {
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await action();
        if (result.ok) {
          after?.();
          setMessage({ tone: "ok", text: done });
        } else setMessage({ tone: "error", text: result.message });
      } catch {
        setMessage({ tone: "error", text: "Server tidak menjawab. Coba lagi." });
      }
    });
  }

  function submitNew(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    run(() => addArea(draft), "Area ditambahkan.", () => setDraft(""));
  }

  return (
    <Panel id="param-area" title="Area Rencana Aksi">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-muted">
          Pilihan kolom Area di Rencana Aksi, berurutan seperti di dashboard. Mengganti nama ikut mengubah semua baris
          yang memakainya. Area yang masih dipakai tidak bisa dihapus.
        </p>
        <ol className="flex flex-col divide-y divide-line rounded-control border border-line">
          {areas.map((area, i) => (
            <li key={area.name} className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
              {editing?.name === area.name ? (
                <form
                  className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-end"
                  onSubmit={(event) => {
                    event.preventDefault();
                    run(() => renameArea(area.name, editing.value), "Nama area diganti.", () => setEditing(null));
                  }}
                >
                  <Field label={`Nama baru untuk ${area.name}`} hideLabel className="flex-1">
                    <Input value={editing.value} maxLength={80} onChange={(e) => setEditing({ ...editing, value: e.target.value })} />
                  </Field>
                  <div className="flex gap-2">
                    <Button type="submit" size="sm" loading={pending} loadingText="Menyimpan…">
                      Simpan
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setEditing(null)}>
                      Batal
                    </Button>
                  </div>
                </form>
              ) : (
                <>
                  <p className="text-sm text-ink">
                    <span className="tabular-nums text-ink-muted">{i + 1}.</span> {area.name}
                    <span className="text-ink-muted"> · {area.rows} baris</span>
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={pending || i === 0}
                      aria-label={`Naikkan ${area.name}`}
                      onClick={() => run(() => moveArea(area.name, -1), "Urutan disimpan.")}
                    >
                      Naik
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={pending || i === areas.length - 1}
                      aria-label={`Turunkan ${area.name}`}
                      onClick={() => run(() => moveArea(area.name, 1), "Urutan disimpan.")}
                    >
                      Turun
                    </Button>
                    <Button size="sm" variant="secondary" disabled={pending} onClick={() => setEditing({ name: area.name, value: area.name })}>
                      Ganti nama
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={pending || area.rows > 0}
                      title={area.rows > 0 ? "Masih dipakai di Rencana Aksi" : undefined}
                      onClick={() => run(() => deleteArea(area.name), "Area dihapus.")}
                    >
                      Hapus
                    </Button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ol>
        <form onSubmit={submitNew} className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Field label="Area baru" className="flex-1">
            <Input value={draft} maxLength={80} onChange={(e) => setDraft(e.target.value)} placeholder="Misalnya Pelatihan SOP" />
          </Field>
          <Button type="submit" loading={pending} loadingText="Menambahkan…" disabled={draft.trim() === ""}>
            Tambah area
          </Button>
        </form>
        {message ? (
          <p role="status" className={message.tone === "error" ? "text-sm font-semibold text-critical" : "text-sm text-ink-muted"}>
            {message.text}
          </p>
        ) : null}
      </div>
    </Panel>
  );
}
