"use client";

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

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
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null);
  const selected = useMemo(() => options.find((option) => option.value === value), [options, value]);
  const visibleLabel = selected?.label ?? placeholder ?? options[0]?.label ?? "Select";

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) {
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

  useLayoutEffect(() => {
    if (!open) {
      setMenuStyle(null);
      return undefined;
    }

    function updateMenuPosition() {
      const button = buttonRef.current;
      if (!button) {
        return;
      }

      const rect = button.getBoundingClientRect();
      const width = Math.max(rect.width, 176);
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      const viewportOffsetTop = window.visualViewport?.offsetTop ?? 0;
      const top = rect.bottom + viewportOffsetTop + 6;
      const maxHeight = Math.max(160, viewportHeight - rect.bottom - 18);
      const left =
        menuAlign === "right"
          ? Math.max(8, rect.right - width)
          : Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);

      setMenuStyle({
        left,
        top,
        width,
        maxHeight: Math.min(288, maxHeight),
      });
    }

    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    window.visualViewport?.addEventListener("resize", updateMenuPosition);
    window.visualViewport?.addEventListener("scroll", updateMenuPosition);

    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
      window.visualViewport?.removeEventListener("resize", updateMenuPosition);
      window.visualViewport?.removeEventListener("scroll", updateMenuPosition);
    };
  }, [menuAlign, open]);

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

      {open && typeof document !== "undefined" ? createPortal(
        <div
          ref={menuRef}
          id={`${id}-menu`}
          className={`ui-themed-select-menu ui-themed-select-menu-portal ${menuAlign === "right" ? "ui-themed-select-menu-right" : ""}`}
          role="listbox"
          aria-label={ariaLabel}
          style={menuStyle ?? undefined}
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
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
