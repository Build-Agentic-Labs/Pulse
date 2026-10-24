import type { PfmeaDocument } from './pfmea';
import type { WorkspaceWriteTracker } from './workspace-save-status';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
export function samePfmeaValue(a: unknown, b: unknown) { return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b)); }
export type PfmeaSaveResult = { document: PfmeaDocument; state: 'saving' | 'saved' | 'error'; error?: string };

/** One queue owns its original product scope throughout navigation and retries. */
export function createPfmeaSaveQueue(options: {
  key: string; tracker: WorkspaceWriteTracker;
  save: (document: PfmeaDocument, base: unknown) => Promise<void>;
  report: (result: PfmeaSaveResult) => void;
  delay?: number;
  retain?: (document: PfmeaDocument, base: unknown) => void;
  acknowledge?: (document: PfmeaDocument) => void;
}) {
  let pending: PfmeaDocument | undefined;
  let latest: PfmeaDocument | undefined;
  let retrySnapshot: PfmeaDocument | undefined;
  let base: unknown;
  let initialized = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> | undefined;
  let finish: ((error?: unknown) => void) | undefined;
  let retries = 0;
  let failed = false;
  function cancelTimer() { if (timer) clearTimeout(timer); timer = undefined; }
  async function drain() {
    while (retrySnapshot || pending) {
      const snapshot = (retrySnapshot ?? pending)!;
      retrySnapshot = undefined;
      if (snapshot === pending) pending = undefined;
      options.report({ document: snapshot, state: 'saving' });
      try {
        await options.save(snapshot, base);
        base = snapshot;
        options.acknowledge?.(snapshot);
        retries = 0;
        options.report({ document: snapshot, state: 'saved' });
      } catch (cause) {
        retrySnapshot = snapshot;
        failed = true;
        const error = cause instanceof Error ? cause.message : 'Unable to save PFMEA.';
        options.report({ document: pending ?? snapshot, state: 'error', error });
        finish?.(cause); finish = undefined;
        if (!error.toLowerCase().includes('conflict') && retries++ < 2) timer = setTimeout(() => { void flush(); }, 1500 * retries);
        return;
      }
    }
    finish?.(); finish = undefined;
    initialized = false;
  }
  function flush(): Promise<void> {
    cancelTimer();
    if (running) return running;
    if (!pending && !retrySnapshot) return Promise.resolve();
    failed = false;
    finish ??= options.tracker.begin(options.key);
    running = drain().finally(() => { running = undefined; });
    return running;
  }
  function schedule(document: PfmeaDocument, initialBase: unknown) {
    if (!initialized) { base = initialBase; initialized = true; }
    pending = document;
    latest = document;
    options.retain?.(document, base);
    failed = false;
    retries = 0;
    finish ??= options.tracker.begin(options.key); // Debounced work also blocks navigation.
    cancelTimer();
    timer = setTimeout(() => { void flush(); }, options.delay ?? 750);
  }
  return { schedule, flush, latest: () => (pending || retrySnapshot || running || failed) ? latest : undefined, hasWork: () => Boolean(pending || retrySnapshot || running || failed) };
}
