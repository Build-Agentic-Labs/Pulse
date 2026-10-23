import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { describe, expect, it, vi } from 'vitest';
import { savePfmeaToSupabase, saveShellProductPreservingPfmea } from './pfmea-store';
import { PRODUCT_PFMEA_DOCUMENT_FIELD as FIELD, createPfmeaDocumentFromProcedure, serializePfmeaDocument } from '@/domain/pfmea';
import { emptyPlannerState } from '@/domain/empty-planner-state';
const stamp = '2026-10-23T00:00:00.000Z';
const document = createPfmeaDocumentFromProcedure(emptyPlannerState.product, emptyPlannerState.scenario, [], []);
function fakeClient(responses: unknown[]) {
  const calls: [string, ...unknown[]][] = [];
  const query: Record<string, unknown> = {};
  for (const name of ['select', 'eq', 'update', 'insert']) query[name] = (...args: unknown[]) => { calls.push([name, ...args]); return query; };
  query.maybeSingle = async () => ({ data: responses.shift(), error: null });
  const client = { from: vi.fn((table: string) => { calls.push(['from', table]); return query; }) };
  return { client: client as unknown as Parameters<typeof savePfmeaToSupabase>[4], calls };
}
describe('granular PFMEA persistence', () => {
  it('keeps full-size document content out of the request URL', async () => {
    const fields = { keep: "unrelated".repeat(40000) }; const expected = serializePfmeaDocument(document);
    const requests: { url: string; method?: string }[] = [];
    const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(url), method: init?.method });
      return new Response(JSON.stringify(init?.method === 'PATCH' ? { updated_at: stamp, custom_fields: { ...fields, [FIELD]: expected } } : { updated_at: stamp, custom_fields: fields }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    const client = createClient<Database>('http://127.0.0.1:1', 'fixture-key', { global: { fetch }, auth: { persistSession: false, autoRefreshToken: false } });
    await savePfmeaToSupabase('fixture-product', 'fixture-project', document, undefined, client);
    const update = requests.find(request => request.method === 'PATCH')!;
    expect(new URL(update.url).searchParams.has('custom_fields')).toBe(false);
    expect(new URL(update.url).searchParams.get('updated_at')).toBe('eq.' + stamp);
    expect(update.url.length).toBeLessThan(1000);
    expect(requests).toHaveLength(2);
  });
  it('preserves fresh unrelated JSON and scopes the write to one product/project', async () => {
    const fields = { unrelated: { keep: true } }; const expected = serializePfmeaDocument(document);
    const { client, calls } = fakeClient([{ updated_at: stamp, custom_fields: fields }, { updated_at: stamp, custom_fields: { ...fields, [FIELD]: expected } }]);
    await savePfmeaToSupabase('product-test', 'project-test', document, undefined, client);
    expect(calls.filter(([name]) => name === 'from')).toEqual([['from', 'products'], ['from', 'products']]);
    expect(calls).toContainEqual(['update', { custom_fields: { ...fields, [FIELD]: expected } }]);
    expect(calls).toContainEqual(['eq', 'project_id', 'project-test']);
    expect(calls).toContainEqual(['eq', 'updated_at', stamp]);
  });
  it('rejects changed PFMEA content without writing', async () => {
    const { client, calls } = fakeClient([{ updated_at: stamp, custom_fields: { [FIELD]: { title: 'someone else' } } }]);
    await expect(savePfmeaToSupabase('p', 'project', document, undefined, client)).rejects.toThrow('conflict');
    expect(calls.some(([name]) => name === 'update')).toBe(false);
  });
  it('recognizes an already committed save despite JSON key order', async () => {
    const expected = serializePfmeaDocument(document);
    const { client, calls } = fakeClient([{ updated_at: stamp, custom_fields: { [FIELD]: Object.fromEntries(Object.entries(expected).reverse()) } }]);
    await savePfmeaToSupabase('p', 'project', document, undefined, client);
    expect(calls.some(([name]) => name === 'update')).toBe(false);
  });
  it('re-reads unrelated concurrent changes after a compare-and-swap miss', async () => {
    const expected = serializePfmeaDocument(document);
    const { client, calls } = fakeClient([{ updated_at: stamp, custom_fields: { other: 1 } }, null, { updated_at: stamp, custom_fields: { other: 2 } }, { updated_at: stamp, custom_fields: { other: 2, [FIELD]: expected } }]);
    await savePfmeaToSupabase('p', 'project', document, undefined, client);
    expect(calls.filter(([name]) => name === 'update').at(-1)).toEqual(['update', { custom_fields: { other: 2, [FIELD]: expected } }]);
  });
  it('prevents a shell save from restoring an older PFMEA', async () => {
    const latest = { version: 'new' }; const { client, calls } = fakeClient([{ updated_at: stamp, custom_fields: { [FIELD]: latest } }, { id: 'p' }]);
    await saveShellProductPreservingPfmea({ ...emptyPlannerState.product, id: 'p', customFields: { [FIELD]: { version: 'old' }, other: 1 } }, client);
    const payload = calls.find(([name]) => name === 'update')![1] as { custom_fields: unknown };
    expect(payload.custom_fields).toEqual({ [FIELD]: latest, other: 1 });
  });
});
