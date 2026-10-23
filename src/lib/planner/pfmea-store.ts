import { plannerClient } from './client';
import { throwIfError } from './query-helpers';
import { PRODUCT_PFMEA_DOCUMENT_FIELD, serializePfmeaDocument, type PfmeaDocument } from '@/domain/pfmea';
import { samePfmeaValue } from '@/domain/pfmea-save-queue';
import type { Json } from '@/lib/database.types';

/** Compare-and-swap the product JSON after a fresh read. Never writes planner/SOP tables. */
export async function savePfmeaToSupabase(productId: string, projectId: string, document: PfmeaDocument, base: unknown, client = plannerClient()) {
  const expected = serializePfmeaDocument(document);
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await throwIfError(client.from('products').select('custom_fields').eq('id', productId).eq('project_id', projectId).maybeSingle());
    if (!current) throw new Error('PFMEA product unavailable. Check project access before retrying.');
    const fields = current.custom_fields && typeof current.custom_fields === 'object' && !Array.isArray(current.custom_fields) ? current.custom_fields : {};
    const existing = fields[PRODUCT_PFMEA_DOCUMENT_FIELD];
    if (samePfmeaValue(existing, expected)) return; // A lost response may have committed successfully.
    if (!samePfmeaValue(existing, base)) throw new Error('PFMEA conflict: another edit was saved. Your changes remain pending; reload only after resolving the conflict.');
    const saved = await throwIfError(client.from('products').update({ custom_fields: { ...fields, [PRODUCT_PFMEA_DOCUMENT_FIELD]: expected } as unknown as Json })
      .eq('id', productId).eq('project_id', projectId).eq('custom_fields', JSON.stringify(current.custom_fields)).select('custom_fields').maybeSingle());
    if (saved) {
      const actual = saved.custom_fields as Record<string, unknown>;
      if (!samePfmeaValue(actual[PRODUCT_PFMEA_DOCUMENT_FIELD], expected)) throw new Error('PFMEA save could not be verified. Retry before leaving.');
      return;
    }
  }
  throw new Error('The product changed during the PFMEA save. Please retry.');
}

/** Shell saves must not put an older PFMEA snapshot back after its dedicated save. */
export async function saveShellProductPreservingPfmea(product: import('@/domain/types').Product, client = plannerClient()) {
  const { productRow } = await import('./row-mappers');
  const payload = productRow(product);
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await throwIfError(client.from('products').select('custom_fields').eq('id', product.id).maybeSingle());
    if (!current) {
      await throwIfError(client.from('products').insert(payload));
      return;
    }
    const existing = current.custom_fields as Record<string, Json>;
    const fields = { ...(payload.custom_fields as Record<string, Json>) };
    delete fields[PRODUCT_PFMEA_DOCUMENT_FIELD];
    if (existing?.[PRODUCT_PFMEA_DOCUMENT_FIELD] !== undefined) fields[PRODUCT_PFMEA_DOCUMENT_FIELD] = existing[PRODUCT_PFMEA_DOCUMENT_FIELD];
    const saved = await throwIfError(client.from('products').update({ ...payload, custom_fields: fields })
      .eq('id', product.id).eq('custom_fields', JSON.stringify(current.custom_fields)).select('id').maybeSingle());
    if (saved) return;
  }
  throw new Error('Product changed while saving. Retry to preserve the latest PFMEA.');
}
