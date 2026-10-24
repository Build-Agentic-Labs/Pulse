import { createClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '@/lib/database.types';
import { createPfmeaDocumentFromProcedure, createPfmeaRowForProcedureLink, serializePfmeaDocument } from '@/domain/pfmea';
import { emptyPlannerState } from '@/domain/empty-planner-state';
import type { Task } from '@/domain/types';
import { createPfmeaCellWriter, savePfmeaCells } from './pfmea-cell-store';

function fixture() {
  const document = createPfmeaDocumentFromProcedure(emptyPlannerState.product, emptyPlannerState.scenario, [], []);
  document.rows = [createPfmeaRowForProcedureLink({ id: 'task', name: 'Fixture', wbs: '1', customFields: {} } as Task, undefined, undefined)];
  return document;
}

describe('PFMEA cell RPC adapter', () => {
  it('sends changed cells rather than a full document and preserves returned cell versions', async () => {
    const base = fixture(); const edited = structuredClone(base); edited.rows[0].severity = 8;
    const remote = structuredClone(edited); remote.rows[0].effect = 'Another editor’s effect';
    remote.cellVersions = { [base.rows[0].id]: { severity: { version: 1, mutationId: 'receipt' } } };
    const requests: { url: string; body: Record<string, unknown> }[] = [];
    const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify(remote), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    const client = createClient<Database>('http://127.0.0.1:1', 'fixture-key', { global: { fetch }, auth: { persistSession: false, autoRefreshToken: false } });
    const writer = createPfmeaCellWriter(base.productId, 'fixture-project', serializePfmeaDocument(base), client);
    const ack = await writer.save(edited);
    expect(requests).toHaveLength(1);
    expect(new URL(requests[0].url).pathname).toBe('/rest/v1/rpc/patch_pfmea_cells');
    expect(requests[0].body.p_changes).toEqual([{ rowId: base.rows[0].id, field: 'severity', expectedVersion: 0, previous: null, value: 8 }]);
    expect(requests[0].body).not.toHaveProperty('rows');
    expect(ack.document.rows[0].effect).toBe('Another editor’s effect');
    expect(serializePfmeaDocument(ack.document).cellVersions).toEqual(remote.cellVersions);
  });

  it('preserves structured conflict information without falling back to snapshot saving', async () => {
    const base = fixture();
    const client = { rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'PFMEA cell conflict', code: 'P0001', details: 'cell conflict detail' } }) } as unknown as Parameters<typeof savePfmeaCells>[5];
    await expect(savePfmeaCells(base.productId, 'project', base.id, crypto.randomUUID(), [], client)).rejects.toMatchObject({ code: 'P0001', details: 'cell conflict detail' });
    expect(client!.rpc).toHaveBeenCalledTimes(1);
  });

  it('rejects acknowledgements for another document', async () => {
    const base = fixture();
    const client = { rpc: vi.fn().mockResolvedValue({ data: { ...serializePfmeaDocument(base), id: 'wrong-document' }, error: null }) } as unknown as Parameters<typeof savePfmeaCells>[5];
    await expect(savePfmeaCells(base.productId, 'project', base.id, crypto.randomUUID(), [], client)).rejects.toThrow('did not match');
  });
});
