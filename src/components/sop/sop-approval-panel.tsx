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
  listSignatures,
  signSop,
  transitionSop,
  type SignatureMeaning,
  type SopControl,
  type SopSignature,
} from "@/lib/sop/review";
import { countTasksUsingSop, getSop, SopConflictError } from "@/lib/sop/store";
import { SopShell } from "./sop-shell";
import { canManage, SopWorkspaceSwitcher, useSopWorkspace } from "./sop-workspace-provider";

const MEANING_LABELS: Record<SignatureMeaning, string> = {
  authorship: "Authored — technical content",
  review: "Reviewed for accuracy",
  dept_approval: "Department approval — release",
  quality_approval: "Quality approval — release control",
  rejection: "Rejected — sent back for rework",
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

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setPhase("loading");
    setLoadError("");
    try {
      const supabase = createPlannerSupabaseClient();
      const [record, control, signatures, deptRoles, departments, userResult, used] = await Promise.all([
        getSop(sopId),
        getSopControl(sopId),
        listSignatures(sopId),
        fetchMyDeptRoles(workspaceId),
        listDepartments(workspaceId),
        getUserFromSession(supabase),
        countTasksUsingSop(sopId),
      ]);
      if (!control) {
        setPhase("missing");
        return;
      }
      setReady({
        title: record?.sop.meta.title ?? "",
        control,
        signatures,
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
      const [control, signatures] = await Promise.all([getSopControl(sopId), listSignatures(sopId)]);
      setReady((prev) => (prev ? { ...prev, control: control ?? prev.control, signatures } : prev));
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

  const { control, signatures, departments, deptRoles, userId, title, whereUsed } = ready;
  const dept = control.departmentId ? departments.find((d) => d.id === control.departmentId) : undefined;
  const myRole = control.departmentId ? deptRoles.get(control.departmentId) : undefined;
  const isQualityApprover = departments.some((d) => d.isQualityGate && deptRoles.get(d.id) === "approver");
  const isSubmitter = Boolean(userId && control.submittedBy && control.submittedBy === userId);
  const badge = statusBadge(control.status);

  const canDo = (to: SopStatus): boolean =>
    canTransitionSop({
      from: control.status,
      to,
      role: myRole,
      isSubmitter,
      isQualityApprover,
      hasDept: Boolean(control.departmentId),
      isManager: canManage(role),
    }).ok;

  const actions: ActionDef[] = [
    { key: "submit", label: "Submit for review", tone: "primary", from: ["draft"], to: "in_review", run: (c) => transitionSop(sopId, "in_review", c.updatedAt) },
    { key: "signReview", label: "Sign review", tone: "ghost", from: ["in_review"], to: "draft", run: () => signSop(sopId, "review") },
    { key: "approve", label: "Approve & sign", tone: "primary", from: ["in_review"], to: "approved", run: async (c) => { await signSop(sopId, "dept_approval"); await transitionSop(sopId, "approved", c.updatedAt); } },
    { key: "makeEffective", label: "Make effective", tone: "primary", from: ["approved"], to: "effective", run: async (c) => { await signSop(sopId, "quality_approval"); await transitionSop(sopId, "effective", c.updatedAt); } },
    { key: "startRevision", label: "Start revision", tone: "ghost", from: ["effective"], to: "draft", run: (c) => transitionSop(sopId, "draft", c.updatedAt) },
    { key: "retire", label: "Retire", tone: "danger", from: ["draft", "approved", "effective"], to: "obsolete", run: (c) => transitionSop(sopId, "obsolete", c.updatedAt) },
  ];

  const visibleActions = actions.filter((a) => a.from.includes(control.status) && canDo(a.to));
  const canReject = control.status === "in_review" && canDo("draft");
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
                    const reason = reject.reason.trim();
                    await signSop(sopId, "rejection", reason);
                    await transitionSop(sopId, "draft", control.updatedAt, { rejectedReason: reason });
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
