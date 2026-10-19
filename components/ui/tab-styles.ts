import { cx } from "./cx";

/** Shared look for Tabs and TabNav: ink text, 2 px --brand underline on the selected one. */
export function tabClasses(isSelected: boolean): string {
  return cx(
    "-mb-px inline-flex min-h-11 shrink-0 items-center border-b-2 px-3 text-sm font-semibold whitespace-nowrap",
    "transition-colors duration-120",
    isSelected
      ? "border-brand text-ink"
      : "border-transparent text-ink-muted hover:border-line-strong hover:text-ink",
  );
}
