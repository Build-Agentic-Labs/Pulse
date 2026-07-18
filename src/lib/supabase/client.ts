import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

/**
 * Browser Supabase client with COOKIE-backed sessions (@supabase/ssr), replacing
 * the localStorage sessions supabase-js used by default. The cookies are
 * deliberately readable by JS (not httpOnly): the browser client and the realtime
 * WebSocket both need to read them, and this is no weaker than the localStorage
 * they replace. What cookies buy us is that the SERVER can now identify the user
 * too — the unlock for server-side rendering (refactor plan, Stage 3).
 *
 * Auth defaults (persistSession, autoRefreshToken, detectSessionInUrl) match the
 * previous configuration in supabase-planner.ts.
 */
export function createSupabaseBrowserClient(): SupabaseClient<Database> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  }
  return createBrowserClient<Database>(supabaseUrl, supabaseAnonKey);
}
