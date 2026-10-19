import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabasePublicEnv } from "./env";

/** The owner area (/admin) and the branch-account area (/cabang). Everything else this helper sees (/login, /register, /auth, unknown paths) is public. */
function isSignedInArea(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/") || pathname === "/cabang" || pathname.startsWith("/cabang/");
}

/**
 * Runs in proxy.ts for the owner area, the branch area and auth routes (never for /s/* station links):
 * 1. refreshes the Supabase session and writes rotated cookies to the response;
 * 2. optimistic redirect: no valid session on /admin/* or /cabang/* → /login?next=<path>.
 * Which area a signed-in visitor belongs to (owner, approved branch account, pending) needs the
 * database, so /login itself decides that and forwards.
 * This is a convenience, not the security boundary: the /admin and /cabang layouts and every Server
 * Action re-check with requireAdmin() / requireActiveAccount(), and RLS and the share_* functions
 * enforce it in the database.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });
  const env = getSupabasePublicEnv();
  // Not configured yet: let the page explain it instead of redirect-looping.
  if (!env) return response;

  const supabase = createServerClient(env.url, env.key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        for (const [key, value] of Object.entries(headers ?? {})) {
          response.headers.set(key, value);
        }
      },
    },
  });

  // Do not put code between createServerClient and getClaims(): it triggers the refresh.
  const { data, error } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);
  const authUnreachable = Boolean(error && error.name === "AuthRetryableFetchError");
  const { pathname, search } = request.nextUrl;

  const redirectWithCookies = (url: URL) => {
    const redirect = NextResponse.redirect(url);
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    redirect.headers.set("Cache-Control", "private, no-store");
    return redirect;
  };

  // If Supabase Auth cannot be reached, do not bounce people to /login: the page
  // shows the connection problem instead.
  if (!signedIn && !authUnreachable && isSignedInArea(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    if (pathname !== "/admin" && pathname !== "/cabang") url.searchParams.set("next", `${pathname}${search}`);
    return redirectWithCookies(url);
  }

  // A signed-in account that is not the owner has no business in /admin: send it to /login, which forwards an
  // approved branch account to /cabang. Only when the database answers; otherwise the page's own gate explains.
  if (signedIn && (pathname === "/admin" || pathname.startsWith("/admin/"))) {
    const { data: admin, error: adminError } = await supabase.from("admins").select("user_id").eq("user_id", data!.claims!.sub).maybeSingle();
    if (!adminError && !admin) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.search = "";
      return redirectWithCookies(url);
    }
  }

  return response;
}
