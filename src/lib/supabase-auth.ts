import type { AuthError, Session, SupabaseClient } from "@supabase/supabase-js";

export function isStaleAuthSessionError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const message =
    "message" in error && typeof error.message === "string" ? error.message.toLowerCase() : "";

  return (
    message.includes("invalid refresh token") ||
    message.includes("refresh token not found") ||
    message.includes("session not found") ||
    message.includes("jwt expired")
  );
}

export async function clearStaleSupabaseSession(supabase: SupabaseClient) {
  try {
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    // Ignore local cleanup failures for already-invalid sessions.
  }
}

export async function resolveSupabaseSession(
  supabase: SupabaseClient,
): Promise<{ session: Session | null; error: AuthError | null }> {
  const { data, error } = await supabase.auth.getSession();

  if (!error) {
    return { session: data.session, error: null };
  }

  if (isStaleAuthSessionError(error)) {
    await clearStaleSupabaseSession(supabase);
    return { session: null, error: null };
  }

  return { session: data.session ?? null, error };
}
