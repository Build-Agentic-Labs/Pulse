import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { deletePushSubscription, listPushSubscriptions, savePushSubscription } from "./push-store";

type Result = { data: unknown; error: { message: string } | null };

function makeClient(
  results: Record<string, Result>,
  capture: { upserts: { values: Record<string, unknown>; options: unknown }[]; deletes: Record<string, unknown>[] },
) {
  const from = (table: string) => {
    const guards: Record<string, unknown> = {};
    const builder: Record<string, unknown> = {};
    Object.assign(builder, {
      select: () => builder,
      in: () => builder,
      eq: (col: string, val: unknown) => {
        guards[col] = val;
        return builder;
      },
      upsert: (values: Record<string, unknown>, options: unknown) => {
        capture.upserts.push({ values, options });
        return builder;
      },
      delete: () => {
        capture.deletes.push(guards);
        return builder;
      },
      then: (resolve: (r: Result) => void) => resolve(results[table] ?? { data: [], error: null }),
    });
    return builder;
  };
  return { from } as unknown as SupabaseClient<Database>;
}

describe("listPushSubscriptions", () => {
  it("groups subscriptions by user", async () => {
    const client = makeClient(
      {
        push_subscriptions: {
          data: [
            { endpoint: "https://p/1", user_id: "u1", p256dh: "a", auth: "b" },
            { endpoint: "https://p/2", user_id: "u1", p256dh: "c", auth: "d" },
            { endpoint: "https://p/3", user_id: "u2", p256dh: "e", auth: "f" },
          ],
          error: null,
        },
      },
      { upserts: [], deletes: [] },
    );
    const map = await listPushSubscriptions(client, ["u1", "u2"]);
    expect(map.get("u1")).toEqual([
      { endpoint: "https://p/1", p256dh: "a", auth: "b" },
      { endpoint: "https://p/2", p256dh: "c", auth: "d" },
    ]);
    expect(map.get("u2")).toHaveLength(1);
    expect((await listPushSubscriptions(client, [])).size).toBe(0);
  });
});

describe("savePushSubscription / deletePushSubscription", () => {
  it("upserts on the endpoint for the signed-in user", async () => {
    const capture = { upserts: [] as { values: Record<string, unknown>; options: unknown }[], deletes: [] };
    await savePushSubscription(makeClient({}, capture), "u1", { endpoint: "https://p/1", p256dh: "a", auth: "b" }, "Chrome");
    expect(capture.upserts).toEqual([
      { values: { endpoint: "https://p/1", user_id: "u1", p256dh: "a", auth: "b", user_agent: "Chrome" }, options: { onConflict: "endpoint" } },
    ]);
  });

  it("deletes by endpoint", async () => {
    const capture = { upserts: [], deletes: [] as Record<string, unknown>[] };
    await deletePushSubscription(makeClient({}, capture), "https://p/1");
    expect(capture.deletes).toEqual([{ endpoint: "https://p/1" }]);
  });
});
