/**
 * Posts Adaptive Cards to a Microsoft Teams incoming webhook. Plain fetch, no
 * SDK; the injected fetch keeps it testable. Never throws — the drain records
 * the outcome per channel and moves on.
 */

import { isTeamsWebhookUrl, type TeamsMessage } from "@/domain/notifications/teams-card";

export type TeamsSendResult = { ok: true } | { ok: false; status: number; error: string };
export type TeamsSender = (webhookUrl: string, message: TeamsMessage | Record<string, unknown>) => Promise<TeamsSendResult>;

export function createTeamsSender(fetchImpl: typeof fetch = fetch): TeamsSender {
  return async (webhookUrl, message) => {
    if (!isTeamsWebhookUrl(webhookUrl)) {
      return { ok: false, status: 0, error: "Not a Microsoft Teams webhook URL." };
    }
    try {
      const response = await fetchImpl(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(message),
      });
      if (response.ok) return { ok: true };
      const error = await response.text().catch(() => "");
      return { ok: false, status: response.status, error: error.slice(0, 500) };
    } catch (error: unknown) {
      return { ok: false, status: 0, error: error instanceof Error ? error.message : "Teams post failed" };
    }
  };
}
