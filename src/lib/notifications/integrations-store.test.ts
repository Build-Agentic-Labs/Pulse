import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { loadTeamsIntegration, loadTeamsIntegrations, saveTeamsIntegration } from "./integrations-store";

type Result = { data: unknown; error: { message: string } | null };

function makeClient(results: Record<string, Result>, capture: { upserts: { values: Record<string, unknown>; options: unknown }[] }) {
  const from = (table: string) => {
    const builder: Record<string, unknown> = {};
    Object.assign(builder, {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      maybeSingle: () => builder,
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

describe("loadTeamsIntegrations", () => {
  it("maps enabled webhooks by workspace and ignores disabled or malformed rows", async () => {
    const client = makeClient(
      {
        workspace_integrations: {
          data: [
            { workspace_id: "ws-1", kind: "teams_webhook", enabled: true, config: { webhookUrl: "https://a.webhook.office.com/x" } },
            { workspace_id: "ws-2", kind: "teams_webhook", enabled: false, config: { webhookUrl: "https://b.webhook.office.com/x" } },
            { workspace_id: "ws-3", kind: "teams_webhook", enabled: true, config: {} },
          ],
          error: null,
        },
      },
      { upserts: [] },
    );
    const map = await loadTeamsIntegrations(client, ["ws-1", "ws-2", "ws-3"]);
    expect(Array.from(map.entries())).toEqual([["ws-1", { webhookUrl: "https://a.webhook.office.com/x" }]]);
  });

  it("returns an empty map for no workspaces without querying", async () => {
    expect((await loadTeamsIntegrations(makeClient({}, { upserts: [] }), [])).size).toBe(0);
  });
});

describe("loadTeamsIntegration / saveTeamsIntegration", () => {
  it("loads one workspace's row for the settings form", async () => {
    const client = makeClient(
      {
        workspace_integrations: {
          data: { workspace_id: "ws-1", kind: "teams_webhook", enabled: true, config: { webhookUrl: "https://a.webhook.office.com/x" }, updated_at: "2026-09-04T00:00:00Z" },
          error: null,
        },
      },
      { upserts: [] },
    );
    expect(await loadTeamsIntegration(client, "ws-1")).toEqual({ webhookUrl: "https://a.webhook.office.com/x", enabled: true, updatedAt: "2026-09-04T00:00:00Z" });
    expect(await loadTeamsIntegration(makeClient({ workspace_integrations: { data: null, error: null } }, { upserts: [] }), "ws-9")).toBeNull();
  });

  it("upserts on (workspace, kind) with the caller as updated_by", async () => {
    const capture = { upserts: [] as { values: Record<string, unknown>; options: unknown }[] };
    await saveTeamsIntegration(makeClient({}, capture), "ws-1", { webhookUrl: "https://a.webhook.office.com/x", enabled: true }, "u1");
    expect(capture.upserts).toEqual([
      {
        values: {
          workspace_id: "ws-1",
          kind: "teams_webhook",
          config: { webhookUrl: "https://a.webhook.office.com/x" },
          enabled: true,
          updated_by: "u1",
          updated_at: expect.any(String),
        },
        options: { onConflict: "workspace_id,kind" },
      },
    ]);
  });

  it("refuses a webhook URL that is not a Teams host", async () => {
    await expect(
      saveTeamsIntegration(makeClient({}, { upserts: [] }), "ws-1", { webhookUrl: "https://evil.example.com/x", enabled: true }, "u1"),
    ).rejects.toThrow("Microsoft Teams webhook");
  });
});
