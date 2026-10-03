/**
 * Supabase-backed DrainStore for workspace membership emails: welcomes (member
 * inserts), role changes, removals, and accepted invitations. audit_log is the
 * outbox (its trigger records every change transactionally); recipients resolve
 * against CURRENT membership so stale events self-cancel; claims land in
 * workspace_notifications. Service-role only — construct exclusively inside the
 * drain route. All queries batched by id set.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { resolveEmailEnabled, type PreferenceRow } from "@/domain/notifications/channels";
import { inboxEntryFromEmail } from "@/domain/notifications/inbox";
import {
  MEMBERSHIP_NOTIFIABLE_ACTIONS,
  parseMembershipEvent,
  renderMembershipEmail,
  resolveMembershipNotification,
  type MembershipEvent,
  type MembershipPending,
} from "@/domain/workspace/membership-notifications";
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
import { readAllPages, readRowsByIds } from "@/lib/supabase/read-all-pages";
import { throwIfError } from "@/lib/supabase-errors";
import { stampDeliveredChannel } from "@/lib/sop/notifications-store";

const EVENT_WINDOW_DAYS = 30;
const DEAD_ROW_WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export type WorkspaceNotificationPending = WorkspaceWelcomePending | MembershipPending;

interface WelcomeBundle {
  prefsByUser: Map<string, PreferenceRow[]>;
  suppressed: Set<string>;
  workspaceNameById: Map<string, string>;
  memberKeySet: Set<string>; // `${workspaceId}:${userId}`
  redeemedInviteAtByMemberKey: Map<string, number[]>; // `${workspaceId}:${userId}` -> redemption times
  profileById: Map<string, { fullName: string | null; email: string | null }>;
}

interface Participant {
  workspaceId: string;
  recipientId: string;
  actorId: string | null;
}

const INVITE_EVENT_MATCH_TOLERANCE_MS = 5_000;

function wasRedeemedInvite(bundle: WelcomeBundle, event: MemberAddedEvent): boolean {
  const eventTime = new Date(event.createdAt).getTime();
  if (!Number.isFinite(eventTime)) return false;
  return (bundle.redeemedInviteAtByMemberKey.get(`${event.workspaceId}:${event.recipientId}`) ?? []).some(
    (redeemedAt) => Math.abs(redeemedAt - eventTime) <= INVITE_EVENT_MATCH_TOLERANCE_MS,
  );
}

export function createWorkspaceWelcomeDrainStore(
  admin: SupabaseClient<Database>,
): DrainStore<WorkspaceNotificationPending> {
  async function loadBundle(participants: Participant[]): Promise<WelcomeBundle> {
    const workspaceIds = Array.from(new Set(participants.map((entry) => entry.workspaceId)));
    const recipientIds = Array.from(new Set(participants.map((entry) => entry.recipientId)));
    const userIds = Array.from(
      new Set(participants.flatMap((entry) => (entry.actorId ? [entry.recipientId, entry.actorId] : [entry.recipientId]))),
    );
    // Batch participant pairs together: two independently chunked global ID
    // lists would create a workspace × recipient request explosion. Both IN
    // filters stay small, and repeated grants across batches are deduplicated.
    async function loadRedeemedInvites() {
      const pairs = [...new Map(participants.map((entry) => [
        `${entry.workspaceId}:${entry.recipientId}`, entry,
      ])).values()];
      const grants = new Map<string, { workspace_id: string; redeemed_by: string | null; redeemed_at: string | null }>();
      for (let start = 0; start < pairs.length; start += 50) {
        const batch = pairs.slice(start, start + 50);
        const rows = await readAllPages((from, to) => throwIfError(admin
          .from("workspace_access_grants")
          .select("workspace_id, email, redeemed_by, redeemed_at")
          .in("workspace_id", [...new Set(batch.map((entry) => entry.workspaceId))])
          .in("redeemed_by", [...new Set(batch.map((entry) => entry.recipientId))])
          .order("workspace_id").order("email").range(from, to)));
        for (const row of rows) grants.set(`${row.workspace_id}:${row.email}`, row);
      }
      return [...grants.values()];
    }
    const [workspaces, members, profiles, redeemedInvites] = await Promise.all([
      readRowsByIds(workspaceIds, (ids, from, to) => throwIfError(admin.from("workspaces")
        .select("id, name").in("id", ids).order("id").range(from, to))),
      readRowsByIds(workspaceIds, (ids, from, to) => throwIfError(admin.from("workspace_members")
        .select("workspace_id, user_id").in("workspace_id", ids)
        .order("workspace_id").order("user_id").range(from, to))),
      readRowsByIds(userIds, (ids, from, to) => throwIfError(admin.from("profiles")
        .select("id, full_name, email").in("id", ids).order("id").range(from, to))),
      loadRedeemedInvites(),
    ]);
    const redeemedInviteAtByMemberKey = new Map<string, number[]>();
    for (const row of redeemedInvites) {
      if (!row.redeemed_by || !row.redeemed_at) continue;
      const redeemedAt = new Date(row.redeemed_at).getTime();
      if (!Number.isFinite(redeemedAt)) continue;
      const key = `${row.workspace_id}:${row.redeemed_by}`;
      redeemedInviteAtByMemberKey.set(key, [...(redeemedInviteAtByMemberKey.get(key) ?? []), redeemedAt]);
    }
    const profileById = new Map(
      profiles.map((row) => [row.id, { fullName: row.full_name, email: row.email }]),
    );
    const recipientEmails = recipientIds
      .map((id) => profileById.get(id)?.email?.toLowerCase())
      .filter((email): email is string => Boolean(email));
    const [prefs, suppressions] = await Promise.all([
      readRowsByIds(recipientIds, (ids, from, to) => throwIfError(admin
        .from("notification_preferences").select("user_id, workspace_id, kind, channel, mode")
        .in("user_id", ids).eq("channel", "email")
        .order("user_id").order("workspace_id").order("kind").order("channel").range(from, to))),
      readRowsByIds([...new Set(recipientEmails)], (emails, from, to) => throwIfError(admin
        .from("email_suppressions").select("email").in("email", emails).order("email").range(from, to)), 3500),
    ]);
    const prefsByUser = new Map<string, PreferenceRow[]>();
    for (const row of prefs) {
      prefsByUser.set(row.user_id, [
        ...(prefsByUser.get(row.user_id) ?? []),
        { workspaceId: row.workspace_id, kind: row.kind, channel: row.channel, mode: row.mode },
      ]);
    }
    return {
      prefsByUser,
      suppressed: new Set(suppressions.map((row) => String(row.email).toLowerCase())),
      workspaceNameById: new Map(workspaces.map((row) => [row.id, row.name])),
      memberKeySet: new Set(members.map((row) => `${row.workspace_id}:${row.user_id}`)),
      redeemedInviteAtByMemberKey,
      profileById,
    };
  }

  function channelsFor(bundle: WelcomeBundle, pending: WorkspaceNotificationPending, email: string | null) {
    return {
      email: resolveEmailEnabled(pending.kind, pending.workspaceId, bundle.prefsByUser.get(pending.recipientId) ?? []),
      suppressed: email !== null && bundle.suppressed.has(email.toLowerCase()),
    };
  }

  function inboxFor(pending: WorkspaceNotificationPending) {
    return { link: "/", entityType: "workspace", entityId: pending.workspaceId, workspaceId: pending.workspaceId };
  }

  function welcomeItem(
    bundle: WelcomeBundle,
    event: MemberAddedEvent,
    pending: WorkspaceWelcomePending,
    origin: string,
  ): DrainItem<WorkspaceNotificationPending> {
    const selfCaused = event.actorId === null || event.actorId === event.recipientId;
    const actorName = event.actorId ? (bundle.profileById.get(event.actorId)?.fullName ?? null) : null;
    const email = bundle.profileById.get(pending.recipientId)?.email ?? null;
    return {
      pending,
      email,
      channels: channelsFor(bundle, pending, email),
      inbox: inboxFor(pending),
      content: renderWorkspaceWelcomeEmail({
        workspaceName: bundle.workspaceNameById.get(pending.workspaceId) ?? "your workspace",
        actorName,
        selfCaused,
        origin,
      }),
    };
  }

  function membershipItem(
    bundle: WelcomeBundle,
    event: MembershipEvent,
    pending: MembershipPending,
    origin: string,
  ): DrainItem<WorkspaceNotificationPending> {
    const email = bundle.profileById.get(pending.recipientId)?.email ?? null;
    return {
      pending,
      email,
      channels: channelsFor(bundle, pending, email),
      inbox: inboxFor(pending),
      content: renderMembershipEmail({
        kind: event.kind,
        workspaceName: bundle.workspaceNameById.get(pending.workspaceId) ?? "your workspace",
        actorName: event.actorId ? (bundle.profileById.get(event.actorId)?.fullName ?? null) : null,
        origin,
        role: event.role,
        inviteeEmail: event.inviteeEmail,
      }),
    };
  }

  return {
    ledger: "workspace_notifications",

    async collect(now, origin): Promise<DrainBatch<WorkspaceNotificationPending>> {
      const windowStart = new Date(now.getTime() - EVENT_WINDOW_DAYS * DAY_MS).toISOString();
      const rows = await readAllPages((from, to) => throwIfError(admin
        .from("audit_log")
        .select("id, action, workspace_id, target_id, actor_id, details, created_at")
        .in("action", [...MEMBERSHIP_NOTIFIABLE_ACTIONS])
        .gte("created_at", windowStart)
        .order("created_at", { ascending: true }).order("id").range(from, to)));

      const welcomes: MemberAddedEvent[] = [];
      const memberships: MembershipEvent[] = [];
      for (const row of rows ?? []) {
        const added = parseMemberAddedEvent(row);
        if (added) {
          welcomes.push(added);
          continue;
        }
        const membership = parseMembershipEvent(row);
        if (membership) memberships.push(membership);
      }

      const eventIds = [...welcomes.map((event) => event.id), ...memberships.map((event) => event.id)];
      const ledgerRows = await readRowsByIds(eventIds.map(String), (ids, from, to) => throwIfError(admin
        .from("workspace_notifications").select("event_id, recipient_id")
        .in("event_id", ids.map(Number)).order("id").range(from, to)));
      const covered = new Set((ledgerRows ?? []).map((row) => `${row.event_id}:${row.recipient_id}`));

      const freshWelcomes = welcomes.filter((event) => !covered.has(`${event.id}:${event.recipientId}`));
      const freshMemberships = memberships.filter((event) => !covered.has(`${event.id}:${event.recipientId}`));
      const bundle = await loadBundle([...freshWelcomes, ...freshMemberships]);

      const items: DrainItem<WorkspaceNotificationPending>[] = [];
      let oldestMs: number | null = null;
      const noteAge = (createdAt: string) => {
        const age = now.getTime() - new Date(createdAt).getTime();
        oldestMs = oldestMs === null ? age : Math.max(oldestMs, age);
      };

      for (const event of freshWelcomes) {
        const pending = resolveWorkspaceWelcome(event, {
          isStillMember: bundle.memberKeySet.has(`${event.workspaceId}:${event.recipientId}`),
          wasInvited: wasRedeemedInvite(bundle, event),
          workspaceName: bundle.workspaceNameById.get(event.workspaceId) ?? null,
          actorName: null,
        });
        if (!pending) continue;
        items.push(welcomeItem(bundle, event, pending, origin));
        noteAge(event.createdAt);
      }
      for (const event of freshMemberships) {
        const pending = resolveMembershipNotification(event, {
          recipientIsMember: bundle.memberKeySet.has(`${event.workspaceId}:${event.recipientId}`),
          workspaceName: bundle.workspaceNameById.get(event.workspaceId) ?? null,
        });
        if (!pending) continue;
        items.push(membershipItem(bundle, event, pending, origin));
        noteAge(event.createdAt);
      }
      return {
        items,
        oldestUnnotifiedEventAgeHours: oldestMs === null ? null : Math.round(oldestMs / (60 * 60 * 1000)),
      };
    },

    async retryItems(now, origin): Promise<RetryItem[]> {
      const data = await readAllPages((from, to) => throwIfError(admin
        .from("workspace_notifications")
        .select("id, workspace_id, recipient_id, event_id, kind, attempts, last_attempt_at, created_at, content")
        .is("sent_at", null)
        .is("skipped_reason", null)
        .lt("attempts", MAX_SEND_ATTEMPTS).order("id").range(from, to)));
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

      const bundle = await loadBundle(
        rows.map((row) => ({ workspaceId: row.workspace_id, recipientId: row.recipient_id, actorId: null })),
      );
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

    async claim(item) {
      const { pending, content } = item;
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
      const ledgerId = Number(data.id);
      const entry = inboxEntryFromEmail(content, item.inbox);
      const { error: inboxError } = await admin.from("notifications").insert({
        recipient_id: pending.recipientId,
        workspace_id: item.inbox.workspaceId,
        source: "workspace",
        source_ledger_id: ledgerId,
        kind: pending.kind,
        entity_type: entry.entityType,
        entity_id: entry.entityId,
        title: entry.title,
        body: entry.body,
        link: entry.link,
      });
      if (inboxError) {
        console.error("workspace_notifications: inbox row write failed", { ledgerId, message: inboxError.message });
      }
      return { claimed: true, ledgerId };
    },

    async markSkipped(ledgerId, reason) {
      const { error } = await admin.from("workspace_notifications").update({ skipped_reason: reason }).eq("id", ledgerId);
      if (error) throw new Error(error.message);
    },

    async recordChannel(ledgerId, channel, status) {
      await stampDeliveredChannel(admin, "workspace", ledgerId, channel, status);
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
