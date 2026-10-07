import { isWiEdit, type PendingWiEdit } from "@/domain/quality-wi/schema";
export type WiDraftScope = {
  userId: string;
  workspaceId: string;
  wiId: string;
};
type RecordValue = WiDraftScope & {
  key: string;
  schemaVersion: 1;
  updatedAt: string;
  pending: PendingWiEdit[];
};
const DATABASE = "pulse-quality-wi-recovery",
  STORE = "drafts";
const scopeKey = (scope: WiDraftScope) =>
  [scope.userId, scope.workspaceId, scope.wiId]
    .map(encodeURIComponent)
    .join(":");
function valid(value: unknown, scope: WiDraftScope): value is RecordValue {
  if (!value || typeof value !== "object") return false;
  const r = value as RecordValue;
  return (
    r.schemaVersion === 1 &&
    r.userId === scope.userId &&
    r.workspaceId === scope.workspaceId &&
    r.wiId === scope.wiId &&
    typeof r.key === "string" &&
    r.key.startsWith(scopeKey(scope) + ":") &&
    Array.isArray(r.pending) &&
    (r.pending.length === 0 ||
      Number.isInteger(
        r.pending[0].expectedVersion ?? r.pending[0].baseVersion,
      )) &&
    r.pending.every(
      (e) =>
        typeof e?.operation === "string" &&
        (e.expectedVersion === undefined ||
          (Number.isInteger(e.expectedVersion) && e.expectedVersion > 0)) &&
        isWiEdit(e.edit),
    )
  );
}
async function transaction<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore, set: (value: T) => void) => void,
): Promise<T> {
  if (typeof indexedDB === "undefined")
    throw new Error("Browser recovery is unavailable.");
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE))
        request.result.createObjectStore(STORE, { keyPath: "key" });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      let value: T;
      tx.oncomplete = () => resolve(value);
      tx.onerror = () =>
        reject(tx.error ?? new Error("Unable to store this draft."));
      tx.onabort = () =>
        reject(tx.error ?? new Error("Draft storage aborted."));
      try {
        run(tx.objectStore(STORE), (next) => {
          value = next;
        });
      } catch (error) {
        tx.abort();
        reject(error);
      }
    });
  } finally {
    db.close();
  }
}
/** Every mounted editor owns a fork; reload can recover a previous fork without replacing it. */
export function createWiRecoveryStore(scope: WiDraftScope) {
  const prefix = scopeKey(scope),
    key = `${prefix}:${crypto.randomUUID()}`,
    affinity = `pulse:wi-recovery:${prefix}`;
  let queue: Promise<unknown> = Promise.resolve();
  function ordered<T>(operation: () => Promise<T>) {
    const next = queue.catch(() => undefined).then(operation);
    queue = next;
    return next;
  }
  return {
    load() {
      return ordered(() =>
        transaction<PendingWiEdit[]>("readonly", (store, set) => {
          const request = store.getAll();
          request.onsuccess = () => {
            let preferred: string | null = null;
            try {
              preferred = sessionStorage.getItem(affinity);
            } catch {}
            const records = request.result.filter(
              (v): v is RecordValue => valid(v, scope) && v.pending.length > 0,
            );
            records.sort(
              (a, b) =>
                Number(b.key === preferred) - Number(a.key === preferred) ||
                b.updatedAt.localeCompare(a.updatedAt),
            );
            set(records[0]?.pending ?? []);
          };
        }),
      );
    },
    write(pending: PendingWiEdit[]) {
      const snapshot = structuredClone(pending);
      return ordered(() =>
        transaction<void>("readwrite", (store, set) => {
          store.put({
            ...scope,
            key,
            schemaVersion: 1,
            updatedAt: new Date().toISOString(),
            pending: snapshot,
          });
          set(undefined);
        }),
      ).then(() => {
        try {
          sessionStorage.setItem(affinity, key);
        } catch {}
      });
    },
    acknowledge(entry: PendingWiEdit) {
      const snapshot = structuredClone(entry);
      return ordered(() =>
        transaction<void>("readwrite", (store, set) => {
          const request = store.getAll();
          request.onsuccess = () => {
            for (const record of request.result) {
              if (!valid(record, scope)) continue;
              const matches = (entry: PendingWiEdit) =>
                entry.operation === snapshot.operation &&
                JSON.stringify(entry.edit) === JSON.stringify(snapshot.edit) &&
                (entry.expectedVersion ?? entry.baseVersion) ===
                  snapshot.expectedVersion;
              const firstAcknowledged =
                record.pending[0] && matches(record.pending[0]);
              const pending = record.pending.filter((entry) => !matches(entry));
              if (
                firstAcknowledged &&
                pending[0] &&
                pending[0].expectedVersion === undefined &&
                pending[0].baseVersion === undefined
              )
                pending[0] = {
                  ...pending[0],
                  baseVersion: snapshot.expectedVersion! + 1,
                };
              if (pending.length === record.pending.length) continue;
              if (pending.length) store.put({ ...record, pending });
              else store.delete(record.key);
            }
            set(undefined);
          };
        }),
      );
    },
  };
}
