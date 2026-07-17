"use client";

import { Check, ChevronDown } from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
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
  variant?: "default" | "sop";
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
  variant = "default",
}: ThemedSelectProps) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null);
  const selected = useMemo(() => options.find((option) => option.value === value), [options, value]);
  const visibleLabel = selected?.label ?? placeholder ?? options[0]?.label ?? "Select";
  const isSop = variant === "sop";

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

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      const availableOptions = Array.from(
        menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)') ?? [],
      );
      const selectedIndex = options.filter((option) => !option.disabled).findIndex((option) => option.value === value);
      (availableOptions[selectedIndex >= 0 ? selectedIndex : 0] ?? availableOptions[0])?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, options, value]);

  function commit(nextValue: string) {
    if (nextValue !== value) onChange(nextValue);
    setOpen(false);
    buttonRef.current?.focus();
  }

  function handleTriggerKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    setOpen(true);
  }

  function handleMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const optionButtons = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)') ?? [],
    );
    if (!optionButtons.length) return;

    const activeIndex = optionButtons.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex: number | null = null;
    if (event.key === "ArrowDown") nextIndex = (activeIndex + 1) % optionButtons.length;
    if (event.key === "ArrowUp") nextIndex = (activeIndex - 1 + optionButtons.length) % optionButtons.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = optionButtons.length - 1;
    if (event.key === "Tab") setOpen(false);
    if (nextIndex === null) return;

    event.preventDefault();
    optionButtons[nextIndex]?.focus();
  }

  return (
    <div ref={rootRef} className={`ui-themed-select ${isSop ? "ui-themed-select-sop" : ""} ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        className={`ui-themed-select-trigger ${isSop ? "ui-themed-select-trigger-sop" : ""} ${triggerClassName}`}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-menu`}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="ui-themed-select-value">{visibleLabel}</span>
        <ChevronDown size={14} className="ui-themed-select-icon" aria-hidden="true" />
      </button>

      {open && typeof document !== "undefined" ? createPortal(
        <div
          ref={menuRef}
          id={`${id}-menu`}
          className={`ui-themed-select-menu ui-themed-select-menu-portal ${isSop ? "ui-themed-select-menu-sop" : ""} ${menuAlign === "right" ? "ui-themed-select-menu-right" : ""}`}
          role="listbox"
          aria-label={ariaLabel}
          style={menuStyle ?? undefined}
          onKeyDown={handleMenuKeyDown}
        >
          {options.map((option) => {
            const selectedOption = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                className={`ui-themed-select-option ${isSop ? "ui-themed-select-option-sop" : ""}`}
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
