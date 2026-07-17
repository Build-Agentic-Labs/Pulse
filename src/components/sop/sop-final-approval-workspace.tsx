"use client";

import { CheckCircle2, Loader2, Save, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPlannerSupabaseClient, getUserFromSession } from "@/domain/supabase-planner";
import type { SignatureStrokes } from "@/domain/sop/signature";
import { listSopAnnexFiles, type SopAnnexFile } from "@/lib/sop/annex-files";
import {
  getSopControl,
  getMySignatureProfile,
  isSignatureCurrent,
  listProfileNames,
  listSignatures,
  saveMySignatureProfile,
  signSop,
  type SopControl,
  type SopSignature,
} from "@/lib/sop/review";
import { getSop, type SopRecord } from "@/lib/sop/store";
import { SopPrintPreview } from "./sop-print-preview";
import { SignaturePad } from "./signature-pad";

function formatDateTime(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function SopFinalApprovalWorkspace({
  sopId,
  departmentId,
  departmentCode,
  onClose,
  onSigned,
}: {
  sopId: string;
  departmentId: string;
  departmentCode: string;
  onClose: () => void;
  onSigned?: () => void;
}) {
  const [record, setRecord] = useState<SopRecord | null>(null);
  const [annexFiles, setAnnexFiles] = useState<SopAnnexFile[]>([]);
  const [control, setControl] = useState<SopControl | null>(null);
  const [signatures, setSignatures] = useState<SopSignature[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserName, setCurrentUserName] = useState("You");
  const [status, setStatus] = useState<"loading" | "ready" | "signing" | "error">("loading");
  const [error, setError] = useState("");
  const [approvalRefreshKey, setApprovalRefreshKey] = useState(0);
  const [revealSignatureId, setRevealSignatureId] = useState<string | null>(null);
  const [signatureStrokes, setSignatureStrokes] = useState<SignatureStrokes>([]);
  const [savedSignatureStrokes, setSavedSignatureStrokes] = useState<SignatureStrokes>([]);
  const [savingSignature, setSavingSignature] = useState(false);

  useEffect(() => {
    let active = true;
    setStatus("loading");
    setError("");
    const supabase = createPlannerSupabaseClient();
    Promise.all([
      getSop(sopId),
      listSopAnnexFiles(sopId),
      getSopControl(sopId),
      listSignatures(sopId),
      getUserFromSession(supabase),
      getMySignatureProfile(),
    ])
      .then(async ([nextRecord, files, nextControl, nextSignatures, userResult, signatureProfile]) => {
        if (!nextRecord || !nextControl) throw new Error("This SOP could not be loaded for final approval.");
        if (!nextControl.finalApprovalRequestedAt || nextControl.finalApprovalContentHash !== nextControl.contentHash) {
          throw new Error("This SOP is not currently awaiting final approval.");
        }
        const userId = userResult.data.user?.id ?? null;
        const names = userId ? await listProfileNames([userId]) : new Map<string, string>();
        if (!active) return;
        setRecord(nextRecord);
        setAnnexFiles(files);
        setControl(nextControl);
        setSignatures(nextSignatures);
        setCurrentUserId(userId);
        setCurrentUserName((userId ? names.get(userId) : "") || "You");
        setSignatureStrokes(signatureProfile?.strokes ?? []);
        setSavedSignatureStrokes(signatureProfile?.strokes ?? []);
        setStatus("ready");
      })
      .catch((caught) => {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : "The final approval could not be opened.");
        setStatus("error");
      });
    return () => {
      active = false;
    };
  }, [sopId]);

  const mySignature = useMemo(() => {
    if (!control || !currentUserId) return null;
    return signatures.find(
      (signature) =>
        signature.meaning === "dept_approval" &&
        signature.signerId === currentUserId &&
        signature.seatDepartmentId === departmentId &&
        isSignatureCurrent(signature, control),
    ) ?? null;
  }, [control, currentUserId, departmentId, signatures]);

  const signatureChanged = useMemo(
    () => JSON.stringify(signatureStrokes) !== JSON.stringify(savedSignatureStrokes),
    [savedSignatureStrokes, signatureStrokes],
  );

  async function saveSignature(): Promise<boolean> {
    if (!signatureStrokes.length) {
      setError("Draw your signature before saving it.");
      return false;
    }
    setSavingSignature(true);
    setError("");
    try {
      const saved = await saveMySignatureProfile(signatureStrokes);
      setSignatureStrokes(saved.strokes);
      setSavedSignatureStrokes(saved.strokes);
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Your signature could not be saved.");
      return false;
    } finally {
      setSavingSignature(false);
    }
  }

  async function addSignature() {
    if (status === "signing" || mySignature) return;
    if (!signatureStrokes.length) {
      setError("Draw and save your signature before signing this SOP.");
      return;
    }
    setStatus("signing");
    setError("");
    try {
      if (signatureChanged && !(await saveSignature())) {
        setStatus("error");
        return;
      }
      const signatureId = await signSop(sopId, "dept_approval", { seatDepartmentId: departmentId });
      const [nextControl, nextSignatures] = await Promise.all([getSopControl(sopId), listSignatures(sopId)]);
      if (!nextControl) throw new Error("The signed SOP could not be reloaded.");
      setControl(nextControl);
      setSignatures(nextSignatures);
      setRevealSignatureId(signatureId);
      setApprovalRefreshKey((value) => value + 1);
      setStatus("ready");
      onSigned?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Your signature could not be added.");
      setStatus("error");
    }
  }

  if (!record || !control || status === "loading") {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60">
        {status === "error" ? (
          <div className="ui-panel max-w-sm p-5 text-center">
            <p className="ui-section-subtitle text-danger">{error}</p>
            <button type="button" className="ui-btn-ghost mt-3 h-9 px-4" onClick={onClose}>
              Back to review queue
            </button>
          </div>
        ) : (
          <Loader2 size={22} className="animate-spin text-white" />
        )}
      </div>
    );
  }

  const panel = (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="border-b border-line px-5 py-4">
        <div className="flex items-center gap-2">
          <ShieldCheck size={15} className="text-emerald-700" />
          <h2 className="text-sm font-medium text-ink">Final approval</h2>
        </div>
        <p className="mt-1 text-xs leading-5 text-ink-secondary">
          Review the controlled PDF, then add your digital signature to its approval table.
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-5">
        {error ? <div className="ui-notice ui-notice-warn px-3 py-2 text-xs">{error}</div> : null}
        <section className="rounded-md border border-line bg-surface-raised p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="ui-mono-label text-ink-tertiary">Signature for</div>
              <p className="mt-1 truncate text-sm font-medium text-ink">{currentUserName}</p>
              <p className="mt-0.5 text-xs text-ink-secondary">{departmentCode} department approval</p>
            </div>
            <span className={`ui-chip shrink-0 ${mySignature ? "border-emerald-600 text-emerald-700" : ""}`}>
              {mySignature ? "Signed" : "Pending"}
            </span>
          </div>
          {mySignature ? (
            <div className="mt-4 flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-emerald-800">
              <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-medium">Digitally signed by {mySignature.signerName || currentUserName}</p>
                <p className="mt-0.5 text-[11px] tabular-nums">{formatDateTime(mySignature.signedAt)}</p>
              </div>
            </div>
          ) : null}
        </section>

        {!mySignature ? (
          <section className="mt-4 rounded-md border border-line bg-surface-raised p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-xs font-medium text-ink">Your saved signature</h3>
                <p className="mt-1 text-[11px] leading-4 text-ink-tertiary">
                  Draw it once and reuse it for future SOP approvals.
                </p>
              </div>
              <span className={`ui-chip shrink-0 ${!signatureChanged && signatureStrokes.length ? "border-emerald-600 text-emerald-700" : ""}`}>
                {!signatureStrokes.length ? "Not created" : signatureChanged ? "Unsaved" : "Saved"}
              </span>
            </div>
            <div className="mt-3">
              <SignaturePad
                value={signatureStrokes}
                disabled={savingSignature || status === "signing"}
                onChange={(strokes) => {
                  setSignatureStrokes(strokes);
                  setError("");
                  if (status === "error") setStatus("ready");
                }}
              />
            </div>
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                className="ui-btn-ghost h-8 gap-1.5 px-3 disabled:opacity-40"
                disabled={!signatureStrokes.length || !signatureChanged || savingSignature || status === "signing"}
                onClick={() => void saveSignature()}
              >
                {savingSignature ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                {savingSignature ? "Saving…" : "Save signature"}
              </button>
            </div>
          </section>
        ) : null}

        <div className="mt-4 rounded-md border border-dashed border-line px-4 py-3">
          <p className="text-xs leading-5 text-ink-secondary">
            Your signature is bound to version <span className="font-mono text-ink">{control.version}</span> and this
            exact document content. The PDF records your printed name and timestamp automatically.
          </p>
        </div>
      </div>

      <div className="border-t border-line bg-surface p-4">
        {mySignature ? (
          <button type="button" className="ui-btn-primary h-10 w-full gap-2 px-4" onClick={onClose}>
            <CheckCircle2 size={14} />
            Signed · back to review queue
          </button>
        ) : (
          <button
            type="button"
            className="ui-btn-primary h-10 w-full gap-2 px-4 disabled:opacity-40"
            disabled={status === "signing" || savingSignature || !signatureStrokes.length}
            onClick={() => void addSignature()}
          >
            {status === "signing" ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
            {status === "signing" ? "Adding signature…" : "Add signature and send to author"}
          </button>
        )}
      </div>
    </div>
  );

  return (
    <SopPrintPreview
      sop={record.sop}
      annexFiles={annexFiles}
      onClose={onClose}
      mode="approval"
      reviewPanel={panel}
      approvalRefreshKey={approvalRefreshKey}
      revealSignatureId={revealSignatureId}
    />
  );
}
