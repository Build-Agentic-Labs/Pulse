"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Check, Paperclip, Save } from "lucide-react";
import { useConfirm } from "@/components/confirm-provider";
import { formatDateTime } from "@/domain/formatting";
import { caseLabel, isOverdue, sections, stages, stageLabels, transitionIssues, type ProblemCase, type ProblemAction, type ProblemEvidence, type ProblemHistory, type Stage } from "@/domain/problem-solving";
import { addAction, caseDetails, completeAction, evidenceUrl, saveCase, uploadEvidence } from "@/lib/problem-solving/store";

function errorMessage(e: unknown) { return e instanceof Error ? e.message : (e as { message?: string })?.message ?? "Unable to save. Please retry."; }

function HistorySnapshot({ entry }: { entry: ProblemHistory }) {
  const snapshot = entry.snapshot;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const fields: [string, string][] = entry.entity === "problem_cases"
    ? [["title", "Case"], ["stage", "Stage"], ["owner", "Owner"], ["source", "Customer / source"], ["severity", "Severity"], ["reported_on", "Reported"], ...sections.flatMap(section => section.fields.map(([key, label]): [string, string] => [key, label])), ["verified_on", "Verified"]]
    : entry.entity === "problem_actions" ? [["kind", "Type"], ["description", "Action"], ["owner", "Owner"], ["due_on", "Due date"], ["status", "Status"], ["completion_evidence", "Completion evidence"]]
      : [["section", "Section"], ["file_name", "File"]];
  return <dl className="ps-history-fields">{fields.map(([key, label]) => typeof snapshot[key] === "string" && snapshot[key] ? <div key={key}><dt>{label}</dt><dd>{key === "stage" || key === "section" ? stageLabels[String(snapshot[key])] : String(snapshot[key])}</dd></div> : null)}</dl>;
}

