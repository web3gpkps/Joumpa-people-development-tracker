import { useState } from "react";

/**
 * Keeps the order rows had when the list first rendered, so a row does not jump away
 * while someone is entering data (a save refreshes the server data, which is sorted
 * due/late first). Rows that appear later go to the end. Remount (key) to re-sort.
 */
export function useStableOrder<T>(rows: readonly T[], key: (row: T) => string): T[] {
  const [first] = useState(() => new Map(rows.map((r, i) => [key(r), i] as const)));
  const indexed = rows.map((row, i) => ({ row, i, at: first.get(key(row)) }));
  return indexed
    .sort((a, b) => (a.at ?? first.size + a.i) - (b.at ?? first.size + b.i))
    .map((x) => x.row);
}
