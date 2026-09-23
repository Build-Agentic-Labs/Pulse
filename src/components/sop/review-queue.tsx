"use client";

import { Inbox } from "lucide-react";
import Link from "next/link";
import { Fragment, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { summarizeQueue } from "@/domain/sop/queue-summary";
import { publishReviewQueueCount } from "@/lib/sop/review-queue-count";
import { QuietLoading } from "@/components/quiet-loading";
import { formatDate } from "@/domain/formatting";
import { listNumberLabel } from "@/domain/sop/authoring";
import { createPlannerSupabaseClient, getUserFromSession } from "@/domain/supabase-planner";
import {
  EMPTY_QUEUE as EMPTY,
  fetchReviewQueueData,
  type PendingSeat,
  type QualityQueueItem,
  type QueueData,
} from "@/lib/sop/review-queue-data";
import type { SopListItem } from "@/lib/sop/store";
import { useSopWorkspace } from "./sop-workspace-provider";
import { SopFinalApprovalWorkspace } from "./sop-final-approval-workspace";
import { SopReviewWorkspace } from "./sop-review-workspace";



type ListStatus = "loading" | "ready" | "error";

interface QueueRow {
  key: string;
  number: string;
  title: string;
  /** Who sent it; "You" for your own SOPs, "" when unknown. */
  author: string;
  status: string;
  /** When it landed on the viewer. */
  receivedAt: string;
  /** Exactly one of href (navigate) or onOpen (open the review/signature workspace in place). */
  href?: string;
  onOpen?: () => void;
}

/** The All SOPs table, with one group row per bucket of work. */
function QueueTable({ groups }: { groups: { label: string; rows: QueueRow[] }[] }) {
  return (
    <div className="ui-data-table-frame ui-data-table-frame-canvas">
      <div className="ui-table-scroll">
        <table className="w-full min-w-[720px] border-collapse text-left">
          <thead>
            <tr className="border-b border-line">
              <th className="w-36 px-5 py-3 text-[11px] font-medium text-ink-secondary">Number</th>
              <th className="px-5 py-3 text-[11px] font-medium text-ink-secondary">Title</th>
              <th className="w-44 px-5 py-3 text-[11px] font-medium text-ink-secondary">Author</th>
              <th className="w-44 px-5 py-3 text-[11px] font-medium text-ink-secondary">Status</th>
              <th className="w-28 px-5 py-3 text-[11px] font-medium text-ink-secondary">Received</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <Fragment key={group.label}>
                <tr className="border-b border-line bg-canvas/70">
                  <th colSpan={5} className="px-5 py-2.5 text-left">
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate text-sm font-semibold text-ink">{group.label}</span>
                      <span className="shrink-0 text-xs font-normal tabular-nums text-ink-tertiary">
                        {group.rows.length} {group.rows.length === 1 ? "SOP" : "SOPs"}
                      </span>
                    </div>
                  </th>
                </tr>
                {group.rows.map((row) => (
                  <tr
                    key={row.key}
                    className="group border-b border-line/70 transition-colors last:border-b-0 hover:bg-surface-hover"
                  >
                    <td className="px-5 py-3.5 align-middle">
                      <QueueRowTarget row={row} className="text-xs font-medium text-ink-secondary hover:text-ink">
                        {row.number}
                      </QueueRowTarget>
                    </td>
                    <td className="max-w-0 px-5 py-3.5 align-middle">
                      <QueueRowTarget row={row} className="block w-full min-w-0 text-left">
                        <span className="block truncate text-[13px] font-medium leading-snug text-ink">{row.title}</span>
                      </QueueRowTarget>
                    </td>
                    <td className="max-w-0 px-5 py-3.5 align-middle">
                      <span className="block truncate text-[12px] text-ink-secondary">{row.author || "—"}</span>
                    </td>
                    <td className="px-5 py-3.5 align-middle">
                      <span className="inline-flex shrink-0 items-center whitespace-nowrap rounded bg-surface-muted px-2 py-1 text-[11px] font-medium text-ink-secondary">
                        {row.status}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 align-middle text-[12px] tabular-nums text-ink-tertiary">
                      {formatDate(row.receivedAt) || "—"}
                    </td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function QueueRowTarget({ row, className, children }: { row: QueueRow; className: string; children: ReactNode }) {
  if (row.href) {
    return (
      <Link href={row.href} className={className}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" className={className} onClick={row.onOpen}>
      {children}
    </button>
  );
}

// PendingSeat / QualityQueueItem / QueueData / EMPTY_QUEUE and the queue assembly
// live in @/lib/sop/review-queue-data, shared with the server page (Stage 5).

/**
 * The reviewer's own queue, not a workspace board. "Notification" here means the SOP shows up
 * where the person already looks — derived from the roster, so there is no notifications table
 * to keep in sync with reality.
 */
export function ReviewQueue({
  active = true,
  preload = false,
  initialQueue,
  initialWorkspaceId,
  openReviewId = null,
}: {
  active?: boolean;
  preload?: boolean;
  /** Server-fetched first paint (Stage 5): seeds the queue, then background-revalidates. */
  initialQueue?: QueueData;
  initialWorkspaceId?: string;
  /** `?review=<sopId>`: open that SOP's review straight away (a reviewer clicking it elsewhere). */
  openReviewId?: string | null;
}) {
  const { workspaceId } = useSopWorkspace();
  const seededFromServer =
    initialQueue !== undefined && initialWorkspaceId !== undefined && initialWorkspaceId === workspaceId;
  const [data, setData] = useState<QueueData>(seededFromServer ? initialQueue : EMPTY);
  const [listStatus, setListStatus] = useState<ListStatus>(seededFromServer ? "ready" : "loading");
  const [error, setError] = useState("");
  const [selectedReviewId, setSelectedReviewId] = useState<string | null>(openReviewId);
  useEffect(() => {
    if (openReviewId) setSelectedReviewId(openReviewId);
  }, [openReviewId]);
  // The deep link has done its job once the review closes; drop it so a reload or
  // Back doesn't reopen a review the reviewer already left.
  const closeReview = useCallback(() => {
    setSelectedReviewId(null);
    if (new URLSearchParams(window.location.search).has("review")) {
      window.history.replaceState(null, "", "/sops?tab=review");
    }
  }, []);
  const [selectedFinalApproval, setSelectedFinalApproval] = useState<PendingSeat | null>(null);
  // Server-seeded data marks itself loaded-but-stale (loadedAt: 1): the mount effect
  // refreshes in the background instead of flashing a loader.
  const freshnessRef = useRef<{ workspaceId?: string; loadedAt: number }>(
    seededFromServer ? { workspaceId, loadedAt: 1 } : { loadedAt: 0 },
  );
  // Bumped at the start of every refresh so an in-flight load for a prior workspace
  // bails instead of overwriting the current one after a switch.
  const refreshGenerationRef = useRef(0);

  const refreshList = useCallback(async (options: { background?: boolean } = {}) => {
    const generation = ++refreshGenerationRef.current;
    const isCurrent = () => refreshGenerationRef.current === generation;
    if (!workspaceId) {
      setData(EMPTY);
      setListStatus("ready");
      freshnessRef.current = { workspaceId, loadedAt: Date.now() };
      return;
    }
    if (!options.background) {
      setListStatus("loading");
      setError("");
    }
    try {
      const supabase = createPlannerSupabaseClient();
      const userResult = await getUserFromSession(supabase);
      if (!isCurrent()) return;
      const userId = userResult.data.user?.id ?? null;
      if (!userId) {
        setData(EMPTY);
        setListStatus("ready");
        freshnessRef.current = { workspaceId, loadedAt: Date.now() };
        return;
      }

      const queue = await fetchReviewQueueData(workspaceId, userId);
      if (!isCurrent()) return;
      setData(queue);
      setError("");
      setListStatus("ready");
      freshnessRef.current = { workspaceId, loadedAt: Date.now() };
    } catch (caught) {
      if (!isCurrent()) return;
      if (!options.background) {
        setError(caught instanceof Error ? caught.message : "Could not load your review queue.");
        setListStatus("error");
      }
    }
  }, [workspaceId]);

  useEffect(() => {
    if (!active && !preload) return;
    const hasCurrentData =
      freshnessRef.current.workspaceId === workspaceId && freshnessRef.current.loadedAt > 0;
    if (hasCurrentData && Date.now() - freshnessRef.current.loadedAt < 15_000) return;
    void refreshList({ background: hasCurrentData });
  }, [active, preload, refreshList, workspaceId]);

  // Reviewers keep this open as their inbox, and workflow actions often finish in another tab
  // (review/signature workspaces). Refresh as soon as the user returns, with a visible-tab
  // interval as a fallback for long-lived tabs. Background refreshes preserve the current queue
  // instead of flashing a loader.
  useEffect(() => {
    if (!active || !workspaceId) return;

    const refreshInBackground = () => {
      if (document.visibilityState === "visible") void refreshList({ background: true });
    };
    const interval = window.setInterval(refreshInBackground, 15_000);
    window.addEventListener("focus", refreshInBackground);
    document.addEventListener("visibilitychange", refreshInBackground);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshInBackground);
      document.removeEventListener("visibilitychange", refreshInBackground);
    };
  }, [active, refreshList, workspaceId]);

  const pendingReviewIds = new Set(data.awaitingMe.map((seat) => seat.sopId));
  const draftReviews = data.allInFlight.filter(
    (sop) => sop.status === "in_review" && pendingReviewIds.has(sop.id),
  );
  const awaitingRelease = data.isQualityApprover
    ? []
    : data.allInFlight.filter((sop) => sop.status === "approved");
  const reviewRows: QueueRow[] = [
    ...draftReviews.map((sop) => ({
      key: `review:${sop.id}`,
      number: listNumberLabel(sop.sopNumber, sop.departmentCode),
      title: sop.title || sop.sopNumber || "Untitled SOP",
      author: data.authorNames[sop.id] ?? "",
      status: "Draft review",
      receivedAt: data.receivedAt[sop.id] ?? sop.updatedAt,
      onOpen: () => setSelectedReviewId(sop.id),
    })),
    ...data.finalApprovals.map((seat) => ({
      key: `sign:${seat.sopId}:${seat.departmentId}`,
      number: listNumberLabel(seat.sopNumber, seat.sopDepartmentCode),
      title: seat.title || seat.sopNumber || "Untitled SOP",
      author: data.authorNames[seat.sopId] ?? "",
      status: "Signature needed",
      receivedAt: seat.finalApprovalRequestedAt ?? seat.updatedAt,
      onOpen: () => setSelectedFinalApproval(seat),
    })),
  ];
  const authoredRow = (sop: SopListItem, status: string, step: string): QueueRow => ({
    key: `mine:${sop.id}`,
    number: listNumberLabel(sop.sopNumber, sop.departmentCode),
    title: sop.title || sop.sopNumber || "Untitled SOP",
    author: "You",
    status,
    receivedAt: data.receivedAt[sop.id] ?? sop.updatedAt,
    href: `/sops/${sop.id}?step=${step}`,
  });
  const feedbackRows: QueueRow[] = [
    ...data.feedbackToAddress.map((sop) => authoredRow(sop, "Remarks to address", "draft-review")),
    ...data.readyForFinalApproval.map((sop) => authoredRow(sop, "Ready for final approval", "final-approval")),
    ...data.sentBack.map((sop) => authoredRow(sop, "Sent back", "draft-review")),
  ];
  const releaseRows: QueueRow[] = awaitingRelease.map((sop) => ({
    key: `release:${sop.id}`,
    number: listNumberLabel(sop.sopNumber, sop.departmentCode),
    title: sop.title || sop.sopNumber || "Untitled SOP",
    author: "",
    status: "Awaiting Quality",
    receivedAt: sop.updatedAt,
    href: `/sops/${sop.id}?step=quality-approval`,
  }));
  const queueGroups = [
    { label: "Needs your review", rows: reviewRows },
    { label: "Feedback on your SOPs", rows: feedbackRows },
    { label: "Awaiting Quality release", rows: releaseRows },
  ].filter((group) => group.rows.length > 0);
  const needsReviewCount = draftReviews.length + data.finalApprovals.length;
  const feedbackBackCount =
    data.feedbackToAddress.length + data.readyForFinalApproval.length + data.sentBack.length;
  const nothingToDo =
    needsReviewCount === 0 &&
    feedbackBackCount === 0 &&
    data.awaitingQuality.length === 0 &&
    awaitingRelease.length === 0;

  // Keep the sidebar badge in step with what this page shows, between bell refreshes.
  useEffect(() => {
    if (listStatus !== "ready" || !workspaceId || freshnessRef.current.workspaceId !== workspaceId) return;
    publishReviewQueueCount(workspaceId, summarizeQueue(data).total);
  }, [data, listStatus, workspaceId]);
  const qualityGroups = useMemo(() => {
    const groups = new Map<string, { key: string; code: string; name: string; sops: QualityQueueItem[] }>();
    for (const sop of data.awaitingQuality) {
      const key = sop.departmentId ?? `${sop.departmentCode}:${sop.departmentName}`;
      const group = groups.get(key) ?? {
        key,
        code: sop.departmentCode,
        name: sop.departmentName,
        sops: [],
      };
      group.sops.push(sop);
      groups.set(key, group);
    }
    return Array.from(groups.values()).sort((left, right) => left.name.localeCompare(right.name));
  }, [data.awaitingQuality]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="ui-section-title">{data.isQualityApprover ? "Quality review queue" : "Review queue"}</h1>
      </div>

      {error ? <div className="ui-notice ui-notice-warn px-4 py-3 ui-section-subtitle">{error}</div> : null}

      {listStatus === "loading" ? (
        <QuietLoading active={active} label="Loading review queue" />
      ) : listStatus === "error" ? (
        <section className="ui-empty-state">
          <p className="ui-section-subtitle text-ink-tertiary">{error || "Could not load your review queue."}</p>
          <button type="button" className="ui-btn-ghost mt-3 inline-flex h-9 px-3" onClick={() => void refreshList()}>
            Retry
          </button>
        </section>
      ) : nothingToDo ? (
        <section className="ui-empty-state ui-empty-state-flat">
          <Inbox size={20} className="mx-auto text-ink-tertiary" />
          <p className="mt-2 ui-section-subtitle text-ink-tertiary">Nothing is waiting on you.</p>
        </section>
      ) : (
        <>
          {queueGroups.length > 0 ? <QueueTable groups={queueGroups} /> : null}

          {data.awaitingQuality.length > 0 ? (
            <div className="space-y-7">
              {qualityGroups.map((group) => {
                const count = group.sops.length;
                return (
                  <section key={group.key} className="space-y-2.5">
                    <div className="flex items-baseline justify-between gap-3 px-0.5">
                      <h2 className="truncate text-sm font-semibold text-ink">{group.name}</h2>
                      <span className="shrink-0 text-[12px] tabular-nums text-ink-tertiary">
                        {count} {count === 1 ? "SOP" : "SOPs"}
                      </span>
                    </div>

                    <div className="ui-data-table-frame ui-data-table-frame-canvas">
                      <div className="ui-table-scroll">
                        <table className="min-w-[720px] w-full border-collapse text-left">
                          <thead>
                            <tr className="border-b border-line">
                              <th className="w-36 px-5 py-3 text-[11px] font-medium text-ink-secondary">Number</th>
                              <th className="px-5 py-3 text-[11px] font-medium text-ink-secondary">Title</th>
                              <th className="w-48 px-5 py-3 text-[11px] font-medium text-ink-secondary">Release status</th>
                              <th className="w-32 px-5 py-3 text-right text-[11px] font-medium text-ink-secondary">Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {group.sops.map((sop) => {
                              const href = `/sops/${sop.id}?step=quality-approval`;
                              return (
                                <tr
                                  key={sop.id}
                                  className="group border-b border-line/70 transition-colors last:border-b-0 hover:bg-surface-hover"
                                >
                                  <td className="px-5 py-3.5 align-middle">
                                    <Link href={href} className="text-xs font-medium text-ink-secondary hover:text-ink">
                                      {listNumberLabel(sop.sopNumber, sop.departmentCode)}
                                    </Link>
                                  </td>
                                  <td className="max-w-0 px-5 py-3.5 align-middle">
                                    <Link href={href} className="block min-w-0">
                                      <span className="block truncate text-[13px] font-medium leading-snug text-ink">
                                        {sop.title || sop.sopNumber || "Untitled SOP"}
                                      </span>
                                      {sop.version ? (
                                        <span className="mt-1 block text-[11px] text-ink-tertiary">Version {sop.version}</span>
                                      ) : null}
                                    </Link>
                                  </td>
                                  <td className="px-5 py-3.5 align-middle">
                                    <span className="ui-chip whitespace-nowrap border-sky-600 text-sky-700">
                                      Final signature required
                                    </span>
                                  </td>
                                  <td className="px-5 py-3.5 text-right align-middle">
                                    <Link href={href} className="text-[12px] font-medium text-ink hover:underline">
                                      Sign &amp; release
                                    </Link>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </section>
                );
              })}
            </div>
          ) : null}
        </>
      )}
      {selectedReviewId ? (
        <SopReviewWorkspace
          sopId={selectedReviewId}
          onClose={closeReview}
          onSubmitted={() => {
            closeReview();
            void refreshList({ background: true });
          }}
        />
      ) : null}
      {selectedFinalApproval ? (
        <SopFinalApprovalWorkspace
          sopId={selectedFinalApproval.sopId}
          departmentId={selectedFinalApproval.departmentId}
          departmentCode={selectedFinalApproval.departmentCode}
          onClose={() => setSelectedFinalApproval(null)}
          onSigned={() => void refreshList({ background: true })}
        />
      ) : null}
    </div>
  );
}