export function ProblemCaseForm({ initial, onDirty, onBack, onSaved }: { initial: ProblemCase; onDirty: (value: boolean) => void; onBack: () => void; onSaved: (row: ProblemCase) => void }) {
  const confirm = useConfirm();
  const [draft, setDraft] = useState(initial);
  const [actions, setActions] = useState<ProblemAction[]>([]);
  const [evidence, setEvidence] = useState<ProblemEvidence[]>([]);
  const [history, setHistory] = useState<ProblemHistory[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dirty, setDirty] = useState(false);
  const [actionDirty, setActionDirty] = useState(false);
  const [completion, setCompletion] = useState<Record<string, string>>({});
  const [action, setAction] = useState({ kind: "containment", description: "", owner: "", due_on: "" });
  const closed = draft.stage === "closed";
  const today = new Date().toLocaleDateString("en-CA");
  const next = stages[stages.indexOf(draft.stage as Stage) + 1];
  const issues = next ? transitionIssues(draft, actions, next, today) : [];
  const hasUnsaved = dirty || actionDirty || Object.values(completion).some(Boolean);
  useEffect(() => { onDirty(hasUnsaved); }, [hasUnsaved, onDirty]);
  const reload = useCallback(async () => {
    const data = await caseDetails(initial.id);
    setActions(data.actions); setEvidence(data.evidence); setHistory(data.history);
  }, [initial.id]);
  useEffect(() => { let active = true; void caseDetails(initial.id).then(data => { if (active) { setActions(data.actions); setEvidence(data.evidence); setHistory(data.history); setLoading(false); } }).catch(e => { if (active) { setError(errorMessage(e)); setLoading(false); } }); return () => { active = false; }; }, [initial.id]);
  function edit<K extends keyof ProblemCase>(key: K, value: ProblemCase[K]) { setDraft(d => ({ ...d, [key]: value })); setDirty(true); setNotice(""); }
  async function run(work: () => Promise<void>) { if (busy) return; setBusy(true); setError(""); setNotice(""); try { await work(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); } }
  async function save(stage = draft.stage) {
    await run(async () => {
      const row = await saveCase({ ...draft, stage });
      setDraft(row); setDirty(false); onSaved(row);
      setNotice(stage === "closed" ? "Effectiveness verified. Case signed off and closed." : "Case saved.");
      await reload();
    });
  }
  return <>
    <button className="ui-btn-ghost mb-4" onClick={onBack} disabled={busy}><ArrowLeft size={15} />Back to cases</button>
    <header className="ps-heading"><div><p className="ps-eyebrow">{caseLabel(draft.number)} · {closed ? "CLOSED" : "OPEN CASE"}</p><h1>{draft.title}</h1><p>{closed ? `Signed off ${formatDateTime(draft.closed_at)} · rlopez` : "Save your work at any point. Complete each stage when its evidence is ready."}</p></div><span className={`ps-badge ${closed ? "ps-done" : ""}`}>{stageLabels[draft.stage]}</span></header>
    <ol className="ps-progress" aria-label="Problem solving progress">{sections.map((s, i) => <li key={s.key} aria-current={draft.stage === s.key ? "step" : undefined} className={stages.indexOf(draft.stage as Stage) > i ? "ps-progress-done" : ""}><span>{stages.indexOf(draft.stage as Stage) > i ? <Check size={13} /> : i + 1}</span>{stageLabels[s.key]}</li>)}</ol>
    {error && <div role="alert" className="ps-error">{error}</div>}{notice && <p role="status" className="ps-notice">{notice}</p>}
    {loading && <p role="status">Loading actions and evidence…</p>}
    <fieldset disabled={busy || closed || loading} className="ps-case-fields">
      <section className="ps-panel ps-meta"><label className="ps-span-2">Case title<input required maxLength={200} value={draft.title} onChange={e => edit("title", e.target.value)} /></label><label>Customer / source<input value={draft.source} placeholder="Internal or customer name" onChange={e => edit("source", e.target.value)} /></label><label>Case owner<input value={draft.owner} onChange={e => edit("owner", e.target.value)} /></label><label>Reported date<input type="date" required value={draft.reported_on} onInput={e => edit("reported_on", e.currentTarget.value)} /></label><label>Severity<select value={draft.severity} onChange={e => edit("severity", e.target.value)}>{["Low","Medium","High","Critical"].map(s => <option key={s}>{s}</option>)}</select></label></section>
      {sections.map((section, index) => <details className="ps-panel ps-section" key={`${section.key}-${draft.stage}`} open={closed || draft.stage === section.key}>
        <summary><span className="ps-section-number">{index + 1}</span><span>{section.title}</span><small>{evidence.filter(e => e.section === section.key).length} files</small></summary>
        <div className="ps-section-body"><p className="ps-guidance">{section.guidance}</p>
          <div className="ps-narratives">{section.fields.map(([key, label]) => <label key={key}>{label}<textarea rows={3} value={draft[key]} onChange={e => edit(key, e.target.value)} /></label>)}</div>
          {section.key === "verify" && <label>Verification date<input type="date" min={draft.reported_on} max={today} value={draft.verified_on ?? ""} onInput={e => edit("verified_on", e.currentTarget.value || null)} /></label>}
          {evidence.filter(e => e.section === section.key).map(file => <div key={file.id} className="ps-file"><Paperclip size={14} /><span>{file.file_name}</span><small>{formatDateTime(file.created_at)}</small></div>)}
          {!closed && <label className="ps-upload"><Paperclip size={14} />Attach evidence<input type="file" aria-label={`Attach evidence to ${section.title}`} accept=".jpg,.jpeg,.png,.webp,.pdf,.txt,.csv,.docx,.xlsx" onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void run(async () => { await uploadEvidence(draft, section.key, file); await reload(); setNotice("Evidence attached."); }); }} /><small>Photos, PDF, Word, Excel or text · up to 20 MB each</small></label>}
        </div>
      </details>)}
    </fieldset>
    <section className="ps-panel ps-action-section"><h2>Action plan</h2><p className="ps-guidance">Contain the issue, remove the cause and prevent recurrence. Action records save separately from the form.</p>
      {actions.length === 0 && <p className="ps-guidance">No actions recorded yet.</p>}
      {actions.map(a => <div key={a.id} className="ps-action"><div><span className={`ps-badge ${a.status === "done" ? "ps-done" : ""}`}>{a.kind} · {a.status === "done" ? "Done" : "Open"}</span><h3>{a.description}</h3><p>{a.owner} · Due {a.due_on}{isOverdue(a, today) && <span className="ps-danger"> · Overdue</span>}</p>{a.status === "done" && <p className="ps-completion">{a.completion_evidence}</p>}</div>{a.status !== "done" && !closed && <form onSubmit={e => { e.preventDefault(); void run(async () => { await completeAction(a.id, completion[a.id] ?? ""); setCompletion(current => ({ ...current, [a.id]: "" })); await reload(); setNotice("Action completed with evidence."); }); }}><label>Completion evidence<textarea required disabled={busy} rows={2} value={completion[a.id] ?? ""} onChange={e => setCompletion(current => ({ ...current, [a.id]: e.target.value }))} placeholder="What was done, when, and what evidence confirms it?" /></label><button className="ui-btn-secondary" disabled={busy || !(completion[a.id] ?? "").trim()}>Mark complete</button></form>}</div>)}
      {!closed && <form className="ps-add-action" onSubmit={e => { e.preventDefault(); void run(async () => { await addAction({ ...action, case_id: draft.id }); setAction({ kind: action.kind, description: "", owner: "", due_on: "" }); setActionDirty(false); await reload(); setNotice("Action added."); }); }}><fieldset disabled={busy || loading}><legend>Add an action</legend><label>Type<select value={action.kind} onChange={e => { setAction(a => ({ ...a, kind: e.target.value })); setActionDirty(true); }}>{["containment","corrective","preventive"].map(k => <option key={k} value={k}>{k[0].toUpperCase() + k.slice(1)}</option>)}</select></label><label className="ps-span-2">Action<input required value={action.description} onChange={e => { setAction(a => ({ ...a, description: e.target.value })); setActionDirty(true); }} /></label><label>Owner<input required value={action.owner} onChange={e => { setAction(a => ({ ...a, owner: e.target.value })); setActionDirty(true); }} /></label><label>Due date<input type="date" required value={action.due_on} onInput={e => { const value = e.currentTarget.value; setAction(a => ({ ...a, due_on: value })); setActionDirty(true); }} /></label><button className="ui-btn-secondary" disabled={!action.description.trim() || !action.owner.trim() || !action.due_on}>Add action</button></fieldset></form>}
    </section>
    {evidence.length > 0 && <details className="ps-panel ps-section"><summary>Evidence library <small>{evidence.length} files</small></summary><div className="ps-section-body">{evidence.map(file => <div className="ps-file" key={file.id}><span>{stageLabels[file.section]}</span><button type="button" className="ps-case-link" disabled={busy} onClick={() => void run(async () => { const url = await evidenceUrl(file.storage_path); const link = document.createElement("a"); link.href = url; link.target = "_blank"; link.rel = "noopener noreferrer"; link.click(); })}>{file.file_name} ↗</button></div>)}</div></details>}
    <details className="ps-panel ps-section"><summary>Case history <small>{history.length} entries</small></summary><div className="ps-section-body">{history.map(h => <details className="ps-history" key={h.id}><summary>{h.entity === "problem_cases" ? "Case" : h.entity === "problem_actions" ? "Action" : "Evidence"} {h.event === "insert" ? "created" : "updated"} · {formatDateTime(h.created_at)} · rlopez</summary><HistorySnapshot entry={h} /></details>)}</div></details>
    {!closed && <div className="ps-savebar"><div><strong>{hasUnsaved ? "Unsaved changes" : "All changes saved"}</strong><small>{issues.length ? issues[0] : `Ready for ${stageLabels[next ?? "closed"]}`}</small></div><button className="ui-btn-secondary" disabled={busy || loading || !draft.title.trim() || !draft.reported_on} onClick={() => void save()}><Save size={15} />{busy ? "Saving…" : "Save draft"}</button><button className="ui-btn-primary" disabled={busy || loading || !next || issues.length > 0 || actionDirty || Object.values(completion).some(Boolean)} onClick={async () => { if (next === "closed" && !await confirm({ title: "Verify effectiveness and close?", body: "I confirm the recorded evidence demonstrates effectiveness. Closing signs off this case as rlopez and makes it read-only.", tone: "warning", confirmLabel: "Sign off and close", cancelLabel: "Keep open" })) return; void save(next); }}>{next === "closed" ? "Sign off & close" : `Continue to ${stageLabels[next ?? "closed"]}`}</button></div>}
  </>;
}
