// Legacy v1 helpers retain their existing contract. The C1 store below owns account/product/task
// slots and exact-token acknowledgment; new editors never write or clear the unowned v1 slot.
import type { ManufacturingStepCheckValue } from "@/domain/manufacturing-step-checks";
import type { StepPhotoAttachment } from "@/domain/step-photos";

const MOBILE_DRAFT_DB_NAME = "buildlogic-mobile-drafts";
const MOBILE_DRAFT_STORE_NAME = "drafts";
const MOBILE_NEW_STEP_DRAFT_KEY = "mobile-new-step-draft-v1";

export type MobileNewStepDraftRecord = {
  key: string;
  taskId: string;
  stepId: string | null;
  name?: string;
  instruction: string;
  durationText: string;
  tools: string[];
  photos: StepPhotoAttachment[];
  checks: string[];
  checkValues?: Record<string, ManufacturingStepCheckValue>;
  updatedAt: string;
};

export function readBlobAsDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Unable to read compressed photo."));
    reader.readAsDataURL(blob);
  });
}

function openMobileDraftDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("Local draft storage is not available in this browser."));
      return;
    }

    const request = indexedDB.open(MOBILE_DRAFT_DB_NAME, 1);

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(MOBILE_DRAFT_STORE_NAME)) {
        database.createObjectStore(MOBILE_DRAFT_STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to open local draft storage."));
  });
}

export async function saveMobileNewStepRecoveryDraft(draft: Omit<MobileNewStepDraftRecord, "key" | "updatedAt">) {
  const database = await openMobileDraftDb();

  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(MOBILE_DRAFT_STORE_NAME, "readwrite");
      transaction.objectStore(MOBILE_DRAFT_STORE_NAME).put({
        ...draft,
        key: MOBILE_NEW_STEP_DRAFT_KEY,
        updatedAt: new Date().toISOString(),
      } satisfies MobileNewStepDraftRecord);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Unable to save the local recovery draft."));
    });
  } finally {
    database.close();
  }
}

export async function loadMobileNewStepRecoveryDraft() {
  const database = await openMobileDraftDb();

  try {
    return await new Promise<MobileNewStepDraftRecord | null>((resolve, reject) => {
      const transaction = database.transaction(MOBILE_DRAFT_STORE_NAME, "readonly");
      const request = transaction.objectStore(MOBILE_DRAFT_STORE_NAME).get(MOBILE_NEW_STEP_DRAFT_KEY);
      request.onsuccess = () => resolve((request.result as MobileNewStepDraftRecord | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error("Unable to load the local recovery draft."));
    });
  } finally {
    database.close();
  }
}

export async function clearMobileNewStepRecoveryDraft() {
  const database = await openMobileDraftDb();

  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(MOBILE_DRAFT_STORE_NAME, "readwrite");
      transaction.objectStore(MOBILE_DRAFT_STORE_NAME).delete(MOBILE_NEW_STEP_DRAFT_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Unable to clear the local recovery draft."));
    });
  } finally {
    database.close();
  }
}

export type RecoveryDraftScope = { userId: string; projectId: string; taskId: string };
export type ScopedRecoveryDraft = MobileNewStepDraftRecord & RecoveryDraftScope & {
  schemaVersion: 2;
  draftId: string;
  writeToken: string;
};

