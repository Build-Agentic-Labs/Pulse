/**
 * Workspace channel integrations (workspace_integrations). Owners/admins read and
 * write their workspace's row under RLS; the drain reads enabled rows with the
 * service role.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { isTeamsWebhookUrl } from "@/domain/notifications/teams-card";
import type { Database, Json } from "@/lib/database.types";

export interface TeamsIntegration {
  webhookUrl: string;
}

export interface TeamsIntegrationSettings extends TeamsIntegration {
  enabled: boolean;
  updatedAt: string | null;
}

function webhookFromConfig(config: unknown): string | null {
  if (typeof config !== "object" || config === null) return null;
  const url = (config as Record<string, unknown>).webhookUrl;
  return typeof url === "string" && url ? url : null;
}

/** Enabled Teams webhooks for a set of workspaces — what the drain posts to. */
export async function loadTeamsIntegrations(
  client: SupabaseClient<Database>,
  workspaceIds: readonly string[],
): Promise<Map<string, TeamsIntegration>> {
  const unique = Array.from(new Set(workspaceIds));
  if (unique.length === 0) return new Map();
  const { data, error } = await client
    .from("workspace_integrations")
    .select("workspace_id, kind, enabled, config")
    .in("workspace_id", unique)
    .eq("kind", "teams_webhook");
  if (error) throw new Error(error.message);
  const map = new Map<string, TeamsIntegration>();
  for (const row of data ?? []) {
    if (row.kind !== "teams_webhook" || !row.enabled) continue;
    const webhookUrl = webhookFromConfig(row.config);
    if (webhookUrl) map.set(row.workspace_id, { webhookUrl });
  }
  return map;
}

export async function loadTeamsIntegration(
  client: SupabaseClient<Database>,
  workspaceId: string,
): Promise<TeamsIntegrationSettings | null> {
  const { data, error } = await client
    .from("workspace_integrations")
    .select("workspace_id, kind, enabled, config, updated_at")
    .eq("workspace_id", workspaceId)
    .eq("kind", "teams_webhook")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    webhookUrl: webhookFromConfig(data.config) ?? "",
    enabled: Boolean(data.enabled),
    updatedAt: (data.updated_at as string | null) ?? null,
  };
}

export async function saveTeamsIntegration(
  client: SupabaseClient<Database>,
  workspaceId: string,
  settings: { webhookUrl: string; enabled: boolean },
  userId: string,
): Promise<void> {
  const webhookUrl = settings.webhookUrl.trim();
  if (webhookUrl && !isTeamsWebhookUrl(webhookUrl)) {
    throw new Error("Enter a Microsoft Teams webhook URL (webhook.office.com or logic.azure.com, https).");
  }
  const { error } = await client.from("workspace_integrations").upsert(
    {
      workspace_id: workspaceId,
      kind: "teams_webhook",
      config: { webhookUrl } as Json,
      enabled: settings.enabled && Boolean(webhookUrl),
      updated_by: userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id,kind" },
  );
  if (error) throw new Error(error.message);
}
