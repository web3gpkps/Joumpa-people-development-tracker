import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { getSupabasePublicEnv, SUPABASE_ENV_MISSING_MESSAGE } from "@/lib/supabase/env";

/**
 * Cookie-less Supabase client for station links: the anon/publishable key, no session,
 * no cookies. It can do nothing except call the share_* RPCs (anon has no table
 * privileges; the RPCs check the token and the scope inside the database).
 * Server only, so the token never travels in a browser-side API call.
 */
export function createLinkClient() {
  const env = getSupabasePublicEnv();
  if (!env) throw new Error(SUPABASE_ENV_MISSING_MESSAGE);
  return createClient<Database>(env.url, env.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
