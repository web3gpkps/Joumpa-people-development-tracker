import "server-only";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.types";
import { cookies } from "next/headers";
import { getSupabasePublicEnv, SUPABASE_ENV_MISSING_MESSAGE } from "./env";

/**
 * Supabase client for Server Components, Server Actions and Route Handlers, acting
 * as the signed-in user (RLS applies: only admins pass is_admin()).
 *
 * Next 16 + cacheComponents: this reads cookies(), which is request data. Call it
 * only inside a <Suspense> boundary (or in a Server Action / Route Handler), never
 * inside a "use cache" scope. Create a new client per request; do not share one.
 */
export async function createClient() {
  const env = getSupabasePublicEnv();
  if (!env) throw new Error(SUPABASE_ENV_MISSING_MESSAGE);
  const cookieStore = await cookies();

  return createServerClient<Database>(env.url, env.key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies. proxy.ts refreshes the session on
          // every request, so a refresh attempted during render can be ignored here.
        }
      },
    },
  });
}
