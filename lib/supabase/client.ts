import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.types";
import { getSupabasePublicEnv, SUPABASE_ENV_MISSING_MESSAGE } from "./env";

/**
 * Supabase client for Client Components (same session cookies as the server client).
 * Prefer Server Components / Server Actions for data; use this only for browser-only
 * needs. Returns one shared instance per tab (createBrowserClient memoises it).
 */
export function createClient() {
  const env = getSupabasePublicEnv();
  if (!env) throw new Error(SUPABASE_ENV_MISSING_MESSAGE);
  return createBrowserClient<Database>(env.url, env.key);
}
