"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";

type CopyState = "idle" | "copied" | "manual";

/** Copies text; when the browser refuses, selects `fallback` so Ctrl+C / long-press still works. */
export async function copyText(text: string, fallback?: HTMLInputElement | null): Promise<CopyState> {
  try {
    if (!navigator.clipboard) throw new Error("clipboard unavailable");
    await navigator.clipboard.writeText(text);
    return "copied";
  } catch {
    if (fallback) {
      fallback.focus();
      fallback.select();
    }
    return "manual";
  }
}

export function CopyFeedback({ state, className }: { state: CopyState; className?: string }) {
  return (
    <span role="status" aria-live="polite" className={cx("text-sm font-semibold", className)}>
      {state === "copied" ? <span className="text-good">Tersalin</span> : null}
      {state === "manual" ? (
        <span className="text-warning">Browser menolak menyalin otomatis. Teks tautan sudah dipilih: tekan Ctrl+C.</span>
      ) : null}
    </span>
  );
}

type CopyLinkFieldProps = {
  url: string;
  /** Accessible name of the read-only field, e.g. "Tautan baru SUB". */
  label: string;
};

/** Full URL in a read-only field plus "Salin tautan" with visible "Tersalin" feedback. */
export function CopyLinkField({ url, label }: CopyLinkFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<CopyState>("idle");

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          ref={inputRef}
          readOnly
          value={url}
          aria-label={label}
          onFocus={(e) => e.currentTarget.select()}
          className="block min-h-11 w-full min-w-0 rounded-control border border-line-strong bg-surface px-3 text-sm text-ink sm:min-h-10"
        />
        <Button className="shrink-0" onClick={async () => setState(await copyText(url, inputRef.current))}>
          Salin tautan
        </Button>
      </div>
      <CopyFeedback state={state} />
    </div>
  );
}
