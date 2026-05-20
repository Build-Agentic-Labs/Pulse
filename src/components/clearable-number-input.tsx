"use client";

import { useEffect, useState, type InputHTMLAttributes } from "react";

type ClearableNumberInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "type" | "value"> & {
  value: number | undefined;
  onValueChange: (value: number) => void;
  fallbackValue?: number;
  precision?: number;
  normalize?: (value: number) => number;
};

function roundNumber(value: number, precision: number) {
  const multiplier = 10 ** precision;
  return Math.round(value * multiplier) / multiplier;
}

function formatNumber(value: number | undefined, precision?: number) {
  if (value === undefined || !Number.isFinite(value)) {
    return "";
  }

  const formattedValue = precision === undefined ? value : roundNumber(value, precision);
  return String(formattedValue);
}

function isCompleteNumberDraft(value: string) {
  return value !== "" && value !== "." && value !== "-" && value !== "-.";
}

export function ClearableNumberInput({
  value,
  onValueChange,
  fallbackValue,
  precision,
  normalize,
  min,
  max,
  onBlur,
  onFocus,
  onKeyDown,
  ...inputProps
}: ClearableNumberInputProps) {
  const [draft, setDraft] = useState(formatNumber(value, precision));
  const [editing, setEditing] = useState(false);
  const allowNegative = typeof min !== "number" || min < 0;
  const draftPattern = allowNegative ? /^-?\d*\.?\d*$/ : /^\d*\.?\d*$/;

  function clampAndNormalize(nextValue: number) {
    let normalizedValue = normalize ? normalize(nextValue) : nextValue;

    if (typeof min === "number") {
      normalizedValue = Math.max(normalizedValue, min);
    }

    if (typeof max === "number") {
      normalizedValue = Math.min(normalizedValue, max);
    }

    return normalizedValue;
  }

  function commitDraft(nextDraft: string) {
    if (!isCompleteNumberDraft(nextDraft)) {
      const replacement = clampAndNormalize(fallbackValue ?? value ?? (typeof min === "number" ? min : 0));
      setDraft(formatNumber(replacement, precision));
      onValueChange(replacement);
      return;
    }

    const parsed = Number(nextDraft);
    if (!Number.isFinite(parsed)) {
      return;
    }

    const normalizedValue = clampAndNormalize(parsed);
    setDraft(formatNumber(normalizedValue, precision));
    onValueChange(normalizedValue);
  }

  useEffect(() => {
    if (!editing) {
      setDraft(formatNumber(value, precision));
    }
  }, [editing, precision, value]);

  return (
    <input
      {...inputProps}
      type="text"
      inputMode="decimal"
      value={draft}
      onFocus={(event) => {
        setEditing(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setEditing(false);
        commitDraft(event.currentTarget.value);
        onBlur?.(event);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        }

        onKeyDown?.(event);
      }}
      onChange={(event) => {
        const nextDraft = event.target.value.trim();
        if (!draftPattern.test(nextDraft)) {
          return;
        }

        setDraft(nextDraft);

        if (!isCompleteNumberDraft(nextDraft)) {
          return;
        }

        const parsed = Number(nextDraft);
        if (Number.isFinite(parsed)) {
          onValueChange(clampAndNormalize(parsed));
        }
      }}
    />
  );
}
