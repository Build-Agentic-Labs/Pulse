"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { clipboardImageFiles } from "@/domain/clipboard-images";
import {
  canPasteInto,
  createStepPhotoClipboardEntry,
  type StepPhotoClipboardEntry,
  type StepPhotoClipboardMode,
} from "@/domain/step-photo-clipboard";
import type { StepPhotoAttachment } from "@/domain/step-photos";

export interface StepPhotoTarget {
  taskId: string;
  stepId: string;
}

export interface ActiveStepPhoto extends StepPhotoTarget {
  photo: StepPhotoAttachment;
}

interface StepPhotoClipboardValue {
  entry: StepPhotoClipboardEntry | null;
  putOnClipboard: (
    photo: StepPhotoAttachment,
    taskId: string,
    stepId: string,
    mode: StepPhotoClipboardMode,
  ) => void;
  clear: () => void;
  setActivePhoto: (target: ActiveStepPhoto | null) => void;
  setActiveStep: (target: StepPhotoTarget | null) => void;
}

const StepPhotoClipboardContext = createContext<StepPhotoClipboardValue | null>(null);

export function useStepPhotoClipboard(): StepPhotoClipboardValue {
  const value = useContext(StepPhotoClipboardContext);
  if (!value) {
    throw new Error("useStepPhotoClipboard must be used within a StepPhotoClipboardProvider.");
  }
  return value;
}

/** Typing in a field must never be hijacked by the photo clipboard. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
}

function hasTextSelection(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const selection = window.getSelection();
  return Boolean(selection && !selection.isCollapsed && selection.toString().trim().length > 0);
}

export function StepPhotoClipboardProvider({
  children,
  onPaste,
  onNotify,
}: {
  children: ReactNode;
  onPaste: (entry: StepPhotoClipboardEntry, target: StepPhotoTarget) => Promise<void> | void;
  onNotify?: (message: { title: string; body?: string; tone: "success" | "danger" }) => void;
}) {
  const [entry, setEntry] = useState<StepPhotoClipboardEntry | null>(null);
  const entryRef = useRef<StepPhotoClipboardEntry | null>(null);
  const activePhotoRef = useRef<ActiveStepPhoto | null>(null);
  const activeStepRef = useRef<StepPhotoTarget | null>(null);
  const onPasteRef = useRef(onPaste);
  const onNotifyRef = useRef(onNotify);

  entryRef.current = entry;
  onPasteRef.current = onPaste;
  onNotifyRef.current = onNotify;

  const setActivePhoto = useCallback((target: ActiveStepPhoto | null) => {
    activePhotoRef.current = target;
  }, []);

  const setActiveStep = useCallback((target: StepPhotoTarget | null) => {
    activeStepRef.current = target;
  }, []);

  const putOnClipboard = useCallback(
    (photo: StepPhotoAttachment, taskId: string, stepId: string, mode: StepPhotoClipboardMode) => {
      setEntry(createStepPhotoClipboardEntry(photo, taskId, stepId, mode));
      onNotifyRef.current?.({
        title: mode === "cut" ? "Photo cut" : "Photo copied",
        body: "Hover another step's photos and press Ctrl+V.",
        tone: "success",
      });
    },
    [],
  );

  const clear = useCallback(() => setEntry(null), []);

  // Copy/cut cannot ride the native `copy` event: that fires on the focused element, and
  // this feature keys off what the pointer is over. keydown is the only signal available.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key !== "c" && key !== "x") {
        return;
      }

      if (isEditableTarget(event.target) || hasTextSelection()) {
        return;
      }

      const active = activePhotoRef.current;
      if (!active) {
        return;
      }

      event.preventDefault();
      putOnClipboard(active.photo, active.taskId, active.stepId, key === "x" ? "cut" : "copy");
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [putOnClipboard]);

  // Paste rides the native `paste` event rather than keydown so that "did the system
  // clipboard bring an image?" is answered synchronously, at one decision point. A
  // screenshot taken seconds ago always beats a photo copied minutes ago.
  useEffect(() => {
    function handlePaste(event: ClipboardEvent) {
      const currentEntry = entryRef.current;
      if (!currentEntry) {
        return;
      }

      if (clipboardImageFiles(event.clipboardData).length > 0) {
        return;
      }

      if (isEditableTarget(event.target)) {
        return;
      }

      const target = activeStepRef.current;
      if (!target || !canPasteInto(currentEntry, target.taskId, target.stepId)) {
        return;
      }

      event.preventDefault();
      void Promise.resolve(onPasteRef.current(currentEntry, target))
        .then(() => {
          if (currentEntry.mode === "cut" && entryRef.current === currentEntry) {
            setEntry(null);
          }
        })
        .catch(() => undefined);
    }

    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, []);

  const value = useMemo<StepPhotoClipboardValue>(
    () => ({ entry, putOnClipboard, clear, setActivePhoto, setActiveStep }),
    [entry, putOnClipboard, clear, setActivePhoto, setActiveStep],
  );

  return <StepPhotoClipboardContext.Provider value={value}>{children}</StepPhotoClipboardContext.Provider>;
}
