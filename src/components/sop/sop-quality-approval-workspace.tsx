"use client";

import { formatDateTime } from "@/domain/formatting";
import { CheckCircle2, Loader2, Save, ShieldCheck } from "lucide-react";
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
  saveMySignatureProfile,
  signSop,
  transitionSop,
  type SopControl,
  type SopSignature,
} from "@/lib/sop/review";
import { getSop, SopConflictError, type SopRecord } from "@/lib/sop/store";
import { SignaturePad } from "./signature-pad";
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
  const [savedSignatureStrokes, setSavedSignatureStrokes] = useState<SignatureStrokes>([]);
  const [savingSignature, setSavingSignature] = useState(false);
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
        setSavedSignatureStrokes(signatureProfile?.strokes ?? []);
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

  async function releaseToEffectiveLibrary() {
    if (!control || status === "releasing" || control.status === "effective") return;
    if (!qualitySignature && !signatureStrokes.length) {
      setError("Draw and save your Quality signature before releasing this SOP.");
      return;
    }
    setStatus("releasing");
    setError("");
    try {
      if (!qualitySignature && signatureChanged && !(await saveSignature())) {
        setStatus("error");
        return;
      }
      const signatureId =
        qualitySignature?.id ??
        (await signSop(sopId, "quality_approval", {
          expectedContentHash: control.contentHash,
          expectedReviewCycle: control.reviewCycle,
        }));
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
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60">
        {status === "error" ? (
          <div className="ui-panel max-w-sm p-5 text-center">
            <p className="ui-section-subtitle text-danger">{error}</p>
            <button type="button" className="ui-btn-ghost mt-3 h-9 px-4" onClick={onClose}>
              {returnLabel}
            </button>
          </div>
        ) : (
          <Loader2 size={22} className="animate-spin text-white" />
        )}
      </div>
    );
  }

  const released = control.status === "effective";
  const panel = (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="border-b border-line px-5 py-4">
        <div className="flex items-center gap-2">
          <ShieldCheck size={15} className="text-emerald-700" />
          <h2 className="text-sm font-medium text-ink">Quality final signature</h2>
        </div>
        <p className="mt-1 text-xs leading-5 text-ink-secondary">
          Verify the fully stakeholder-approved PDF, sign it, and release the controlled copy.
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-5">
        {error ? <div className="ui-notice ui-notice-warn px-3 py-2 text-xs">{error}</div> : null}
        <section className="rounded-md border border-line bg-surface-raised p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="ui-mono-label text-ink-tertiary">Quality approver</div>
              <p className="mt-1 text-sm font-medium text-ink">{currentUserName}</p>
              <p className="mt-0.5 text-xs text-ink-secondary">Final controlled-document release</p>
            </div>
            <span className={`ui-chip shrink-0 ${released ? "border-emerald-600 text-emerald-700" : ""}`}>
              {released ? "Effective" : qualitySignature ? "Signed" : "Pending"}
            </span>
          </div>
          {qualitySignature ? (
            <div className="mt-4 flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-emerald-800">
              <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-medium">Quality signature recorded</p>
                <p className="mt-0.5 text-[11px] tabular-nums">{formatDateTime(qualitySignature.signedAt)}</p>
              </div>
            </div>
          ) : null}
        </section>

        {!qualitySignature && !released ? (
          <section className="mt-4 rounded-md border border-line bg-surface-raised p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-xs font-medium text-ink">Your saved signature</h3>
                <p className="mt-1 text-[11px] leading-4 text-ink-tertiary">This signature is bound to the released PDF.</p>
              </div>
              <span className={`ui-chip shrink-0 ${!signatureChanged && signatureStrokes.length ? "border-emerald-600 text-emerald-700" : ""}`}>
                {!signatureStrokes.length ? "Not created" : signatureChanged ? "Unsaved" : "Saved"}
              </span>
            </div>
            <div className="mt-3">
              <SignaturePad
                value={signatureStrokes}
                disabled={savingSignature || status === "releasing"}
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
                disabled={!signatureStrokes.length || !signatureChanged || savingSignature || status === "releasing"}
                onClick={() => void saveSignature()}
              >
                {savingSignature ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                {savingSignature ? "Saving…" : "Save signature"}
              </button>
            </div>
          </section>
        ) : null}
      </div>

      <div className="border-t border-line bg-surface p-4">
        {released ? (
          <button type="button" className="ui-btn-primary h-9 w-full gap-2 px-4" onClick={onClose}>
            <CheckCircle2 size={14} />
            Effective · {returnLabel.toLowerCase()}
          </button>
        ) : (
          <button
            type="button"
            className="ui-btn-primary h-9 w-full gap-2 px-4 disabled:opacity-40"
            disabled={status === "releasing" || savingSignature || (!qualitySignature && !signatureStrokes.length)}
            onClick={() => void releaseToEffectiveLibrary()}
          >
            {status === "releasing" ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
            {status === "releasing" ? "Releasing…" : "Add Quality signature & release to Effective Library"}
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
