"use client";

import { Check, FileText, ListChecks, ScanText, Sparkles } from "lucide-react";
import { useEffect, useState, type ComponentType } from "react";
import { NothingSpinner } from "@/components/nothing-ui";

export type ConvertPhase = "working" | "done";

type Stage = {
  id: string;
  label: string;
  hint: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
};

const STAGES: Stage[] = [
  { id: "read", label: "Reading your document", hint: "Opening the uploaded file", icon: FileText },
  { id: "extract", label: "Extracting the content", hint: "Pulling text from every page", icon: ScanText },
  { id: "map", label: "Mapping to the standard format", hint: "Analyzing the document with AI", icon: Sparkles },
  { id: "build", label: "Building your SOP", hint: "Assembling the structured document", icon: ListChecks },
];

// The AI step is the long pole; we walk up to it, then hold there until the
// request resolves (we have no server-side progress to drive a real bar).
const PARK_INDEX = 2;

// Cycled under the AI step so the screen reflects the work actually happening.
const MAP_HINTS = [
  "Reading section headings…",
  "Extracting definitions and references…",
  "Identifying the RASIC responsibility matrix…",
  "Capturing change history and approvals…",
];

export function SopConvertOverlay({ fileName, phase }: { fileName: string; phase: ConvertPhase }) {
  const [step, setStep] = useState(0);
  const [hintIndex, setHintIndex] = useState(0);

  // Walk through the quick early stages, then hold on the AI step.
  useEffect(() => {
    if (phase === "done" || step >= PARK_INDEX) return;
    const delay = step === 0 ? 1200 : 1500;
    const timer = setTimeout(() => setStep((current) => Math.min(PARK_INDEX, current + 1)), delay);
    return () => clearTimeout(timer);
  }, [step, phase]);

  // Cycle the sub-hint while parked on the AI step.
  useEffect(() => {
    if (phase === "done" || step !== PARK_INDEX) return;
    const timer = setInterval(() => setHintIndex((current) => (current + 1) % MAP_HINTS.length), 2200);
    return () => clearInterval(timer);
  }, [step, phase]);

  // Once the work finishes, light up every stage for a clean finish.
  useEffect(() => {
    if (phase === "done") setStep(STAGES.length - 1);
  }, [phase]);

  const allDone = phase === "done";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-canvas px-6 text-ink">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3">
          <NothingSpinner />
          <div className="min-w-0">
            <div className="ui-section-title">{allDone ? "SOP ready" : "Converting SOP"}</div>
            <div className="ui-mono-label mt-0.5 truncate text-ink-tertiary">{fileName}</div>
          </div>
        </div>

        <div className="nd-progress-segments mt-5">
          {STAGES.map((stage, index) => {
            const filled = allDone || index <= step;
            return (
              <span
                key={stage.id}
                className={`nd-progress-segment ${
                  filled ? (allDone ? "nd-progress-segment-good" : "nd-progress-segment-filled") : ""
                }`}
              />
            );
          })}
        </div>

        <ul className="mt-6 space-y-3">
          {STAGES.map((stage, index) => {
            const status = allDone || index < step ? "done" : index === step ? "active" : "pending";
            const Icon = stage.icon;
            const isMapActive = status === "active" && index === PARK_INDEX;
            return (
              <li
                key={stage.id}
                className="sop-convert-row flex items-start gap-3"
                style={{ animationDelay: `${index * 70}ms` }}
              >
                <span
                  className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors ${
                    status === "done"
                      ? "border-success bg-success-muted text-success"
                      : status === "active"
                        ? "border-ink-secondary bg-surface-muted text-ink"
                        : "border-line text-ink-tertiary"
                  }`}
                >
                  {status === "done" ? (
                    <Check size={13} strokeWidth={2.5} />
                  ) : (
                    <Icon size={13} strokeWidth={1.75} className={status === "active" ? "animate-pulse" : ""} />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div
                    className={`text-sm transition-colors ${
                      status === "pending" ? "text-ink-tertiary" : "font-medium text-ink"
                    }`}
                  >
                    {stage.label}
                  </div>
                  {status === "active" ? (
                    <>
                      <div className="ui-mono-label mt-1 truncate text-ink-tertiary">
                        {isMapActive ? MAP_HINTS[hintIndex] : stage.hint}
                      </div>
                      <div className="sop-convert-bar mt-2 h-0.5 w-full rounded-full bg-line" />
                    </>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
