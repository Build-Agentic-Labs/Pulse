import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPfmeaSaveQueue } from './pfmea-save-queue';
import { WorkspaceWriteTracker } from './workspace-save-status';
import type { PfmeaDocument } from './pfmea';
const doc = (id: string) => ({ id } as PfmeaDocument);
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
afterEach(() => vi.useRealTimers());
describe('PFMEA dedicated queue', () => {
  it('coalesces typing and tracks unsaved work before the debounce expires', async () => {
    vi.useFakeTimers(); const save = vi.fn().mockResolvedValue(undefined); const tracker = new WorkspaceWriteTracker(); const report = vi.fn();
    const queue = createPfmeaSaveQueue({ key: 'a', tracker, save, report });
    queue.schedule(doc('one'), undefined); queue.schedule(doc('two'), undefined);
    expect(tracker.getSnapshot().pending).toBe(1); expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(750);
    expect(save).toHaveBeenCalledExactlyOnceWith(doc('two'), undefined);
    expect(tracker.getSnapshot().pending).toBe(0);
    expect(report).toHaveBeenLastCalledWith({ document: doc('two'), state: 'saved' });
  });
  it('flushes immediately on exit and drains edits queued during an in-flight save', async () => {
    vi.useFakeTimers(); const first = deferred(); const save = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined); const tracker = new WorkspaceWriteTracker();
    const queue = createPfmeaSaveQueue({ key: 'a', tracker, save, report: vi.fn() });
    queue.schedule(doc('one'), doc('base')); const flushing = queue.flush();
    queue.schedule(doc('two'), doc('stale-parent'));
    expect(save).toHaveBeenCalledTimes(1); first.resolve(); await flushing;
    expect(save.mock.calls).toEqual([[doc('one'), doc('base')], [doc('two'), doc('one')]]);
    expect(queue.hasWork()).toBe(false); expect(tracker.getSnapshot().pending).toBe(0);
  });
  it('retains failures, retries transient errors, and never labels failures saved', async () => {
    vi.useFakeTimers(); const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined); const tracker = new WorkspaceWriteTracker(); const report = vi.fn();
    const queue = createPfmeaSaveQueue({ key: 'a', tracker, save, report });
    queue.schedule(doc('one'), undefined); await queue.flush();
    expect(report).toHaveBeenLastCalledWith({ document: doc('one'), state: 'error', error: 'offline' });
    expect(tracker.getSnapshot().failures).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1500);
    expect(tracker.getSnapshot().failures).toHaveLength(0); expect(queue.hasWork()).toBe(false);
  });
  it('retries the uncertain snapshot before saving newer typing after a lost response', async () => {
    vi.useFakeTimers(); let reject!: (error: Error) => void;
    const first = new Promise<void>((_, fail) => { reject = fail; });
    const save = vi.fn().mockReturnValueOnce(first).mockResolvedValue(undefined);
    const queue = createPfmeaSaveQueue({ key: 'a', tracker: new WorkspaceWriteTracker(), save, report: vi.fn() });
    queue.schedule(doc('one'), doc('base')); const flushing = queue.flush();
    queue.schedule(doc('two'), doc('base')); reject(new Error('Response lost')); await flushing;
    await queue.flush();
    expect(save.mock.calls).toEqual([[doc('one'), doc('base')], [doc('one'), doc('base')], [doc('two'), doc('one')]]);
    expect(queue.hasWork()).toBe(false);
  });
  it('keeps conflicts blocked until explicitly retried', async () => {
    vi.useFakeTimers(); const save = vi.fn().mockRejectedValue(new Error('PFMEA conflict')); const tracker = new WorkspaceWriteTracker();
    const queue = createPfmeaSaveQueue({ key: 'a', tracker, save, report: vi.fn() });
    queue.schedule(doc('one'), undefined); await queue.flush(); await vi.advanceTimersByTimeAsync(20000);
    expect(save).toHaveBeenCalledTimes(1); expect(queue.hasWork()).toBe(true);
    save.mockResolvedValue(undefined); await queue.flush(); expect(queue.hasWork()).toBe(false);
  });
});
