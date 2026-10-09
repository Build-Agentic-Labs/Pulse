"use client";

import { effectiveProductAccess } from "@/domain/product-access";

import { BookOpen, Plus, ArrowRight, X } from "lucide-react";
import { useState, useEffect, useRef, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { awiDraftStatus, createAwiMaster, listAwiMasters, type AwiMaster } from "@/lib/awi/store";
import type { PlannerProjectContext, WorkspaceProjectGroup } from "@/domain/types";
import { AwiDirectoryShell } from "./awi-directory-shell";
import { AwiDirectoryColumns, AwiDirectoryLoadingContent } from "./awi-directory-loading";
import { groupAwiMasters } from "@/domain/awi-categories";

export function AwiDirectory({ project, groups, workspaceId, initialMasters }: { project?: PlannerProjectContext; groups?: WorkspaceProjectGroup[]; workspaceId?: string; initialMasters?: AwiMaster[] }) {
  const router = useRouter();
  const [masters, setMasters] = useState(initialMasters ?? []);
  const [loading, setLoading] = useState(initialMasters === undefined);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [number, setNumber] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const listWorkspaceRef = useRef(workspaceId);
  const canCreate = groups?.some((group) => group.workspace.id === workspaceId && effectiveProductAccess(group) === "edit");
  useEffect(() => {
    const workspaceChanged = listWorkspaceRef.current !== workspaceId;
    listWorkspaceRef.current = workspaceId;
    if (initialMasters !== undefined) {
      setMasters(initialMasters);
      setLoading(false);
      setError("");
      return;
    }
    if (workspaceChanged || !workspaceId) setMasters([]);
    if (!workspaceId) { setLoading(false); return; }
    setLoading(true);
    setError("");
    let cancelled = false;
    listAwiMasters(workspaceId).then((rows) => { if (!cancelled) setMasters(rows); })
      .catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : "Unable to load AWIs."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [initialMasters, workspaceId]);
  useEffect(() => {
    // Warm editor code only; opening a hidden builder would fetch unrelated data.
    const timer = window.setTimeout(() => { void import("./line-workspace").catch(() => undefined); }, 300);
    return () => window.clearTimeout(timer);
  }, []);
  async function create(event: FormEvent) {
    event.preventDefault();
    if (!workspaceId || pending || !title.trim()) return;
    setPending(true); setError("");
    try {
      const master = await createAwiMaster(workspaceId, title, number);
      setMasters((current) => [master, ...current]);
      router.push(`/awi/${master.id}?view=procedure&task=${encodeURIComponent(master.task_id)}`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to create AWI."); setPending(false); }
  }
  return <AwiDirectoryShell project={project} groups={groups} workspaceId={workspaceId} loading={loading}>
        {loading ? <AwiDirectoryLoadingContent /> : <>
        <div className="flex items-start justify-between gap-4 border-b border-line pb-5">
          <div><h1 className="ui-section-title">AWI Master List</h1>
            <p className="ui-section-subtitle mt-1">Common assembly work instructions across the product portfolio.</p></div>
          {canCreate ? <button type="button" className="ui-btn-ghost h-9 gap-2 px-3" onClick={() => { setAdding(true); setError(""); }}><Plus size={15} />Add AWI</button> : null}
        </div>
        {error ? <p role="alert" className="my-3 text-xs text-danger">{error}</p> : null}
        {masters.length ? (
          <div className="mt-5">
            <AwiDirectoryColumns />
            {groupAwiMasters(masters).map((group) => <section key={group.category} aria-label={group.category}>
              <h2 className="border-b border-line bg-surface-hover px-2 py-3 text-xs font-semibold">{group.category}<span className="ml-2 font-normal text-ink-tertiary">{group.masters.length}</span></h2>
            {group.masters.map((master) => <Link key={master.id} href={`/awi/${master.id}?view=procedure&task=${encodeURIComponent(master.task_id)}`}
              className="grid grid-cols-[minmax(110px,0.5fr)_minmax(0,2fr)_minmax(100px,1fr)_24px] items-center gap-4 border-b border-line px-2 py-4 text-xs transition-colors hover:bg-surface-hover focus-visible:bg-surface-hover">
              <span className="truncate font-mono text-ink-secondary">{master.document_number}</span><span className="truncate font-medium">{master.title}</span>
              <span className="text-ink-secondary">{awiDraftStatus(master)}</span><ArrowRight size={14} className="text-ink-tertiary" />
            </Link>)}
            </section>)}
          </div>
        ) : <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-center">
          <BookOpen size={24} strokeWidth={1.5} className="text-ink-tertiary" />
          <p className="text-sm font-medium">{canCreate ? "Create your first master AWI" : "No master AWIs yet"}</p>
          <p className="max-w-sm text-xs leading-relaxed text-ink-secondary">{canCreate ? "Add an instruction to open the full procedure builder. Your work is saved as a draft until you publish it." : "Instructions created by your team will appear here."}</p>
        </div>}
        {adding ? <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/20 p-4" role="presentation">
          <form onSubmit={create} className="w-full max-w-md rounded-xl border border-line bg-surface-raised p-6 shadow-lg" role="dialog" aria-modal="true" aria-labelledby="new-awi-title">
            <div className="mb-5 flex items-center justify-between"><h2 id="new-awi-title" className="ui-section-title">Add AWI</h2><button type="button" className="ui-btn-ghost h-8 w-8 px-0" aria-label="Cancel new AWI" disabled={pending} onClick={() => setAdding(false)}><X size={15} /></button></div>
            <label className="block text-xs text-ink-secondary">Instruction title<input className="ui-field-standalone mt-2 h-9 w-full rounded-md px-3" autoFocus required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} disabled={pending} /></label>
            <label className="mt-4 block text-xs text-ink-secondary">Document number<input className="ui-field-standalone mt-2 h-9 w-full rounded-md px-3" placeholder="Assigned automatically, or enter your own" maxLength={64} value={number} onChange={(event) => setNumber(event.target.value)} disabled={pending} /></label>
            <p className="mt-2 text-[11px] text-ink-tertiary">Leave blank for the next AWI number.</p>
            {error ? <p role="alert" className="mt-3 text-xs text-danger">{error}</p> : null}
            <div className="mt-6 flex justify-end gap-2"><button type="button" className="ui-btn-ghost h-9 px-3" disabled={pending} onClick={() => setAdding(false)}>Cancel</button><button type="submit" className="ui-btn-primary h-9 px-4" disabled={pending || !title.trim()}>{pending ? "Creating…" : "Create draft"}</button></div>
          </form>
        </div> : null}
        </>}
  </AwiDirectoryShell>;
}
