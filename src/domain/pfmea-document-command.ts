import type { PfmeaDocument, PfmeaRow } from './pfmea';
import { samePfmeaValue } from './pfmea-save-queue';

/** Apply only this editor's document/structural changes to the last acknowledged server state. */
export function buildPfmeaDocumentCommand(base: PfmeaDocument, edited: PfmeaDocument, remote: PfmeaDocument): PfmeaDocument {
  if (base.id !== edited.id || remote.id !== base.id || base.productId !== edited.productId || remote.productId !== base.productId) throw new Error('PFMEA command scope changed.');
  const next = structuredClone(remote);
  for (const key of Object.keys(edited) as (keyof PfmeaDocument)[]) {
    if (['rows','cellVersions','commandReceipts','updatedAt','id','productId','createdAt','version'].includes(key)) continue;
    if (!samePfmeaValue(base[key], edited[key])) Object.assign(next, { [key]: structuredClone(edited[key]) });
  }
  const before = new Map(base.rows.map(row => [row.id,row]));
  const latest = new Map(remote.rows.map(row => [row.id,row]));
  const editedIds = new Set(edited.rows.map(row => row.id));
  if (editedIds.size !== edited.rows.length) throw new Error('Duplicate PFMEA row ID.');
  next.rows = edited.rows.map(row => {
    const prior = before.get(row.id); const server = latest.get(row.id);
    if (!prior) {
      if (server && !samePfmeaValue(server,row)) throw new Error('PFMEA row ID conflict.');
      return structuredClone(server ?? row);
    }
    if (!server) throw new Error('PFMEA row was removed by another editor.');
    const merged = structuredClone(server);
    for (const key of new Set([...Object.keys(prior),...Object.keys(row)]) as Set<keyof PfmeaRow>) {
      if (['id','updatedAt','createdAt'].includes(key) || samePfmeaValue(prior[key],row[key])) continue;
      if (!samePfmeaValue(server[key],prior[key]) && !samePfmeaValue(server[key],row[key])) throw new Error('PFMEA cell conflict while preparing document command.');
      if (row[key] === undefined) delete merged[key]; else Object.assign(merged,{[key]:structuredClone(row[key])});
    }
    return merged;
  });
  for (const row of remote.rows) {
    if (!before.has(row.id) && !editedIds.has(row.id)) next.rows.push(structuredClone(row));
    if (before.has(row.id) && !editedIds.has(row.id)) {
      const { updatedAt: _before, ...prior } = before.get(row.id)!;
      const { updatedAt: _server, ...server } = row;
      if (!samePfmeaValue(prior,server)) throw new Error('PFMEA row changed before removal.');
    }
  }
  return next;
}
