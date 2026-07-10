"use client";

import { AlertTriangle, Check, FileText, Loader2, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import type { Department, DeptRole } from "@/domain/departments";
import { canTransitionSop, SOP_STATUS_ORDER, type SopStatus } from "@/domain/sop/lifecycle";
import { SOP_STATUS_LABELS } from "@/domain/sop/schema";
import { createPlannerSupabaseClient, getUserFromSession } from "@/domain/supabase-planner";
import { fetchMyDeptRoles, listDepartments } from "@/lib/departments/store";
import {
  getSopControl,
  hasSeatSigned,
  isBlockingSeat,
  isSignatureCurrent,
  listProfileNames,
  listSeats,
  listSignatures,
  openObjections,
  signSop,
  transitionSop,
  type SignatureMeaning,
  type SopControl,
  type SopReviewSeat,
  type SopSignature,
} from "@/lib/sop/review";
import { countTasksUsingSop, getSop, SopConflictError } from "@/lib/sop/store";
import { SopRosterEditor } from "./sop-roster-editor";
import { SopShell } from "./sop-shell";
import { canManage, SopWorkspaceSwitcher, useSopWorkspace } from "./sop-workspace-provider";

const MEANING_LABELS: Record<SignatureMeaning, string> = {
  authorship: "Authored — technical content",
  review: "Reviewed for accuracy",
  dept_approval: "Department approval — release",
  quality_approval: "Quality approval — release control",
  rejection: "Objected — sent back for rework",
  objection_withdrawn: "Objection withdrawn by the reviewer who raised it",
  objection_sustained: "Objection sustained — the author changed the document",
  objection_overruled: "Objection overruled — set aside with a written justification",
};

const RASIC_LABELS: Record<SopReviewSeat["rasic"], string> = {
  responsible: "Responsible",
  accountable: "Accountable",
  support: "Support",
  consulted: "Consulted",
  informed: "Informed",
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
}

function formatDateTime(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** Status badge className/style — accent for approved, danger for obsolete, warn/success tints else. */
function statusBadge(status: SopStatus): { className: string; style?: CSSProperties } {
  switch (status) {
    case "approved":
      return { className: "border-accent text-accent" };
    case "obsolete":
      return { className: "border-danger text-danger" };
    case "in_review":
      return { className: "", style: { color: "var(--color-warn)", borderColor: "var(--color-warn)" } };
    case "effective":
      return { className: "", style: { color: "var(--color-success)", borderColor: "var(--color-success)" } };
    default:
      return { className: "" };
  }
}

interface ReadyData {
  title: string;
  control: SopControl;
  signatures: SopSignature[];
  seats: SopReviewSeat[];
  /** Printed name per user id, for seats that have not signed yet. */
  signerNames: Map<string, string>;
  departments: Department[];
  deptRoles: Map<string, DeptRole>;
  userId: string | null;
  whereUsed: number;
}

type ActionTone = "primary" | "ghost" | "danger";

interface ActionDef {
  key: string;
  label: string;
  tone: ActionTone;
  /** Statuses in which this action is offered (avoids the from===to always-ok case). */
  from: SopStatus[];
  /** Transition target used purely to gate visibility via canTransitionSop. */
  to: SopStatus;
  run: (control: SopControl) => Promise<unknown>;
}

function LifecycleStepper({ status }: { status: SopStatus }) {
  const currentIndex = SOP_STATUS_ORDER.indexOf(status);
  return (
    <div className="flex flex-wrap items-center gap-y-2">
      {SOP_STATUS_ORDER.map((step, index) => {
        const done = index < currentIndex;
        const current = index === currentIndex;
        return (
          <div key={step} className="flex items-center">
            <span
              className={`inline-flex items-center gap-2 ui-mono-label ${
                current ? "text-ink" : done ? "text-ink-secondary" : "text-ink-tertiary"
              }`}
            >
              <span
                className={`inline-flex h-5 w-5 items-center justify-center rounded-full border text-[9px] ${
                  current
                    ? "border-accent bg-accent text-canvas"
                    : done
                      ? "border-ink-secondary text-ink"
                      : "border-border-strong text-transparent"
                }`}
              >
                {done ? <Check size={11} strokeWidth={2.5} /> : current ? "●" : ""}
              </span>
              {SOP_STATUS_LABELS[step]}
            </span>
            {index < SOP_STATUS_ORDER.length - 1 ? <span className="mx-2 h-px w-6 bg-border-strong" /> : null}
          </div>
        );
      })}
    </div>
  );
}

export function SopApprovalPanel({ sopId }: { sopId: string }) {
  const { workspaceId, role } = useSopWorkspace();
  const [phase, setPhase] = useState<"loading" | "error" | "missing" | "ready">("loading");
  const [ready, setReady] = useState<ReadyData | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [reject, setReject] = useState<{ open: boolean; reason: string }>({ open: false, reason: "" });
  const [revisionReason, setRevisionReason] = useState("");
  const [overrule, setOverrule] = useState<{ signatureId: string | null; reason: string }>({
    signatureId: null,
    reason: "",
  });

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setPhase("loading");
    setLoadError("");
    try {
      const supabase = createPlannerSupabaseClient();
      const [record, control, signatures, seats, deptRoles, departments, userResult, used] = await Promise.all([
        getSop(sopId),
        getSopControl(sopId),
        listSignatures(sopId),
        listSeats(sopId),
        fetchMyDeptRoles(workspaceId),
        listDepartments(workspaceId),
        getUserFromSession(supabase),
        countTasksUsingSop(sopId),
      ]);
      if (!control) {
        setPhase("missing");
        return;
      }
      const signerNames = await listProfileNames(
        seats.map((seat) => seat.signerId).filter((id): id is string => id !== null),
      );
      setReady({
        title: record?.sop.meta.title ?? "",
        control,
        signatures,
        seats,
        signerNames,
        departments,
        deptRoles,
        userId: userResult.data.user?.id ?? null,
        whereUsed: used,
      });
      setPhase("ready");
    } catch (error) {
      setLoadError(getErrorMessage(error));
      setPhase("error");
    }
  }, [sopId, workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Re-read only the volatile parts (the updated_at token changed after any action).
  const reload = useCallback(async () => {
    try {
      const [control, signatures, seats] = await Promise.all([
        getSopControl(sopId),
        listSignatures(sopId),
        listSeats(sopId),
      ]);
      setReady((prev) => (prev ? { ...prev, control: control ?? prev.control, signatures, seats } : prev));
    } catch (error) {
      setBanner(getErrorMessage(error));
    }
  }, [sopId]);

  async function runGuarded(key: string, fn: () => Promise<unknown>) {
    if (busy || !ready) return;
    setBusy(key);
    setBanner(null);
    setConflict(false);
    try {
      await fn();
    } catch (error) {
      if (error instanceof SopConflictError) {
        setConflict(true);
        setBanner(error.message);
      } else {
        setBanner(getErrorMessage(error));
      }
    }
    await reload();
    setBusy(null);
  }

  const sidebar = (
    <>
      <div className="ui-nav-section">SOPs</div>
      <div className="space-y-0.5">
        <Link href="/sops" className="ui-nav-item ui-nav-item-idle">
          <FileText size={15} strokeWidth={1.75} />
          <span>All SOPs</span>
        </Link>
        <Link href={`/sops/${sopId}`} className="ui-nav-item ui-nav-item-idle">
          <FileText size={15} strokeWidth={1.75} />
          <span>Document</span>
        </Link>
      </div>
      <div className="ui-nav-section mt-3">Control</div>
      <div className="space-y-0.5">
        <span className="ui-nav-item ui-nav-item-active">
          <ShieldCheck size={15} strokeWidth={1.75} />
          <span>Review &amp; approve</span>
        </span>
      </div>
      <SopWorkspaceSwitcher />
    </>
  );

  const back = { href: "/sops", label: "All SOPs" };

  if (phase === "loading" || !workspaceId) {
    return (
      <SopShell sidebar={sidebar} back={back} crumb="Control">
        <div className="flex h-full items-center justify-center p-4">
          <Loader2 size={18} className="animate-spin text-ink-tertiary" />
        </div>
      </SopShell>
    );
  }

  if (phase === "missing" || phase === "error") {
    return (
      <SopShell sidebar={sidebar} back={back} crumb="Control">
        <div className="flex h-full items-center justify-center p-4">
          <div className="text-center">
            <p className="ui-section-subtitle text-ink-tertiary">
              {phase === "error" ? loadError || "Could not load this SOP." : "This SOP could not be found."}
            </p>
            {phase === "error" ? (
              <button type="button" className="ui-btn-ghost mt-3 inline-flex h-9 px-3" onClick={() => void load()}>
                Retry
              </button>
            ) : (
              <Link href="/sops" className="ui-btn-ghost mt-3 inline-flex h-9 px-3">
                Back to SOPs
              </Link>
            )}
          </div>
        </div>
      </SopShell>
    );
  }

  if (!ready) return null;

  const { control, signatures, seats, signerNames, departments, deptRoles, userId, title, whereUsed } = ready;
  const dept = control.departmentId ? departments.find((d) => d.id === control.departmentId) : undefined;
  const myRole = control.departmentId ? deptRoles.get(control.departmentId) : undefined;
  const isQualityApprover = departments.some((d) => d.isQualityGate && deptRoles.get(d.id) === "approver");
  const isSubmitter = Boolean(userId && control.submittedBy && control.submittedBy === userId);
  const isAuthor = Boolean(userId && control.createdBy && control.createdBy === userId);
  const badge = statusBadge(control.status);

  // The seat is the authorization: a person signs the department they were designated for,
  // and one person may legitimately hold seats for two departments.
  const mySeats = userId ? seats.filter((seat) => seat.signerId === userId) : [];
  const myBlockingSeats = mySeats.filter((seat) => isBlockingSeat(seat.rasic));
  const myAdvisorySeats = mySeats.filter((seat) => !isBlockingSeat(seat.rasic) && seat.rasic !== "informed");
  const blockingSeats = seats.filter((seat) => isBlockingSeat(seat.rasic));
  const quorumMet =
    blockingSeats.length > 0 && blockingSeats.every((seat) => hasSeatSigned(seat, signatures, control));
  const objections = openObjections(signatures, control);
  const accountableSeat = seats.find((seat) => seat.rasic === "accountable");
  const authorshipSigned = signatures.some(
    (sig) => sig.meaning === "authorship" && sig.signerId === userId && isSignatureCurrent(sig, control),
  );
  // A Quality approver who set an objection aside cannot also release the document.
  const overruledThisCycle = signatures.some(
    (sig) =>
      sig.meaning === "objection_overruled" && sig.signerId === userId && sig.reviewCycle === control.reviewCycle,
  );
  const hasOwnRejection = signatures.some(
    (sig) => sig.meaning === "rejection" && sig.signerId === userId && isSignatureCurrent(sig, control),
  );

  const deptCode = (departmentId: string | null): string =>
    departments.find((d) => d.id === departmentId)?.code ?? "—";

  const canDo = (to: SopStatus): boolean =>
    canTransitionSop({
      from: control.status,
      to,
      role: myRole,
      isSubmitter,
      isAuthor,
      isQualityApprover,
      hasDept: Boolean(control.departmentId),
      isManager: canManage(role),
      hasResponsibleSeat: seats.some((seat) => seat.rasic === "responsible"),
      accountableSeatCount: seats.filter((seat) => seat.rasic === "accountable").length,
      holdsBlockingSeat: myBlockingSeats.length > 0,
      holdsAnySeat: mySeats.length > 0,
      authorshipSigned,
      quorumMet,
      hasOpenObjection: objections.length > 0,
      hasRevisionReason: revisionReason.trim().length > 0,
      overruledThisCycle,
      hasOwnRejection,
    }).ok;

  // A signature I may still owe, for a seat I hold, against the document as it stands now.
  const pendingBlockingSeat = myBlockingSeats.find((seat) => !hasSeatSigned(seat, signatures, control));
  const pendingAdvisorySeat = myAdvisorySeats.find(
    (seat) =>
      !signatures.some(
        (sig) =>
          sig.meaning === "review" &&
          sig.signerId === seat.signerId &&
          sig.seatDepartmentId === seat.departmentId &&
          isSignatureCurrent(sig, control),
      ),
  );

  /** Objections this user is entitled to close, and how. */
  const withdrawable = objections.filter((objection) => objection.signerId === userId);
  const overrulable = objections.filter((objection) => {
    const raisedBy = seats.find((seat) => seat.departmentId === objection.seatDepartmentId);
    if (!raisedBy) return false;
    if (raisedBy.rasic === "responsible") return accountableSeat?.signerId === userId;
    if (raisedBy.rasic === "accountable") return isQualityApprover;
    return false;
  });

  const actions: ActionDef[] = [
    { key: "signAuthorship", label: "Sign authorship", tone: "ghost", from: ["draft"], to: "draft", run: () => signSop(sopId, "authorship") },
    { key: "submit", label: "Submit for review", tone: "primary", from: ["draft"], to: "in_review", run: (c) => transitionSop(sopId, "in_review", c.updatedAt) },
    // Signing the last blocking seat advances the SOP inside sign_sop. Never chain a transition.
    { key: "signApproval", label: `Sign department approval${pendingBlockingSeat ? ` · ${deptCode(pendingBlockingSeat.departmentId)}` : ""}`, tone: "primary", from: ["in_review"], to: "in_review", run: () => signSop(sopId, "dept_approval", { seatDepartmentId: pendingBlockingSeat?.departmentId }) },
    { key: "signReview", label: `Sign review${pendingAdvisorySeat ? ` · ${deptCode(pendingAdvisorySeat.departmentId)}` : ""}`, tone: "ghost", from: ["in_review"], to: "in_review", run: () => signSop(sopId, "review", { seatDepartmentId: pendingAdvisorySeat?.departmentId }) },
    { key: "recall", label: "Recall submission", tone: "ghost", from: ["in_review"], to: "draft", run: (c) => transitionSop(sopId, "draft", c.updatedAt) },
    { key: "makeEffective", label: "Make effective", tone: "primary", from: ["approved"], to: "effective", run: async (c) => { await signSop(sopId, "quality_approval"); await transitionSop(sopId, "effective", c.updatedAt); } },
    { key: "startRevision", label: "Start revision", tone: "ghost", from: ["effective"], to: "draft", run: (c) => transitionSop(sopId, "draft", c.updatedAt, { revisionReason: revisionReason.trim() }) },
    { key: "retire", label: "Retire", tone: "danger", from: ["draft", "approved", "effective"], to: "obsolete", run: (c) => transitionSop(sopId, "obsolete", c.updatedAt) },
  ];

  const visibleActions = actions.filter((action) => {
    if (!action.from.includes(control.status)) return false;
    switch (action.key) {
      case "signAuthorship":
        return Boolean(myRole) && !authorshipSigned;
      case "signApproval":
        return pendingBlockingSeat !== undefined;
      case "signReview":
        return pendingAdvisorySeat !== undefined;
      case "recall":
        return isSubmitter;
      default:
        return canDo(action.to);
    }
  });

  // Only a Responsible or Accountable seat holder may object, and only against this content.
  const canReject =
    control.status === "in_review" && myBlockingSeats.length > 0 && pendingBlockingSeat !== undefined;
  const toneClass: Record<ActionTone, string> = {
    primary: "ui-btn-primary px-4 disabled:opacity-40",
    ghost: "ui-btn-ghost h-9 px-4 border border-border-strong rounded-full disabled:opacity-40",
    danger: "ui-btn-ghost h-9 px-4 rounded-full border border-danger text-danger disabled:opacity-40",
  };

  return (
    <SopShell sidebar={sidebar} back={back} crumb={control.sopNumber || "Control"}>
      <div className="mx-auto max-w-3xl space-y-3.5">
        {banner ? (
          <div className="ui-notice ui-notice-warn flex items-start gap-2 px-4 py-3">
            <AlertTriangle size={15} className="mt-0.5 shrink-0 text-ink-secondary" />
            <p className="ui-section-subtitle text-ink-secondary">
              {banner}
              {conflict ? " Reload the page to see the latest state before trying again." : ""}
            </p>
          </div>
        ) : null}

        {/* Control header */}
        <section className="ui-panel space-y-3 p-4 md:p-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="ui-chip-accent">{control.sopNumber || "Unnumbered"}</span>
            <span className={`ui-chip ${badge.className}`} style={badge.style}>
              {SOP_STATUS_LABELS[control.status]}
            </span>
          </div>
          <h1 className="ui-section-title text-lg">{title || "Untitled SOP"}</h1>
          <div className="flex flex-wrap gap-x-8 gap-y-3">
            <div>
              <div className="ui-mono-label text-ink-tertiary">Owning dept</div>
              <div className="mt-1 text-sm text-ink">{dept ? `${dept.code} · ${dept.name}` : "Unassigned"}</div>
            </div>
            <div>
              <div className="ui-mono-label text-ink-tertiary">Version</div>
              <div className="mt-1 font-mono text-sm text-ink">{control.version || "—"}</div>
            </div>
            <div>
              <div className="ui-mono-label text-ink-tertiary">Effective date</div>
              <div className="mt-1 font-mono text-sm text-ink">{formatDate(control.effectiveDate) || "On approval"}</div>
            </div>
            <div>
              <div className="ui-mono-label text-ink-tertiary">Next review</div>
              <div className="mt-1 font-mono text-sm text-ink">{formatDate(control.nextReviewDate) || "—"}</div>
            </div>
            <div>
              <div className="ui-mono-label text-ink-tertiary">Used by</div>
              <div className="mt-1 text-sm text-ink">
                {whereUsed} task{whereUsed === 1 ? "" : "s"}
              </div>
            </div>
          </div>
          {control.status === "draft" && control.rejectedReason ? (
            <div className="ui-notice ui-notice-warn px-4 py-3">
              <div className="ui-mono-label text-ink-tertiary">Sent back for rework</div>
              <p className="mt-1 ui-section-subtitle text-ink-secondary">{control.rejectedReason}</p>
            </div>
          ) : null}
        </section>

        {/* Lifecycle stepper */}
        <section className="ui-panel p-4 md:p-5">
          <div className="ui-mono-label mb-3 text-ink-tertiary">Lifecycle</div>
          <LifecycleStepper status={control.status} />
        </section>

        {/* Open objections — who flagged it, and why. Everyone on the SOP sees this. */}
        {objections.length > 0 ? (
          <section className="ui-panel overflow-hidden">
            <div className="border-b border-line px-4 py-3">
              <div className="ui-mono-label text-danger">
                {objections.length} open objection{objections.length === 1 ? "" : "s"}
              </div>
            </div>
            <div className="divide-y divide-line">
              {objections.map((objection) => (
                <div key={objection.id} className="space-y-2 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="ui-chip" style={{ color: "var(--color-warn)", borderColor: "var(--color-warn)" }}>
                      {deptCode(objection.seatDepartmentId)}
                    </span>
                    <span className="text-sm font-medium text-ink">{objection.signerName || "Unknown reviewer"}</span>
                    <span className="font-mono text-[11px] text-ink-tertiary">{formatDateTime(objection.signedAt)}</span>
                  </div>
                  <p className="ui-section-subtitle text-ink-secondary">{objection.rejectedReason}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    {withdrawable.some((item) => item.id === objection.id) ? (
                      <button
                        type="button"
                        className="ui-btn-ghost h-8 rounded border border-border-strong px-3 disabled:opacity-40"
                        disabled={busy !== null}
                        onClick={() =>
                          void runGuarded(`withdraw-${objection.id}`, () =>
                            signSop(sopId, "objection_withdrawn", { resolvesSignatureId: objection.id }),
                          )
                        }
                      >
                        {busy === `withdraw-${objection.id}` ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          "Withdraw my objection"
                        )}
                      </button>
                    ) : null}
                    {overrulable.some((item) => item.id === objection.id) ? (
                      <button
                        type="button"
                        className="ui-btn-ghost h-8 rounded border border-border-strong px-3 disabled:opacity-40"
                        disabled={busy !== null}
                        onClick={() => setOverrule({ signatureId: objection.id, reason: "" })}
                      >
                        Overrule with justification
                      </button>
                    ) : null}
                  </div>
                  {overrule.signatureId === objection.id ? (
                    <div className="space-y-2 border-t border-line pt-3">
                      <label className="ui-mono-label text-ink-tertiary" htmlFor={`overrule-${objection.id}`}>
                        Written justification — printed permanently on the released document
                      </label>
                      <textarea
                        id={`overrule-${objection.id}`}
                        className="ui-field-standalone min-h-20 w-full resize-y"
                        placeholder="Why is this objection being set aside?"
                        value={overrule.reason}
                        onChange={(event) => setOverrule((prev) => ({ ...prev, reason: event.target.value }))}
                        disabled={busy !== null}
                      />
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          className="ui-btn-ghost h-8 px-3"
                          onClick={() => setOverrule({ signatureId: null, reason: "" })}
                          disabled={busy !== null}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="ui-btn-ghost h-8 rounded border border-danger px-3 text-danger disabled:opacity-40"
                          disabled={busy !== null || overrule.reason.trim().length === 0}
                          onClick={() =>
                            void runGuarded(`overrule-${objection.id}`, async () => {
                              await signSop(sopId, "objection_overruled", {
                                reason: overrule.reason.trim(),
                                resolvesSignatureId: objection.id,
                              });
                              setOverrule({ signatureId: null, reason: "" });
                            })
                          }
                        >
                          {busy === `overrule-${objection.id}` ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            "Overrule"
                          )}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {/* Assign the responsible parties. Draft only — the DB freezes the roster on submit. */}
        {control.status === "draft" && (myRole !== undefined || canManage(role)) ? (
          <SopRosterEditor
            sopId={sopId}
            departments={departments}
            seats={seats}
            authorId={control.createdBy}
            onChanged={reload}
          />
        ) : null}

        {/* The roster. Every party reviewing this SOP sees who has signed and who has not. */}
        <section className="ui-panel overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
            <div className="ui-mono-label text-ink-tertiary">Responsible parties</div>
            <div className="ui-mono-label text-ink-tertiary">
              {blockingSeats.filter((seat) => hasSeatSigned(seat, signatures, control)).length}/{blockingSeats.length} signed
            </div>
          </div>
          {seats.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="ui-section-subtitle text-ink-tertiary">
                No departments assigned yet. Name them on the document&apos;s departments tab.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-line">
              {seats.map((seat) => {
                const blocking = isBlockingSeat(seat.rasic);
                const signed = blocking && hasSeatSigned(seat, signatures, control);
                return (
                  <div key={seat.departmentId} className="flex items-center gap-3 px-4 py-3">
                    <span className="ui-chip shrink-0">{deptCode(seat.departmentId)}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-ink">
                        {seat.signerId ? signerNames.get(seat.signerId) || "Assigned reviewer" : "No signer — notified only"}
                      </div>
                      <div className="ui-section-subtitle text-ink-secondary">
                        {RASIC_LABELS[seat.rasic]}
                        {blocking ? " — signature required" : seat.rasic === "informed" ? "" : " — advisory"}
                      </div>
                    </div>
                    {blocking ? (
                      <span
                        className="shrink-0 ui-mono-label"
                        style={{ color: signed ? "var(--color-success)" : "var(--color-warn)" }}
                      >
                        {signed ? "SIGNED" : "PENDING"}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Gate D needs a reason before an effective SOP can be reopened. */}
        {control.status === "effective" ? (
          <section className="ui-panel space-y-3 p-4 md:p-5">
            <label className="ui-mono-label text-ink-tertiary" htmlFor="revision-reason">
              Reason for revision — recorded in this document&apos;s change log
            </label>
            <textarea
              id="revision-reason"
              className="ui-field-standalone min-h-16 w-full resize-y"
              placeholder="What is changing, and why?"
              value={revisionReason}
              onChange={(event) => setRevisionReason(event.target.value)}
              disabled={busy !== null}
            />
          </section>
        ) : null}

        {/* Signature routing */}
        <section className="ui-panel overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
            <div className="ui-mono-label text-ink-tertiary">Approval routing</div>
            <div className="flex items-center gap-1.5 text-[11px] text-danger">
              <AlertTriangle size={13} className="shrink-0" />
              <span>Segregation of duties — the author cannot approve their own SOP.</span>
            </div>
          </div>
          {signatures.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="ui-section-subtitle text-ink-tertiary">No signatures recorded yet.</p>
            </div>
          ) : (
            <div className="divide-y divide-line">
              {signatures.map((sig) => (
                <div key={sig.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-ink">{sig.signerName || "Unknown signer"}</div>
                    <div className="ui-section-subtitle text-ink-secondary">
                      {MEANING_LABELS[sig.meaning]}
                      {sig.meaning === "rejection" && sig.rejectedReason ? ` — ${sig.rejectedReason}` : ""}
                    </div>
                  </div>
                  <span className="shrink-0 font-mono text-[11px] text-ink-tertiary">{formatDateTime(sig.signedAt)}</span>
                </div>
              ))}
            </div>
          )}
          <div className="border-t border-line px-4 py-3">
            <div className="flex items-start gap-2 rounded-xl border border-dashed border-border-strong px-3 py-2.5">
              <ShieldCheck size={14} className="mt-0.5 shrink-0 text-ink-tertiary" />
              <p className="ui-section-subtitle text-ink-secondary">
                Signatures bind to version <span className="font-mono text-ink">{control.version || "—"}</span> via
                content hash — they can&apos;t be moved to another version.
              </p>
            </div>
          </div>
        </section>

        {/* Reject reason */}
        {reject.open ? (
          <section className="ui-panel space-y-3 p-4 md:p-5">
            <label className="ui-mono-label text-ink-tertiary" htmlFor="reject-reason">
              Reason for rejection
            </label>
            <textarea
              id="reject-reason"
              className="ui-field-standalone min-h-20 w-full resize-y"
              placeholder="Explain what needs to change before this can be approved."
              value={reject.reason}
              onChange={(event) => setReject((prev) => ({ ...prev, reason: event.target.value }))}
              disabled={busy !== null}
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                className="ui-btn-ghost h-9 px-4"
                onClick={() => setReject({ open: false, reason: "" })}
                disabled={busy !== null}
              >
                Cancel
              </button>
              <button
                type="button"
                className="ui-btn-ghost h-9 rounded-full border border-danger px-4 text-danger disabled:opacity-40"
                disabled={busy !== null || reject.reason.trim().length === 0}
                onClick={() =>
                  void runGuarded("reject", async () => {
                    // sign_sop records the objection AND sends the SOP back to draft in one call.
                    // Chaining a transition here is what used to raise SopConflictError.
                    await signSop(sopId, "rejection", {
                      reason: reject.reason.trim(),
                      seatDepartmentId: pendingBlockingSeat?.departmentId,
                    });
                    setReject({ open: false, reason: "" });
                  })
                }
              >
                {busy === "reject" ? <Loader2 size={14} className="animate-spin" /> : "Reject SOP"}
              </button>
            </div>
          </section>
        ) : null}

        {/* Action set */}
        {visibleActions.length > 0 || canReject ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {canReject && !reject.open ? (
              <button
                type="button"
                className={toneClass.danger}
                onClick={() => setReject({ open: true, reason: control.rejectedReason ?? "" })}
                disabled={busy !== null}
              >
                Reject with reason
              </button>
            ) : null}
            {visibleActions.map((action) => (
              <button
                key={action.key}
                type="button"
                className={toneClass[action.tone]}
                disabled={busy !== null}
                onClick={() => void runGuarded(action.key, () => action.run(control))}
              >
                {busy === action.key ? <Loader2 size={14} className="animate-spin" /> : action.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </SopShell>
  );
}

/** Route client: reads the dynamic sopId and mounts the panel inside the workspace provider. */
export function SopControlClient() {
  const params = useParams<{ sopId: string }>();
  return <SopApprovalPanel sopId={params.sopId} />;
}
