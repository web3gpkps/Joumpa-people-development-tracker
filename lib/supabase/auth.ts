import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "./server";
import { getSupabasePublicEnv } from "./env";

export type AdminSession =
  | { status: "admin"; userId: string; email: string }
  | { status: "not-admin"; userId: string; email: string }
  | { status: "signed-out" }
  | { status: "unavailable"; reason: "config" | "auth" | "database"; detail?: string };

/**
 * Data Access Layer: who is signing in, and are they in public.admins?
 * Verifies the JWT with getClaims() (never trusts getSession()), then reads the
 * caller's own row in public.admins with the user's client (RLS: only admins can
 * read admins, so a non-admin simply gets no row).
 * Memoised per request with React cache(), so the layout, pages and actions can all
 * call it without extra round trips. Reads cookies: call inside <Suspense> or an action.
 */
export const getAdminSession = cache(async (): Promise<AdminSession> => {
  if (!getSupabasePublicEnv()) return { status: "unavailable", reason: "config" };

  // partialPrefetching prerenders cookie data into the prefetched shell, so cookies()
  // alone does not mark this as request time; getClaims() then reads Date.now() to check
  // the JWT expiry, which Next rejects during a prerender. The access decision must be
  // made per request anyway.
  await connection();
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;

  if (!claims?.sub) {
    if (claimsError && claimsError.name === "AuthRetryableFetchError") {
      return { status: "unavailable", reason: "auth", detail: claimsError.message };
    }
    return { status: "signed-out" };
  }

  const userId = claims.sub;
  const email = typeof claims.email === "string" ? claims.email : "";

  const { data: row, error } = await supabase
    .from("admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) return { status: "unavailable", reason: "database", detail: error.message };
  if (!row) return { status: "not-admin", userId, email };
  return { status: "admin", userId, email };
});

/**
 * Guard for every admin page data function and every Server Action:
 *   const admin = await requireAdmin();
 * Signed out → redirect to /login. Signed in but not an admin, or the database is
 * unreachable → throws (an action fails, a page shows its error boundary).
 * The (admin) layout gate is not enough on its own: layouts do not re-run on
 * client navigation and a Server Action is a public POST endpoint.
 */
export async function requireAdmin(): Promise<{ userId: string; email: string }> {
  const session = await getAdminSession();
  if (session.status === "signed-out") redirect("/login");
  if (session.status === "not-admin") {
    throw new Error("Akun ini belum terdaftar sebagai admin.");
  }
  if (session.status === "unavailable") {
    throw new Error("Data admin tidak bisa diperiksa. Coba lagi sebentar lagi.");
  }
  return { userId: session.userId, email: session.email };
}
