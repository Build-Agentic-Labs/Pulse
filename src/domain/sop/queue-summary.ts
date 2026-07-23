/**
 * Reduces the Review queue's QueueData to what the notification bell renders:
 * a total for the badge and ordered, non-empty sections for the dropdown.
 * Pure — the QueueData import is type-only, so this module carries no runtime
 * dependency on the lib layer. The badge shares the queue page's derivation by
 * construction, so the two can never disagree.
 * Spec: docs/superpowers/specs/2026-07-22-sop-notification-bell-design.md
 */

import type { QueueData } from "@/lib/sop/review-queue-data";

export interface QueueSummaryItem {
  notificationId: string;
  sopId: string;
  sopNumber: string | null;
  title: string | null;
}

export interface QueueSummarySection {
  key: "awaitingMe" | "finalApprovals" | "awaitingQuality" | "sentBack";
  label: string;
  items: QueueSummaryItem[];
}

export interface QueueSummary {
  total: number;
  sections: QueueSummarySection[];
}

function notificationId(section: QueueSummarySection["key"], values: Array<string | number | null>): string {
  return [section, ...values].map((value) => encodeURIComponent(String(value ?? ""))).join(":");
}

export function summarizeQueue(queue: QueueData): QueueSummary {
  const sections: QueueSummarySection[] = [
    {
      key: "awaitingMe" as const,
      label: "Awaiting my review",
      items: queue.awaitingMe.map((row) => ({
        notificationId: notificationId("awaitingMe", [
          row.sopId,
          row.departmentId,
          row.reviewCycle,
          row.contentHash,
        ]),
        sopId: row.sopId,
        sopNumber: row.sopNumber,
        title: row.title,
      })),
    },
    {
      key: "finalApprovals" as const,
      label: "Signature needed",
      items: queue.finalApprovals.map((row) => ({
        notificationId: notificationId("finalApprovals", [
          row.sopId,
          row.departmentId,
          row.reviewCycle,
          row.finalApprovalContentHash ?? row.contentHash,
          row.finalApprovalRequestedAt,
        ]),
        sopId: row.sopId,
        sopNumber: row.sopNumber,
        title: row.title,
      })),
    },
    {
      key: "awaitingQuality" as const,
      label: "Ready for release",
      items: queue.awaitingQuality.map((row) => ({
        notificationId: notificationId("awaitingQuality", [
          row.id,
          row.reviewCycle,
          row.contentHash,
          row.finalApprovalRequestedAt,
        ]),
        sopId: row.id,
        sopNumber: row.sopNumber,
        title: row.title,
      })),
    },
    {
      key: "sentBack" as const,
      label: "Sent back",
      items: queue.sentBack.map((row) => ({
        notificationId: notificationId("sentBack", [
          row.id,
          row.reviewCycle,
          row.contentHash,
          row.rejectedReason,
        ]),
        sopId: row.id,
        sopNumber: row.sopNumber,
        title: row.title,
      })),
    },
  ].filter((section) => section.items.length > 0);

  return {
    total: sections.reduce((sum, section) => sum + section.items.length, 0),
    sections,
  };
}

/** Removes browser-acknowledged workflow events without mutating the live queue projection. */
export function excludeAcknowledged(
  summary: QueueSummary,
  acknowledgedNotificationIds: ReadonlySet<string>,
): QueueSummary {
  const sections = summary.sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => !acknowledgedNotificationIds.has(item.notificationId)),
    }))
    .filter((section) => section.items.length > 0);

  return {
    total: sections.reduce((sum, section) => sum + section.items.length, 0),
    sections,
  };
}

/** Badge text: exact through 9, then "9+" — a top-bar tag, not a statistic. */
export function badgeLabel(total: number): string {
  return total > 9 ? "9+" : String(total);
}
