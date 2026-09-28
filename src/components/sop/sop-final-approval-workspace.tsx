"use client";

import { SopReviewLoading } from "./sop-review-loading";

import { formatDateTime } from "@/domain/formatting";
import { CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
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
  signSopWithMark,
  type SopControl,
  type SopSignature,
} from "@/lib/sop/review";
import { getSop, type SopRecord } from "@/lib/sop/store";
import { SopPrintPreview } from "./sop-print-preview";
import { SignatureInput } from "./signature-input";


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

  async function addSignature() {
    if (!control || status === "signing" || mySignature) return;
    if (!signatureStrokes.length) {
      setError("Draw or type your signature before signing this SOP.");
      return;
    }
    setStatus("signing");
    setError("");
    try {
      const signatureId = await signSopWithMark(sopId, "dept_approval", signatureStrokes, control.contentHash ?? "", control.reviewCycle, departmentId);
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
    return <SopReviewLoading label="Final approval" error={status === "error" ? error : undefined} onClose={onClose} />;
  }

  const panel = (
    <div className="flex h-full min-h-0 flex-col bg-canvas">
      <div className="min-h-0 flex-1 space-y-5 overflow-auto p-5">
        <div>
          <h2 className="text-sm font-medium text-ink">{mySignature ? "Signed" : "Your signature"}</h2>
          <p className="mt-1 text-xs text-ink-secondary">{currentUserName} · {departmentCode} approval</p>
        </div>
        {error ? <p role="alert" className="text-xs text-danger">{error}</p> : null}
        {mySignature ? (
          <p className="text-xs text-ink-secondary">Signed by {mySignature.signerName || currentUserName} · {formatDateTime(mySignature.signedAt)}</p>
        ) : (
          <SignatureInput value={signatureStrokes} disabled={status === "signing"} onChange={strokes => { setSignatureStrokes(strokes); setError(""); }} />
        )}
        <p className="text-[11px] leading-5 text-ink-secondary">Signing approves version {control.version} of this document. Your account name and signing time are recorded.</p>
      </div>
      <div className="border-t border-line p-4">
        {mySignature ? <button type="button" className="ui-btn-primary h-9 w-full gap-2" onClick={onClose}><CheckCircle2 size={14} />Back to review queue</button> : <button type="button" className="ui-btn-primary h-9 w-full gap-2 disabled:opacity-40" disabled={status === "signing" || !signatureStrokes.length} onClick={() => void addSignature()}>{status === "signing" ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}{status === "signing" ? "Signing…" : "Sign SOP"}</button>}
      </div>
    </div>
  );

  return (
    <SopPrintPreview
      sop={record.sop}
      departmentCode={record.departmentCode}
      annexFiles={annexFiles}
      onClose={onClose}
      mode="approval"
      taskLabel="Signatures"
      toolbarNote="Review the document, then sign to approve."
      embedded
      reviewPanel={panel}
      approvalRefreshKey={approvalRefreshKey}
      revealSignatureId={revealSignatureId}
    />
  );
}
