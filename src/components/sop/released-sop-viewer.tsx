"use client";
import { normalizeSopDocument } from "@/domain/sop/normalize-document";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createPlannerSupabaseClient } from "@/domain/supabase-planner";
import { parseSignatureStrokes } from "@/domain/sop/signature";
import { type Sop } from "@/domain/sop/schema";
import type { ApprovalSignatureEntry } from "@/lib/sop/approval-entries";
import type { SopAnnexFile } from "@/lib/sop/annex-files";
import { mapFile } from "@/lib/sop/annex-files";
import { ModalSurface } from "@/components/ui/modal-surface";
import { ControlledChangeHistory } from "./controlled-change-history";
import { SopPrintPreview } from "./sop-print-preview";

export function ReleasedSopViewer({ sopId }: { sopId: string }) {
  const router = useRouter();
  const [state, setState] = useState<{ sop: Sop; authorName: string; approvals: ApprovalSignatureEntry[]; files: SopAnnexFile[] }>();
  const [showHistory, setShowHistory] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void (async () => {
      const { data, error: failure } = await createPlannerSupabaseClient().rpc("get_sop_effective_release", { p_sop: sopId });
      if (failure?.code === "PGRST202") {
        // Deployment compatibility only: a working draft is never substituted for a release.
        const [{ getSop }, { buildApprovalEntries }, { listSopAnnexFiles }] = await Promise.all([
          import("@/lib/sop/store"), import("@/lib/sop/approval-entries"), import("@/lib/sop/annex-files"),
        ]);
        const record = await getSop(sopId);
        if (!record || record.sop.status !== "effective") throw new Error("No current effective release is available.");
        const [approval, files] = await Promise.all([buildApprovalEntries(sopId), listSopAnnexFiles(sopId)]);
        if (active) setState({ sop: record.sop, authorName: approval.systemAuthorName, approvals: approval.entries, files });
        return;
      }
      if (failure) throw new Error(failure.message);
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("No current effective release is available.");
      const value = data as Record<string, unknown>;
      const document = normalizeSopDocument(value.document, sopId, String(value.released_at)).sop;
      const approvals = (Array.isArray(value.approvals) ? value.approvals : []) as Record<string, unknown>[];
      if (active) setState({
        sop: { ...document, id: sopId, status: "effective", meta: { ...document.meta,
          version: String(value.version), sopNumber: String(value.sop_number),
          effectiveDate: String(value.released_at).slice(0, 10) } },
        authorName: String(value.author_name || "SOP author"),
        approvals: approvals.map((signature) => ({
          key: String(signature.id), approval: signature.meaning === "quality_approval" ? "Quality final approval" :
            `${signature.department_name || "Department approval"}${signature.carried_from_version ? ` · Approval carried forward from ${signature.carried_from_version}` : ""}`,
          name: String(signature.signer_printed_name ?? ""), position: "", signedAt: String(signature.signed_at),
          signatureStrokes: parseSignatureStrokes(signature.signature_strokes),
        })),
        files: (Array.isArray(value.files) ? value.files : []).map((file) => mapFile(file as Record<string, unknown>)),
      });
    })().catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : "The released SOP could not be loaded."); });
    return () => { active = false; };
  }, [sopId]);
  if (error) return <div className="p-8"><p role="alert">{error}</p><Link href="/sops?tab=library">Back to Effective Library</Link></div>;
  if (!state) return <p className="p-8" role="status">Loading effective release…</p>;
  return <>{showHistory ? <ModalSurface label="Published change log" onCancel={() => setShowHistory(false)}><div className="flex min-h-dvh items-center justify-center bg-black/20 p-4"><div className="ui-panel max-h-[85vh] w-[min(40rem,calc(100vw-2rem))] overflow-auto p-4"><button type="button" className="ui-btn-ghost mb-2 px-3" onClick={() => setShowHistory(false)}>Close change log</button><ControlledChangeHistory sopId={sopId} refreshKey={state.sop.meta.version} releasedOnly /></div></div></ModalSurface> : null}<SopPrintPreview sop={state.sop} frozenApprovals={state.approvals} frozenAuthorName={state.authorName} annexFiles={state.files}
    toolbarActions={<button type="button" className="ui-btn-ghost h-9 px-3" onClick={() => setShowHistory(true)}>Change log</button>}
    onClose={() => router.push("/sops?tab=library")} toolbarNote="Current effective release · working drafts do not replace this document." /></>;
}
