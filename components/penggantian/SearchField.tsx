"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { toQuery, type QueryValue } from "@/lib/workspace/access";
import { Input } from "@/components/ui/Field";

type SearchFieldProps = {
  /** The page path, e.g. hrefs(access).penggantian. */
  path: string;
  /** The other filters to keep in the URL. */
  query: Record<string, QueryValue>;
  /** Current ?cari= value. */
  current: string;
  param?: string;
  placeholder?: string;
};

/**
 * Search that lives in the URL (?cari=), like the selects next to it: typing replaces the URL a
 * moment after the last key, Enter at once. Client component.
 */
export function SearchField({ path, query, current, param = "cari", placeholder = "Nama, ID SDM atau pengganti" }: SearchFieldProps) {
  const id = useId();
  const router = useRouter();
  const [value, setValue] = useState(current);
  const [pending, startTransition] = useTransition();
  const timer = useRef<number | undefined>(undefined);

  // Back/forward or a "Hapus filter" link changes the URL: follow it.
  const [shown, setShown] = useState(current);
  if (shown !== current) {
    setShown(current);
    setValue(current);
  }

  useEffect(() => () => window.clearTimeout(timer.current), []);

  function go(text: string) {
    window.clearTimeout(timer.current);
    const href = `${path}${toQuery({ ...query, [param]: text.trim() || null })}`;
    startTransition(() => router.replace(href, { scroll: false }));
  }

  return (
    <form
      role="search"
      className="flex basis-full flex-col gap-1 sm:basis-auto"
      data-print="hide"
      onSubmit={(event) => {
        event.preventDefault();
        go(value);
      }}
    >
      <label htmlFor={id} className="section-label">
        Cari
      </label>
      <Input
        id={id}
        type="search"
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        maxLength={100}
        aria-busy={pending || undefined}
        className="w-full sm:w-64"
        onChange={(event) => {
          const next = event.target.value;
          setValue(next);
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => go(next), 350);
        }}
      />
    </form>
  );
}
