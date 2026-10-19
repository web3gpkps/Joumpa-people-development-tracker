"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { tabClasses } from "./tab-styles";

export type TabItem = {
  id: string;
  label: ReactNode;
  panel: ReactNode;
};

type TabsProps = {
  /** Accessible name of the tab list, e.g. "Tampilan performa". */
  label: string;
  items: TabItem[];
  /** Initially selected tab id. Defaults to the first item. */
  defaultTab?: string;
  /** Notified when the selection changes (e.g. to sync a ?tab= search param). */
  onChange?: (id: string) => void;
};

/**
 * In-page tabs (WAI-ARIA tabs pattern): arrow keys move between tabs, Home/End jump,
 * only the selected tab is in the Tab order. Client component.
 * When the tab should survive a reload or be linkable, use <TabNav> with real URLs instead.
 */
export function Tabs({ label, items, defaultTab, onChange }: TabsProps) {
  const baseId = useId();
  const [selected, setSelected] = useState(defaultTab ?? items[0]?.id);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function select(index: number) {
    const item = items[index];
    if (!item) return;
    setSelected(item.id);
    onChange?.(item.id);
    tabRefs.current[index]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = items.length - 1;
    let next: number | null = null;
    if (event.key === "ArrowRight") next = index === last ? 0 : index + 1;
    if (event.key === "ArrowLeft") next = index === 0 ? last : index - 1;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = last;
    if (next !== null) {
      event.preventDefault();
      select(next);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        role="tablist"
        aria-label={label}
        className="flex max-w-full gap-1 overflow-x-auto overflow-y-hidden border-b border-line"
      >
        {items.map((item, index) => {
          const isSelected = item.id === selected;
          return (
            <button
              key={item.id}
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${item.id}`}
              aria-controls={`${baseId}-panel-${item.id}`}
              aria-selected={isSelected}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => select(index)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={tabClasses(isSelected)}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      {items.map((item) => (
        <div
          key={item.id}
          role="tabpanel"
          id={`${baseId}-panel-${item.id}`}
          aria-labelledby={`${baseId}-tab-${item.id}`}
          hidden={item.id !== selected}
          tabIndex={0}
        >
          {item.panel}
        </div>
      ))}
    </div>
  );
}
