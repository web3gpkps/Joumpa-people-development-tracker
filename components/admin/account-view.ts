/*
 * Pure helpers for the owner's account approval page (Akun Cabang): no React, no server code,
 * unit tested in account-view.test.ts.
 */
import { UNASSIGNED_BRANCH, type AccountStatus } from "@/lib/accounts/rules";

export type AccountRow = {
  id: string;
  email: string;
  fullName: string;
  /** A station code, "KPS", or "UNASSIGNED". */
  branchCode: string;
  status: AccountStatus;
  createdAt: string;
  decidedAt: string | null;
};

export type AccountTab = AccountStatus;

export const TAB_ORDER: readonly AccountTab[] = ["pending", "active", "inactive"];

export const TAB_LABEL: Record<AccountTab, string> = {
  pending: "Menunggu",
  active: "Aktif",
  inactive: "Dinonaktifkan",
};

export function accountCounts(rows: readonly AccountRow[]): Record<AccountTab, number> {
  const counts: Record<AccountTab, number> = { pending: 0, active: 0, inactive: 0 };
  for (const row of rows) counts[row.status] += 1;
  return counts;
}

/** Rows of one tab. Waiting accounts: oldest first (first come, first served); the others: newest decision first. */
export function rowsForTab(rows: readonly AccountRow[], tab: AccountTab): AccountRow[] {
  const inTab = rows.filter((row) => row.status === tab);
  const key = (row: AccountRow) => (tab === "pending" ? row.createdAt : (row.decidedAt ?? row.createdAt));
  return inTab.sort((a, b) => (tab === "pending" ? key(a).localeCompare(key(b)) : key(b).localeCompare(key(a))));
}

/** The tab to open first: the waiting accounts when there are any, otherwise the active ones. */
export function defaultTab(rows: readonly AccountRow[]): AccountTab {
  return rows.some((row) => row.status === "pending") ? "pending" : "active";
}

/** A sign-up that named no valid branch cannot be approved until the owner picks one. */
export function needsBranch(row: Pick<AccountRow, "branchCode">): boolean {
  return row.branchCode === UNASSIGNED_BRANCH;
}

/** The branch the owner may approve with: what is chosen in the row, else the registered one; null when neither is usable. */
export function approvalBranch(row: Pick<AccountRow, "branchCode">, chosen: string | undefined): string | null {
  const branch = (chosen ?? row.branchCode).trim().toUpperCase();
  return branch === "" || branch === UNASSIGNED_BRANCH ? null : branch;
}

/** Case-insensitive match on name, e-mail or branch. */
export function matchesSearch(row: AccountRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return `${row.fullName} ${row.email} ${row.branchCode}`.toLowerCase().includes(q);
}
