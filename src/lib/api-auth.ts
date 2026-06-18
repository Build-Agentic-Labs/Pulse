/**
 * Server-side auth for Next.js API routes. The browser attaches the user's Supabase
 * access token as a Bearer header; we verify it against Supabase auth before doing any
 * work. Mirrors the pattern proven in /api/smart-allocation — RLS remains the data
 * authorization layer, this gate just keeps anonymous callers off server resources
 * (LLM spend, host network details).
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

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
export function callerScopedSupabase(token: string): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  return createClient(supabaseUrl, supabaseAnonKey, {
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
    return {
      userId: null,
      failure: NextResponse.json({ error: "Sign in to use this endpoint." }, { status: 401 }),
    };
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
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
