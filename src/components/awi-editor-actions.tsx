"use client";

import type { SaveState } from "@/domain/supabase-planner";
import { useId, useState, type FormEvent } from "react";
import { ModalSurface } from "./ui/modal-surface";
import { Eye, Pencil, X } from "lucide-react";
import type { PlannerState } from "@/domain/types";
import { updateAwiMetadata, type AwiMaster } from "@/lib/awi/store";
import { WorkInstructionPrintPreview } from "./work-instruction/work-instruction-print";

export function AwiEditorActions({ master, state, saveState, saveError, recoveryDrafts, readOnly, ready, beforeSave }: {
  master: AwiMaster; state?: PlannerState; saveState: SaveState; readOnly: boolean; ready: boolean;
  beforeSave: () => Promise<boolean>;
  saveError?: string;
  recoveryDrafts?: unknown;
}) {
  const titleId = useId();
  const categoriesId = useId();
  const [preview, setPreview] = useState(false);
  const [editing, setEditing] = useState(false);
  const [number, setNumber] = useState(master.document_number);
  const [category, setCategory] = useState(master.category ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function save(event: FormEvent) {
    event.preventDefault();
    if (pending || readOnly || !number.trim()) return;
    setPending(true); setError("");
    try {
      if (!await beforeSave()) { setError("Save the procedure changes before updating AWI details."); setPending(false); return; }
      await updateAwiMetadata(master, number, category);
      // Reload confirmed task versions as well as the master, avoiding a stale autosave after renumbering.
      window.location.reload();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to save AWI details."); setPending(false); }
  }
  return <>
    <AwiSaveStatus saveState={saveState} saveError={saveError} />
    {(saveState === "error" || saveState === "retrying" || saveState === "conflict") && state ?
      <button type="button" className="ui-btn-ghost h-8 px-2" onClick={() => {
        const url = URL.createObjectURL(new Blob([JSON.stringify({ master, state, recoveryDrafts, saveError, exportedAt: new Date().toISOString() }, null, 2)], { type: "application/json" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = `${master.document_number}-recovery.json`;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }}>Download draft</button> : null}
    {!readOnly ? <button type="button" className="ui-btn-ghost h-8 gap-1.5 px-2" disabled={!ready}
      onClick={() => { setNumber(master.document_number); setCategory(master.category ?? ""); setError(""); setEditing(true); }}>
      <Pencil size={14} />AWI details
    </button> : null}
    <button type="button" className="ui-btn-ghost h-8 gap-1.5 px-2" disabled={!ready} onClick={() => setPreview(true)}><Eye size={15} />Preview</button>
    {preview ? <WorkInstructionPrintPreview projectId={master.project_id} taskIds={[master.task_id]} initialPlannerState={state} sopViewer onClose={() => setPreview(false)} /> : null}
    {editing ? <ModalSurface labelledBy={titleId} onCancel={() => { if (!pending) setEditing(false); }}><div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/20 p-4">
      <form onSubmit={save}
        className="w-full max-w-sm rounded-xl border border-line bg-surface-raised p-6 shadow-lg">
        <div className="mb-5 flex items-center justify-between"><h2 id={titleId} className="ui-section-title">AWI details</h2>
          <button type="button" className="ui-btn-ghost h-8 w-8 px-0" aria-label="Close AWI details" disabled={pending} onClick={() => setEditing(false)}><X size={15} /></button></div>
        <label className="block text-xs text-ink-secondary">AWI number<input data-modal-initial-focus required maxLength={64} className="ui-field-standalone mt-2 h-9 w-full rounded-md px-3" value={number} onChange={event => setNumber(event.target.value)} disabled={pending} /></label>
        <label className="mt-4 block text-xs text-ink-secondary">Category<input list={categoriesId} maxLength={80} placeholder="e.g. Accessory or Trailer" className="ui-field-standalone mt-2 h-9 w-full rounded-md px-3" value={category} onChange={event => setCategory(event.target.value)} disabled={pending} /></label>
        <datalist id={categoriesId}><option value="Accessory" /><option value="Trailer" /><option value="Compressor" /><option value="Generator" /><option value="Hybrid" /><option value="Power Module" /></datalist>
        {error ? <p role="alert" className="mt-3 text-xs text-danger">{error}</p> : null}
        <div className="mt-6 flex justify-end gap-2"><button type="button" className="ui-btn-ghost h-9 px-3" disabled={pending} onClick={() => setEditing(false)}>Cancel</button>
          <button type="submit" className="ui-btn-primary h-9 px-4" disabled={pending || !number.trim()}>{pending ? "Saving…" : "Save"}</button></div>
      </form>
    </div></ModalSurface> : null}
  </>;
}

export function AwiSaveStatus({ saveState, saveError }: { saveState: SaveState; saveError?: string }) {
  const status = saveState === "error" || saveState === "retrying" ? "Save pending — keep this draft open"
    : saveState === "conflict" ? "Conflicting edit — keep this draft open"
    : saveState === "loading" ? "Loading…" : saveState === "saving" || saveState === "draft" ? "Saving…" : "Saved";
  return <span role="status" title={saveError} className="hidden text-[11px] text-ink-secondary sm:inline">{status}</span>;
}
