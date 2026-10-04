// IndexedDB recovery-draft store for the mobile photo portal's New Step panel. Moved verbatim out of
// mobile-photo-portal.tsx (edit-reliability Package B, slice B2); no hooks, effects or JSX. Owns the
// database and store names, the single fixed record key (deliberately not project- or user-scoped here;
// that scoping is a Package C design input), the record shape and `updatedAt` stamp, and the
// open/put/get/delete lifecycle with `database.close()` in every `finally`. The component decides when
// to save, load and clear. Not pure: touches window.indexedDB and FileReader.
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
