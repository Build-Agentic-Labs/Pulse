import { normalizePhotoAnnotationDocument, type PhotoAnnotationDocument } from "@/domain/photo-annotations";

const prefix = "pulse:photo-annotation-draft:";
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Keep local edits by annotation ID; accept remote changes to untouched marks. */
export function mergeAnnotationDocuments(base: PhotoAnnotationDocument, local: PhotoAnnotationDocument, remote: PhotoAnnotationDocument): PhotoAnnotationDocument {
  const before = new Map(base.items.map(item => [item.id, item]));
  const edited = new Map(local.items.map(item => [item.id, item]));
  const result = new Map(remote.items.map(item => [item.id, item]));
  for (const [id, item] of before) {
    if (!edited.has(id)) result.delete(id);
    else if (!equal(item, edited.get(id))) result.set(id, edited.get(id)!);
  }
  for (const [id, item] of edited) if (!before.has(id)) result.set(id, item);
  return { version: 2, items: [...result.values()] };
}

function key(taskId: string, photoId: string) { return `${prefix}${encodeURIComponent(taskId)}:${encodeURIComponent(photoId)}`; }
export function readAnnotationDraft(taskId: string, photoId: string): { base: PhotoAnnotationDocument; local: PhotoAnnotationDocument } | undefined {
  if (!taskId) return;
  try {
    const raw = localStorage.getItem(key(taskId, photoId));
    if (!raw) return;
    const value = JSON.parse(raw);
    return {base: normalizePhotoAnnotationDocument(value.base), local: normalizePhotoAnnotationDocument(value.local)};
  } catch { return; }
}
export function writeAnnotationDraft(taskId: string, photoId: string, base: PhotoAnnotationDocument, local: PhotoAnnotationDocument) {
  if (!taskId) return;
  try { localStorage.setItem(key(taskId, photoId), JSON.stringify({base: readAnnotationDraft(taskId, photoId)?.base ?? base, local})); } catch { /* In-memory edits still save normally. */ }
}
/** Only a confirmed database response may clear a draft, never a local prop echo. */
export function acknowledgeAnnotationDrafts(taskId: string, saved: Record<string, PhotoAnnotationDocument>) {
  try {
    const taskPrefix = `${prefix}${encodeURIComponent(taskId)}:`;
    for (const entry of Object.keys(localStorage).filter(entry => entry.startsWith(taskPrefix))) {
      const photoId = decodeURIComponent(entry.slice(taskPrefix.length));
      const draft = readAnnotationDraft(taskId, photoId);
      if (!draft) continue;
      const base = new Map(draft.base.items.map(item => [item.id, item]));
      const local = new Map(draft.local.items.map(item => [item.id, item]));
      const remote = new Map((saved[photoId]?.items ?? []).map(item => [item.id, item]));
      const changed = [...new Set([...base.keys(), ...local.keys()])].filter(id => !equal(base.get(id), local.get(id)));
      if (changed.every(id => equal(local.get(id), remote.get(id)))) localStorage.removeItem(entry);
    }
  } catch { /* A retained draft can be safely rebased on the next visit. */ }
}
