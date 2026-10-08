"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { QualityWi, WiEdit } from "@/domain/quality-wi/schema";
import { WiEditorController } from "@/lib/quality-wi/editor-controller";
import { createWiRecoveryStore } from "@/lib/quality-wi/recovery-store";
import {
  saveQualityWiEdit,
  publishQualityWi,
} from "@/lib/quality-wi/write-store";
import { loadQualityWi, signWiImages } from "@/lib/quality-wi/read-store";
import { uploadWiImage } from "@/lib/quality-wi/image-store";
export function useWiEditor(initial: QualityWi, userId: string) {
  const controllerRef = useRef<WiEditorController | null>(null);
  const [snapshot, setSnapshot] = useState(() => ({
    document: initial,
    ready: false,
    status: "saved" as "saved" | "saving" | "error",
    message: "",
    localWarning: "",
    pending: 0,
    publishing: false,
    conflicted: false,
  }));
  useEffect(() => {
    const recovery = createWiRecoveryStore({
      userId,
      workspaceId: initial.workspaceId,
      wiId: initial.id,
    });
    const controller = new WiEditorController(initial, {
      loadRecovery: () => recovery.load(),
      archiveRecovery: (entries) => recovery.archive(entries),
      storeRecovery: (entries) => recovery.write(entries),
      acknowledge: (entry) => recovery.acknowledge(entry),
      save: async (entry, assertCurrent) => {
        if (
          entry.edit.kind === "image" &&
          entry.edit.payload.image &&
          entry.edit.payload.dataUrl
        )
          await uploadWiImage(
            entry.edit.payload.image,
            entry.edit.payload.dataUrl,
            undefined,
            assertCurrent,
            userId,
          );
        return saveQualityWiEdit(
          initial.id,
          entry,
          undefined,
          assertCurrent,
          userId,
        );
      },
      reload: async () =>
        signWiImages(await loadQualityWi(initial.workspaceId, initial.id)),
      publish: (version, operation, description, assertCurrent) =>
        publishQualityWi(
          initial.id,
          version,
          operation,
          description,
          undefined,
          assertCurrent,
          userId,
        ),
    });
    controllerRef.current = controller;
    setSnapshot(controller.getSnapshot());
    const unsubscribe = controller.subscribe(() =>
      setSnapshot(controller.getSnapshot()),
    );
    void controller.start();
    return () => {
      unsubscribe();
      controller.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [initial, userId]);
  const edit = useCallback(
    (value: WiEdit) => controllerRef.current?.edit(value),
    [],
  );
  const flush = useCallback(
    () => controllerRef.current?.flush() ?? Promise.resolve(false),
    [],
  );
  const publish = useCallback(
    (description: string) =>
      controllerRef.current?.publish(description) ?? Promise.resolve(false),
    [],
  );
  const acceptSaved = useCallback(() => controllerRef.current?.acceptSaved() ?? Promise.resolve(false), []);
  return { ...snapshot, edit, flush, publish, acceptSaved };
}
