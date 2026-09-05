/**
 * DrainStore for the weekly stalled-work digest (notification_digests). Reads
 * the same live stall picture as the SOP drain (createSopContextLoader), decides
 * with the pure digest module, and claims one row per recipient per ISO week.
 * Service-role only; the route runs it on cron calls only, never on kicks.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveEmailEnabled } from "@/domain/notifications/channels";
import {
  buildStalledDigest,
  renderStalledDigestEmail,
  selectStalledSops,
  type DigestPending,
  type DigestWorkspaceState,
  type StalledSop,
} from "@/domain/notifications/digest";
import { inboxEntryFromEmail } from "@/domain/notifications/inbox";
import { listNumberLabel } from "@/domain/sop/authoring";
import { describeStall } from "@/domain/sop/notifications";
import type { Database, Json } from "@/lib/database.types";
import { createSopContextLoader, stampDeliveredChannel } from "@/lib/sop/notifications-store";
import {
  MAX_SEND_ATTEMPTS,
  isRetryDue,
  snapshotContent,
  type DrainBatch,
  type DrainItem,
  type DrainStore,
  type RetryItem,
} from "@/lib/sop/notifications-drain";

const DEAD_ROW_WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export function createStalledDigestDrainStore(admin: SupabaseClient<Database>): DrainStore<DigestPending> {
  const loader = createSopContextLoader(admin);

  return {
    ledger: "notification_digests",

    async collect(now, origin): Promise<DrainBatch<DigestPending>> {
      const { rows, states, bundle } = await loader.loadStallStates(now);
      if (rows.length === 0) return { items: [], oldestUnnotifiedEventAgeHours: null };

      const stateBySop = new Map(states.map((state) => [state.sop.id, state]));
      const stalledByWorkspace = new Map<string, StalledSop[]>();
      const candidates = rows.map((row) => {
        const state = stateBySop.get(row.id);
        return {
          workspaceId: row.workspace_id,
          sopId: row.id,
          label: `${listNumberLabel(row.sop_number ?? "", row.department_id ? (bundle.departmentCodeById.get(row.department_id) ?? null) : null)} · ${row.title || "Untitled SOP"}`,
          status: row.status,
          lastMovedAt: row.updated_at ?? now.toISOString(),
          waitingOn: state ? describeStall(state) || "the next step" : "the next step",
        };
      });
      for (const stalled of selectStalledSops(now, candidates)) {
        const workspaceId = candidates.find((candidate) => candidate.sopId === stalled.sopId)?.workspaceId ?? "";
        stalledByWorkspace.set(workspaceId, [...(stalledByWorkspace.get(workspaceId) ?? []), stalled]);
      }
      if (stalledByWorkspace.size === 0) return { items: [], oldestUnnotifiedEventAgeHours: null };

      const workspaceIds = Array.from(stalledByWorkspace.keys());
      const { data: workspaces, error: workspacesError } = await admin
        .from("workspaces")
        .select("id, name")
        .in("id", workspaceIds);
      if (workspacesError) throw new Error(workspacesError.message);
      const nameById = new Map((workspaces ?? []).map((row) => [row.id, row.name]));

      const workspaceStates: DigestWorkspaceState[] = workspaceIds.map((workspaceId) => {
        const qualityApprovers = states
          .filter((state) => rows.find((row) => row.id === state.sop.id)?.workspace_id === workspaceId)
          .flatMap((state) => state.qualityApprovers.map((approver) => approver.userId));
        return {
          workspaceId,
          workspaceName: nameById.get(workspaceId) ?? "your workspace",
          recipients: [...(bundle.managersByWorkspace.get(workspaceId) ?? []), ...qualityApprovers],
          stalled: stalledByWorkspace.get(workspaceId) ?? [],
        };
      });

      const pendings = buildStalledDigest(now, workspaceStates);
      const recipientIds = pendings.map((pending) => pending.recipientId);
      await loader.loadEmails(bundle, recipientIds);
      await loader.loadChannels(bundle, recipientIds);

      const items: DrainItem<DigestPending>[] = pendings.map((pending) => {
        const email = bundle.emailByUser.get(pending.recipientId) ?? null;
        const workspace = workspaceStates.find((state) => state.workspaceId === pending.workspaceId);
        return {
          pending,
          email,
          channels: {
            email: resolveEmailEnabled(pending.kind, pending.workspaceId, bundle.prefsByUser.get(pending.recipientId) ?? []),
            suppressed: email !== null && bundle.suppressed.has(email.toLowerCase()),
          },
          inbox: { link: "/sops/review", entityType: "workspace", entityId: pending.workspaceId, workspaceId: pending.workspaceId },
          content: renderStalledDigestEmail({
            workspaceName: workspace?.workspaceName ?? "your workspace",
            periodKey: pending.periodKey,
            stalled: workspace?.stalled ?? [],
            origin,
          }),
        };
      });
      return { items, oldestUnnotifiedEventAgeHours: null };
    },

    async retryItems(now, _origin): Promise<RetryItem[]> {
      const { data, error } = await admin
        .from("notification_digests")
        .select("id, workspace_id, recipient_id, period_key, attempts, last_attempt_at, created_at, content")
        .is("sent_at", null)
        .is("skipped_reason", null)
        .lt("attempts", MAX_SEND_ATTEMPTS);
      if (error) throw new Error(error.message);
      const rows = (data ?? []).filter((row) =>
        isRetryDue(now, row.last_attempt_at ? new Date(row.last_attempt_at) : null, new Date(row.created_at), row.attempts),
      );
      if (rows.length === 0) return [];
      const { data: profiles, error: profilesError } = await admin
        .from("profiles")
        .select("id, email")
        .in("id", Array.from(new Set(rows.map((row) => row.recipient_id))));
      if (profilesError) throw new Error(profilesError.message);
      const emailById = new Map((profiles ?? []).map((row) => [row.id, row.email]));
      return rows.flatMap((row) => {
        const content = snapshotContent(row.content);
        // A digest without its snapshot cannot be faithfully re-rendered (the
        // stall picture has moved on); it is left for the dead-row report.
        if (!content) return [];
        return [{ ledgerId: Number(row.id), email: emailById.get(row.recipient_id) ?? null, content, attempts: row.attempts }];
      });
    },

    async claim(item) {
      const { pending, content } = item;
      const { data, error } = await admin
        .from("notification_digests")
        .insert({
          workspace_id: pending.workspaceId,
          recipient_id: pending.recipientId,
          kind: pending.kind,
          period_key: pending.periodKey,
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
        source: "digest",
        source_ledger_id: ledgerId,
        kind: pending.kind,
        entity_type: entry.entityType,
        entity_id: entry.entityId,
        title: entry.title,
        body: entry.body,
        link: entry.link,
      });
      if (inboxError) {
        console.error("notification_digests: inbox row write failed", { ledgerId, message: inboxError.message });
      }
      return { claimed: true, ledgerId };
    },

    async markSkipped(ledgerId, reason) {
      const { error } = await admin.from("notification_digests").update({ skipped_reason: reason }).eq("id", ledgerId);
      if (error) throw new Error(error.message);
    },

    async recordChannel(ledgerId, channel, status) {
      await stampDeliveredChannel(admin, "digest", ledgerId, channel, status);
    },

    async deadRows(now) {
      const since = new Date(now.getTime() - DEAD_ROW_WINDOW_DAYS * DAY_MS).toISOString();
      const { count, error } = await admin
        .from("notification_digests")
        .select("id", { count: "exact", head: true })
        .is("sent_at", null)
        .is("skipped_reason", null)
        .gte("attempts", MAX_SEND_ATTEMPTS)
        .gte("created_at", since);
      if (error) throw new Error(error.message);
      return count ?? 0;
    },

    async claimRetry(ledgerId, expectedAttempts) {
      const { data, error } = await admin
        .from("notification_digests")
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
        .from("notification_digests")
        .update({ sent_at: new Date().toISOString(), resend_message_id: messageId })
        .eq("id", ledgerId);
      if (error) throw new Error(error.message);
    },

    async markFailed(ledgerId, message, attemptsAfter) {
      const { error } = await admin
        .from("notification_digests")
        .update({ attempts: attemptsAfter, last_error: message.slice(0, 1000), last_attempt_at: new Date().toISOString() })
        .eq("id", ledgerId);
      if (error) throw new Error(error.message);
    },
  };
}
