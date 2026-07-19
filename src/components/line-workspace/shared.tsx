"use client";

import { type KeyboardEvent as ReactKeyboardEvent } from "react";
import { resolveBulletEnter } from "@/domain/instruction-bullets";
import { ClearableNumberInput } from "../clearable-number-input";

export type ProcedureDraftFieldName = "instruction" | "name";

function applyTextareaCursor(textarea: HTMLTextAreaElement, cursorPosition: number) {
  window.requestAnimationFrame(() => {
    textarea.setSelectionRange(cursorPosition, cursorPosition);
  });
}

export function handleInstructionBulletKeyDown(
  event: ReactKeyboardEvent<HTMLTextAreaElement>,
  onValue: (value: string) => void,
) {
  if (event.key !== "Enter" || event.shiftKey) {
    return;
  }

  const textarea = event.currentTarget;
  const nextValue = resolveBulletEnter(textarea.value, textarea.selectionStart, textarea.selectionEnd);

  if (!nextValue) {
    return;
  }

  event.preventDefault();
  onValue(nextValue.value);
  applyTextareaCursor(textarea, nextValue.selectionStart);
}

export type ProductNumberField =
  | "targetManHours"
  | "demandQuantity"
  | "grossAvailableMinutes"
  | "breakMinutes"
  | "lunchMinutes"
  | "meetingMinutes"
  | "plannedDowntimeMinutes"
  | "workDaysPerWeek"
  | "workWeeksPerMonth"
  | "manualTaktMinutes";

export type ProductTextField = "name" | "productCode" | "sku" | "revision" | "ownerName" | "status" | "demandPeriod";

export function NumericField({
  label,
  value,
  suffix,
  onChange,
  precision,
  normalize,
  readOnly = false,
}: {
  label: string;
  value: number | undefined;
  suffix?: string;
  onChange: (value: number) => void;
  precision?: number;
  normalize?: (value: number) => number;
  readOnly?: boolean;
}) {
  return (
    <label className="block">
      <span className="ui-field-label">{label}</span>
      <div className={`ui-field-shell ${readOnly ? "ui-field-shell-readonly" : ""}`}>
        <ClearableNumberInput
          className={`number-input ui-field-control ${readOnly ? "ui-field-control-readonly" : ""}`}
          value={value}
          min={0}
          fallbackValue={value ?? 0}
          precision={precision}
          normalize={normalize}
          readOnly={readOnly}
          aria-readonly={readOnly}
          onValueChange={(nextValue) => {
            if (!readOnly) {
              onChange(nextValue);
            }
          }}
        />
        {suffix ? <span className="ui-field-suffix">{suffix}</span> : null}
      </div>
    </label>
  );
}

export function StatCard({
  label,
  value,
  meta,
  tone = "neutral",
}: {
  label: string;
  value: string;
  meta?: string;
  tone?: "neutral" | "good" | "warn" | "bad";
}) {
  const toneClass =
    tone === "good"
      ? "ui-metric-card-good"
      : tone === "warn"
        ? "ui-metric-card-warn"
        : tone === "bad"
          ? "ui-metric-card-bad"
          : "";

  return (
    <div className={`ui-metric-card ${toneClass}`}>
      <div className="ui-metric-card-label">{label}</div>
      <div className="ui-metric-card-value">{value}</div>
      {meta ? <div className="ui-metric-card-meta">{meta}</div> : null}
    </div>
  );
}
