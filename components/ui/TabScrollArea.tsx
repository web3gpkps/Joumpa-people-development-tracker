"use client";

import { useEffect, useRef, type ReactNode } from "react";

type TabScrollAreaProps = {
  label: string;
  className?: string;
  children: ReactNode;
};

/**
 * The <nav> around TabNav's links. When the tabs overflow (phones), it scrolls the
 * current tab (aria-current="page") to the middle of the row. Only the row scrolls,
 * never the page.
 */
export function TabScrollArea({ label, className, children }: TabScrollAreaProps) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const nav = ref.current;
    const current = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !current || nav.scrollWidth <= nav.clientWidth) return;
    const offset = current.getBoundingClientRect().left - nav.getBoundingClientRect().left;
    nav.scrollLeft += offset - (nav.clientWidth - current.offsetWidth) / 2;
  });

  return (
    <nav ref={ref} aria-label={label} className={className}>
      {children}
    </nav>
  );
}
