"use client";
import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { UiContextMenu } from "../ui-context-menu";
import { ModalSurface } from "../ui/modal-surface";
import { awiDraftStatus, listAwiMasters, type AwiMaster } from "@/lib/awi/store";
export function AddTaskMenu({workspaceId, disabled, onNewTask, onLinkTask}: {workspaceId?:string; disabled?:boolean; onNewTask:()=>void; onLinkTask:(master:AwiMaster)=>Promise<void>}) {
  const [anchor,setAnchor]=useState<DOMRect|null>(null);
  const [picking,setPicking]=useState(false);
  const [masters,setMasters]=useState<AwiMaster[]>([]);
  const [query,setQuery]=useState("");
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(false);
  const [pending,setPending]=useState(false);
  const [retry,setRetry]=useState(0);
  useEffect(()=>{
    if (!picking || !workspaceId) return;
    let active=true; setLoading(true); setError(""); setMasters([]);
    listAwiMasters(workspaceId).then(rows=>{if(active)setMasters(rows);}).catch(e=>{if(active)setError(e instanceof Error ? e.message : "Unable to load AWIs.");}).finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[picking,workspaceId,retry]);
  const matches=masters.filter(m=>`${m.document_number} ${m.title} ${m.category}`.toLowerCase().includes(query.toLowerCase()));
  return <>
    <button type="button" disabled={disabled} aria-haspopup="menu" aria-expanded={Boolean(anchor)} onClick={e=>setAnchor(e.currentTarget.getBoundingClientRect())} className="ui-btn-ghost h-9 gap-2"><Plus size={16}/>Task</button>
    {anchor && <UiContextMenu anchorRect={anchor} ariaLabel="Add task" density="comfortable" menuWidth={220} onClose={()=>setAnchor(null)} items={[
      {id:"new",label:"New task",onSelect:onNewTask},
      {id:"linked",label:"Link AWI from master list",disabled:!workspaceId,onSelect:()=>{setQuery("");setPicking(true);}},
    ]}/>}
    {picking && <ModalSurface labelledBy="link-awi-title" onCancel={()=>{if(!pending)setPicking(false);}}><div className="fixed inset-0 flex items-center justify-center bg-black/20 p-4"><section className="w-full max-w-xl rounded-xl border border-line bg-surface-raised p-6 shadow-lg">
      <div className="flex items-center justify-between"><h2 id="link-awi-title" className="ui-section-title">Link AWI from master list</h2><button type="button" className="ui-btn-ghost h-9 w-9" disabled={pending} aria-label="Close AWI picker" onClick={()=>setPicking(false)}><X size={16}/></button></div>
      <p className="mt-2 text-xs text-ink-secondary">Instructions and timing come from the master. Plan this task’s operators here.</p>
      <input data-modal-initial-focus aria-label="Search master AWIs" placeholder="Search by AWI number, name, or category" className="ui-input mt-4 w-full" value={query} onChange={e=>setQuery(e.target.value)}/>
      <div className="mt-4 max-h-80 overflow-auto">
        {loading ? <p role="status" className="py-6 text-sm">Loading master AWIs…</p> : error ? <div role="alert"><p>{error}</p><button type="button" className="ui-btn-ghost" onClick={()=>setRetry(n=>n+1)}>Retry</button></div> : matches.length ? matches.map(master=><button type="button" disabled={pending} key={master.id} className="flex w-full items-center justify-between gap-4 border-b border-line py-3 text-left text-xs hover:bg-surface-hover" onClick={async()=>{setPending(true);setError("");try {await onLinkTask(master);setPicking(false);} catch(e) {setError(e instanceof Error ? e.message : "Unable to link AWI.");} finally {setPending(false);}}}><span><span className="block font-mono text-ink-secondary">{master.document_number}</span><span className="mt-1 block font-medium">{master.title}</span></span><span className="text-ink-secondary">{awiDraftStatus(master)}</span></button>) : <p className="py-6 text-sm text-ink-secondary">{masters.length ? "No matching AWIs." : "No master AWIs in this workspace yet."}</p>}
      </div>
    </section></div></ModalSurface>}
  </>;
}
