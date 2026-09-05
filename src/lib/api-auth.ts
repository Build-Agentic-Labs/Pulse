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
  return /^Bearer\s+(\S+)$/i.exec(header.trim())?.[1] ?? "";
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

export type ApiUserResult =
  | { userId: string; supabase: SupabaseClient<Database>; failure: null }
  | { userId: null; supabase: null; failure: NextResponse };

export async function requireApiUser(request: Request): Promise<ApiUserResult> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return {
      userId: null,
      supabase: null,
      failure: NextResponse.json({ error: "Supabase auth is not configured." }, { status: 503 }),
    };
  }

  const token = getBearerToken(request);
  // An explicit malformed header must never fall back to a different identity.
  if (request.headers.has("authorization") && !token) {
    return {
      userId: null,
      supabase: null,
      failure: NextResponse.json({ error: "Invalid authorization header." }, { status: 401 }),
    };
  }

  const supabase = token
    ? callerScopedSupabase(token)
    : cookieScopedSupabase(request, supabaseUrl, supabaseAnonKey);
  const { data, error } = token
    ? await supabase.auth.getUser(token)
    : await supabase.auth.getUser();

  if (error || !data.user) {
    return {
      userId: null,
      supabase: null,
      failure: NextResponse.json({ error: "Invalid or expired session." }, { status: 401 }),
    };
  }

  // Reuse this verified client for all data access. Reconstructing it from only
  // the Authorization header drops cookie sessions and makes RLS see anon.
  return { userId: data.user.id, supabase, failure: null };
}

/** Read-only cookies: token rotation belongs to the proxy, not API routes. */
function cookieScopedSupabase(request: Request, supabaseUrl: string, supabaseAnonKey: string) {
  const parsed = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((part) => {
      const separator = part.indexOf("=");
      if (separator === -1) return null;
      return { name: part.slice(0, separator).trim(), value: part.slice(separator + 1).trim() };
    })
    .filter((cookie): cookie is { name: string; value: string } => cookie !== null);

  return createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll: () => parsed,
      setAll: () => {},
    },
  });
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
