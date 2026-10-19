/**
 * Public Supabase settings. Both values are safe in the browser: the URL and the
 * publishable (or legacy anon) key only grant what RLS allows. The service_role /
 * secret key must never be read here or put in a NEXT_PUBLIC_* variable.
 *
 * Returns null instead of throwing when they are missing, so the UI can say so
 * ("Aplikasi belum terhubung ke database") rather than crash.
 */
export function getSupabasePublicEnv(): { url: string; key: string } | null {
  // Literal process.env.NEXT_PUBLIC_* reads so Next inlines them into the browser bundle.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return { url, key };
}

export const SUPABASE_ENV_MISSING_MESSAGE =
  "Variabel NEXT_PUBLIC_SUPABASE_URL dan NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY belum diisi.";