export function recoveryDraftKey(scope: RecoveryDraftScope) {
  const parts = [scope.userId, scope.projectId, scope.taskId];
  if (parts.some((part) => typeof part !== "string" || !part)) throw new Error("Recovery draft scope is required.");
  return `mobile-new-step-draft-v2:${parts.map(encodeURIComponent).join(":")}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isMobileRecoveryPayload(value: unknown): value is MobileNewStepDraftRecord {
  if (!isObject(value)) return false;
  return typeof value.taskId === "string" && Boolean(value.taskId) &&
    typeof value.stepId === "string" && Boolean(value.stepId) &&
    (value.name === undefined || typeof value.name === "string") &&
    typeof value.instruction === "string" && typeof value.durationText === "string" &&
    Array.isArray(value.tools) && value.tools.every((tool) => typeof tool === "string") &&
    Array.isArray(value.checks) && value.checks.every((check) => typeof check === "string") &&
    Array.isArray(value.photos) && value.photos.every((photo) => isObject(photo) &&
      typeof photo.id === "string" && typeof photo.name === "string" &&
      typeof photo.dataUrl === "string" && typeof photo.capturedAt === "string") &&
    (value.checkValues === undefined || (isObject(value.checkValues) && Object.values(value.checkValues).every(isObject))) &&
    typeof value.updatedAt === "string" && Number.isFinite(Date.parse(value.updatedAt));
}

function isScopedDraft(value: unknown, scope: RecoveryDraftScope): value is ScopedRecoveryDraft {
  return isObject(value) && value.schemaVersion === 2 &&
    value.userId === scope.userId && value.projectId === scope.projectId && value.taskId === scope.taskId &&
    value.key === recoveryDraftKey(scope) && value.draftId === value.stepId &&
    typeof value.writeToken === "string" && Boolean(value.writeToken) && isMobileRecoveryPayload(value);
}

// Instance-owned ordering: opening separate connections must not reorder writes that were issued
// synchronously by one editor. IndexedDB supplies the cross-tab transaction lock, not this queue.
export function createMobileRecoveryDraftStore() {
  const pending = new Map<string, Promise<unknown>>();
  function ordered<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const next = (pending.get(key) ?? Promise.resolve()).catch(() => undefined).then(operation);
    pending.set(key, next);
    void next.catch(() => undefined).finally(() => { if (pending.get(key) === next) pending.delete(key); });
    return next;
  }

  async function transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore, result: (value: T) => void, fail: (error: Error) => void) => void) {
    const database = await openMobileDraftDb();
    try {
      return await new Promise<T>((resolve, reject) => {
        const tx = database.transaction(MOBILE_DRAFT_STORE_NAME, mode);
        let result: T;
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error ?? new Error("Unable to access the local recovery draft."));
        tx.onabort = () => reject(tx.error ?? new Error("Local recovery draft transaction aborted."));
        try { operation(tx.objectStore(MOBILE_DRAFT_STORE_NAME), (value) => { result = value; }, (error) => { reject(error); tx.abort(); }); }
        catch (error) { tx.abort(); reject(error); }
      });
    } finally { database.close(); }
  }

  return {
    save(draft: ScopedRecoveryDraft) {
      const key = recoveryDraftKey(draft);
      // Capture before enqueueing: callers may subsequently mutate arrays/objects in their editor.
      const snapshot = structuredClone(draft);
      return ordered(key, () => transaction<void>("readwrite", (store, result, fail) => {
        if (!isScopedDraft(snapshot, snapshot)) throw new Error("Invalid recovery draft.");
        const read = store.get(key);
        read.onsuccess = () => {
          if (read.result !== undefined && !isScopedDraft(read.result, snapshot)) {
            // Abort rather than replacing an unknown schema or malformed record.
            fail(new Error("Unrecognized local recovery draft; existing data was preserved."));
            return;
          }
          store.put(snapshot);
          result(undefined);
        };
      }));
    },
    load(scope: RecoveryDraftScope) {
      const key = recoveryDraftKey(scope);
      return ordered(key, () => transaction<ScopedRecoveryDraft | null>("readonly", (store, result) => {
        const read = store.get(key);
        read.onsuccess = () => result(isScopedDraft(read.result, scope) ? read.result : null);
      }));
    },
    acknowledge(draft: ScopedRecoveryDraft) {
      const key = recoveryDraftKey(draft);
      return ordered(key, () => transaction<boolean>("readwrite", (store, result) => {
        const read = store.get(key);
        read.onsuccess = () => {
          const matches = isScopedDraft(read.result, draft) && read.result.draftId === draft.draftId && read.result.writeToken === draft.writeToken;
          if (matches) store.delete(key);
          result(matches);
        };
      }));
    },
    // Explicit legacy adoption only. Never delete/rewrite the source and never replace an owned slot.
    adoptLegacy(scope: RecoveryDraftScope, reviewed: MobileNewStepDraftRecord) {
      const key = recoveryDraftKey(scope);
      const expected = structuredClone(reviewed);
      return ordered(key, () => transaction<ScopedRecoveryDraft>("readwrite", (store, result, fail) => {
        if (!isMobileRecoveryPayload(expected) || expected.taskId !== scope.taskId) throw new Error("Invalid legacy recovery draft.");
        const legacy = store.get(MOBILE_NEW_STEP_DRAFT_KEY);
        legacy.onsuccess = () => {
          if (!isObject(legacy.result) || legacy.result.schemaVersion !== undefined || JSON.stringify(legacy.result) !== JSON.stringify(expected)) {
            fail(new Error("The earlier draft changed. Review it again before using it.")); return;
          }
          const owned = store.get(key);
          owned.onsuccess = () => {
            if (owned.result !== undefined) { fail(new Error("Finish your current draft before using this one.")); return; }
            const draft: ScopedRecoveryDraft = { ...expected, ...scope, key, schemaVersion: 2,
              draftId: expected.stepId!, writeToken: crypto.randomUUID(), updatedAt: new Date().toISOString() };
            store.put(draft); result(draft);
          };
        };
      }));
    },
  };
}
