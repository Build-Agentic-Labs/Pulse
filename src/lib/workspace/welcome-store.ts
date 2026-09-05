/**
 * Supabase-backed DrainStore for workspace welcome emails. Scans audit_log
 * (the outbox — its trigger records every workspace_members.insert
 * transactionally), resolves against CURRENT membership so removals
 * self-cancel, and claims into workspace_notifications. Service-role only —
 * construct exclusively inside the drain route. All queries batched by id set.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import {
  parseMemberAddedEvent,
  renderWorkspaceWelcomeEmail,
  resolveWorkspaceWelcome,
  type MemberAddedEvent,
  type WorkspaceWelcomePending,
} from "@/domain/workspace/welcome";
import {
  MAX_SEND_ATTEMPTS,
  isRetryDue,
  snapshotContent,
  type DrainBatch,
  type DrainItem,
  type DrainStore,
  type RetryItem,
} from "@/lib/sop/notifications-drain";

const EVENT_WINDOW_DAYS = 30;
const DEAD_ROW_WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

interface WelcomeBundle {
  workspaceNameById: Map<string, string>;
  memberKeySet: Set<string>; // `${workspaceId}:${userId}`
  redeemedInviteAtByMemberKey: Map<string, number[]>; // `${workspaceId}:${userId}` -> redemption times
  profileById: Map<string, { fullName: string | null; email: string | null }>;
}

const INVITE_EVENT_MATCH_TOLERANCE_MS = 5_000;

function wasRedeemedInvite(bundle: WelcomeBundle, event: MemberAddedEvent): boolean {
  const eventTime = new Date(event.createdAt).getTime();
  if (!Number.isFinite(eventTime)) return false;
  return (bundle.redeemedInviteAtByMemberKey.get(`${event.workspaceId}:${event.recipientId}`) ?? []).some(
    (redeemedAt) => Math.abs(redeemedAt - eventTime) <= INVITE_EVENT_MATCH_TOLERANCE_MS,
  );
}

export function createWorkspaceWelcomeDrainStore(admin: SupabaseClient<Database>): DrainStore<WorkspaceWelcomePending> {
  async function loadBundle(events: MemberAddedEvent[]): Promise<WelcomeBundle> {
    const workspaceIds = Array.from(new Set(events.map((event) => event.workspaceId)));
    const recipientIds = Array.from(new Set(events.map((event) => event.recipientId)));
    const userIds = Array.from(
      new Set(events.flatMap((event) => (event.actorId ? [event.recipientId, event.actorId] : [event.recipientId]))),
    );
    const [workspaces, members, profiles, redeemedInvites] = await Promise.all([
      workspaceIds.length
        ? admin.from("workspaces").select("id, name").in("id", workspaceIds)
        : Promise.resolve({ data: [], error: null }),
      workspaceIds.length
        ? admin.from("workspace_members").select("workspace_id, user_id").in("workspace_id", workspaceIds)
        : Promise.resolve({ data: [], error: null }),
      userIds.length
        ? admin.from("profiles").select("id, full_name, email").in("id", userIds)
        : Promise.resolve({ data: [], error: null }),
      workspaceIds.length && recipientIds.length
        ? admin
            .from("workspace_access_grants")
            .select("workspace_id, redeemed_by, redeemed_at")
            .in("workspace_id", workspaceIds)
            .in("redeemed_by", recipientIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    for (const result of [workspaces, members, profiles, redeemedInvites]) {
      if (result.error) throw new Error(result.error.message);
    }
    const redeemedInviteAtByMemberKey = new Map<string, number[]>();
    for (const row of redeemedInvites.data ?? []) {
      if (!row.redeemed_by || !row.redeemed_at) continue;
      const redeemedAt = new Date(row.redeemed_at).getTime();
      if (!Number.isFinite(redeemedAt)) continue;
      const key = `${row.workspace_id}:${row.redeemed_by}`;
      redeemedInviteAtByMemberKey.set(key, [...(redeemedInviteAtByMemberKey.get(key) ?? []), redeemedAt]);
    }
    return {
      workspaceNameById: new Map((workspaces.data ?? []).map((row) => [row.id, row.name])),
      memberKeySet: new Set((members.data ?? []).map((row) => `${row.workspace_id}:${row.user_id}`)),
      redeemedInviteAtByMemberKey,
      profileById: new Map(
        (profiles.data ?? []).map((row) => [row.id, { fullName: row.full_name, email: row.email }]),
      ),
    };
  }

  function toItem(
    bundle: WelcomeBundle,
    event: MemberAddedEvent,
    pending: WorkspaceWelcomePending,
    origin: string,
  ): DrainItem<WorkspaceWelcomePending> {
    const selfCaused = event.actorId === null || event.actorId === event.recipientId;
    const actorName = event.actorId ? (bundle.profileById.get(event.actorId)?.fullName ?? null) : null;
    return {
      pending,
      email: bundle.profileById.get(pending.recipientId)?.email ?? null,
      content: renderWorkspaceWelcomeEmail({
        workspaceName: bundle.workspaceNameById.get(pending.workspaceId) ?? "your workspace",
        actorName,
        selfCaused,
        origin,
      }),
    };
  }

  return {
    ledger: "workspace_notifications",

    async collect(now, origin): Promise<DrainBatch<WorkspaceWelcomePending>> {
      const windowStart = new Date(now.getTime() - EVENT_WINDOW_DAYS * DAY_MS).toISOString();
      const { data: rows, error } = await admin
        .from("audit_log")
        .select("id, action, workspace_id, target_id, actor_id, created_at")
        .eq("action", "workspace_members.insert")
        .gte("created_at", windowStart)
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);

      const events = (rows ?? [])
        .map((row) => parseMemberAddedEvent(row))
        .filter((event): event is MemberAddedEvent => event !== null);

      const eventIds = events.map((event) => event.id);
      const { data: ledgerRows, error: ledgerError } = eventIds.length
        ? await admin.from("workspace_notifications").select("event_id, recipient_id").in("event_id", eventIds)
        : { data: [], error: null };
      if (ledgerError) throw new Error(ledgerError.message);
      const covered = new Set((ledgerRows ?? []).map((row) => `${row.event_id}:${row.recipient_id}`));

      const fresh = events.filter((event) => !covered.has(`${event.id}:${event.recipientId}`));
      const bundle = await loadBundle(fresh);

      const items: DrainItem<WorkspaceWelcomePending>[] = [];
      let oldestMs: number | null = null;
      for (const event of fresh) {
        const pending = resolveWorkspaceWelcome(event, {
          isStillMember: bundle.memberKeySet.has(`${event.workspaceId}:${event.recipientId}`),
          wasInvited: wasRedeemedInvite(bundle, event),
          workspaceName: bundle.workspaceNameById.get(event.workspaceId) ?? null,
          actorName: null,
        });
        if (!pending) continue;
        items.push(toItem(bundle, event, pending, origin));
        const age = now.getTime() - new Date(event.createdAt).getTime();
        oldestMs = oldestMs === null ? age : Math.max(oldestMs, age);
      }
      return {
        items,
        oldestUnnotifiedEventAgeHours: oldestMs === null ? null : Math.round(oldestMs / (60 * 60 * 1000)),
      };
    },

    async retryItems(now, origin): Promise<RetryItem[]> {
      const { data, error } = await admin
        .from("workspace_notifications")
        .select("id, workspace_id, recipient_id, event_id, attempts, last_attempt_at, created_at, content")
        .is("sent_at", null)
        .lt("attempts", MAX_SEND_ATTEMPTS);
      if (error) throw new Error(error.message);
      // Attempt-scaled lease off last_attempt_at (created_at for a never-tried
      // row) so one outage can't burn every attempt within minutes.
      const rows = (data ?? []).filter((row) =>
        isRetryDue(
          now,
          row.last_attempt_at ? new Date(row.last_attempt_at) : null,
          new Date(row.created_at),
          row.attempts,
        ),
      );
      if (rows.length === 0) return [];

      const pseudoEvents: MemberAddedEvent[] = rows.map((row) => ({
        id: Number(row.event_id),
        workspaceId: row.workspace_id,
        recipientId: row.recipient_id,
        actorId: null,
        createdAt: "",
      }));
      const bundle = await loadBundle(pseudoEvents);
      return rows.map((row) => ({
        ledgerId: Number(row.id),
        email: bundle.profileById.get(row.recipient_id)?.email ?? null,
        content:
          snapshotContent(row.content) ??
          renderWorkspaceWelcomeEmail({
            workspaceName: bundle.workspaceNameById.get(row.workspace_id) ?? "your workspace",
            actorName: null,
            selfCaused: true,
            origin,
          }),
        attempts: row.attempts,
      }));
    },

    async claim(pending, content) {
      const { data, error } = await admin
        .from("workspace_notifications")
        .insert({
          workspace_id: pending.workspaceId,
          recipient_id: pending.recipientId,
          kind: pending.kind,
          event_id: pending.eventId,
          content: content as unknown as Json,
        })
        .select("id")
        .single();
      if (error) {
        if (error.code === "23505") return { claimed: false, ledgerId: null };
        throw new Error(error.message);
      }
      return { claimed: true, ledgerId: Number(data.id) };
    },

    async deadRows(now) {
      const since = new Date(now.getTime() - DEAD_ROW_WINDOW_DAYS * DAY_MS).toISOString();
      const { count, error } = await admin
        .from("workspace_notifications")
        .select("id", { count: "exact", head: true })
        .is("sent_at", null)
        .is("skipped_reason", null)
        .gte("attempts", MAX_SEND_ATTEMPTS)
        .gte("created_at", since);
      if (error) throw new Error(error.message);
      return count ?? 0;
    },

    async claimRetry(ledgerId, expectedAttempts) {
      // Conditional bump: matches only while the row is still unsent AT the
      // attempt count the caller read. A concurrent drain that already advanced
      // it sees attempts move past `expectedAttempts` and updates zero rows.
      const { data, error } = await admin
        .from("workspace_notifications")
        .update({ attempts: expectedAttempts + 1, last_attempt_at: new Date().toISOString() })
        .eq("id", ledgerId)
        .is("sent_at", null)
        .eq("attempts", expectedAttempts)
        .select("id");
      if (error) throw new Error(error.message);
      return (data ?? []).length > 0;
    },

    async markSent(ledgerId, messageId) {
      const { error } = await admin
        .from("workspace_notifications")
        .update({ sent_at: new Date().toISOString(), resend_message_id: messageId })
        .eq("id", ledgerId);
      if (error) throw new Error(error.message);
    },

    async markFailed(ledgerId, message, attemptsAfter) {
      const { error } = await admin
        .from("workspace_notifications")
        .update({
          attempts: attemptsAfter,
          last_error: message.slice(0, 1000),
          last_attempt_at: new Date().toISOString(),
        })
        .eq("id", ledgerId);
      if (error) throw new Error(error.message);
    },
  };
}
