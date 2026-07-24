"use client";

import { FileText, Inbox, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QuietLoading } from "@/components/quiet-loading";
import { formatDate } from "@/domain/formatting";
import { createPlannerSupabaseClient, getUserFromSession } from "@/domain/supabase-planner";
import { SOP_STATUS_LABELS, type SopStatus } from "@/domain/sop/schema";
import {
  EMPTY_QUEUE as EMPTY,
  fetchReviewQueueData,
  type PendingSeat,
  type QualityQueueItem,
  type QueueData,
} from "@/lib/sop/review-queue-data";
import { useSopWorkspace } from "./sop-workspace-provider";
import { SopFinalApprovalWorkspace } from "./sop-final-approval-workspace";
import { SopReviewWorkspace } from "./sop-review-workspace";


function statusChipClass(status: SopStatus): string {
  if (status === "approved") return "border-accent text-accent";
  if (status === "in_review") return "border-warn text-warn";
  return "";
}

type ListStatus = "loading" | "ready" | "error";

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
}: {
  active?: boolean;
  preload?: boolean;
  /** Server-fetched first paint (Stage 5): seeds the queue, then background-revalidates. */
  initialQueue?: QueueData;
  initialWorkspaceId?: string;
}) {
  const { workspaceId } = useSopWorkspace();
  const seededFromServer =
    initialQueue !== undefined && initialWorkspaceId !== undefined && initialWorkspaceId === workspaceId;
  const [data, setData] = useState<QueueData>(seededFromServer ? initialQueue : EMPTY);
  const [listStatus, setListStatus] = useState<ListStatus>(seededFromServer ? "ready" : "loading");
  const [error, setError] = useState("");
  const [selectedReviewId, setSelectedReviewId] = useState<string | null>(null);
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
  const nothingToDo =
    draftReviews.length === 0 &&
    data.finalApprovals.length === 0 &&
    data.sentBack.length === 0 &&
    data.awaitingQuality.length === 0 &&
    awaitingRelease.length === 0;
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
        <h1 className="ui-section-title">{data.isQualityApprover ? "Quality review queue" : "Your reviews"}</h1>
        <p className="ui-section-subtitle">
          {data.isQualityApprover
            ? "Complete assigned reviews and add the final Quality signature before controlled SOPs become effective."
            : "Draft reviews assigned to you, and the ones you authored that came back."}
        </p>
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
          {data.sentBack.length > 0 ? (
            <section className="ui-data-table-frame ui-data-table-frame-canvas divide-y divide-line">
              <div className="px-4 py-3">
                <h2 className="text-sm font-semibold text-ink">Sent back for rework</h2>
              </div>
              {data.sentBack.map((sop) => (
                <Link
                  key={sop.id}
                  href={`/sops/${sop.id}?step=draft-review`}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-hover"
                >
                  <FileText size={15} className="shrink-0 text-ink-tertiary" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-ink">
                      {sop.title || sop.sopNumber || "Untitled SOP"}
                    </div>
                    <div className="ui-section-subtitle truncate text-ink-secondary">{sop.rejectedReason}</div>
                  </div>
                  <span className="hidden ui-mono-label text-ink-tertiary sm:inline">{formatDate(sop.updatedAt)}</span>
                </Link>
              ))}
            </section>
          ) : null}

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
                                      {sop.sopNumber || "—"}
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

          {data.finalApprovals.length > 0 ? (
            <section className="ui-data-table-frame ui-data-table-frame-canvas divide-y divide-line">
              <div className="flex items-center justify-between gap-2 px-4 py-3">
                <div>
                  <h2 className="text-sm font-semibold text-ink">Final approval</h2>
                  <p className="ui-section-subtitle mt-0.5 text-ink-tertiary">
                    Draft review is complete. Formally approve the current controlled document.
                  </p>
                </div>
                <ShieldCheck size={14} className="text-emerald-700" />
              </div>
              {data.finalApprovals.map((seat) => (
                <button
                  type="button"
                  key={`${seat.sopId}:${seat.departmentId}`}
                  onClick={() => setSelectedFinalApproval(seat)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-hover"
                >
                  <ShieldCheck size={15} className="shrink-0 text-emerald-700" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-ink">
                      {seat.title || seat.sopNumber || "Untitled SOP"}
                    </div>
                    <div className="ui-mono-label mt-0.5 truncate text-ink-tertiary">
                      {[seat.sopNumber, seat.version ? `v${seat.version}` : "", seat.departmentCode]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                  <span className="ui-chip shrink-0 border-emerald-600 text-emerald-700">Approval required</span>
                  {formatDate(seat.finalApprovalRequestedAt ?? "") ? (
                    <span className="hidden ui-mono-label text-ink-tertiary sm:inline">
                      {formatDate(seat.finalApprovalRequestedAt ?? "")}
                    </span>
                  ) : null}
                </button>
              ))}
            </section>
          ) : null}

          {draftReviews.length > 0 ? (
            <section className="ui-data-table-frame ui-data-table-frame-canvas divide-y divide-line">
              <div className="px-4 py-3">
                <h2 className="text-sm font-semibold text-ink">Draft review</h2>
                <p className="ui-section-subtitle mt-0.5 text-ink-tertiary">
                  Draft SOPs currently being reviewed by their required departmental approvers.
                </p>
              </div>
              {draftReviews.map((sop) => (
                <button
                  type="button"
                  key={sop.id}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-hover"
                  onClick={() => setSelectedReviewId(sop.id)}
                >
                  <FileText size={15} className="shrink-0 text-ink-tertiary" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-ink">
                      {sop.title || sop.sopNumber || "Untitled SOP"}
                    </div>
                    <div className="ui-mono-label mt-0.5 truncate text-ink-tertiary">
                      {[sop.sopNumber, sop.version ? `v${sop.version}` : ""].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <span className={`ui-chip shrink-0 ${statusChipClass(sop.status)}`}>
                    {SOP_STATUS_LABELS[sop.status]}
                  </span>
                  {formatDate(sop.updatedAt) ? (
                    <span className="hidden ui-mono-label text-ink-tertiary sm:inline">{formatDate(sop.updatedAt)}</span>
                  ) : null}
                </button>
              ))}
            </section>
          ) : null}

          {awaitingRelease.length > 0 ? (
            <section className="ui-data-table-frame ui-data-table-frame-canvas divide-y divide-line">
              <div className="px-4 py-3">
                <h2 className="text-sm font-semibold text-ink">Awaiting Quality release</h2>
                <p className="ui-section-subtitle mt-0.5 text-ink-tertiary">
                  Stakeholder approvals are complete. These SOPs are waiting for Quality signature and release.
                </p>
              </div>
              {awaitingRelease.map((sop) => (
                <Link
                  key={sop.id}
                  href={`/sops/${sop.id}?step=quality-approval`}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-hover"
                >
                  <FileText size={15} className="shrink-0 text-ink-tertiary" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-ink">
                      {sop.title || sop.sopNumber || "Untitled SOP"}
                    </div>
                    <div className="ui-mono-label mt-0.5 truncate text-ink-tertiary">
                      {[sop.sopNumber, sop.version ? `v${sop.version}` : ""].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <span className="ui-chip shrink-0 border-sky-600 text-sky-700">
                    Awaiting Quality
                  </span>
                  {formatDate(sop.updatedAt) ? (
                    <span className="hidden ui-mono-label text-ink-tertiary sm:inline">{formatDate(sop.updatedAt)}</span>
                  ) : null}
                </Link>
              ))}
            </section>
          ) : null}
        </>
      )}
      {selectedReviewId ? (
        <SopReviewWorkspace
          sopId={selectedReviewId}
          onClose={() => setSelectedReviewId(null)}
          onSubmitted={() => {
            setSelectedReviewId(null);
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
