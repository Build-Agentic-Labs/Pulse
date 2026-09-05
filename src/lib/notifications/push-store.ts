/**
 * Push subscriptions (push_subscriptions): the browser writes its own rows
 * under RLS; the drain reads them with the service role and prunes endpoints
 * the push service reports gone.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { PushSubscriptionKeys } from "./push-sender";

export type PushSubscriptionRow = PushSubscriptionKeys;

export async function listPushSubscriptions(
  client: SupabaseClient<Database>,
  userIds: readonly string[],
): Promise<Map<string, PushSubscriptionRow[]>> {
  const unique = Array.from(new Set(userIds));
  if (unique.length === 0) return new Map();
  const { data, error } = await client
    .from("push_subscriptions")
    .select("endpoint, user_id, p256dh, auth")
    .in("user_id", unique);
  if (error) throw new Error(error.message);
  const map = new Map<string, PushSubscriptionRow[]>();
  for (const row of data ?? []) {
    map.set(row.user_id, [
      ...(map.get(row.user_id) ?? []),
      { endpoint: String(row.endpoint), p256dh: String(row.p256dh), auth: String(row.auth) },
    ]);
  }
  return map;
}

export async function savePushSubscription(
  client: SupabaseClient<Database>,
  userId: string,
  subscription: PushSubscriptionKeys,
  userAgent: string | null,
): Promise<void> {
  const { error } = await client.from("push_subscriptions").upsert(
    {
      endpoint: subscription.endpoint,
      user_id: userId,
      p256dh: subscription.p256dh,
      auth: subscription.auth,
      user_agent: userAgent,
    },
    { onConflict: "endpoint" },
  );
  if (error) throw new Error(error.message);
}

export async function deletePushSubscription(client: SupabaseClient<Database>, endpoint: string): Promise<void> {
  const { error } = await client.from("push_subscriptions").delete().eq("endpoint", endpoint);
  if (error) throw new Error(error.message);
}
