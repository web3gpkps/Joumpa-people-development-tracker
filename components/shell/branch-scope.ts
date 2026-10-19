import { BRANCH_SHEET_KEYS, type NavSection, type SheetKey, type WorkspaceAccess } from "@/lib/workspace/access";

/**
 * A single-station scope: a station link, or a signed-in branch account of one station (not KPS,
 * not the owner). It has two pages, Rencana Aksi and Cek BMI; every other screen sends it to its
 * home (Rencana Aksi) even when the address is typed in. The database enforces the same scope.
 */
export function isBranchScope(
  access: Pick<WorkspaceAccess, "kind">,
  workspace: { isKps: boolean; isOwner: boolean },
): boolean {
  return access.kind !== "owner" && !workspace.isKps && !workspace.isOwner;
}

/** A branch account (not a link): its Cek BMI menu item keeps v1's name and speaks of No Pegawai. */
export function isBranchAccount(
  access: Pick<WorkspaceAccess, "kind">,
  workspace: { isKps: boolean; isOwner: boolean },
): boolean {
  return access.kind === "account" && isBranchScope(access, workspace);
}

/** May a single-station scope open this page? */
export function branchMayOpen(sheet: SheetKey): boolean {
  return BRANCH_SHEET_KEYS.includes(sheet);
}

/** The home page of a single-station scope. */
export const BRANCH_HOME: SheetKey = "rencanaAksi";

/** The menu name of Cek BMI for a branch account (as in v1). */
export const BRANCH_BMI_MENU_LABEL = "BMI Monitoring Tracker";

/** A branch account's menu: Cek BMI under its v1 name. Sections are copied, never changed in place. */
export function branchAccountNavigation(sections: NavSection[]): NavSection[] {
  return sections.map((section) => ({
    ...section,
    items: section.items.map((item) =>
      item.key === "bmi" ? { ...item, label: BRANCH_BMI_MENU_LABEL, shortLabel: "BMI" } : item,
    ),
  }));
}

/**
 * Cek BMI shows every period by default, for every access; "?semua=0" opens it on the chosen
 * period only. The label is "Cek" everywhere (the sheet headers read "BMI Cek ke-N (Periode ...)").
 */
export function bmiPeriodView(allValue: string | undefined) {
  return {
    allSlots: allValue !== "0",
    label: "Cek",
    /** The ?semua= value that opens this view: null (the default) for every period, 0 for one. */
    query: (all: boolean) => (all ? null : 0),
  };
}
