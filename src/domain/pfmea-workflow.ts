import { getPfmeaRowIssues, createPfmeaRowForProcedureLink, syncPfmeaDocumentWithProcedure, type PfmeaDocument, type PfmeaRow } from './pfmea';
import type { Task, Scenario, Zone } from './types';

export function pfmeaLinkIssue(row: PfmeaRow, tasks: Task[]): string | undefined {
  if (row.archivedAt) return undefined;
  if (!row.taskId) return 'Source not linked';
  const task = tasks.find(task => task.id === row.taskId);
  if (!task) return 'Source task missing';
  if (row.stepId && !task.manufacturingSteps?.some(step => step.id === row.stepId)) return 'Source step missing';
  return undefined;
}

export function previewPfmeaSync(document: PfmeaDocument, scenario: Scenario, tasks: Task[], zones: Zone[]) {
  const next = syncPfmeaDocumentWithProcedure(document, scenario, tasks, zones);
  const oldIds = new Set(document.rows.map(row => row.id));
  const added = next.rows.filter(row => !oldIds.has(row.id));
  const missing = document.rows.filter(row => !row.archivedAt && row.taskId && pfmeaLinkIssue(row, tasks));
  const changed = next.rows.filter(row => {
    const old = document.rows.find(item => item.id === row.id);
    return old && !old.archivedAt && !pfmeaLinkIssue(row, tasks) && (
      old.taskNameSnapshot !== row.taskNameSnapshot || old.taskCodeSnapshot !== row.taskCodeSnapshot ||
      old.processStepSnapshot !== row.processStepSnapshot || old.stepSequenceSnapshot !== row.stepSequenceSnapshot ||
      old.zoneNameSnapshot !== row.zoneNameSnapshot || old.linkStatus !== row.linkStatus);
  });
  return { next, added, changed, missing };
}

export function relinkPfmeaRow(row: PfmeaRow, task: Task, stepId: string | undefined, zones: Zone[], now = new Date()): PfmeaRow {
  const step = stepId ? task.manufacturingSteps?.find(step => step.id === stepId) : undefined;
  if (stepId && !step) throw new Error('Choose an existing Procedure step.');
  const link = createPfmeaRowForProcedureLink(task, step, zones.find(zone => zone.id === task.zoneId), now);
  return {
    ...row, taskId: link.taskId, stepId: link.stepId, taskCodeSnapshot: link.taskCodeSnapshot,
    taskNameSnapshot: link.taskNameSnapshot, processStepSnapshot: link.processStepSnapshot,
    stepSequenceSnapshot: link.stepSequenceSnapshot, zoneIdSnapshot: link.zoneIdSnapshot,
    zoneNameSnapshot: link.zoneNameSnapshot, linkStatus: 'linked', updatedAt: now.toISOString(),
    linkHistory: [...(row.linkHistory ?? []), { taskId: row.taskId, stepId: row.stepId, label: row.processStepSnapshot ?? row.taskNameSnapshot ?? '', changedAt: now.toISOString() }],
  };
}

export function pfmeaActionStatus(row: PfmeaRow) {
  return row.actionStatus ?? (row.recommendedActions.trim() || row.actionsTaken.trim() || row.actionOwner.trim() || row.targetDate ? 'open' : undefined);
}

export function isPfmeaActionOverdue(row: PfmeaRow, today: string) {
  return !row.archivedAt && pfmeaActionStatus(row) !== 'closed' && Boolean(row.targetDate && row.targetDate < today);
}

export function pfmeaClosureIssues(row: PfmeaRow): string[] {
  const issues = getPfmeaRowIssues(row).map(issue => issue.message);
  if (!row.failureMode.trim()) issues.push('Describe the risk before closing its action.');
  if (!row.recommendedActions.trim()) issues.push('Describe the recommended action.');
  if (!row.actionOwner.trim()) issues.push('Choose an action owner.');
  if (!row.targetDate) issues.push('Set a target date.');
  if (!row.actionsTaken.trim()) issues.push('Record what was implemented.');
  if (row.resultOccurrence == null || row.resultDetection == null) issues.push('Record both residual scores.');
  if (!row.verificationNotes?.trim()) issues.push('Record how effectiveness was verified.');
  return [...new Set(issues)];
}

/** Editing a verified analysis requires verification again. Archive/restore alone does not. */
export function patchPfmeaRow(row: PfmeaRow, patch: Partial<PfmeaRow>, now = new Date()): PfmeaRow {
  const next = { ...row, ...patch, updatedAt: now.toISOString() };
  const substantiveChange = Object.keys(patch).some(key => !['archivedAt', 'updatedAt', 'id'].includes(key) && JSON.stringify(row[key as keyof PfmeaRow]) !== JSON.stringify(patch[key as keyof PfmeaRow]));
  if (row.actionStatus === 'closed' && substantiveChange) {
    next.actionStatus = 'awaiting_verification';
    next.verifiedAt = undefined;
  }
  return next;
}

export function closePfmeaAction(row: PfmeaRow, confirmed: boolean, now = new Date()): PfmeaRow {
  const issues = pfmeaClosureIssues(row);
  if (!confirmed || issues.length) throw new Error(issues[0] ?? 'Confirm effectiveness before closing.');
  return { ...row, actionStatus: 'closed', verifiedAt: now.toISOString(), updatedAt: now.toISOString() };
}
