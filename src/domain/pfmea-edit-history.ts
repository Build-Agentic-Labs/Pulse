import type { PfmeaDocument } from './pfmea';

/** Bounded local history. Snapshots share unchanged rows; typing in one cell coalesces. */
export function createPfmeaEditHistory(limit = 100) {
  type Entry = { before: PfmeaDocument; after: PfmeaDocument; group?: string };
  const past: Entry[] = [];
  const future: Entry[] = [];
  let activeGroup: string | undefined;
  return {
    record(before: PfmeaDocument, after: PfmeaDocument, group?: string) {
      if (before === after) return;
      if (group && activeGroup === group && past.at(-1)?.group === group && !future.length) past[past.length - 1].after = after;
      else { past.push({before,after,group}); if (past.length > limit) past.shift(); }
      future.length = 0;
      activeGroup = group;
    },
    seal() { activeGroup = undefined; },
    cancel(group?: string) {
      activeGroup = undefined;
      if (!group || past.at(-1)?.group !== group) return undefined;
      return past.pop()!.before;
    },
    undo() { activeGroup = undefined; const entry = past.pop(); if (!entry) return undefined; future.push(entry); return entry.before; },
    redo() { activeGroup = undefined; const entry = future.pop(); if (!entry) return undefined; past.push(entry); return entry.after; },
    clear() { past.length = 0; future.length = 0; activeGroup = undefined; },
    status: () => ({undo: past.length > 0, redo: future.length > 0}),
  };
}
