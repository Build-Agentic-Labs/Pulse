"use client";
import { useEffect, useState } from "react";
import type { Sop } from "@/domain/sop/schema";
import { getSopDetectedChanges } from "@/lib/sop/controlled-changes";
export interface ImpactAssessment { impactConfirmed: boolean; processOwnerConfirmed: boolean }
export const emptyImpactAssessment: ImpactAssessment = { impactConfirmed: false, processOwnerConfirmed: false };
export function ChangeImpactAssessment({ sopId, document, refreshKey, minor, value, onChange }: { sopId: string; document: Sop; refreshKey: string; minor: boolean; value: ImpactAssessment; onChange: (value: ImpactAssessment) => void }) {
 const [detected, setDetected] = useState<{ sections: string[]; status: "loading" | "ready" | "error" }>({ sections: [], status: "loading" });
 useEffect(() => {
  let active = true;
  const timer = window.setTimeout(() => {
   setDetected(previous => ({ ...previous, status: "loading" }));
   getSopDetectedChanges(sopId, document).then(sections => { if (active) setDetected({ sections, status: "ready" }); })
    .catch(() => { if (active) setDetected({ sections: [], status: "error" }); });
  }, 250);
  return () => { active = false; window.clearTimeout(timer); };
 }, [sopId, document, refreshKey]);
 return <section className="ui-panel space-y-3 p-4">
  <h3 className="ui-setup-section-title">Change assessment</h3>
  <div className="text-xs" aria-live="polite"><p className="text-ink-secondary">Changes detected</p>
   <p className="mt-1">{detected.status === "loading" ? "Checking changes…" : detected.status === "error" ? "Changes could not be checked. Reload before submitting." : detected.sections.length ? detected.sections.join(" · ") : "No changes detected yet."}</p>
  </div>
  <label className="flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5" checked={value.impactConfirmed} onChange={e => onChange({ ...value, impactConfirmed: e.target.checked })} />{minor ? "I reviewed the impact and confirm this is a minor revision." : "I reviewed the impact and confirm a new version is required."}</label>
  {minor ? <label className="flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5" checked={value.processOwnerConfirmed} onChange={e => onChange({ ...value, processOwnerConfirmed: e.target.checked })} />As process owner, I confirm no changes to the process, requirements, responsibilities or controls.</label> : null}
  <details className="text-xs text-ink-secondary">
   <summary className="w-fit cursor-pointer text-ink-tertiary">Which change type?</summary>
   <div className="mt-2 space-y-1">
    <p><span className="font-medium">Minor revision:</span> Spelling, formatting or admin fixes with no operational impact.</p>
    <p><span className="font-medium">New version:</span> Changes to the process, requirements, responsibilities, controls, risks or required records.</p>
    <p>Unsure? Ask Quality.</p>
   </div>
  </details>
 </section>;
}

export interface QualityConfirmations { classification: boolean; document: boolean; history: boolean }
export const emptyQualityConfirmations: QualityConfirmations = { classification: false, document: false, history: false };
export function ChangeQualityConfirmations({ minor, value, onChange }: { minor: boolean; value: QualityConfirmations; onChange: (value: QualityConfirmations) => void }) {
 const labels: [keyof QualityConfirmations,string][] = [
  ["classification", minor ? "I confirm this is a minor change with no impact on process execution, requirements, responsibilities or established controls." : "I confirm the major-change classification and completion of the full approval workflow."],
  ["document", "Acting as Document Control, I verified the proposed modification and the document to be released."],
  ["history", "I verified the revision number, date, description, sections affected, creator and approver in the change history."],
 ];
 return <section className="ui-panel space-y-3 p-4"><h3 className="ui-setup-section-title">Quality / Document Control verification</h3><p className="text-xs text-ink-secondary">Confirm each item before signing and releasing. Return the change or require full version review if the classification is uncertain.</p>{labels.map(([key,label]) => <label key={key} className="flex items-start gap-2 text-xs"><input type="checkbox" checked={value[key]} onChange={e => onChange({ ...value, [key]: e.target.checked })} />{label}</label>)}</section>;
}
