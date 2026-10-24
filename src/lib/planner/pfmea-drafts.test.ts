import { beforeEach, describe, expect, it } from 'vitest';
import { createPfmeaDraftJournal } from './pfmea-drafts';
import { createPfmeaDocumentFromProcedure } from '@/domain/pfmea';
import type { Product, Scenario } from '@/domain/types';
const values = new Map<string, string>();
const localStorage: Storage = {
  get length() { return values.size; },
  clear: () => values.clear(), key: i => [...values.keys()][i] ?? null,
  getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); },
  removeItem: key => { values.delete(key); },
};
const fixture = () => createPfmeaDocumentFromProcedure({ id: 'p', name: 'Fixture' } as Product, { id: 's', name: 'Fixture scenario' } as Scenario, [], []);
const journal = (writer = 'one', account = 'alice', product = 'p') => createPfmeaDraftJournal(localStorage, account, 'project', product, writer);
beforeEach(() => localStorage.clear());
describe('PFMEA device journals', () => {
  it('recovers a full document automatically with its original server base', () => {
    const base = fixture(); const edited = { ...base, owner: 'Unsaved owner' };
    journal().write(edited, base);
    expect(journal('reload').recover(base)).toMatchObject({ base, document: edited });
  });
  it('isolates accounts, products and independent tabs', () => {
    const base = fixture(); journal().write(base, undefined);
    expect(journal('two', 'bob').recover(undefined)).toBeUndefined();
    expect(journal('two', 'alice', 'other').recover(undefined)).toBeUndefined();
    journal('two').write({ ...base, owner: 'Other tab' }, undefined);
    expect(localStorage.length).toBe(2);
  });
  it('does not clear newer edits when an older server response arrives', () => {
    const base = fixture(); const first = { ...base, owner: 'First' }; const second = { ...base, owner: 'Second' };
    const store = journal(); store.write(first, base); store.write(second, base); store.acknowledge(first);
    expect(journal('reload').recover(first)).toMatchObject({ document: second, base: first });
    store.acknowledge(second); expect(localStorage.length).toBe(0);
  });
  it('keeps the original base when the server changed, so CAS blocks overwrites', () => {
    const base = fixture(); const edited = { ...base, owner: 'Mine' }; const remote = { ...base, owner: 'Theirs' };
    journal().write(edited, base);
    expect(journal('reload').recover(remote)).toMatchObject({ base, document: edited });
  });
  it('cleans a lost-response draft already saved on the server', () => {
    const saved = fixture(); journal().write(saved, undefined);
    expect(journal('reload').recover(saved)).toBeUndefined(); expect(localStorage.length).toBe(0);
  });
  it('removes inherited recovery only after acknowledgment, preserving another tab', () => {
    const base = fixture(); journal().write({ ...base, owner: 'Recovered' }, base);
    const next = journal('reload'); const recovered = next.recover(base)!;
    next.write(recovered.document, recovered.base);
    journal('unrelated').write({ ...base, owner: 'Other' }, base);
    next.acknowledge(recovered.document);
    expect(localStorage.length).toBe(1);
  });
  it('does not resurrect an older recovered draft after a lost response for its successor', () => {
    const base = fixture(); const first = { ...base, owner: 'First' }; const second = { ...base, owner: 'Second' };
    journal().write(first, base);
    const recovered = journal('reload'); recovered.recover(base); recovered.write(second, base);
    expect(journal('after-crash').recover(second)).toBeUndefined();
    expect(localStorage.length).toBe(0);
  });
  it('preserves malformed records and ignores them', () => {
    localStorage.setItem('pulse:pfmea-draft:v1:alice:project:p:broken', '{');
    expect(journal().recover(undefined)).toBeUndefined(); expect(localStorage.length).toBe(1);
  });
});
