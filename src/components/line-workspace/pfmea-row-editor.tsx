"use client";
import { useEffect, useState } from 'react';
import { loadWorkspaceMembersFromSupabase } from '@/domain/supabase-planner';
import { normalizePfmeaScore, type PfmeaRow, type PfmeaActionStatus } from '@/domain/pfmea';
import { closePfmeaAction, patchPfmeaRow, pfmeaActionStatus, pfmeaClosureIssues } from '@/domain/pfmea-workflow';
import type { WorkspaceMemberProfile } from '@/domain/types';

export function PfmeaRowEditor({ row, workspaceId, readOnly, onSave, onCancel }: {
  row: PfmeaRow; workspaceId?: string; readOnly: boolean;
  onSave: (row: PfmeaRow) => void; onCancel: () => void;
}) {
  const [draft, setDraft] = useState(row);
  const [members, setMembers] = useState<WorkspaceMemberProfile[]>([]);
  const [directoryState, setDirectoryState] = useState<'loading' | 'ready' | 'error'>(workspaceId ? 'loading' : 'error');
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!workspaceId) return;
    let active = true;
    void loadWorkspaceMembersFromSupabase(workspaceId).then(rows => {
      if (active) { setMembers(rows.filter(member => member.fullName || member.email)); setDirectoryState('ready'); }
    }).catch(() => { if (active) setDirectoryState('error'); });
    return () => { active = false; };
  }, [workspaceId]);
  function change(patch: Partial<PfmeaRow>) {
    setDraft(current => patchPfmeaRow(current, patch));
    setConfirmed(false); setError('');
  }
  const textField = (field: 'failureMode' | 'effect' | 'cause' | 'currentControls' | 'detectionActivity' | 'recommendedActions' | 'actionsTaken' | 'verificationNotes', label: string) => (
    <label><span>{label}</span><textarea aria-label={label} value={draft[field] ?? ''} disabled={readOnly} onChange={event => change({ [field]: event.target.value })} rows={2} /></label>
  );
  const scoreField = (field: 'severity' | 'occurrence' | 'detection' | 'resultOccurrence' | 'resultDetection', label: string) => (
    <label><span>{label}</span><input aria-label={label} type="number" min={1} max={10} step={1} value={draft[field] ?? ''} disabled={readOnly} onChange={event => change({ [field]: normalizePfmeaScore(event.target.value) })} /></label>
  );
  const status = pfmeaActionStatus(draft);
  const legacyOwner = draft.actionOwner && !members.some(member => member.userId === draft.actionOwnerId);
  const closureIssues = pfmeaClosureIssues(draft);
  return <form className="ui-pfmea-focused-editor" onSubmit={event => {
    event.preventDefault(); if (readOnly) return;
    try { onSave(status === 'closed' && !draft.verifiedAt ? closePfmeaAction(draft, confirmed) : draft); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to save this risk.'); }
  }}>
    <p>{row.taskCodeSnapshot} · {row.processStepSnapshot || row.taskNameSnapshot}</p>
    <section><h4>Risk analysis</h4><div className="ui-pfmea-form-grid">
      {textField('failureMode', 'Failure mode')}{textField('effect', 'Effect')}{textField('cause', 'Cause')}
      {textField('currentControls', 'Prevention controls')}{textField('detectionActivity', 'Detection controls')}
      {scoreField('severity', 'Severity')}{scoreField('occurrence', 'Occurrence')}{scoreField('detection', 'Detection')}
    </div></section>
    <section><h4>Action and follow-up</h4><div className="ui-pfmea-form-grid">
      {textField('recommendedActions', 'Recommended action')}
      <label><span>Action owner</span><select aria-label="Action owner" disabled={readOnly || directoryState !== 'ready'} value={draft.actionOwnerId ?? (legacyOwner ? 'legacy' : '')} onChange={event => {
        const member = members.find(member => member.userId === event.target.value);
        change({ actionOwnerId: member?.userId, actionOwner: member?.fullName || member?.email || '' });
      }}><option value="">{directoryState === 'loading' ? 'Loading members…' : 'Choose a member'}</option>
        {legacyOwner ? <option value={draft.actionOwnerId ?? 'legacy'}>{draft.actionOwner} (existing)</option> : null}
        {members.map(member => <option key={member.userId} value={member.userId}>{member.fullName || member.email}{member.fullName && member.email ? ` · ${member.email}` : ''}</option>)}
      </select>{directoryState === 'error' ? <small>Member directory unavailable. The existing owner is preserved.</small> : null}</label>
      <label><span>Target date</span><input aria-label="Target date" type="date" value={draft.targetDate ?? ''} disabled={readOnly} onChange={event => change({ targetDate: event.target.value || undefined })} /></label>
      <label><span>Action status</span><select aria-label="Action status" value={status ?? ''} disabled={readOnly} onChange={event => { const actionStatus = event.target.value as PfmeaActionStatus; setDraft(current => ({ ...current, actionStatus, verifiedAt: undefined })); setConfirmed(false); }}>
        <option value="" disabled>No action</option><option value="open">Open</option><option value="in_progress">In progress</option><option value="awaiting_verification">Awaiting verification</option><option value="closed">Closed</option>
      </select></label>
      {textField('actionsTaken', 'Implementation evidence')}{scoreField('resultOccurrence', 'Residual occurrence')}{scoreField('resultDetection', 'Residual detection')}
      {textField('verificationNotes', 'Effectiveness verification')}
    </div>
    {status === 'closed' && !draft.verifiedAt ? <div className="ui-pfmea-verification">
      {closureIssues.length ? <ul>{closureIssues.map(issue => <li key={issue}>{issue}</li>)}</ul> : null}
      <label><input type="checkbox" checked={confirmed} disabled={readOnly} onChange={event => setConfirmed(event.target.checked)} /> I verified the action is effective using the evidence recorded above.</label>
    </div> : null}
    {draft.verifiedAt ? <p>Effectiveness verified · {draft.verifiedAt.slice(0, 10)}</p> : null}
    </section>
    {error ? <p role="alert">{error}</p> : null}
    <footer><button type="button" className="ui-btn-secondary h-9" onClick={onCancel}>Cancel</button><button type="submit" className="ui-btn-primary h-9" disabled={readOnly || (status === 'closed' && !draft.verifiedAt && (!confirmed || closureIssues.length > 0))}>Save risk</button></footer>
  </form>;
}
