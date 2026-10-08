import { createPlannerSupabaseClient } from "@/domain/supabase-planner";
import type { ConversionReview } from "@/domain/quality-wi/conversion";

/** Capture the authenticated identity for every request, including resumed conversions. */
export async function wiConversionRequest<T = ConversionReview>(
  userId: string,
  url: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const client = createPlannerSupabaseClient();
  const { data, error } = await client.auth.getSession();
  if (error || data.session?.user.id !== userId)
    throw new Error(
      "Your account changed. Reopen the converter before continuing.",
    );
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${data.session.access_token}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: signal ?? AbortSignal.timeout(290_000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      result?.error ??
        "The conversion request could not finish. Check its status before trying again.",
    );
  return result as T;
}
