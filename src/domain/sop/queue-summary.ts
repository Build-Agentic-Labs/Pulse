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

export function summarizeQueue(queue: QueueData): QueueSummary {
  const sections: QueueSummarySection[] = [
    {
      key: "awaitingMe" as const,
      label: "Awaiting my review",
      items: queue.awaitingMe.map((row) => ({ sopId: row.sopId, sopNumber: row.sopNumber, title: row.title })),
    },
    {
      key: "finalApprovals" as const,
      label: "Signature needed",
      items: queue.finalApprovals.map((row) => ({ sopId: row.sopId, sopNumber: row.sopNumber, title: row.title })),
    },
    {
      key: "awaitingQuality" as const,
      label: "Ready for release",
      items: queue.awaitingQuality.map((row) => ({ sopId: row.id, sopNumber: row.sopNumber, title: row.title })),
    },
    {
      key: "sentBack" as const,
      label: "Sent back",
      items: queue.sentBack.map((row) => ({ sopId: row.id, sopNumber: row.sopNumber, title: row.title })),
    },
  ].filter((section) => section.items.length > 0);

  return {
    total: sections.reduce((sum, section) => sum + section.items.length, 0),
    sections,
  };
}

/** Badge text: exact through 9, then "9+" — a top-bar tag, not a statistic. */
export function badgeLabel(total: number): string {
  return total > 9 ? "9+" : String(total);
}
