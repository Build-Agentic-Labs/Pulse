"use client";

import { FileText, Inbox, Loader2, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { listDepartments, fetchMyDeptRoles } from "@/lib/departments/store";
import { createPlannerSupabaseClient, getUserFromSession } from "@/domain/supabase-planner";
import { SOP_STATUS_LABELS, type SopStatus } from "@/domain/sop/schema";
import { listSops, type SopListItem } from "@/lib/sop/store";
import {
  isBlockingSeat,
  listMySeats,
  listMySignaturesFor,
  type MySeatItem,
  type SopSignature,
} from "@/lib/sop/review";
import { useSopWorkspace } from "./sop-workspace-provider";

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

interface QueueData {
  /** Seats I hold that are unsigned against the SOP's current content and cycle. */
  awaitingMe: PendingSeat[];
  /** SOPs I authored that a reviewer has sent back. */
  sentBack: SopListItem[];
  /** Department-approved SOPs waiting on the Quality gate. Only shown to Quality approvers. */
  awaitingQuality: SopListItem[];
  /** The workspace-wide board this page used to be. Kept: nothing that was visible is removed. */
  allInFlight: SopListItem[];
  isQualityApprover: boolean;
}

const EMPTY: QueueData = {
  awaitingMe: [],
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
      const isQualityApprover = departments.some(
        (department) => department.isQualityGate && deptRoles.get(department.id) === "approver",
      );

      const inReviewSeats = seats.filter((seat) => seat.status === "in_review" && seat.rasic !== "informed");
      const mySignatures = await listMySignaturesFor(
        inReviewSeats.map((seat) => seat.sopId),
        userId,
      );

      const hasSigned = (seat: MySeatItem, signatures: SopSignature[]): boolean => {
        const meaning = isBlockingSeat(seat.rasic) ? "dept_approval" : "review";
        return signatures.some(
          (signature) =>
            signature.meaning === meaning &&
            signature.seatDepartmentId === seat.departmentId &&
            signature.reviewCycle === seat.reviewCycle &&
            signature.signedContentHash === seat.contentHash,
        );
      };

      const awaitingMe: PendingSeat[] = inReviewSeats
        .filter((seat) => !hasSigned(seat, mySignatures))
        .map((seat) => ({ ...seat, departmentCode: codeById.get(seat.departmentId) ?? "—" }));

      setData({
        awaitingMe,
        // Mine, sent back by a reviewer. rejectedReason is the DB's mirror of the objection
        // signature; a recall clears it, so a recalled SOP does not land here.
        sentBack: sops.filter(
          (sop) => sop.status === "draft" && sop.createdBy === userId && Boolean(sop.rejectedReason),
        ),
        awaitingQuality: isQualityApprover ? sops.filter((sop) => sop.status === "approved") : [],
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

  const nothingToDo =
    data.awaitingMe.length === 0 &&
    data.sentBack.length === 0 &&
    data.awaitingQuality.length === 0 &&
    data.allInFlight.length === 0;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="ui-section-title">Your reviews</h1>
        <p className="ui-section-subtitle">
          SOPs waiting on your signature, and the ones you authored that came back.
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
          {data.awaitingMe.length > 0 ? (
            <section className="ui-panel divide-y divide-line overflow-hidden">
              <div className="flex items-center justify-between gap-2 px-4 py-3">
                <div className="ui-mono-label text-ink-tertiary">Awaiting your signature</div>
                <span className="ui-mono-label text-warn">{data.awaitingMe.length}</span>
              </div>
              {data.awaitingMe.map((seat) => (
                <Link
                  key={`${seat.sopId}:${seat.departmentId}`}
                  href={`/sops/${seat.sopId}/control`}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-hover"
                >
                  <span className="ui-chip shrink-0">{seat.departmentCode}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-ink">
                      {seat.title || seat.sopNumber || "Untitled SOP"}
                    </div>
                    <div className="ui-mono-label mt-0.5 truncate text-ink-tertiary">
                      {[seat.sopNumber, isBlockingSeat(seat.rasic) ? "signature required" : "advisory"]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                  <span className="hidden ui-mono-label text-ink-tertiary sm:inline">{formatDate(seat.updatedAt)}</span>
                </Link>
              ))}
            </section>
          ) : null}

          {data.sentBack.length > 0 ? (
            <section className="ui-panel divide-y divide-line overflow-hidden">
              <div className="px-4 py-3">
                <div className="ui-mono-label text-ink-tertiary">Sent back for rework</div>
              </div>
              {data.sentBack.map((sop) => (
                <Link
                  key={sop.id}
                  href={`/sops/${sop.id}/control`}
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
            <section className="ui-panel divide-y divide-line overflow-hidden">
              <div className="flex items-center justify-between gap-2 px-4 py-3">
                <div className="ui-mono-label text-ink-tertiary">Awaiting Quality</div>
                <ShieldCheck size={14} className="text-ink-tertiary" />
              </div>
              {data.awaitingQuality.map((sop) => (
                <Link
                  key={sop.id}
                  href={`/sops/${sop.id}/control`}
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
                  <span className={`ui-chip shrink-0 ${statusChipClass(sop.status)}`}>
                    {SOP_STATUS_LABELS[sop.status]}
                  </span>
                </Link>
              ))}
            </section>
          ) : null}

          {data.allInFlight.length > 0 ? (
            <section className="ui-panel divide-y divide-line overflow-hidden">
              <div className="px-4 py-3">
                <div className="ui-mono-label text-ink-tertiary">Everything in review</div>
                <p className="ui-section-subtitle mt-0.5 text-ink-tertiary">
                  Read-only. Every SOP in the workspace currently under review or awaiting release.
                </p>
              </div>
              {data.allInFlight.map((sop) => (
                <Link
                  key={sop.id}
                  href={`/sops/${sop.id}/control`}
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
                  <span className={`ui-chip shrink-0 ${statusChipClass(sop.status)}`}>
                    {SOP_STATUS_LABELS[sop.status]}
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
    </div>
  );
}
