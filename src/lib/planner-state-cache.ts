import type { PlannerState } from "@/domain/types";

const DB_NAME = "pulse-planner-cache";
const DB_VERSION = 1;
const STORE_NAME = "project-snapshots";
const SNAPSHOT_SCHEMA_VERSION = 1;

let plannerCacheDbPromise: Promise<IDBDatabase> | null = null;

type PlannerStateCacheRecord = {
  projectId: string;
  schemaVersion: number;
  savedAt: string;
  state: PlannerState;
};

function canUseIndexedDb() {
  return typeof window !== "undefined" && typeof window.indexedDB !== "undefined";
}

function openPlannerCacheDb() {
  if (plannerCacheDbPromise) {
    return plannerCacheDbPromise;
  }

  plannerCacheDbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (!canUseIndexedDb()) {
      plannerCacheDbPromise = null;
      reject(new Error("Planner cache is not available in this browser."));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "projectId" });
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        plannerCacheDbPromise = null;
      };
      resolve(database);
    };
    request.onerror = () => {
      plannerCacheDbPromise = null;
      reject(request.error ?? new Error("Unable to open planner cache."));
    };
    request.onblocked = () => {
      plannerCacheDbPromise = null;
      reject(new Error("Planner cache upgrade is blocked."));
    };
  });

  return plannerCacheDbPromise;
}

export async function readCachedPlannerState(projectId?: string) {
  if (!projectId || !canUseIndexedDb()) {
    return null;
  }

  const database = await openPlannerCacheDb();

  return new Promise<PlannerState | null>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(projectId);
    request.onsuccess = () => {
      const record = request.result as PlannerStateCacheRecord | undefined;
      if (!record || record.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
        resolve(null);
        return;
      }
      resolve(record.state);
    };
    request.onerror = () => reject(request.error ?? new Error("Unable to read planner cache."));
  });
}

export async function writeCachedPlannerState(projectId: string | undefined, state: PlannerState) {
  if (!projectId || !canUseIndexedDb()) {
    return;
  }

  const database = await openPlannerCacheDb();

  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put({
      projectId,
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      savedAt: new Date().toISOString(),
      state,
    } satisfies PlannerStateCacheRecord);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Unable to write planner cache."));
  });
}
