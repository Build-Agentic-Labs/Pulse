import { getProductPfmeaDocument, PRODUCT_PFMEA_DOCUMENT_FIELD, type PfmeaDocument } from '@/domain/pfmea';
import { samePfmeaValue } from '@/domain/pfmea-save-queue';

type Draft = { version: 1; revision: string; base: unknown; document: PfmeaDocument; updatedAt: number; ancestors?: { key: string; revision: string }[] };
type Entry = { key: string; raw: string; draft: Draft };
/** Independent journals prevent a second tab from replacing another tab's unsaved work. */
export function createPfmeaDraftJournal(storage: Storage, account: string, project: string, product: string, writer: string) {
  const prefix = `pulse:pfmea-draft:v1:${[account, project, product].map(encodeURIComponent).join(':')}:`;
  const key = prefix + writer;
  let inherited: Entry[] = [];
  function entries(): Entry[] {
    return Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter((key): key is string => Boolean(key?.startsWith(prefix))).flatMap(key => {
      const raw = storage.getItem(key);
      if (!raw) return [];
      try {
        const draft = JSON.parse(raw) as Draft;
        if (draft.version !== 1 || typeof draft.revision !== 'string' || !Number.isFinite(draft.updatedAt) || draft.document?.productId !== product || !getProductPfmeaDocument({ [PRODUCT_PFMEA_DOCUMENT_FIELD]: draft.document })) return [];
        return [{ key, raw, draft }];
      } catch { return []; } // Preserve unknown/corrupt records; never overwrite them.
    }).sort((a, b) => b.draft.updatedAt - a.draft.updatedAt);
  }
  function removeExact(entry: Entry) { if (storage.getItem(entry.key) === entry.raw) storage.removeItem(entry.key); }
  return {
    recover(remote: unknown) {
      const found = entries();
      for (const entry of found) if (samePfmeaValue(entry.draft.document, remote)) {
        removeExact(entry);
        for (const ancestor of entry.draft.ancestors ?? []) {
          if (!ancestor.key.startsWith(prefix)) continue;
          const raw = storage.getItem(ancestor.key);
          try { if (raw && JSON.parse(raw).revision === ancestor.revision) storage.removeItem(ancestor.key); } catch { /* Preserve malformed ancestors. */ }
        }
      }
      const pending = found.filter(entry => storage.getItem(entry.key) === entry.raw && !samePfmeaValue(entry.draft.document, remote));
      const selected = pending[0];
      inherited = selected ? [selected] : [];
      return selected?.draft;
    },
    write(document: PfmeaDocument, base: unknown) {
      storage.setItem(key, JSON.stringify({ version: 1, revision: crypto.randomUUID(), base, document, updatedAt: Date.now(), ancestors: inherited.flatMap(entry => [{ key: entry.key, revision: entry.draft.revision }, ...(entry.draft.ancestors ?? [])]) } satisfies Draft));
    },
    acknowledge(saved: PfmeaDocument) {
      const raw = storage.getItem(key);
      if (raw) {
        const current = JSON.parse(raw) as Draft;
        if (samePfmeaValue(current.document, saved)) storage.removeItem(key);
        else storage.setItem(key, JSON.stringify({ ...current, base: saved }));
      }
      for (const entry of inherited) removeExact(entry);
      inherited = [];
    },
  };
}
