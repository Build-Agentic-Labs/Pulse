"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/components/confirm-provider";
import { ArrowLeft, CheckCircle2, ClipboardList, LayoutDashboard, Plus, Search } from "lucide-react";
import { SopShell } from "@/components/sop/sop-shell";
import { useSopWorkspace } from "@/components/sop/sop-workspace-provider";
import { formatDateTime } from "@/domain/formatting";
import { caseLabel, isOverdue, stageLabels, type ProblemCase, type ProblemAction } from "@/domain/problem-solving";
import { createCase, listCases, listActions } from "@/lib/problem-solving/store";
import { ProblemCaseForm } from "./problem-case-form";
import "./problem-solving.css";

type Tab = "dashboard" | "open" | "closed";
type Initial = { workspaceId: string; cases: ProblemCase[]; actions: ProblemAction[] };
const message = (e: unknown) => e instanceof Error ? e.message : (e as { message?: string })?.message ?? "Something went wrong. Please retry.";

export function ProblemWorkspace({ initial }: { initial?: Initial }) {
  const { workspaceId } = useSopWorkspace();
  // Remount on workspace change so records from the previous scope never flash.
  return <Workspace key={workspaceId ?? "none"} workspaceId={workspaceId} initial={initial?.workspaceId === workspaceId ? initial : undefined} />;
}
function Workspace({ workspaceId, initial }: { workspaceId?: string; initial?: Initial }) {
  const confirm = useConfirm();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("dashboard");
  const [cases, setCases] = useState(initial?.cases ?? []);
  const [actions, setActions] = useState(initial?.actions ?? []);
  const [selected, setSelected] = useState<ProblemCase | null>(null);
  const [search, setSearch] = useState("");
  const [title, setTitle] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(!initial);
  const [creating, setCreating] = useState(false);
  const [keyboardNavigation, setKeyboardNavigation] = useState(false);
  const dirty = useRef(false);
  const generation = useRef(0);
  const today = new Date().toLocaleDateString("en-CA");
  const refresh = useCallback(async () => {
    if (!workspaceId) { setLoading(false); return; }
    const request = ++generation.current;
    try {
      const rows = await listCases(workspaceId);
      const tasks = await listActions(rows.map(c => c.id));
      if (request !== generation.current) return;
      setCases(rows); setActions(tasks); setError("");
    } catch (e) { if (request === generation.current) setError(message(e)); }
    finally { if (request === generation.current) setLoading(false); }
  }, [workspaceId]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Tab") setKeyboardNavigation(true); };
    const onPointerDown = () => setKeyboardNavigation(false);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, []);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if (dirty.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, []);
  async function leave() { return !dirty.current || await confirm({ title: "Leave without saving?", body: "Your unsaved form and action entries will be lost.", tone: "warning", confirmLabel: "Leave", cancelLabel: "Stay" }); }
  async function navigate(next: Tab) { if (!await leave()) return; dirty.current = false; setSelected(null); setTab(next); setTitle(null); void refresh(); }
  const open = cases.filter(c => c.stage !== "closed");
  const closed = cases.filter(c => c.stage === "closed");
  const overdue = actions.filter(a => open.some(c => c.id === a.case_id) && isOverdue(a, today));
  const visible = (tab === "closed" ? closed : tab === "open" ? open : cases).filter(c => `${caseLabel(c.number)} ${c.title} ${c.source} ${c.owner}`.toLowerCase().includes(search.toLowerCase()));
  const sidebar = <>
    <Link href="/sops" className="ui-nav-item ui-nav-item-idle" onClick={async e => { e.preventDefault(); if (await leave()) router.push("/sops"); }}><ArrowLeft size={15} />Quality / SOPs</Link>
    <div className="ui-nav-section mt-4">Problem Solving</div>
    {([ ["dashboard", "Dashboard", LayoutDashboard], ["open", "Open", ClipboardList], ["closed", "Closed", CheckCircle2] ] as const).map(([key, label, Icon]) => <button type="button" key={key} onClick={() => navigate(key)} className={`ui-nav-item w-full ${tab === key ? "ui-nav-item-active" : "ui-nav-item-idle"}`}><Icon size={15} />{label}<span className="ml-auto">{key === "open" ? open.length : key === "closed" ? closed.length : ""}</span></button>)}
    <p className="ps-pilot-note">Private pilot · rlopez</p>
  </>;
  return <SopShell sidebar={sidebar} crumb="Quality / Problem Solving" confirmLeave={leave}>
    <div className="ps-workspace" data-keyboard-navigation={keyboardNavigation}>
      {selected ? <ProblemCaseForm key={selected.id} initial={selected} onDirty={value => { dirty.current = value; }} onBack={() => navigate(tab)} onSaved={row => { setSelected(row); setCases(current => current.map(c => c.id === row.id ? row : c)); void refresh(); }} /> : <>
        <header className="ps-heading"><div><p className="ps-eyebrow">QUALITY · PRIVATE PILOT</p><h1>Problem Solving</h1><p>From evidence to a verified solution.</p></div><button className="ui-btn-primary" disabled={!workspaceId || loading || creating} onClick={() => setTitle("")}><Plus size={16} />New case</button></header>
        <div className="ps-tabs" aria-label="Case views">{(["dashboard","open","closed"] as const).map(t => <button key={t} onClick={() => navigate(t)} aria-pressed={tab === t} className={tab === t ? "ps-tab-active" : ""}>{t[0].toUpperCase() + t.slice(1)}</button>)}</div>
        {error && <div className="ps-error" role="alert">{error} <button onClick={() => void refresh()}>Retry</button></div>}
        {title !== null && <form className="ps-new ps-panel" onSubmit={async e => { e.preventDefault(); if (!workspaceId || creating) return; setCreating(true); try { const row = await createCase(workspaceId, title); setCases(current => [row, ...current]); setSelected(row); setTitle(null); setError(""); } catch (err) { setError(message(err)); } finally { setCreating(false); } }}><label>Case title<input autoFocus required maxLength={200} value={title} onChange={e => setTitle(e.target.value)} placeholder="A short, factual description of the problem" /></label><button className="ui-btn-primary" disabled={creating || !title.trim()}>{creating ? "Creating…" : "Create case"}</button><button type="button" className="ui-btn-ghost" onClick={() => setTitle(null)}>Cancel</button></form>}
        {tab === "dashboard" && <div className="ps-metrics">
          <button onClick={() => navigate("open")}><span>Open cases</span><strong>{open.length}</strong><small>Investigations in progress</small></button>
          <div><span>Overdue actions</span><strong className={overdue.length ? "ps-danger" : ""}>{overdue.length}</strong><small>Past their due date</small></div>
          <div><span>Awaiting verification</span><strong>{open.filter(c => c.stage === "verify").length}</strong><small>Check that the solution worked</small></div>
          <button onClick={() => navigate("closed")}><span>Closed cases</span><strong>{closed.length}</strong><small>Verified and signed off</small></button>
        </div>}
        {tab === "dashboard" && overdue.length > 0 && <section className="ps-panel ps-attention"><h2>Actions needing attention</h2>{overdue.map(a => <button key={a.id} onClick={() => setSelected(cases.find(c => c.id === a.case_id) ?? null)}><span>{a.description}<small>{a.owner} · Due {a.due_on}</small></span><span className="ps-danger">Overdue →</span></button>)}</section>}
        <section className="ps-panel"><div className="ps-list-heading"><h2>{tab === "dashboard" ? "Recent cases" : tab === "open" ? "Open cases" : "Closed cases"}</h2><label className="ps-search"><Search size={15} /><span className="sr-only">Search cases</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search cases, customers or owners" /></label></div>
          {loading ? <p className="ps-empty" role="status">Loading cases…</p> : !workspaceId ? <p className="ps-empty">Select a Quality workspace to get started.</p> : !visible.length ? <div className="ps-empty"><ClipboardList size={30} /><h3>{search ? "No matching cases" : tab === "closed" ? "No closed cases yet" : "No cases yet"}</h3><p>{search ? "Try a different search." : tab === "closed" ? "Cases appear here after effectiveness verification and sign-off." : "Create a case to capture the problem, evidence and actions in one place."}</p></div> : <div className="ps-table-wrap"><table><thead><tr><th>Case / problem</th><th>Customer / source</th><th>Owner</th><th>Stage</th><th>Actions</th><th>Updated</th></tr></thead><tbody>{visible.map(c => { const tasks = actions.filter(a => a.case_id === c.id); const late = tasks.filter(a => isOverdue(a,today)); return <tr key={c.id}><td><button className="ps-case-link" onClick={() => setSelected(c)}><small>{caseLabel(c.number)}</small>{c.title}</button></td><td>{c.source || "—"}</td><td>{c.owner || "Unassigned"}</td><td><span className={`ps-badge ${c.stage === "closed" ? "ps-done" : ""}`}>{stageLabels[c.stage]}</span></td><td>{tasks.filter(a => a.status === "done").length}/{tasks.length}{late.length > 0 && <small className="ps-danger">{late.length} overdue</small>}</td><td>{formatDateTime(c.updated_at)}</td></tr>; })}</tbody></table></div>}
        </section>
      </>}
    </div>
  </SopShell>;
}
