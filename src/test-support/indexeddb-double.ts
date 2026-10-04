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

  function makeRequest<T>(run: () => T) {
    const request: { result?: T; error: Error | null; onsuccess: null | (() => void); onerror: null | (() => void) } =
      { error: null, onsuccess: null, onerror: null };
    later(() => {
      if (options.requestError) { request.error = options.requestError; request.onerror?.(); return; }
      request.result = run();
      request.onsuccess?.();
    });
    return request;
  }

  function makeDb(name: string) {
    const db = databases.get(name)!;
    return {
      objectStoreNames: { contains: (store: string) => db.has(store) },
      createObjectStore(store: string, params: { keyPath: string }) { db.set(store, { keyPath: params.keyPath, rows: new Map() }); },
      close() { double.closes += 1; },
      transaction(_storeName: string, _mode: string) {
        const tx: { error: Error | null; oncomplete: null | (() => void); onerror: null | (() => void); objectStore(name: string): unknown } = {
          error: null, oncomplete: null, onerror: null,
          objectStore(name: string) {
            const store = db.get(name);
            if (!store) throw new Error(`No store ${name}`);
            return {
              put: (record: Record_) => makeRequest(() => { store.rows.set(record[store.keyPath] as IDBValidKey, record); return record[store.keyPath]; }),
              get: (key: IDBValidKey) => makeRequest(() => store.rows.get(key)),
              delete: (key: IDBValidKey) => makeRequest(() => { store.rows.delete(key); return undefined; }),
            };
          },
        };
        later(() => later(() => {
          if (options.transactionError) { tx.error = options.transactionError; tx.onerror?.(); return; }
          if (!options.requestError) tx.oncomplete?.();
        }));
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
