"use client";

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

export type ThemedSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type ThemedSelectProps = {
  value: string;
  options: readonly ThemedSelectOption[];
  onChange: (value: string) => void;
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
  menuAlign?: "left" | "right";
  placeholder?: string;
  triggerClassName?: string;
};

export function ThemedSelect({
  value,
  options,
  onChange,
  ariaLabel,
  className = "",
  disabled = false,
  menuAlign = "left",
  placeholder,
  triggerClassName = "",
}: ThemedSelectProps) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const selected = useMemo(() => options.find((option) => option.value === value), [options, value]);
  const visibleLabel = selected?.label ?? placeholder ?? options[0]?.label ?? "Select";

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (rootRef.current?.contains(event.target as Node)) {
        return;
      }
      setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function commit(nextValue: string) {
    onChange(nextValue);
    setOpen(false);
    buttonRef.current?.focus();
  }

  return (
    <div ref={rootRef} className={`ui-themed-select ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        className={`ui-themed-select-trigger ${triggerClassName}`}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-menu`}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="ui-themed-select-value">{visibleLabel}</span>
        <ChevronDown size={14} className="ui-themed-select-icon" aria-hidden="true" />
      </button>

      {open ? (
        <div
          id={`${id}-menu`}
          className={`ui-themed-select-menu ${menuAlign === "right" ? "ui-themed-select-menu-right" : ""}`}
          role="listbox"
          aria-label={ariaLabel}
        >
          {options.map((option) => {
            const selectedOption = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                className="ui-themed-select-option"
                role="option"
                aria-selected={selectedOption}
                disabled={option.disabled}
                onClick={() => commit(option.value)}
              >
                <span className="ui-themed-select-option-label">{option.label}</span>
                {selectedOption ? <Check size={13} className="ui-themed-select-check" aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
