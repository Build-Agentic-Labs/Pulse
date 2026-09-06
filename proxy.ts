import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { resolveCanonicalRedirect } from "@/domain/deployment/canonical-host";
import type { Database } from "@/lib/database.types";

/**
 * Next 16 "proxy" (the renamed middleware convention).
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
export async function proxy(request: NextRequest) {
  // A production deployment answers on its *.vercel.app URL too; send those
  // visitors to the canonical domain so bookmarks, links and cookies all agree.
  // Preview deployments are served as-is (see src/domain/deployment/canonical-host.ts).
  const canonical = resolveCanonicalRedirect({
    requestUrl: request.url,
    vercelEnv: process.env.VERCEL_ENV,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
  });
  if (canonical) {
    return NextResponse.redirect(canonical, 308);
  }

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

  // Refresh ONLY when the access token is missing/near expiry, decided by parsing
  // the cookie locally — no auth round-trip on normal navigation. This matters for
  // two reasons: (1) GoTrue rate limits — a getUser() per navigation can trip them;
  // (2) the refresh-token STAMPEDE: parallel requests arriving after idle all carry
  // the same expired token, race concurrent refreshes of a single-use refresh
  // token, trip reuse detection, and get the whole session revoked. Expiry gating
  // narrows refreshing to the one moment it is actually needed.
  if (sessionNeedsRefresh(request)) {
    try {
      await supabase.auth.getUser();
    } catch (error) {
      // Refresh is best-effort here; authorization still happens in the route's
      // Supabase reads under RLS. A temporary GoTrue/network failure should flow
      // into the existing auth recovery UI instead of crashing the whole route.
      console.warn("Supabase session refresh failed in proxy; continuing request.", error);
    }
  }

  return response;
}

const REFRESH_MARGIN_SECONDS = 300;

/** base64url -> utf8 without Buffer, so this also runs on the edge runtime. */
function decodeBase64Url(value: string): string {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

function sessionNeedsRefresh(request: NextRequest): boolean {
  const chunks = request.cookies
    .getAll()
    .filter((cookie) => cookie.name.startsWith("sb-") && cookie.name.includes("-auth-token"))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (chunks.length === 0) {
    return false; // Signed out: nothing to refresh.
  }

  try {
    let joined = decodeURIComponent(chunks.map((cookie) => cookie.value).join(""));
    if (joined.startsWith("base64-")) {
      joined = decodeBase64Url(joined.slice("base64-".length));
    }
    const session = JSON.parse(joined) as { access_token?: string };
    if (typeof session.access_token !== "string") {
      return true;
    }
    const payload = JSON.parse(decodeBase64Url(session.access_token.split(".")[1] ?? "")) as { exp?: number };
    if (typeof payload.exp !== "number") {
      return true;
    }
    return payload.exp - Date.now() / 1000 < REFRESH_MARGIN_SECONDS;
  } catch {
    // Unparseable cookie: let getUser() decide (it may repair or clear it).
    return true;
  }
}

export const config = {
  matcher: [
    // Everything except api routes, Next internals, and static assets.
    "/((?!api/|_next/|favicon.ico|manifest.webmanifest|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico|woff2?)$).*)",
  ],
};
