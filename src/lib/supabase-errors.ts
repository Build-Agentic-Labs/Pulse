/**
 * Shared Supabase result unwrapping. Consolidates the four per-store `throwIfError`
 * copies; the mechanics live here once, while each store keeps its own
 * constraint-message translation (a departments 23505 must read differently from a
 * sops 23505, so those maps intentionally stay store-local).
 */

export type SupabaseResultError = { message: string; code?: string };

export async function throwIfError<T>(
  operation: PromiseLike<{ data: T; error: SupabaseResultError | null }>,
  translate?: (error: SupabaseResultError) => string | undefined,
): Promise<T> {
  const { data, error } = await operation;
  if (error) {
    throw new Error(translate?.(error) ?? error.message);
  }
  return data;
}
