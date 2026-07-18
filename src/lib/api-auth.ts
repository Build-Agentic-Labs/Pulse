/**
 * Server-side auth for Next.js API routes. Dual-mode (refactor plan, Stage 3):
 *
 * 1. Bearer token — checked FIRST. The SolidWorks plugin authenticates this way
 *    from outside a browser (no cookie jar), so bearer support is permanent.
 *    Browser callers that attach the token manually keep working unchanged.
 * 2. Cookie session — fallback when no Authorization header is present, for
 *    browser callers relying on the @supabase/ssr auth cookies riding along.
 *
 * Either way the token is verified against Supabase auth before any work; RLS
 * remains the data authorization layer.
 */

import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import type { Database } from "./database.types";

export function getBearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const [scheme, token] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" && token ? token : "";
}

/**
 * A Supabase client that acts AS the caller by forwarding their bearer token, so RLS scopes every
 * read/write to what that user (or service account) may actually see. Use this in API routes that
 * need user-scoped data — the shared planner client is an anon singleton with no session.
 */
export function callerScopedSupabase(token: string): SupabaseClient<Database> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  return createClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

export type ApiUserResult = { userId: string; failure: null } | { userId: null; failure: NextResponse };

export async function requireApiUser(request: Request): Promise<ApiUserResult> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return {
      userId: null,
      failure: NextResponse.json({ error: "Supabase auth is not configured." }, { status: 503 }),
    };
  }

  const token = getBearerToken(request);
  if (!token) {
    // No bearer header: fall back to the @supabase/ssr auth cookies. An
    // explicitly-presented bearer token is never silently substituted — if one
    // was sent and is invalid, the caller gets a 401, not a cookie session.
    const cookieUserId = await userIdFromRequestCookies(request, supabaseUrl, supabaseAnonKey);
    if (cookieUserId) {
      return { userId: cookieUserId, failure: null };
    }
    return {
      userId: null,
      failure: NextResponse.json({ error: "Sign in to use this endpoint." }, { status: 401 }),
    };
  }

  const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    return {
      userId: null,
      failure: NextResponse.json({ error: "Invalid or expired session." }, { status: 401 }),
    };
  }

  return { userId: data.user.id, failure: null };
}

/** Verify a cookie-borne session. Read-only: token rotation belongs to middleware, not API routes. */
async function userIdFromRequestCookies(
  request: Request,
  supabaseUrl: string,
  supabaseAnonKey: string,
): Promise<string | null> {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader || !cookieHeader.includes("-auth-token")) {
    return null;
  }

  const parsed = cookieHeader
    .split(";")
    .map((part) => {
      const separator = part.indexOf("=");
      if (separator === -1) return null;
      return { name: part.slice(0, separator).trim(), value: part.slice(separator + 1).trim() };
    })
    .filter((cookie): cookie is { name: string; value: string } => cookie !== null);

  const supabase = createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll: () => parsed,
      setAll: () => {},
    },
  });
  const { data, error } = await supabase.auth.getUser();
  return error || !data.user ? null : data.user.id;
}

/**
 * Per-instance in-memory limiter (same approach as /api/smart-allocation). Good enough
 * to stop a single user hammering an expensive endpoint; not a distributed quota.
 */
export function createApiRateLimiter({ windowMs, maxRequests }: { windowMs: number; maxRequests: number }) {
  const buckets = new Map<string, { count: number; resetAt: number }>();

  return function checkRateLimit(key: string) {
    const now = Date.now();
    const current = buckets.get(key);

    if (!current || current.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }

    if (current.count >= maxRequests) {
      return false;
    }

    current.count += 1;
    return true;
  };
}
