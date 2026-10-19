import Link from "next/link";
import type { ReactNode } from "react";
import { TabScrollArea } from "./TabScrollArea";
import { tabClasses } from "./tab-styles";

export type TabNavItem = {
  href: string;
  label: ReactNode;
};

type TabNavProps = {
  /** Accessible name, e.g. "Tampilan performa". */
  label: string;
  items: TabNavItem[];
  /** href of the current view. The caller decides (from params/searchParams), so this stays a server component. */
  currentHref: string;
};

/**
 * Tabs that are real links (?tab=rekap or sub-routes): linkable, survive reloads,
 * work without JavaScript. Marked up as navigation with aria-current, not role="tab".
 * Server-component friendly; on phones the row scrolls the current tab into view.
 */
export function TabNav({ label, items, currentHref }: TabNavProps) {
  return (
    <TabScrollArea label={label} className="max-w-full overflow-x-auto">
      {/* The border sits on the list, so the tabs' 2 px underline overlaps it without overflowing the scroll box. */}
      <ul className="flex w-max min-w-full gap-1 border-b border-line">
        {items.map((item) => {
          const isCurrent = item.href === currentHref;
          return (
            <li key={item.href} className="shrink-0">
              <Link
                href={item.href}
                aria-current={isCurrent ? "page" : undefined}
                className={tabClasses(isCurrent)}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </TabScrollArea>
  );
}
