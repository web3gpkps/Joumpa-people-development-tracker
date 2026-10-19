import type { Workspace, WorkspaceAccess } from "@/lib/workspace";

/** RememberView's storage namespace: the owner, or the link's scope (never its token). */
export function rememberScope(access: Pick<WorkspaceAccess, "kind">, ws: Pick<Workspace, "scope">): string {
  return access.kind === "owner" ? "owner" : ws.scope;
}

/** "1" … "n", the accepted values of ?minggu= or ?periode=. */
export function oneTo(n: number): string[] {
  return Array.from({ length: n }, (_, i) => String(i + 1));
}
