"use client";

import { useEffect, useId, useRef, useState, useTransition, type FormEvent, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/Button";
import { DataTable, DataTableEmpty, Td, Th, Tr } from "@/components/ui/DataTable";
import { Dialog, DialogActions } from "@/components/ui/Dialog";
import { Field, Input, Select } from "@/components/ui/Field";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { StatusChip } from "@/components/ui/StatusChip";
import { CopyFeedback, CopyLinkField, copyText } from "./CopyLinkField";
import { formatWaktu } from "./format";
import { createShareLink, revokeShareLink, rotateShareLink } from "./link-actions";
import { KPS_SCOPE, linkScopes, scopeDescription, scopeName, type LinkRow, type NewLink, type ScopeStation } from "./link-types";

type LinksManagerProps = {
  title: string;
  links: LinkRow[];
  /** public.stations in display order. */
  stations: ScopeStation[];
};

type Confirm = { mode: "revoke" | "rotate"; link: LinkRow } | null;

function scopeOption(scope: string): string {
  return scope === KPS_SCOPE ? "KPS (semua stasiun)" : `Stasiun ${scope}`;
}

function linkName(l: LinkRow): string {
  return `${l.scope}${l.label ? `, ${l.label}` : ""}`;
}

/**
 * Tautan Akses: one table of working links (Lingkup, Label, Terakhir dipakai, row menu),
 * "Buat tautan" in a dialog, the new URL shown once in its own dialog, revoked links
 * behind a toggle.
 */
export function LinksManager({ title, links, stations }: LinksManagerProps) {
  const scopes: readonly string[] = linkScopes(stations);
  const active = links.filter((l) => !l.revokedAt);
  const revoked = links.filter((l) => l.revokedAt);
  const stationScopes = scopes.filter((s) => s !== KPS_SCOPE);
  const withoutLink = stationScopes.filter((s) => !active.some((l) => l.scope === s && !l.isQa)).length;

  const [createOpen, setCreateOpen] = useState(false);
  const [createRound, setCreateRound] = useState(0);
  const [fresh, setFresh] = useState<NewLink | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState<{ id: string; state: "copied" | "manual" } | null>(null);
  const [showRevoked, setShowRevoked] = useState(false);
  const [confirming, startConfirm] = useTransition();

  function runConfirm() {
    if (!confirm) return;
    const { mode, link } = confirm;
    setConfirmError(null);
    startConfirm(async () => {
      try {
        const result = mode === "revoke" ? await revokeShareLink(link.id) : await rotateShareLink(link.id);
        if (!result.ok) {
          setConfirmError(result.message);
          return;
        }
        setConfirm(null);
        setNotice(result.message);
        if (result.link) setFresh(result.link);
      } catch {
        setConfirmError("Server tidak menjawab. Coba lagi.");
      }
    });
  }

  async function copy(l: LinkRow) {
    if (!l.url) return;
    const state = await copyText(l.url);
    setCopied({ id: l.id, state: state === "copied" ? "copied" : "manual" });
  }

  const meta =
    stationScopes.length === 0
      ? `${active.length} tautan aktif · belum ada stasiun`
      : `${active.length} tautan aktif · ${withoutLink} stasiun belum punya tautan`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={title}
        meta={meta}
        actions={
          <Button
            onClick={() => {
              setCreateRound((n) => n + 1);
              setCreateOpen(true);
            }}
          >
            Buat tautan
          </Button>
        }
      />

      <p role="status" aria-live="polite" className="text-sm font-semibold text-good empty:hidden">
        {notice}
      </p>

      <Panel padding="flush">
        <DataTable caption="Tautan aktif" minWidth="640px" stickyHeader={false}>
          <thead>
            <tr>
              <Th>Lingkup</Th>
              <Th>Label</Th>
              <Th>Terakhir dipakai</Th>
              <Th>
                <span className="sr-only">Aksi</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {active.length === 0 ? (
              <DataTableEmpty colSpan={4} title="Belum ada tautan aktif" />
            ) : (
              active.map((l) => (
                <Tr key={l.id}>
                  <Th scope="row">
                    <span className="station-code">{l.scope}</span>
                  </Th>
                  <Td className="min-w-48 whitespace-normal">
                    {l.label ?? <span className="text-ink-muted">Tanpa label</span>}
                    {l.isQa ? <StatusChip label="Uji" tone="warning" className="ml-2" /> : null}
                    {copied?.id === l.id ? (
                      copied.state === "copied" ? (
                        <CopyFeedback state="copied" className="block" />
                      ) : l.url ? (
                        <div className="mt-2 max-w-xl">
                          <CopyLinkField url={l.url} label={`Tautan ${l.scope} lengkap`} />
                        </div>
                      ) : null
                    ) : null}
                  </Td>
                  <Td className="tabular">
                    {formatWaktu(l.lastUsedAt) ?? <span className="text-ink-muted">Belum pernah</span>}
                  </Td>
                  <Td className="w-0">
                    <RowMenu
                      name={linkName(l)}
                      items={[
                        { label: "Salin tautan", onSelect: () => void copy(l) },
                        {
                          label: "Ganti tautan",
                          onSelect: () => {
                            setConfirmError(null);
                            setConfirm({ mode: "rotate", link: l });
                          },
                        },
                        {
                          label: "Cabut tautan",
                          onSelect: () => {
                            setConfirmError(null);
                            setConfirm({ mode: "revoke", link: l });
                          },
                        },
                      ]}
                    />
                  </Td>
                </Tr>
              ))
            )}
          </tbody>
        </DataTable>
      </Panel>

      {revoked.length > 0 ? (
        <div className="flex flex-col gap-3">
          <div>
            <Button variant="ghost" aria-expanded={showRevoked} onClick={() => setShowRevoked((v) => !v)}>
              {showRevoked ? "Sembunyikan tautan dicabut" : `Tampilkan tautan dicabut (${revoked.length})`}
            </Button>
          </div>
          {showRevoked ? (
            <Panel padding="flush">
              <DataTable caption="Tautan dicabut" minWidth="560px" stickyHeader={false}>
                <thead>
                  <tr>
                    <Th>Lingkup</Th>
                    <Th>Label</Th>
                    <Th>Dicabut</Th>
                  </tr>
                </thead>
                <tbody>
                  {revoked.map((l) => (
                    <Tr key={l.id}>
                      <Th scope="row">
                        <span className="station-code text-ink-muted">{l.scope}</span>
                      </Th>
                      <Td className="whitespace-normal text-ink-muted">{l.label ?? "Tanpa label"}</Td>
                      <Td className="tabular text-ink-muted">{formatWaktu(l.revokedAt)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </DataTable>
            </Panel>
          ) : null}
        </div>
      ) : null}

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} size="md" title="Buat tautan">
        {createOpen ? (
          <CreateForm
            key={createRound}
            scopes={scopes}
            stations={stations}
            onCancel={() => setCreateOpen(false)}
            onCreated={(link) => {
              setCreateOpen(false);
              setNotice(`Tautan ${link.scope} dibuat.`);
              setFresh(link);
            }}
          />
        ) : null}
      </Dialog>

      <Dialog
        open={fresh !== null}
        onClose={() => setFresh(null)}
        size="md"
        title={fresh ? `Tautan baru ${scopeName(fresh.scope)}` : "Tautan baru"}
        description="Siapa pun yang memegang tautan ini bisa mengubah data tanpa login. Kirim lewat pesan pribadi."
        footer={
          <Button variant="secondary" onClick={() => setFresh(null)}>
            Selesai
          </Button>
        }
      >
        {fresh ? <CopyLinkField url={fresh.url} label={`Tautan baru ${fresh.scope}`} /> : null}
      </Dialog>

      <Dialog
        open={confirm !== null}
        onClose={() => {
          if (!confirming) setConfirm(null);
        }}
        dismissible={!confirming}
        title={
          confirm ? (confirm.mode === "revoke" ? `Cabut tautan ${confirm.link.scope}?` : `Ganti tautan ${confirm.link.scope}?`) : ""
        }
        description={confirm?.link.label ?? undefined}
        footer={
          confirm ? (
            <>
              <Button variant="secondary" onClick={() => setConfirm(null)} disabled={confirming}>
                Batal
              </Button>
              {confirm.mode === "revoke" ? (
                <Button variant="danger" onClick={runConfirm} loading={confirming} loadingText="Mencabut…">
                  Cabut tautan
                </Button>
              ) : (
                <Button onClick={runConfirm} loading={confirming} loadingText="Mengganti…">
                  Ganti tautan
                </Button>
              )}
            </>
          ) : null
        }
      >
        {confirm ? (
          <div className="flex flex-col gap-2">
            <p>
              {confirm.mode === "revoke"
                ? "Tautan ini langsung tidak berlaku. Data yang sudah diisi tetap tersimpan."
                : "Tautan lama langsung tidak berlaku. Kirim tautan baru ke pemegangnya."}
            </p>
            {confirmError ? (
              <p role="alert" className="font-semibold text-critical">
                {confirmError}
              </p>
            ) : null}
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}

function CreateForm({
  scopes,
  stations,
  onCancel,
  onCreated,
}: {
  scopes: readonly string[];
  stations: readonly ScopeStation[];
  onCancel: () => void;
  onCreated: (link: NewLink) => void;
}) {
  const [scope, setScope] = useState("");
  const [label, setLabel] = useState("");
  const [errors, setErrors] = useState<{ scope?: string; label?: string }>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    const next: { scope?: string; label?: string } = {};
    if (!scopes.includes(scope)) next.scope = "Pilih lingkup tautan.";
    if (label.trim() === "") next.label = "Isi label, misalnya nama pemegang tautan.";
    setErrors(next);
    if (next.scope || next.label) return;
    startTransition(async () => {
      try {
        const result = await createShareLink(scope, label);
        if (result.ok && result.link) onCreated(result.link);
        else if (!result.ok) {
          setErrors(result.fieldErrors ?? {});
          setMessage(result.message);
        }
      } catch {
        setMessage("Server tidak menjawab. Coba lagi.");
      }
    });
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <Field label="Lingkup" help={scope ? scopeDescription(scope, stations) : undefined} error={errors.scope} required>
        <Select value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="">Pilih lingkup</option>
          {scopes.map((s) => (
            <option key={s} value={s}>
              {scopeOption(s)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Label" help="Nama atau jabatan pemegang, maksimal 80 karakter" error={errors.label} required>
        <Input value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} autoComplete="off" />
      </Field>
      {message ? (
        <p role="alert" className="text-sm font-semibold text-critical">
          {message}
        </p>
      ) : null}
      <DialogActions>
        <Button variant="secondary" onClick={onCancel} disabled={pending}>
          Batal
        </Button>
        <Button type="submit" loading={pending} loadingText="Membuat tautan…">
          Buat tautan
        </Button>
      </DialogActions>
    </form>
  );
}

type MenuItem = { label: string; onSelect: () => void };

/**
 * "Aksi" button with a small menu of row actions. The menu is fixed-positioned so the
 * table's scroll box never clips it; Escape, a click elsewhere or scrolling closes it.
 */
function RowMenu({ name, items }: { name: string; items: MenuItem[] }) {
  const [position, setPosition] = useState<{ top: number; right: number } | null>(null);
  const open = position !== null;
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const close = () => setPosition(null);
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  function toggle() {
    if (open) {
      setPosition(null);
      return;
    }
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) setPosition({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
  }

  function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const list = [...(rootRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const i = list.indexOf(document.activeElement as HTMLElement);
    const next = event.key === "ArrowDown" ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
    list[next]?.focus();
  }

  return (
    <div ref={rootRef}>
      <Button
        ref={buttonRef}
        size="sm"
        variant="secondary"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={toggle}
      >
        Aksi<span className="sr-only"> tautan {name}</span>
      </Button>
      {position ? (
        <div
          id={menuId}
          role="menu"
          aria-label={`Aksi tautan ${name}`}
          onKeyDown={moveFocus}
          style={{ top: position.top, right: position.right }}
          className="fixed z-30 flex min-w-44 flex-col rounded-control border border-line bg-surface py-1 shadow-float"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="min-h-11 px-3 text-left text-sm text-ink hover:bg-bg focus-visible:bg-bg lg:min-h-9"
              onClick={() => {
                setPosition(null);
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
