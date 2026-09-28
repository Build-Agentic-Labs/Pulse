"use client";

import { formatDateTime } from "@/domain/formatting";
import { CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPlannerSupabaseClient, getUserFromSession } from "@/domain/supabase-planner";
import type { SignatureStrokes } from "@/domain/sop/signature";
import { listSopAnnexFiles, type SopAnnexFile } from "@/lib/sop/annex-files";
import {
  getMySignatureProfile,
  getSopControl,
  isSignatureCurrent,
  listProfileNames,
  listSignatures,
  signSopWithMark,
  transitionSop,
  type SopControl,
  type SopSignature,
} from "@/lib/sop/review";
import { getSop, SopConflictError, type SopRecord } from "@/lib/sop/store";
import { SignatureInput } from "./signature-input";
import { SopReviewLoading } from "./sop-review-loading";
import { SopPrintPreview } from "./sop-print-preview";


export function SopQualityApprovalWorkspace({
  sopId,
  onClose,
  onReleased,
  returnLabel = "Back to review queue",
}: {
  sopId: string;
  onClose: () => void;
  onReleased?: () => void;
  returnLabel?: string;
}) {
  const [record, setRecord] = useState<SopRecord | null>(null);
  const [annexFiles, setAnnexFiles] = useState<SopAnnexFile[]>([]);
  const [control, setControl] = useState<SopControl | null>(null);
  const [signatures, setSignatures] = useState<SopSignature[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserName, setCurrentUserName] = useState("You");
  const [status, setStatus] = useState<"loading" | "ready" | "releasing" | "error">("loading");
  const [error, setError] = useState("");
  const [signatureStrokes, setSignatureStrokes] = useState<SignatureStrokes>([]);
  const [approvalRefreshKey, setApprovalRefreshKey] = useState(0);
  const [revealSignatureId, setRevealSignatureId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
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
        if (!nextRecord || !nextControl) throw new Error("This SOP could not be loaded for Quality approval.");
        if (nextControl.status !== "approved" && nextControl.status !== "effective") {
          throw new Error("Every stakeholder must sign before Quality can release this SOP.");
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
        setError(caught instanceof Error ? caught.message : "Quality approval could not be opened.");
        setStatus("error");
      });
    return () => {
      active = false;
    };
  }, [sopId]);

  const qualitySignature = useMemo(() => {
    if (!control || !currentUserId) return null;
    return signatures.find(
      (signature) =>
        signature.meaning === "quality_approval" &&
        signature.signerId === currentUserId &&
        isSignatureCurrent(signature, control),
    ) ?? null;
  }, [control, currentUserId, signatures]);

  async function releaseToEffectiveLibrary() {
    if (!control || status === "releasing" || control.status === "effective") return;
    if (!qualitySignature && !signatureStrokes.length) {
      setError("Draw and save your Quality signature before releasing this SOP.");
      return;
    }
    setStatus("releasing");
    setError("");
    try {
      const signatureId = qualitySignature?.id ?? await signSopWithMark(sopId, "quality_approval", signatureStrokes, control.contentHash ?? "", control.reviewCycle);
      const signedControl = await getSopControl(sopId);
      if (!signedControl) throw new Error("The Quality-signed SOP could not be reloaded.");
      if (signedControl.status === "approved") {
        await transitionSop(sopId, "effective", signedControl.updatedAt);
      }
      const [nextRecord, nextControl, nextSignatures] = await Promise.all([
        getSop(sopId),
        getSopControl(sopId),
        listSignatures(sopId),
      ]);
      if (!nextRecord || !nextControl) throw new Error("The released SOP could not be reloaded.");
      setRecord(nextRecord);
      setControl(nextControl);
      setSignatures(nextSignatures);
      setRevealSignatureId(signatureId);
      setApprovalRefreshKey((value) => value + 1);
      setStatus("ready");
      onReleased?.();
    } catch (caught) {
      // A concurrent Quality release wins the optimistic transition and leaves this caller with a
      // conflict, even though the SOP is already effective. Re-read: if it released, that is success.
      if (caught instanceof SopConflictError) {
        try {
          const [nextRecord, nextControl, nextSignatures] = await Promise.all([
            getSop(sopId),
            getSopControl(sopId),
            listSignatures(sopId),
          ]);
          if (nextRecord && nextControl?.status === "effective") {
            setRecord(nextRecord);
            setControl(nextControl);
            setSignatures(nextSignatures);
            setApprovalRefreshKey((value) => value + 1);
            setStatus("ready");
            onReleased?.();
            return;
          }
        } catch {
          // Fall through to the generic error below.
        }
      }
      setError(caught instanceof Error ? caught.message : "The SOP could not be released.");
      setStatus("error");
    }
  }

  if (!record || !control || status === "loading") {
    return <SopReviewLoading label="Quality approval" error={status === "error" ? error : undefined} onClose={onClose} />;
  }

  const released = control.status === "effective";
  const panel = <QualitySignaturePanel released={released} currentUserName={currentUserName} qualitySignature={qualitySignature} version={control.version} error={error} signatureStrokes={signatureStrokes} status={status} returnLabel={returnLabel} onClose={onClose} onRelease={() => void releaseToEffectiveLibrary()} onChange={strokes => { setSignatureStrokes(strokes); setError(""); }} />;

  return (
    <SopPrintPreview
      sop={record.sop}
      departmentCode={record.departmentCode}
      annexFiles={annexFiles}
      onClose={onClose}
      mode="approval"
      embedded
      taskLabel="Quality approval"
      toolbarNote="Verify the document, then sign and release."
      reviewPanel={panel}
      approvalRefreshKey={approvalRefreshKey}
      revealSignatureId={revealSignatureId}
    />
  );
}

export function QualitySignaturePanel({ released, currentUserName, qualitySignature, version, error, signatureStrokes, status, returnLabel, onClose, onRelease, onChange }: {
 released: boolean; currentUserName: string; qualitySignature: SopSignature | null; version: string; error: string; signatureStrokes: SignatureStrokes; status: string; returnLabel: string; onClose: () => void; onRelease: () => void; onChange: (strokes: SignatureStrokes) => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas">
      <div className="min-h-0 flex-1 space-y-5 overflow-auto p-5">
        <div><h2 className="text-sm font-medium text-ink">{released ? "Released" : "Quality approval"}</h2><p className="mt-1 text-xs text-ink-secondary">{currentUserName} · Final release</p></div>
        {error ? <p role="alert" className="text-xs text-danger">{error}</p> : null}
        {qualitySignature ? <p className="text-xs text-ink-secondary">Quality signed · {formatDateTime(qualitySignature.signedAt)}</p> : !released ? <SignatureInput value={signatureStrokes} disabled={status === "releasing"} onChange={onChange} /> : null}
        <p className="text-[11px] leading-5 text-ink-secondary">Verify the approved document. Signing releases version {version} to the Effective Library.</p>
      </div>
      <div className="border-t border-line p-4">
        {released ? <button type="button" className="ui-btn-primary h-9 w-full gap-2" onClick={onClose}><CheckCircle2 size={14} />{returnLabel}</button> : <button type="button" className="ui-btn-primary h-9 w-full gap-2 disabled:opacity-40" disabled={status === "releasing" || (!qualitySignature && !signatureStrokes.length)} onClick={onRelease}>{status === "releasing" ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}{status === "releasing" ? "Releasing…" : "Sign & release"}</button>}
      </div>
    </div>
  );

}
