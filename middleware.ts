import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/database.types";

/**
 * Refreshes the Supabase auth cookies on navigation (refactor plan, Stage 3).
 * getUser() both verifies the token and rotates it when expired; the setAll
 * dance writes the rotated cookies onto BOTH the forwarded request (so anything
 * downstream in this render sees the fresh session) and the response (so the
 * browser stores it).
 *
 * The matcher deliberately excludes /api: those routes authenticate per-request
 * via requireApiUser (bearer token from the browser or the SolidWorks plugin,
 * with a cookie fallback) and must not depend on middleware ordering.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return response;
  }

  const supabase = createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // No session cookie -> nothing to refresh, skip the auth round-trip entirely.
  if (request.cookies.getAll().some((cookie) => cookie.name.startsWith("sb-") && cookie.name.includes("-auth-token"))) {
    await supabase.auth.getUser();
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except api routes, Next internals, and static assets.
    "/((?!api/|_next/|favicon.ico|manifest.webmanifest|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico|woff2?)$).*)",
  ],
};
