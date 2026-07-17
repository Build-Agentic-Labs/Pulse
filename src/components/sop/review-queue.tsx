"use client";

import { FileText, Inbox, Loader2, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { listDepartments, fetchMyDeptRoles } from "@/lib/departments/store";
import { createPlannerSupabaseClient, getUserFromSession } from "@/domain/supabase-planner";
import { SOP_STATUS_LABELS, type SopStatus } from "@/domain/sop/schema";
import { listSops, type SopListItem } from "@/lib/sop/store";
import {
  listMySignaturesFor,
  listMySeats,
  type MySeatItem,
} from "@/lib/sop/review";
import { hasSubmittedSopReview, listSopReviewSubmissions } from "@/lib/sop/review-annotations";
import { useSopWorkspace } from "./sop-workspace-provider";
import { SopFinalApprovalWorkspace } from "./sop-final-approval-workspace";
import { SopReviewWorkspace } from "./sop-review-workspace";

function formatDate(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
}

function statusChipClass(status: SopStatus): string {
  if (status === "approved") return "border-accent text-accent";
  if (status === "in_review") return "border-warn text-warn";
  return "";
}

type ListStatus = "loading" | "ready" | "error";

/** A seat awaiting this user's signature, with the department it speaks for. */
interface PendingSeat extends MySeatItem {
  departmentCode: string;
}

function departmentAccent(code: string): string {
  let hash = 0;
  for (let index = 0; index < code.length; index += 1) {
    hash = (hash * 31 + code.charCodeAt(index)) >>> 0;
  }
  const hues = [208, 162, 28, 286, 338, 188, 48, 132, 304, 12, 248];
  return `hsl(${hues[hash % hues.length]} 42% 40%)`;
}

interface QualityQueueItem extends SopListItem {
  departmentCode: string;
  departmentName: string;
}

interface QueueData {
  /** Seats I hold that are unsigned against the SOP's current content and cycle. */
  awaitingMe: PendingSeat[];
  /** Formal approvals requested after every draft reviewer accepted the content. */
  finalApprovals: PendingSeat[];
  /** SOPs I authored that a reviewer has sent back. */
  sentBack: SopListItem[];
  /** Department-approved SOPs waiting on the Quality gate. Only shown to Quality approvers. */
  awaitingQuality: QualityQueueItem[];
  /** The workspace-wide board this page used to be. Kept: nothing that was visible is removed. */
  allInFlight: SopListItem[];
  isQualityApprover: boolean;
}

const EMPTY: QueueData = {
  awaitingMe: [],
  finalApprovals: [],
  sentBack: [],
  awaitingQuality: [],
  allInFlight: [],
  isQualityApprover: false,
};

/**
 * The reviewer's own queue, not a workspace board. "Notification" here means the SOP shows up
 * where the person already looks — derived from the roster, so there is no notifications table
 * to keep in sync with reality.
 */
export function ReviewQueue() {
  const { workspaceId } = useSopWorkspace();
  const [data, setData] = useState<QueueData>(EMPTY);
  const [listStatus, setListStatus] = useState<ListStatus>("loading");
  const [error, setError] = useState("");
  const [selectedReviewId, setSelectedReviewId] = useState<string | null>(null);
  const [selectedFinalApproval, setSelectedFinalApproval] = useState<PendingSeat | null>(null);

  const refreshList = useCallback(async () => {
    if (!workspaceId) {
      setData(EMPTY);
      setListStatus("ready");
      return;
    }
    setListStatus("loading");
    setError("");
    try {
      const supabase = createPlannerSupabaseClient();
      const userResult = await getUserFromSession(supabase);
      const userId = userResult.data.user?.id ?? null;
      if (!userId) {
        setData(EMPTY);
        setListStatus("ready");
        return;
      }

      const [seats, sops, departments, deptRoles] = await Promise.all([
        listMySeats(workspaceId, userId),
        listSops(workspaceId),
        listDepartments(workspaceId),
        fetchMyDeptRoles(workspaceId),
      ]);

      const codeById = new Map(departments.map((department) => [department.id, department.code]));
      const departmentById = new Map(departments.map((department) => [department.id, department]));
      const isQualityApprover = departments.some(
        (department) => department.isQualityGate && deptRoles.get(department.id) === "approver",
      );

      const inReviewSeats = seats.filter((seat) => seat.status === "in_review" && seat.rasic !== "informed");
      const finalApprovalSeats = inReviewSeats.filter(
        (seat) =>
          (seat.rasic === "responsible" || seat.rasic === "accountable") &&
          Boolean(seat.finalApprovalRequestedAt) &&
          seat.finalApprovalContentHash === seat.contentHash,
      );
      const finalApprovalSopIds = new Set(finalApprovalSeats.map((seat) => seat.sopId));
      const draftReviewSeats = inReviewSeats.filter((seat) => !finalApprovalSopIds.has(seat.sopId));
      const [mySubmissions, mySignatures] = await Promise.all([
        listSopReviewSubmissions(draftReviewSeats.map((seat) => seat.sopId)),
        listMySignaturesFor(finalApprovalSeats.map((seat) => seat.sopId), userId),
      ]);

      const awaitingMe: PendingSeat[] = draftReviewSeats
        .filter((seat) => !hasSubmittedSopReview(
          mySubmissions,
          seat.sopId,
          seat.reviewCycle,
          userId,
          seat.contentHash,
        ))
        .map((seat) => ({ ...seat, departmentCode: codeById.get(seat.departmentId) ?? "—" }));

      const finalApprovals: PendingSeat[] = finalApprovalSeats
        .filter((seat) => !mySignatures.some(
          (signature) =>
            signature.meaning === "dept_approval" &&
            signature.seatDepartmentId === seat.departmentId &&
            signature.reviewCycle === seat.reviewCycle &&
            signature.signedContentHash === (seat.contentHash ?? ""),
        ))
        .map((seat) => ({ ...seat, departmentCode: codeById.get(seat.departmentId) ?? "—" }));

      setData({
        awaitingMe,
        finalApprovals,
        // Mine, sent back by a reviewer. rejectedReason is the DB's mirror of the objection
        // signature; a recall clears it, so a recalled SOP does not land here.
        sentBack: sops.filter(
          (sop) => sop.status === "draft" && sop.createdBy === userId && Boolean(sop.rejectedReason),
        ),
        awaitingQuality: isQualityApprover
          ? sops
              .filter((sop) => sop.status === "approved")
              .map((sop) => {
                const department = sop.departmentId ? departmentById.get(sop.departmentId) : undefined;
                return {
                  ...sop,
                  departmentCode: department?.code ?? "—",
                  departmentName: department?.name ?? "Unknown department",
                };
              })
          : [],
        allInFlight: sops.filter((sop) => sop.status === "in_review" || sop.status === "approved"),
        isQualityApprover,
      });
      setListStatus("ready");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load your review queue.");
      setListStatus("error");
    }
  }, [workspaceId]);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

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
    <div className={`mx-auto space-y-5 ${data.isQualityApprover ? "max-w-4xl" : "max-w-3xl"}`}>
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
        <section className="ui-panel">
          <div className="flex items-center justify-center px-4 py-10">
            <Loader2 size={18} className="animate-spin text-ink-tertiary" />
          </div>
        </section>
      ) : listStatus === "error" ? (
        <section className="ui-panel">
          <div className="px-4 py-10 text-center">
            <p className="ui-section-subtitle text-ink-tertiary">{error || "Could not load your review queue."}</p>
            <button type="button" className="ui-btn-ghost mt-3 inline-flex h-9 px-3" onClick={() => void refreshList()}>
              Retry
            </button>
          </div>
        </section>
      ) : nothingToDo ? (
        <section className="ui-panel">
          <div className="px-4 py-10 text-center">
            <Inbox size={20} className="mx-auto text-ink-tertiary" />
            <p className="mt-2 ui-section-subtitle text-ink-tertiary">Nothing is waiting on you.</p>
          </div>
        </section>
      ) : (
        <>
          {data.sentBack.length > 0 ? (
            <section className="ui-panel divide-y divide-line overflow-hidden">
              <div className="px-4 py-3">
                <div className="ui-mono-label text-ink-tertiary">Sent back for rework</div>
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
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: departmentAccent(group.code) }}
                          aria-hidden
                        />
                        <h2 className="truncate text-[15px] font-semibold tracking-tight text-ink">{group.name}</h2>
                      </div>
                      <span className="shrink-0 text-[12px] tabular-nums text-ink-tertiary">
                        {count} {count === 1 ? "SOP" : "SOPs"}
                      </span>
                    </div>

                    <div className="overflow-hidden rounded-xl border border-line bg-surface">
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
                                    <Link href={href} className="font-mono text-[12px] tracking-wide text-ink-secondary hover:text-ink">
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
            <section className="ui-panel divide-y divide-line overflow-hidden border-l-2 border-l-emerald-600">
              <div className="flex items-center justify-between gap-2 px-4 py-3">
                <div>
                  <div className="ui-mono-label text-ink-tertiary">Final approval</div>
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
            <section className="ui-panel divide-y divide-line overflow-hidden">
              <div className="px-4 py-3">
                <div className="ui-mono-label text-ink-tertiary">Draft review</div>
                <p className="ui-section-subtitle mt-0.5 text-ink-tertiary">
                  Draft SOPs currently being reviewed by their responsible parties.
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
            <section className="ui-panel divide-y divide-line overflow-hidden">
              <div className="px-4 py-3">
                <div className="ui-mono-label text-ink-tertiary">Awaiting Quality release</div>
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
            void refreshList();
          }}
        />
      ) : null}
      {selectedFinalApproval ? (
        <SopFinalApprovalWorkspace
          sopId={selectedFinalApproval.sopId}
          departmentId={selectedFinalApproval.departmentId}
          departmentCode={selectedFinalApproval.departmentCode}
          onClose={() => setSelectedFinalApproval(null)}
          onSigned={() => void refreshList()}
        />
      ) : null}
    </div>
  );
}
