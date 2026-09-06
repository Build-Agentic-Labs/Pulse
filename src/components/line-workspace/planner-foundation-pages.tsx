"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Download, FileText } from "lucide-react";

export { PfmeaWorkspace } from "./pfmea-workspace";
const ChecklistPdfViewer = dynamic(() => import("./checklist-pdf-viewer").then(module => module.ChecklistPdfViewer), { ssr: false });

export function ChecklistWorkspace() {
  const [kind, setKind] = useState<"build" | "pdi">("build");
  const [preview, setPreview] = useState(false);
  const title = kind === "build" ? "Build Traveler" : "Pre-Delivery Inspection";
  const pdf = `/templates/${kind}-checklist.pdf`;
  return (
    <section className="mx-auto max-w-[1100px] space-y-5" aria-labelledby="planner-checklist-title">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 id="planner-checklist-title" className="ui-section-title">Checklist templates</h2><p className="ui-section-subtitle mt-1">ANA · Blank controlled-document templates</p></div>
        <div className="flex gap-1" role="group" aria-label="Checklist template">
          {(["build", "pdi"] as const).map(value => <button key={value} type="button" aria-pressed={kind === value} className={`ui-btn-ghost h-8 px-3 text-xs ${kind === value ? "bg-surface-active text-ink" : "text-ink-secondary"}`} onClick={() => setKind(value)}>{value === "build" ? "Build Traveler" : "PDI"}</button>)}
        </div>
      </header>
      <div className="flex flex-wrap items-center justify-between gap-5 border-y border-line py-6">
        <div><h3 className="text-sm font-semibold">{title}</h3><p className="mt-2 text-xs text-ink-secondary">Portrait US Letter · 1 page · Operator and QC signature fields</p><p className="mt-1 text-xs text-ink-tertiary">Blank check rows, document control, traceability and final authorization.</p></div>
        <div className="flex gap-2"><button type="button" className="ui-btn-primary h-9 gap-2 px-4 text-xs" onClick={() => setPreview(true)}><FileText size={14} />View template</button><a href={pdf} download className="ui-btn-ghost h-9 gap-2 px-3 text-xs"><Download size={14} />Download</a></div>
      </div>
      <p className="text-[11px] text-ink-tertiary">Draft master template. Complete document approvals and define product-specific checks before use.</p>
      {preview ? <ChecklistPdfViewer key={kind} url={pdf} title={title} onClose={() => setPreview(false)} /> : null}
    </section>
  );
}
