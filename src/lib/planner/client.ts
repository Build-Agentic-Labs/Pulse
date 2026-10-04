// The planner's Supabase client: environment, the browser singleton (kept on globalThis so a page shares
// one client), the one-time legacy localStorage session bridge, the server trap (construction allowed,
// any use throws), and the cached-session user helper. Moved verbatim from supabase-planner.ts (Phase 4);
// the facade re-exports the public names. A plain module: it is imported by server code too.

import type { Database } from "@/lib/database.types";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { SupabaseClient, User } from "@supabase/supabase-js";

export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

type PlannerSupabaseGlobal = typeof globalThis & {
  __buildlogicPlannerSupabaseClient?: SupabaseClient<Database>;
};

/**
 * One-time bridge from the pre-Stage-3 localStorage session to cookie storage:
 * signed-in users keep their session across the cutover instead of being forced
 * to sign in again. The localStorage key is removed BEFORE the async setSession
 * resolves so the bridge can never run twice, and it is skipped entirely when a
 * cookie session already exists (never overwrite a newer session with an older
 * token). Failure mode is benign: the user signs in once, fresh.
 */
function migrateLocalStorageSessionToCookies(client: SupabaseClient<Database>) {
  try {
    const hasCookieSession = document.cookie
      .split(";")
      .some((part) => /^\s*sb-[^=]*-auth-token(?:\.\d+)?=/.test(part));
    if (hasCookieSession) return;

    const legacyKey = Object.keys(window.localStorage).find(
      (key) => key.startsWith("sb-") && key.includes("-auth-token"),
    );
    if (!legacyKey) return;

    const raw = window.localStorage.getItem(legacyKey);
    if (!raw) return;

    // supabase-js may store the payload base64url-encoded with a "base64-" prefix.
    const json = raw.startsWith("base64-")
      ? new TextDecoder().decode(
          Uint8Array.from(atob(raw.slice("base64-".length).replace(/-/g, "+").replace(/_/g, "/")), (c) =>
            c.charCodeAt(0),
          ),
        )
      : raw;

    const parsed = JSON.parse(json) as { access_token?: unknown; refresh_token?: unknown };
    if (typeof parsed.access_token !== "string" || typeof parsed.refresh_token !== "string") {
      return; // Unrecognized shape: leave the key alone rather than destroy it.
    }

    // Remove only once the tokens are safely extracted. Re-running after a failed
    // setSession is harmless (a used refresh token just rejects), and the
    // cookie-present guard above prevents re-running after success.
    window.localStorage.removeItem(legacyKey);
    void client.auth.setSession({
      access_token: parsed.access_token,
      refresh_token: parsed.refresh_token,
    });
  } catch {
    // Corrupt or unreadable legacy token: fall through to a normal sign-in.
  }
}

export function plannerClient() {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  }

  if (typeof window !== "undefined") {
    const globalScope = globalThis as PlannerSupabaseGlobal;
    if (!globalScope.__buildlogicPlannerSupabaseClient) {
      // Cookie-backed sessions (@supabase/ssr) replace the previous localStorage
      // sessions so the server can identify the user too (refactor plan, Stage 3).
      // Auth behavior is unchanged: one persistent session, background token
      // refresh, low auth traffic elsewhere (see getUserFromSession).
      globalScope.__buildlogicPlannerSupabaseClient = createSupabaseBrowserClient();
      migrateLocalStorageSessionToCookies(globalScope.__buildlogicPlannerSupabaseClient);
    }
    return globalScope.__buildlogicPlannerSupabaseClient;
  }

  // Server-side there is deliberately NO working client (refactor plan, Stage 4).
  // The old fallback here was a sessionless anon singleton: every RLS-scoped read
  // through it returned zero rows, so a page accidentally calling this from the
  // server rendered EMPTY instead of erroring — the silent failure that becomes a
  // data-loss chain once full-state saves are involved.
  //
  // CONSTRUCTING is allowed, because client components run on the server for the
  // initial HTML and several build a client in render-time useMemo, using it only
  // inside effects/handlers that never run during SSR. USING it on the server is
  // what throws: any property access (auth, from, rpc, ...) fails loudly with
  // guidance. Server code must pass an explicit per-request client
  // (src/lib/supabase/server.ts) to the data functions.
  return new Proxy({} as SupabaseClient<Database>, {
    get(_target, prop) {
      if (typeof prop === "symbol" || prop === "then") {
        // Benign framework probes (thenable checks, React internals) — not real use.
        return undefined;
      }
      throw new Error(
        `createPlannerSupabaseClient() is browser-only: '${String(prop)}' was accessed during a server ` +
          "render. Create a per-request client with createSupabaseServerClient() and pass it to the " +
          "data function explicitly.",
      );
    },
  });
}

export function createPlannerSupabaseClient() {
  return plannerClient();
}

/**
 * The current user from the CACHED session — NO network round-trip. Use this instead of
 * `getUserFromSession(supabase)` for "who am I" (stamping created_by/updated_by, presence keys).
 * `getUser()` calls the auth server on every invocation, which counts against Supabase Auth's
 * (GoTrue) rate limit; under heavy navigation that burst can trip the limit and boot the user to
 * login. `getSession()` reads the already-verified JWT locally. Returns the same
 * `{ data: { user }, error }` shape so call sites don't change how they read the result.
 *
 * SERVER CALLERS (Stage 4+): pass a per-request cookie client and note the semantics —
 * on the server, getSession() reads the UNVERIFIED cookie payload, which is acceptable
 * only because middleware.ts already ran getUser() for the request. And this function
 * returns `user: null` rather than throwing when signed out: a server caller that
 * ignores the null renders an EMPTY page, not an error. Check the null explicitly.
 */
export async function getUserFromSession(
  supabase: SupabaseClient,
): Promise<{ data: { user: User | null }; error: null }> {
  const { data } = await supabase.auth.getSession();
  return { data: { user: data.session?.user ?? null }, error: null };
}
