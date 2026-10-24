import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePfmeaSaveQueue } from './use-pfmea-save-queue';
import { WorkspaceWriteTracker } from '@/domain/workspace-save-status';
import { createPfmeaDocumentFromProcedure } from '@/domain/pfmea';
import { createPfmeaDraftJournal } from '@/lib/planner/pfmea-drafts';
import { savePfmeaToSupabase } from '@/lib/planner/pfmea-store';
import type { Product, Scenario } from '@/domain/types';
const auth = vi.hoisted(() => ({ user: 'alice', emit: undefined as undefined | ((event: string, session: { user: { id: string } } | null) => void) }));
vi.mock('@/lib/planner/pfmea-store', () => ({ savePfmeaToSupabase: vi.fn() }));
vi.mock('@/lib/planner/client', () => ({
  plannerClient: () => ({ auth: { onAuthStateChange: (callback: typeof auth.emit) => { auth.emit = callback; return { data: { subscription: { unsubscribe: vi.fn() } } }; } } }),
  getUserFromSession: async () => ({ data: { user: { id: auth.user } } }),
}));
const base = () => createPfmeaDocumentFromProcedure({ id: 'p', name: 'Fixture' } as Product, { id: 's', name: 'Fixture scenario' } as Scenario, [], []);
beforeEach(() => { localStorage.clear(); auth.user = 'alice'; vi.useFakeTimers(); vi.mocked(savePfmeaToSupabase).mockResolvedValue(undefined); });
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
function mount(remote: unknown) {
  const tracker = new WorkspaceWriteTracker(); const saved = vi.fn();
  const hook = renderHook(() => usePfmeaSaveQueue('p', 'project', tracker, saved, { remote, enabled: true }));
  act(() => auth.emit?.('INITIAL_SESSION', { user: { id: auth.user } }));
  return { ...hook, saved };
}
describe('automatic PFMEA draft recovery', () => {
  it('restores without a prompt, saves against the original base, then clears the acknowledged journal', async () => {
    const remote = base(); const edited = { ...remote, owner: 'Recovered owner' };
    createPfmeaDraftJournal(localStorage, 'alice', 'project', 'p', 'crashed-tab').write(edited, remote);
    const hook = mount(remote);
    expect(hook.result.current.queue.latest()?.owner).toBe('Recovered owner');
    expect(hook.result.current.ready).toBe(true);
    await act(async () => { await hook.result.current.queue.flush(); });
    expect(savePfmeaToSupabase).toHaveBeenCalledWith('p', 'project', edited, remote);
    expect(localStorage.length).toBe(0);
    hook.unmount();
  });
  it('keeps a failed save on-device and restores it on the next mount', async () => {
    vi.mocked(savePfmeaToSupabase).mockRejectedValue(new Error('Offline'));
    const remote = base(); const edited = { ...remote, owner: 'Offline owner' };
    const hook = mount(remote);
    act(() => hook.result.current.queue.schedule(edited, remote));
    expect(localStorage.length).toBe(1);
    await act(async () => { await hook.result.current.queue.flush(); });
    hook.unmount();
    const reopened = mount(remote);
    expect(reopened.result.current.queue.latest()?.owner).toBe('Offline owner');
    reopened.unmount();
  });
  it('retains conflicting edits without rebasing them onto someone else’s version', async () => {
    const remote = base(); const mine = { ...remote, owner: 'Mine' }; const theirs = { ...remote, owner: 'Theirs' };
    createPfmeaDraftJournal(localStorage, 'alice', 'project', 'p', 'old').write(mine, remote);
    vi.mocked(savePfmeaToSupabase).mockRejectedValue(new Error('PFMEA conflict'));
    const hook = mount(theirs);
    await act(async () => { await hook.result.current.queue.flush(); });
    expect(savePfmeaToSupabase).toHaveBeenCalledWith('p', 'project', mine, remote);
    expect(hook.result.current.result?.state).toBe('error');
    expect(hook.result.current.queue.latest()?.owner).toBe('Mine');
    expect(localStorage.length).toBeGreaterThan(0);
    hook.unmount();
  });
  it('does not expose one account’s draft to another account', () => {
    const remote = base(); createPfmeaDraftJournal(localStorage, 'alice', 'project', 'p', 'old').write({ ...remote, owner: 'Private draft' }, remote);
    auth.user = 'bob'; const hook = mount(remote);
    expect(hook.result.current.queue.latest()).toBeUndefined();
    expect(savePfmeaToSupabase).not.toHaveBeenCalled(); hook.unmount();
  });
  it('reports storage failures while retaining normal remote saving', async () => {
    const remote = base(); const hook = mount(remote);
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota'); });
    act(() => hook.result.current.queue.schedule({ ...remote, owner: 'Save remotely' }, remote));
    expect(hook.result.current.localError).toContain('Device backup unavailable');
    await act(async () => { await hook.result.current.queue.flush(); });
    expect(savePfmeaToSupabase).toHaveBeenCalled(); write.mockRestore(); hook.unmount();
  });
});
