import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { isAccountStatus, type AccountStatus } from "@/lib/accounts/rules";
import { createClient } from "./server";
import { getSupabasePublicEnv } from "./env";

export type AccountProfile = {
  userId: string;
  email: string;
  fullName: string;
  /** A station code or "KPS". "UNASSIGNED" until the owner picks one. */
  branchCode: string;
  status: AccountStatus;
};

export type AccountSession =
  | { status: "signed-out" }
  /** Signed in, but there is no profile row (an owner-only login, or a profile removed afterwards). */
  | { status: "no-profile"; userId: string; email: string }
  | { status: "active"; profile: AccountProfile }
  | { status: "pending" | "inactive"; profile: AccountProfile }
  | { status: "unavailable"; reason: "config" | "auth" | "database" };

/**
 * Who is signed in, as a branch account. Verifies the JWT with getClaims() (never getSession()),
 * then reads the caller's own row in public.profiles with the user's client; RLS lets an account
 * read only its own row. Memoised per request. Reads cookies and the clock: call inside <Suspense>
 * or an action. The owner (public.admins) is a different path: see getAdminSession().
 */
export const getAccountSession = cache(async (): Promise<AccountSession> => {
  if (!getSupabasePublicEnv()) return { status: "unavailable", reason: "config" };

  // See getAdminSession(): getClaims() reads the clock, which must happen at request time.
  await connection();
  const supabase = await createClient();
  const { data, error: claimsError } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) {
    if (claimsError && claimsError.name === "AuthRetryableFetchError") return { status: "unavailable", reason: "auth" };
    return { status: "signed-out" };
  }

  const userId = claims.sub;
  const email = typeof claims.email === "string" ? claims.email : "";
  const { data: row, error } = await supabase
    .from("profiles")
    .select("email, full_name, branch_code, status")
    .eq("id", userId)
    .maybeSingle();

  if (error) return { status: "unavailable", reason: "database" };
  if (!row || !isAccountStatus(row.status)) return { status: "no-profile", userId, email };

  const profile: AccountProfile = {
    userId,
    email: row.email || email,
    fullName: row.full_name,
    branchCode: row.branch_code,
    status: row.status,
  };
  return { status: row.status, profile };
});

/** Where a login that is not an active account is sent, with the reason the login page prints. */
export function loginNoticeFor(session: AccountSession): string {
  if (session.status === "pending") return "pending";
  if (session.status === "inactive") return "inactive";
  return "no-account";
}

/**
 * Guard for every page data function and Server Action of the branch area (/cabang):
 *   const { profile } = await requireActiveAccount();
 * Signed out: redirect to /login. Signed in but pending, inactive or without a profile: redirect to
 * /login with the reason. The /cabang layout gate alone is not enough (layouts do not re-run on
 * client navigation and a Server Action is a public POST endpoint).
 */
export async function requireActiveAccount(): Promise<{ profile: AccountProfile }> {
  const session = await getAccountSession();
  if (session.status === "active") return { profile: session.profile };
  if (session.status === "signed-out") redirect("/login");
  if (session.status === "unavailable") throw new Error("Akun tidak bisa diperiksa. Coba lagi sebentar lagi.");
  redirect(`/login?notice=${loginNoticeFor(session)}`);
}
