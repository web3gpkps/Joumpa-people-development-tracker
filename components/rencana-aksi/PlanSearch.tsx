"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Input } from "@/components/ui/Field";
import { toQuery, type QueryValue } from "@/lib/workspace/access";

type PlanSearchProps = {
  /** The page path (hrefs(access).rencanaAksi). */
  basePath: string;
  /** The other filters now in the URL, kept when the search changes. */
  query: Record<string, QueryValue>;
  /** ?q= now. */
  current: string;
};

const DELAY = 350;

/**
 * Text search kept in the URL (?q=), like the other filters: typing replaces the URL after a
 * short pause, so a reload or a shared address shows the same list.
 */
export function PlanSearch({ basePath, query, current }: PlanSearchProps) {
  const id = useId();
  const router = useRouter();
  const [text, setText] = useState(current);
  // "Hapus filter" (or back / forward) changes ?q= from outside: show the URL's value again.
  const [shownCurrent, setShownCurrent] = useState(current);
  if (current !== shownCurrent) {
    setShownCurrent(current);
    if (current !== text.trim()) setText(current);
  }
  const [pending, startTransition] = useTransition();
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  function go(value: string) {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    const q = value.trim();
    if (q === current) return;
    startTransition(() => router.replace(`${basePath}${toQuery({ ...query, q })}`, { scroll: false }));
  }

  return (
    <form
      role="search"
      className="flex min-w-0 flex-col gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        go(text);
      }}
    >
      <label htmlFor={id} className="section-label">
        Cari
      </label>
      <Input
        id={id}
        type="search"
        value={text}
        aria-busy={pending || undefined}
        placeholder="Tindakan, PIC, No, atau catatan"
        enterKeyHint="search"
        autoComplete="off"
        className="w-full sm:w-72"
        onChange={(event) => {
          const value = event.target.value;
          setText(value);
          if (timer.current !== null) window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => go(value), DELAY);
        }}
      />
    </form>
  );
}
