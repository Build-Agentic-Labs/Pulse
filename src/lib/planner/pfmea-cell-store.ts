import type { PfmeaCellChange, PfmeaCellVersions } from '@/domain/pfmea-cell-changes';
import { getProductPfmeaDocument, PRODUCT_PFMEA_DOCUMENT_FIELD, serializePfmeaDocument, type PfmeaDocument } from '@/domain/pfmea';
import type { Json } from '@/lib/database.types';
import { plannerClient } from './client';
import { createPfmeaCellSession } from '@/domain/pfmea-cell-session';

/** Cell RPC adapter; product/project scope and field versions are enforced in Postgres. */
export async function savePfmeaCells(productId: string, projectId: string, documentId: string, mutationId: string, changes: PfmeaCellChange[], client = plannerClient()) {
  const { data, error } = await client.rpc('patch_pfmea_cells', {
    p_product_id: productId, p_project_id: projectId, p_document_id: documentId,
    p_mutation_id: mutationId, p_changes: changes.map(change => ({ ...change })),
  });
  if (error) throw Object.assign(new Error(error.message), { code: error.code, details: error.details });
  return parseAcknowledgement(data, documentId, productId);
}

function parseAcknowledgement(data: Json, documentId: string, productId: string) {
  const document = getProductPfmeaDocument({ [PRODUCT_PFMEA_DOCUMENT_FIELD]: data });
  if (!document || document.id !== documentId || document.productId !== productId) throw new Error('PFMEA cell save response did not match the current document.');
  const versions: PfmeaCellVersions = {};
  const raw = data && typeof data === 'object' && !Array.isArray(data) ? data.cellVersions : undefined;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [row, cells] of Object.entries(raw)) {
      if (!cells || typeof cells !== 'object' || Array.isArray(cells)) continue;
      versions[row] = {};
      for (const [field, stamp] of Object.entries(cells)) {
        if (stamp && typeof stamp === 'object' && !Array.isArray(stamp) && typeof stamp.version === 'number' && Number.isSafeInteger(stamp.version) && stamp.version >= 0 && typeof stamp.mutationId === 'string') {
          Object.assign(versions[row], { [field]: { version: stamp.version, mutationId: stamp.mutationId } });
        }
      }
    }
  }
  return { document, versions };
}

/** One scoped writer per save queue. Never silently falls back to snapshot writes. */
export function createPfmeaCellWriter(productId: string, projectId: string, base: unknown, client = plannerClient(), recovery?: Pick<Parameters<typeof createPfmeaCellSession>[0], 'pending' | 'retain' | 'acknowledge'>, initial?: PfmeaDocument) {
  const existing = getProductPfmeaDocument({ [PRODUCT_PFMEA_DOCUMENT_FIELD]: base });
  const document = existing ?? (initial ? { ...structuredClone(initial), rows: [] } : undefined);
  let creating = !existing;
  if (!document || document.productId !== productId) throw new Error('Load a saved PFMEA before enabling cell saves.');
  return createPfmeaCellSession({
    ...recovery,
    document, versions: document.cellVersions ?? {}, mutationId: () => crypto.randomUUID(),
    send: (mutationId, changes) => savePfmeaCells(productId, projectId, document.id, mutationId, changes, client),
    sendCommand: async (mutationId, base, edited) => {
      const { data, error } = await client.rpc('commit_pfmea_document_command', {
        p_product_id: productId, p_project_id: projectId, p_document_id: document.id, p_mutation_id: mutationId,
        p_base: creating ? null : serializePfmeaDocument(base) as unknown as Json, p_document: serializePfmeaDocument(edited) as unknown as Json,
      });
      if (error) throw Object.assign(new Error(error.message), { code: error.code, details: error.details });
      creating = false;
      return parseAcknowledgement(data, document.id, productId);
    },
  });
}
