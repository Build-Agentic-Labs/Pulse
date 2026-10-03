"use client";

import { ArrowLeft, FileCheck2 } from "lucide-react";
import { useState, useEffect } from "react";
import type { SaveState } from "@/domain/supabase-planner";
import type { WorkInstruction } from "@/domain/work-instruction/schema";
import type { WorkInstructionReleaseSummary } from "@/domain/work-instruction/release";
import type { WorkInstructionReferenceRecord } from "@/domain/work-instruction/references";
import type { AwiMaster } from "@/lib/awi/store";
import { WorkInstructionControl } from "./work-instruction/work-instruction-control";
import { listWorkInstructionReleases } from "@/lib/work-instruction/store";

export type AwiPublishPreparation = { instruction: WorkInstruction; releases: WorkInstructionReleaseSummary[]; references: WorkInstructionReferenceRecord[] };
export function AwiEditorActions({ master, saveState, readOnly, onPrepare, onLeave }: {
  master: AwiMaster; saveState: SaveState; readOnly: boolean;
  onPrepare: () => Promise<AwiPublishPreparation | null>; onLeave: () => Promise<void>;
}) {
  const [preparation, setPreparation] = useState<AwiPublishPreparation | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [published, setPublished] = useState(false);
  useEffect(() => { if (saveState === "draft" || saveState === "saving") setPublished(false); }, [saveState]);
  async function openPublish() {
    setPending(true); setError("");
    try { setPreparation(await onPrepare()); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to prepare AWI."); }
    finally { setPending(false); }
  }
  const status = saveState === "error" || saveState === "retrying" ? "Save pending — keep this draft open"
    : saveState === "conflict" ? "Conflicting edit — keep this draft open"
    : saveState === "loading" ? "Loading…" : saveState === "saving" || saveState === "draft" ? "Saving…" : "Saved";
  return <>
    <span role="status" className="hidden text-[11px] text-ink-secondary sm:inline">{error || (published ? "Published" : status)}</span>
    <button type="button" className="ui-btn-ghost h-8 gap-1.5 px-2 text-xs" onClick={() => { void onLeave(); }} disabled={pending}><ArrowLeft size={13} />AWI list</button>
    {!readOnly ? <button type="button" className="ui-btn-ghost h-8 gap-1.5 px-2 text-xs" onClick={() => { void openPublish(); }} disabled={pending || saveState === "loading"}><FileCheck2 size={14} />{pending ? "Preparing…" : "Publish AWI"}</button> : null}
    {preparation ? <WorkInstructionControl projectId={master.project_id} instruction={preparation.instruction} releases={preparation.releases} references={preparation.references}
      initialStep="release" readOnly={readOnly} photosLoaded
      onChanged={async () => {
        const releases = await listWorkInstructionReleases(master.project_id);
        if (releases.length > preparation.releases.length) setPublished(true);
        setPreparation((current) => current ? { ...current, releases } : null);
      }} onClose={() => setPreparation(null)} onEditTask={() => setPreparation(null)}
      onPreview={(options) => {
        window.open(`/projects/${encodeURIComponent(master.project_id)}/planner/work-instructions/print?taskIds=${encodeURIComponent(master.task_id)}${options?.releaseId ? `&release=${encodeURIComponent(options.releaseId)}` : ""}`, "_blank", "noopener");
      }} /> : null}
  </>;
}
