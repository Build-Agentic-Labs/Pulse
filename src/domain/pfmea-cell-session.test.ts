import { describe, expect, it, vi } from 'vitest';
import { createPfmeaCellSession } from './pfmea-cell-session';
import { createPfmeaDocumentFromProcedure, createPfmeaRowForProcedureLink } from './pfmea';
import { emptyPlannerState } from './empty-planner-state';
import type { Task } from './types';

function fixture() {
  const document = createPfmeaDocumentFromProcedure(emptyPlannerState.product, emptyPlannerState.scenario, [], []);
  document.rows = [createPfmeaRowForProcedureLink({ id: 'task', name: 'Fixture', wbs: '1', customFields: {} } as Task, undefined, undefined)];
  return document;
}

describe('PFMEA cell session', () => {
  it('recovers the same mutation ID and payload after losing a response and reloading', async () => {
    const base = fixture(); const edited = structuredClone(base); edited.rows[0].severity = 6;
    let retained: Parameters<typeof createPfmeaCellSession>[0]['pending'];
    const first = createPfmeaCellSession({ document: base, versions: {}, mutationId: () => 'original', retain: pending => { retained = structuredClone(pending); }, send: async () => { throw new Error('Response lost'); } });
    await expect(first.save(edited)).rejects.toThrow('Response lost');
    const send = vi.fn().mockResolvedValue({ document: edited, versions: {} });
    const restored = createPfmeaCellSession({ document: base, versions: {}, pending: retained, mutationId: () => 'must-not-use', send });
    await restored.save(edited);
    expect(send).toHaveBeenCalledExactlyOnceWith('original', retained!.changes);
  });
  it('does not resend another editor’s values from the server acknowledgement', async () => {
    const base = fixture(); const row = base.rows[0].id;
    const first = structuredClone(base); first.rows[0].failureMode = 'Mine';
    const remote = structuredClone(first); remote.rows[0].effect = 'Other editor';
    const send = vi.fn().mockResolvedValue({ document: remote, versions: { [row]: { failureMode: { version: 1, mutationId: 'one' }, effect: { version: 1, mutationId: 'other' } } } });
    const session = createPfmeaCellSession({ document: base, versions: {}, mutationId: () => 'one', send });
    await session.save(first);
    const second = structuredClone(first); second.rows[0].cause = 'My cause';
    await session.save(second);
    expect(send.mock.calls[1][1]).toEqual([{ rowId: row, field: 'cause', previous: '', value: 'My cause', expectedVersion: 0 }]);
  });

  it('reuses a failed mutation before sending newer edits', async () => {
    const base = fixture(); const row = base.rows[0].id;
    const first = structuredClone(base); first.rows[0].severity = 5;
    const second = structuredClone(first); second.rows[0].severity = 6;
    const send = vi.fn().mockRejectedValueOnce(new Error('Response lost'))
      .mockResolvedValueOnce({ document: first, versions: { [row]: { severity: { version: 1, mutationId: 'one' } } } })
      .mockResolvedValueOnce({ document: second, versions: { [row]: { severity: { version: 2, mutationId: 'two' } } } });
    const mutationId = vi.fn().mockReturnValueOnce('one').mockReturnValueOnce('two');
    const session = createPfmeaCellSession({ document: base, versions: {}, mutationId, send });
    await expect(session.save(first)).rejects.toThrow('Response lost');
    expect(session.hasPending()).toBe(true);
    await session.save(second);
    expect(send.mock.calls[0]).toEqual(send.mock.calls[1]);
    expect(send.mock.calls[2]).toEqual(['two', [{ rowId: row, field: 'severity', previous: 5, value: 6, expectedVersion: 1 }]]);
    expect(session.hasPending()).toBe(false);
  });

  it('keeps same-cell conflicts pending rather than silently rebasing', async () => {
    const base = fixture(); const edited = structuredClone(base); edited.rows[0].severity = 9;
    const send = vi.fn().mockRejectedValue(new Error('Cell conflict'));
    const session = createPfmeaCellSession({ document: base, versions: {}, mutationId: () => 'one', send });
    await expect(session.save(edited)).rejects.toThrow('Cell conflict');
    await expect(session.save(edited)).rejects.toThrow('Cell conflict');
    expect(send.mock.calls[0]).toEqual(send.mock.calls[1]);
    expect(session.hasPending()).toBe(true);
  });
});
