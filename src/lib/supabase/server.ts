import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

/**
 * Server Supabase client for Server Components, Server Actions, and Route
 * Handlers: reads the caller's session from the request cookies, so RLS scopes
 * every query to that user. Server-only (imports next/headers) — never import
 * from client code.
 *
 * Cookie WRITES throw inside Server Components (Next.js forbids it there); the
 * try/catch makes that a no-op, which is safe because middleware.ts refreshes
 * expiring sessions before a Server Component ever runs.
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient<Database>> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  }

  const cookieStore = await cookies();
  return createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component — writes are forbidden there and
          // middleware handles the refresh instead.
        }
      },
    },
  });
}
