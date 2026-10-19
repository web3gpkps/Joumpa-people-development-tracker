"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

export type RememberedParam = "stasiun" | "minggu" | "periode";

type RememberViewProps = {
  /** Storage namespace: the link's scope ("KPS", "SUB") or "owner". Never a token. */
  scope: string;
  /** Values this sheet accepts per param, e.g. { stasiun: ["SUB", …], minggu: ["1", …, "10"] }. */
  allowed: Partial<Record<RememberedParam, string[]>>;
  /** What the page shows now (from the URL or the default), so the effect runs on each navigation. */
  shown: Partial<Record<RememberedParam, string | null>>;
};

const ALL = "semua";
/** localStorage namespace for remembered views in this app. */
const PREFIX = "joumpa.view";

function jakartaDay(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
}

function read(key: string): { v: string; d: string } | null {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (parsed && typeof parsed === "object" && "v" in parsed && "d" in parsed) {
      const { v, d } = parsed as { v: unknown; d: unknown };
      if (typeof v === "string" && typeof d === "string") return { v, d };
    }
  } catch {
    // Unreadable or blocked storage: nothing remembered.
  }
  return null;
}

function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, JSON.stringify({ v: value, d: jakartaDay() }));
  } catch {
    // Storage blocked (private window): nothing is remembered, the page still works.
  }
}

/**
 * Remembers the last station filter, week and period per browser (docs/UX.md §4) and puts
 * them back when a sheet opens without them in its URL. The URL always wins. A week or
 * period is reused only on the day it was chosen, so the next day opens on the current one.
 * Renders nothing.
 */
export function RememberView({ scope, allowed, shown }: RememberViewProps) {
  const router = useRouter();
  const restored = useRef(false);
  const keyOf = (param: RememberedParam) => `${PREFIX}.${scope}.${param}`;

  // "Semua stasiun" has no URL param, so the station filter records each choice itself:
  // a link with data-remember-stasiun on click, the StationSelect select on change.
  useEffect(() => {
    if (!allowed.stasiun) return;
    const key = `${PREFIX}.${scope}.stasiun`;
    const onClick = (event: MouseEvent) => {
      const chip = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-remember-stasiun]");
      if (chip?.dataset.rememberStasiun) write(key, chip.dataset.rememberStasiun);
    };
    const onChange = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (target instanceof HTMLSelectElement && target.hasAttribute("data-remember-stasiun-select")) {
        write(key, target.value);
      }
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("change", onChange, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("change", onChange, true);
    };
  }, [scope, allowed.stasiun]);

  const signature = JSON.stringify(shown);
  useEffect(() => {
    const url = new URL(window.location.href);
    const restore: Array<[RememberedParam, string]> = [];
    for (const param of Object.keys(allowed) as RememberedParam[]) {
      const values = allowed[param] ?? [];
      const inUrl = url.searchParams.get(param);
      if (inUrl !== null) {
        const value = param === "stasiun" ? inUrl.toUpperCase() : inUrl;
        if (values.includes(value)) write(keyOf(param), value);
        continue;
      }
      const stored = read(keyOf(param));
      if (!stored || stored.v === ALL || !values.includes(stored.v)) continue;
      if (param !== "stasiun" && stored.d !== jakartaDay()) continue;
      if (shown[param] !== stored.v) restore.push([param, stored.v]);
    }
    if (restore.length === 0 || restored.current) return;
    restored.current = true;
    for (const [param, value] of restore) url.searchParams.set(param, value);
    router.replace(`${url.pathname}${url.search}${url.hash}`, { scroll: false });
    // keyOf only depends on scope; signature stands for `shown`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, scope, router]);

  return null;
}
