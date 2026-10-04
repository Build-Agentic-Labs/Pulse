// Minimal IndexedDB double for jsdom tests: open (with upgrade), transaction, objectStore put/get/delete,
// request and transaction callbacks fired asynchronously, close counting, and failure injection. It is
// not a general implementation — only what the mobile recovery-draft store exercises.
type Record_ = Record<string, unknown>;
type Store = Map<IDBValidKey, Record_>;
type Db = Map<string, { keyPath: string; rows: Store }>;

export type IndexedDbDoubleOptions = {
  openError?: Error;
  transactionError?: Error;
  requestError?: Error;
  transactionAbort?: boolean;
};

export type IndexedDbDouble = {
  databases: Map<string, Db>;
  opens: number;
  closes: number;
  upgrades: number;
  records(dbName: string, storeName: string): Record_[];
  uninstall(): void;
};

const later = (fn: () => void) => { setTimeout(fn, 0); };

export function installIndexedDbDouble(options: IndexedDbDoubleOptions = {}): IndexedDbDouble {
  const databases = new Map<string, Db>();
  const double: IndexedDbDouble = {
    databases, opens: 0, closes: 0, upgrades: 0,
    records: (dbName, storeName) => [...(databases.get(dbName)?.get(storeName)?.rows.values() ?? [])],
    uninstall: () => { delete (globalThis as { indexedDB?: unknown }).indexedDB; },
  };

  function makeDb(name: string) {
    const db = databases.get(name)!;
    return {
      objectStoreNames: { contains: (store: string) => db.has(store) },
      createObjectStore(store: string, params: { keyPath: string }) { db.set(store, { keyPath: params.keyPath, rows: new Map() }); },
      close() { double.closes += 1; },
      transaction(_storeName: string, _mode: string) {
        let pending = 0;
        let finished = false;
        const snapshots = new Map([...db].map(([name, store]) => [name, new Map(store.rows)]));
        const tx = {
          error: null as Error | null,
          oncomplete: null as null | (() => void), onerror: null as null | (() => void), onabort: null as null | (() => void),
          abort() {
            if (finished) return;
            finished = true;
            for (const [name, rows] of snapshots) db.get(name)!.rows = rows;
            later(() => tx.onabort?.());
          },
          objectStore(name: string) {
            const store = db.get(name);
            if (!store) throw new Error(`No store ${name}`);
            function request<T>(run: () => T) {
              pending += 1;
              const req = { result: undefined as T | undefined, error: null as Error | null, transaction: tx,
                onsuccess: null as null | (() => void), onerror: null as null | (() => void) };
              later(() => {
                if (finished) return;
                if (options.requestError) { req.error = options.requestError; req.onerror?.(); tx.error = req.error; tx.onerror?.(); tx.abort(); return; }
                req.result = run(); req.onsuccess?.();
                pending -= 1;
                if (pending === 0 && !finished) later(() => {
                  if (pending > 0 || finished) return;
                  if (options.transactionError) { tx.error = options.transactionError; tx.onerror?.(); tx.abort(); return; }
                  if (options.transactionAbort) { tx.abort(); return; }
                  finished = true; tx.oncomplete?.();
                });
              });
              return req;
            }
            return {
              put: (record: Record_) => request(() => { store.rows.set(record[store.keyPath] as IDBValidKey, structuredClone(record)); return record[store.keyPath]; }),
              get: (key: IDBValidKey) => request(() => { const value = store.rows.get(key); return value === undefined ? undefined : structuredClone(value); }),
              delete: (key: IDBValidKey) => request(() => { store.rows.delete(key); return undefined; }),
            };
          },
        };
        return tx;
      },
    };
  }

  (globalThis as { indexedDB?: unknown }).indexedDB = {
    open(name: string, _version: number) {
      double.opens += 1;
      const request: { result?: ReturnType<typeof makeDb>; error: Error | null; onupgradeneeded: null | (() => void); onsuccess: null | (() => void); onerror: null | (() => void) } =
        { error: null, onupgradeneeded: null, onsuccess: null, onerror: null };
      later(() => {
        if (options.openError) { request.error = options.openError; request.onerror?.(); return; }
        const fresh = !databases.has(name);
        if (fresh) databases.set(name, new Map());
        request.result = makeDb(name);
        if (fresh) { double.upgrades += 1; request.onupgradeneeded?.(); }
        request.onsuccess?.();
      });
      return request;
    },
  };
  return double;
}
