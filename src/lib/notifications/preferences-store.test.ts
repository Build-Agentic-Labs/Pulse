import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { loadPreferences, savePreference } from "./preferences-store";

type Result = { data: unknown; error: { message: string } | null };

function makeClient(
  results: Record<string, Result>,
  capture: { upserts: { values: Record<string, unknown>; options: unknown }[]; filters: Record<string, unknown> },
) {
  const from = (table: string) => {
    const builder: Record<string, unknown> = {};
    Object.assign(builder, {
      select: () => builder,
      eq: (col: string, val: unknown) => {
        capture.filters[col] = val;
        return builder;
      },
      upsert: (values: Record<string, unknown>, options: unknown) => {
        capture.upserts.push({ values, options });
        return builder;
      },
      then: (resolve: (r: Result) => void) => resolve(results[table] ?? { data: [], error: null }),
    });
    return builder;
  };
  return { from } as unknown as SupabaseClient<Database>;
}

describe("loadPreferences", () => {
  it("loads every row for the user across channels, mapped to domain rows", async () => {
    const capture = { upserts: [], filters: {} as Record<string, unknown> };
    const client = makeClient(
      {
        notification_preferences: {
          data: [
            { user_id: "u1", workspace_id: "", kind: "remark_added", channel: "email", mode: "immediate" },
            { user_id: "u1", workspace_id: "ws-1", kind: "review_requested", channel: "teams", mode: "off" },
          ],
          error: null,
        },
      },
      capture,
    );
    expect(await loadPreferences("u1", client)).toEqual([
      { workspaceId: "", kind: "remark_added", channel: "email", mode: "immediate" },
      { workspaceId: "ws-1", kind: "review_requested", channel: "teams", mode: "off" },
    ]);
    expect(capture.filters).toEqual({ user_id: "u1" });
  });
});

describe("savePreference", () => {
  it("upserts on the natural key so a second save overwrites the first", async () => {
    const capture = { upserts: [] as { values: Record<string, unknown>; options: unknown }[], filters: {} };
    const client = makeClient({}, capture);
    await savePreference("u1", { workspaceId: "", kind: "review_requested", channel: "email", mode: "off" }, client);
    expect(capture.upserts).toEqual([
      {
        values: { user_id: "u1", workspace_id: "", kind: "review_requested", channel: "email", mode: "off", updated_at: expect.any(String) },
        options: { onConflict: "user_id,workspace_id,kind,channel" },
      },
    ]);
  });

  it("surfaces a rejected write", async () => {
    const client = makeClient({ notification_preferences: { data: null, error: { message: "denied" } } }, { upserts: [], filters: {} });
    await expect(
      savePreference("u1", { workspaceId: "", kind: "review_requested", channel: "email", mode: "off" }, client),
    ).rejects.toThrow("denied");
  });
});
