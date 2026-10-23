import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePfmeaSaveQueue } from './use-pfmea-save-queue';
import { WorkspaceWriteTracker } from '@/domain/workspace-save-status';
import { savePfmeaToSupabase } from '@/lib/planner/pfmea-store';
import type { PfmeaDocument } from '@/domain/pfmea';
vi.mock('@/lib/planner/pfmea-store', () => ({ savePfmeaToSupabase: vi.fn() }));
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
const documentFixture = { id: 'fixture-only' } as PfmeaDocument;
describe('PFMEA navigation saves', () => {
  for (const event of ['pagehide', 'beforeunload']) it(`flushes pending work on ${event}`, async () => {
    vi.useFakeTimers(); vi.mocked(savePfmeaToSupabase).mockResolvedValue(undefined);
    const tracker = new WorkspaceWriteTracker(); const saved = vi.fn();
    const { result } = renderHook(() => usePfmeaSaveQueue('p', 'project', tracker, saved));
    act(() => result.current.queue.schedule(documentFixture, undefined));
    expect(savePfmeaToSupabase).not.toHaveBeenCalled();
    await act(async () => { window.dispatchEvent(new Event(event)); });
    expect(savePfmeaToSupabase).toHaveBeenCalledExactlyOnceWith('p', 'project', documentFixture, undefined);
    expect(tracker.getSnapshot().pending).toBe(0);
  });
  it('starts saving on in-app links without waiting for the debounce', async () => {
    vi.useFakeTimers(); vi.mocked(savePfmeaToSupabase).mockResolvedValue(undefined);
    const tracker = new WorkspaceWriteTracker(); const { result } = renderHook(() => usePfmeaSaveQueue('p', 'project', tracker, vi.fn()));
    const anchor = document.createElement('a'); anchor.href = '#test'; document.body.append(anchor);
    act(() => result.current.queue.schedule(documentFixture, undefined));
    await act(async () => { anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); });
    anchor.remove(); expect(savePfmeaToSupabase).toHaveBeenCalledTimes(1);
  });
  it('flushes on unmount and does not report an old product save as a new product save', async () => {
    vi.useFakeTimers(); vi.mocked(savePfmeaToSupabase).mockResolvedValue(undefined);
    const tracker = new WorkspaceWriteTracker();
    const { result, rerender, unmount } = renderHook(({ product }) => usePfmeaSaveQueue(product, 'project', tracker, vi.fn()), { initialProps: { product: 'old' } });
    act(() => result.current.queue.schedule(documentFixture, undefined));
    await act(async () => { rerender({ product: 'new' }); });
    expect(savePfmeaToSupabase).toHaveBeenCalledWith('old', 'project', documentFixture, undefined);
    expect(result.current.result).toBeUndefined();
    act(() => result.current.queue.schedule(documentFixture, undefined));
    await act(async () => { unmount(); });
    expect(savePfmeaToSupabase).toHaveBeenLastCalledWith('new', 'project', documentFixture, undefined);
  });
});
