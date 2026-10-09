import { useEffect, useMemo, useRef, useState } from "react";
import type { Sop, SopReferenceDoc } from "@/domain/sop/schema";
import type { AnnexUploadStatus } from "./attachment-types";
import {
  listSopAnnexFiles,
  createSopAnnexFileUrl,
  openSopAnnexFile,
  removeSopAnnexFile,
  renameSopAnnexFile,
  uploadSopAnnexFile,
  type SopAnnexFile,
} from "@/lib/sop/annex-files";
function newReferenceDocId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? `refdoc-${crypto.randomUUID()}`
    : `refdoc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

interface SopAttachmentsOptions {
  sopId: string;
  annexes: Sop["annexes"];
  workspaceId?: string;
  hasPersistedSop: boolean;
  persist: () => Promise<boolean>;
  updateReferenceDocs: (change: (current: SopReferenceDoc[]) => SopReferenceDoc[]) => void;
  updateAnnexes: (rows: Sop["annexes"]) => void;
  isAnnexPersisted: (id: string) => boolean;
}

/** File operations preserve their save-before-upload and delete-before-removal ordering. */
export function useSopAttachments({
  sopId,
  annexes,
  workspaceId,
  hasPersistedSop,
  persist,
  updateReferenceDocs,
  updateAnnexes,
  isAnnexPersisted,
}: SopAttachmentsOptions) {
  const [annexFiles, setAnnexFiles] = useState<SopAnnexFile[]>([]);
  // Counts local writes to `annexFiles`. A list response that started before a local write
  // (e.g. the first save of a new SOP starts the list, then the upload appends) is stale and
  // is retried so unrelated existing files are still loaded. Never merge a stale response —
  // that would re-add a file removed after the list started.
  const localWritesRef = useRef(0);
  const [annexFileError, setAnnexFileError] = useState("");
  const [referenceDocError, setReferenceDocError] = useState("");
  const [referencePreview, setReferencePreview] = useState<{
    name: string;
    url: string;
  } | null>(null);
  const [uploadingReferenceDoc, setUploadingReferenceDoc] = useState(false);
  const [uploadingAnnexId, setUploadingAnnexId] = useState<string | null>(null);
  const [annexUploadStatus, setAnnexUploadStatus] =
    useState<AnnexUploadStatus | null>(null);
  // Reference-doc uploads share the annex-file table (keyed by the reference row's id
  // in the annex_id slot); this map serves the References UI's open/remove actions.
  const referenceFileByDocId = useMemo(
    () => new Map(annexFiles.map((file) => [file.annexId, file] as const)),
    [annexFiles],
  );

  async function handleAnnexUpload(index: number, file: File) {
    const annex = annexes[index];
    if (!annex?.id || !workspaceId) {
      setAnnexFileError("Save this SOP before uploading a form.");
      return;
    }
    const requiresSopSave = !isAnnexPersisted(annex.id);
    setUploadingAnnexId(annex.id);
    setAnnexFileError("");
    setAnnexUploadStatus({
      annexId: annex.id,
      phase: requiresSopSave ? "saving" : "uploading",
      message: requiresSopSave
        ? "Saving this new form row before upload…"
        : `Uploading ${file.name}…`,
    });
    try {
      if (requiresSopSave && !(await persist())) {
        setAnnexUploadStatus({
          annexId: annex.id,
          phase: "error",
          message:
            "Upload paused because the SOP could not be saved. Resolve the save warning above, then try again.",
        });
        return;
      }
      setAnnexUploadStatus({
        annexId: annex.id,
        phase: "uploading",
        message: `Uploading ${file.name}…`,
      });
      const saved = await uploadSopAnnexFile({
        workspaceId,
        sopId,
        annexId: annex.id,
        file,
      });
      localWritesRef.current += 1;
      setAnnexFiles((current) => [
        ...current.filter((item) => item.annexId !== annex.id),
        saved,
      ]);
      setAnnexUploadStatus({
        annexId: annex.id,
        phase: "success",
        message: "Upload complete.",
      });
    } catch (error) {
      setAnnexUploadStatus({
        annexId: annex.id,
        phase: "error",
        message:
          error instanceof Error ? error.message : "Could not upload the form.",
      });
    } finally {
      setUploadingAnnexId(null);
    }
  }

  async function handleAnnexOpen(file: SopAnnexFile) {
    setAnnexFileError("");
    try {
      if (file.contentType === "application/pdf") {
        const url = await createSopAnnexFileUrl(file, 600);
        setReferencePreview({ name: file.originalName, url });
      } else {
        await openSopAnnexFile(file);
      }
    } catch (error) {
      setAnnexFileError(
        error instanceof Error ? error.message : "Could not open the form.",
      );
    }
  }

  async function handleAnnexFileRemove(file: SopAnnexFile) {
    setAnnexFileError("");
    try {
      await removeSopAnnexFile(file);
      localWritesRef.current += 1;
      setAnnexFiles((current) => current.filter((item) => item.id !== file.id));
    } catch (error) {
      setAnnexFileError(
        error instanceof Error ? error.message : "Could not remove the form.",
      );
    }
  }

  async function handleReferenceDocUpload(file: File) {
    if (!workspaceId) {
      setReferenceDocError("Select an organization before uploading.");
      return;
    }
    setReferenceDocError("");
    setUploadingReferenceDoc(true);
    try {
      // The file row's sop_id FK needs the SOP to exist server-side; persist() closes over
      // this render's document, so it runs BEFORE the new reference row is added to state.
      if (!hasPersistedSop && !(await persist())) {
        setReferenceDocError(
          "Upload paused because the SOP could not be saved. Resolve the save warning above, then try again.",
        );
        return;
      }
      const docId = newReferenceDocId();
      const saved = await uploadSopAnnexFile({
        workspaceId,
        sopId,
        annexId: docId,
        file,
      });
      localWritesRef.current += 1;
      setAnnexFiles((current) => [
        ...current.filter((item) => item.annexId !== docId),
        saved,
      ]);
      // Added after the upload succeeds; autosave persists the document row.
      updateReferenceDocs(current => [...current, { id: docId, name: file.name }]);
    } catch (error) {
      setReferenceDocError(
        error instanceof Error
          ? error.message
          : "Could not upload the document.",
      );
    } finally {
      setUploadingReferenceDoc(false);
    }
  }

  async function handleReferenceDocOpen(doc: SopReferenceDoc) {
    const file = referenceFileByDocId.get(doc.id);
    if (!file) {
      setReferenceDocError(
        "This document's file is missing. Remove the row and upload it again.",
      );
      return;
    }
    setReferenceDocError("");
    try {
      if (file.contentType === "application/pdf") {
        const url = await createSopAnnexFileUrl(file, 600);
        setReferencePreview({ name: doc.name, url });
      } else {
        await openSopAnnexFile(file);
      }
    } catch (error) {
      setReferenceDocError(
        error instanceof Error ? error.message : "Could not open the document.",
      );
    }
  }

  async function handleReferenceDocRemove(doc: SopReferenceDoc) {
    setReferenceDocError("");
    const file = referenceFileByDocId.get(doc.id);
    try {
      if (file) {
        await removeSopAnnexFile(file);
        localWritesRef.current += 1;
        setAnnexFiles((current) =>
          current.filter((item) => item.id !== file.id),
        );
      }
      updateReferenceDocs(current => current.filter(item => item.id !== doc.id));
    } catch (error) {
      setReferenceDocError(
        error instanceof Error
          ? error.message
          : "Could not remove the document.",
      );
    }
  }

  async function handleAnnexRowRemove(index: number) {
    const annex = annexes[index];
    const file = annex?.id
      ? annexFiles.find((item) => item.annexId === annex.id)
      : undefined;
    if (file) {
      try {
        await removeSopAnnexFile(file);
        localWritesRef.current += 1;
        setAnnexFiles((current) =>
          current.filter((item) => item.id !== file.id),
        );
      } catch (error) {
        setAnnexFileError(
          error instanceof Error
            ? error.message
            : "Could not remove the attached form.",
        );
        return;
      }
    }
    updateAnnexes(annexes.filter((_, rowIndex) => rowIndex !== index));
  }

  // Keyed on persistence, not on the autosave concurrency token: every autosave advances
  // `persistedUpdatedAt`, and re-listing on each one re-rasterized every attached PDF in a
  // mounted print preview. Upload/rename/remove paths update the list from their own writes.
  useEffect(() => {
    if (!workspaceId || !hasPersistedSop) {
      setAnnexFiles([]);
      return;
    }
    let active = true;
    async function loadFiles() {
      try {
        while (active) {
          const seenWrites = localWritesRef.current;
          const files = await listSopAnnexFiles(sopId);
          if (!active) return;
          // A write can overtake the initial read before any existing files were loaded.
          // Retry against the server instead of leaving only that write's result in state.
          if (localWritesRef.current !== seenWrites) continue;
          setAnnexFiles(files);
          return;
        }
      } catch (error: unknown) {
        if (active) setAnnexFileError(
          error instanceof Error ? error.message : "Could not load attached forms.",
        );
      }
    }
    void loadFiles();
    return () => {
      active = false;
    };
  }, [hasPersistedSop, sopId, workspaceId]);

  async function handleAnnexRename(file: SopAnnexFile, name: string) {
    const renamed = await renameSopAnnexFile(file, name);
    localWritesRef.current += 1;
    setAnnexFiles((current) =>
      current.map((item) => (item.id === renamed.id ? renamed : item)),
    );
  }
  function reportUnavailableAttachment() {
    setAnnexFileError("This attachment is no longer available. Open the section in the builder to check its replacement.");
  }
  function clearUploadStatus() { setAnnexUploadStatus(null); }
  function closeReferencePreview() { setReferencePreview(null); }
  return {
    annexFiles,
    reportUnavailableAttachment, clearUploadStatus, closeReferencePreview,
    annexFileError,
    referenceDocError,
    referencePreview,
    uploadingReferenceDoc,
    uploadingAnnexId,
    annexUploadStatus,
    referenceFileByDocId,
    handleAnnexUpload,
    handleAnnexOpen,
    handleAnnexFileRemove,
    handleReferenceDocUpload,
    handleReferenceDocOpen,
    handleReferenceDocRemove,
    handleAnnexRowRemove,
    handleAnnexRename,
  };
}
