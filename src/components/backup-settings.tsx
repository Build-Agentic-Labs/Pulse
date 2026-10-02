"use client";
import { useCallback, useEffect, useState } from "react";
import { Download, HardDrive, Loader2 } from "lucide-react";

type Backup = { id: string; state: string; phase: string; updatedAt: string; integrityVerified?: boolean; restoreTested?:boolean; error?: string };
type Overview = { ready: boolean; problems: string[]; backups: Backup[] };
export function BackupSettings() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const refresh = useCallback(async () => {
    const response = await fetch("/api/backups", { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not load backup status.");
    setOverview(result);
  }, []);
  useEffect(() => { void refresh().catch((e) => setError(e.message)); }, [refresh]);
  const running = overview?.backups.some((backup) => backup.state === "running");
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => { void refresh().catch((e) => setError(e.message)); }, 3000);
    return () => clearInterval(timer);
  }, [running, refresh]);
  async function create() {
    setStarting(true); setError("");
    try {
      const response = await fetch("/api/backups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Backup could not start.");
      setPassword(""); setConfirmation(""); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Backup could not start."); }
    finally { setStarting(false); }
  }
  return <div className="space-y-6">
    <section className="ui-settings-section">
      <h3 className="ui-settings-section-title flex items-center gap-2"><HardDrive size={15} /> Local backup</h3>
      <p className="ui-settings-section-desc">Encrypted copies of Quality and Product records and original files. Production is read only. Choose where to save the download after verification.</p>
      {error ? <p role="alert" className="mt-3 text-sm text-danger">{error}</p> : null}
      {!overview && !error ? <p role="status" className="mt-3 text-sm text-ink-secondary">Checking backup setup…</p> : null}
      {overview && !overview.ready ? <div className="mt-4 border-y border-line py-4">
        <p className="text-sm font-medium">Setup required — exports are locked</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-secondary">{overview.problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>
        <p className="mt-3 text-sm text-ink-secondary">{overview.backups.length ? 'Existing backup progress is shown below. Setup checks must pass before starting another export.' : 'No production backup has been run. Read-only access and an isolated restore rehearsal must be verified first.'}</p>
      </div> : null}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-sm">Backup password<input type="password" autoComplete="new-password" className="ui-input mt-1 w-full" value={password} onChange={(e) => setPassword(e.target.value)} disabled={!overview?.ready || running} /></label>
        <label className="text-sm">Confirm password<input type="password" autoComplete="new-password" className="ui-input mt-1 w-full" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} disabled={!overview?.ready || running} /></label>
      </div>
      <p className="mt-2 text-xs text-ink-secondary">At least 16 characters. Keep this password securely; it is not saved and cannot be recovered.</p>
      <button type="button" className="ui-btn-primary mt-4" disabled={!overview?.ready || running || starting || password.length < 16 || password !== confirmation} onClick={() => void create()}>{starting || running ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}{running ? "Backup running" : "Create backup"}</button>
    </section>
    <section className="ui-settings-section">
      <h3 className="ui-settings-section-title">Backup history</h3>
      {!overview?.backups.length ? <p className="ui-settings-section-desc">No verified local backups yet.</p> : overview.backups.map((backup) => <div key={backup.id} className="flex items-center justify-between gap-4 border-b border-line py-4">
        <div><p className="text-sm">{new Date(backup.updatedAt).toLocaleString()}</p><p role="status" className="mt-1 text-xs text-ink-secondary">{backup.state === "complete" ? backup.restoreTested ? "Integrity verified · isolated restore verified" : "Integrity verified · restore not yet tested for this snapshot" : `${backup.state} · ${backup.phase || ""}`}</p>{backup.error ? <p className="mt-1 text-sm text-danger">{backup.error}</p> : null}</div>
        {backup.state === "complete" && backup.integrityVerified ? <a className="ui-btn-ghost" href={`/api/backups?download=${backup.id}`}><Download size={14} /> Save file</a> : null}
      </div>)}
    </section>
  </div>;
}
