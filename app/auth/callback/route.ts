/**
 * GET /auth/callback: where every link Supabase e-mails out lands (address confirmation after
 * sign-up, password recovery). It trades the one-time code (or token hash) for a session cookie,
 * then sends the visitor on:
 *   ?next=/reset-password  -> the reset page (recovery)
 *   no next                -> /login with the "email confirmed" notice
 * Any other `next` is ignored, so a crafted link cannot bounce someone to another page or site.
 */
import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { safeCallbackPath } from "@/lib/accounts/rules";
import { createClient } from "@/lib/supabase/server";
import { getSupabasePublicEnv } from "@/lib/supabase/env";

const OTP_TYPES: readonly EmailOtpType[] = ["signup", "recovery", "email", "invite", "magiclink", "email_change"];

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const target = safeCallbackPath(searchParams.get("next"));
  const done = target === "/login" ? "/login?notice=email-confirmed" : target;
  const invalid = NextResponse.redirect(`${origin}/login?notice=link-invalid`);

  if (!getSupabasePublicEnv() || (!code && !(tokenHash && type && OTP_TYPES.includes(type)))) return invalid;

  const supabase = await createClient();
  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : await supabase.auth.verifyOtp({ token_hash: tokenHash!, type: type! });
  if (error) return invalid;

  const response = NextResponse.redirect(`${origin}${done}`);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
