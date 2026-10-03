"use client";

import { BookOpen, PanelLeftClose, Plus, ArrowRight, X } from "lucide-react";
import { useState, useEffect, type CSSProperties, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { awiDraftStatus, createAwiMaster, listAwiMasters, type AwiMaster } from "@/lib/awi/store";
import type { PlannerProjectContext, WorkspaceProjectGroup } from "@/domain/types";
import { SpaceTopNav } from "./space-top-nav";
import { SidebarWorkspacePanel } from "./sidebar-workspace-panel";
import { SidebarReopenButton } from "./line-workspace/nav";

export function AwiDirectory({ project, groups, workspaceId, initialMasters }: { project?: PlannerProjectContext; groups?: WorkspaceProjectGroup[]; workspaceId?: string; initialMasters?: AwiMaster[] }) {
  const [collapsed, setCollapsed] = useState(false);
  const router = useRouter();
  const [masters, setMasters] = useState(initialMasters ?? []);
  const [loading, setLoading] = useState(initialMasters === undefined);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [number, setNumber] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const canCreate = groups?.some((group) => group.workspace.id === workspaceId && ["owner", "admin", "editor"].includes(group.role));
  useEffect(() => {
    if (initialMasters !== undefined || !workspaceId) return;
    let cancelled = false;
    listAwiMasters(workspaceId).then((rows) => { if (!cancelled) setMasters(rows); })
      .catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : "Unable to load AWIs."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [initialMasters, workspaceId]);
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
  return <div className="fixed inset-0 h-[100dvh] overflow-hidden bg-canvas text-ink"
    style={{ "--workspace-sidebar-width": collapsed ? "0px" : "var(--shell-sidebar)" } as CSSProperties}>
    <SpaceTopNav context="AWI Master List" />
    <div className="relative ui-workspace-shell">
      <SidebarReopenButton collapsed={collapsed} onToggle={() => setCollapsed(false)} />
      <div className={`ui-workspace-sidebar-slot ${collapsed ? "ui-workspace-sidebar-slot-collapsed" : ""}`}>
        <aside className="ui-nav-sidebar">
          <div className="flex h-9 shrink-0 items-center justify-end px-2">
            <button type="button" className="ui-btn-ghost inline-flex h-8 w-8 items-center justify-center px-0 text-ink-tertiary hover:text-ink"
              aria-label="Hide sidebar" title="Hide sidebar" onClick={() => setCollapsed(true)}><PanelLeftClose size={15} strokeWidth={1.75} /></button>
          </div>
          <SidebarWorkspacePanel activeProject={project} initialGroups={groups} />
        </aside>
      </div>
      <main className="min-h-0 min-w-0 overflow-auto rounded-l-xl bg-canvas p-6 transition-[border-radius] duration-300 ease-out sm:p-8">
        <div className="flex items-start justify-between gap-4 border-b border-line pb-5">
          <div><h1 className="ui-section-title">AWI Master List</h1>
            <p className="ui-section-subtitle mt-1">Common assembly work instructions across the product portfolio.</p></div>
          {canCreate ? <button type="button" className="ui-btn-ghost h-9 gap-2 px-3" onClick={() => { setAdding(true); setError(""); }}><Plus size={15} />Add AWI</button> : null}
        </div>
        {error ? <p role="alert" className="my-3 text-xs text-danger">{error}</p> : null}
        {loading ? <p className="py-8 text-xs text-ink-secondary" role="status">Loading AWIs…</p> : masters.length ? (
          <div className="mt-5">
            <div className="grid grid-cols-[minmax(110px,0.5fr)_minmax(0,2fr)_minmax(100px,1fr)_24px] gap-4 border-b border-line px-2 py-3 text-[10px] uppercase tracking-wider text-ink-tertiary"><span>Document number</span><span>Instruction</span><span>Status</span><span /></div>
            {masters.map((master) => <Link key={master.id} href={`/awi/${master.id}?view=procedure&task=${encodeURIComponent(master.task_id)}`}
              className="grid grid-cols-[minmax(110px,0.5fr)_minmax(0,2fr)_minmax(100px,1fr)_24px] items-center gap-4 border-b border-line px-2 py-4 text-xs transition-colors hover:bg-surface-hover focus-visible:bg-surface-hover">
              <span className="truncate font-mono text-ink-secondary">{master.document_number}</span><span className="truncate font-medium">{master.title}</span>
              <span className="text-ink-secondary">{awiDraftStatus(master)}</span><ArrowRight size={14} className="text-ink-tertiary" />
            </Link>)}
          </div>
        ) : <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-center">
          <BookOpen size={24} strokeWidth={1.5} className="text-ink-tertiary" />
          <p className="text-sm font-medium">Create your first master AWI</p>
          <p className="max-w-sm text-xs leading-relaxed text-ink-secondary">Add an instruction to open the full procedure builder. Your work is saved as a draft until you publish it.</p>
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
      </main>
    </div>
  </div>;
}
