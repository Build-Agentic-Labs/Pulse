"use client";

import { Check, ChevronDown, Plus } from "lucide-react";
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
  /** Optional secondary line shown beneath the option label. */
  description?: string;
  disabled?: boolean;
  /** Optional visual group heading. Consecutive options with the same group share one heading. */
  group?: string;
};

type ThemedSelectProps = {
  value: string;
  options: readonly ThemedSelectOption[];
  onChange: (value: string) => void;
  ariaLabel?: string;
  autoOpen?: boolean;
  className?: string;
  disabled?: boolean;
  menuAlign?: "left" | "right";
  /** Maximum menu height in pixels when this picker needs to expose a longer list at once. */
  menuMaxHeight?: number;
  placeholder?: string;
  /**
   * Opt-in combobox behavior: a search box at the top of the menu that filters the options and
   * offers to commit whatever was typed. Defaults to false, so every call site that does not
   * pass it renders and behaves exactly as before.
   */
  allowCustomValue?: boolean;
  /** Optional compact trigger text when the menu labels need to be more descriptive. */
  selectedLabel?: string;
  triggerClassName?: string;
  variant?: "default" | "sop";
};

export function ThemedSelect({
  value,
  options,
  onChange,
  ariaLabel,
  allowCustomValue = false,
  autoOpen = false,
  className = "",
  disabled = false,
  menuAlign = "left",
  menuMaxHeight = 288,
  placeholder,
  selectedLabel,
  triggerClassName = "",
  variant = "default",
}: ThemedSelectProps) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // Same normalization the domain applies to a role name, so what is offered and what is
  // committed cannot disagree about whitespace.
  const typed = query.trim().replace(/\s+/g, " ");
  const visibleOptions = useMemo(() => {
    if (!allowCustomValue || !typed) return options;
    const needle = typed.toLowerCase();
    return options.filter(
      (option) =>
        option.label.toLowerCase().includes(needle) || option.value.toLowerCase().includes(needle),
    );
  }, [allowCustomValue, options, typed]);
  // A case or spacing variant of something already offered is that option, never a new value.
  const typedMatchesExisting = useMemo(
    () => options.find((option) => option.value.trim().toLowerCase() === typed.toLowerCase()),
    [options, typed],
  );
  const showCustomEntry = allowCustomValue && typed.length > 0 && !typedMatchesExisting;
  const selected = useMemo(() => options.find((option) => option.value === value), [options, value]);
  const selectedOptionLabel = selected?.description
    ? `${selected.label} — ${selected.description}`
    : selected?.label;
  const visibleLabel = selectedLabel ?? selectedOptionLabel ?? placeholder ?? options[0]?.label ?? "Select";
  const isSop = variant === "sop";

  useEffect(() => {
    if (autoOpen && !disabled) setOpen(true);
  }, [autoOpen, disabled]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

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
        maxHeight: Math.min(menuMaxHeight, maxHeight),
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
  }, [menuAlign, menuMaxHeight, open]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      if (allowCustomValue) {
        searchRef.current?.focus();
        return;
      }
      const availableOptions = Array.from(
        menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)') ?? [],
      );
      const selectedIndex = options.filter((option) => !option.disabled).findIndex((option) => option.value === value);
      (availableOptions[selectedIndex >= 0 ? selectedIndex : 0] ?? availableOptions[0])?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [allowCustomValue, open, options, value]);

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
          {allowCustomValue ? (
            <div className="ui-themed-select-search" role="presentation">
              <input
                ref={searchRef}
                type="text"
                className="ui-themed-select-search-input"
                aria-label={ariaLabel ? `${ariaLabel} — type to filter or add` : "Type to filter or add"}
                placeholder="Type to filter or add…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  // An exact match wins so a case variant can never create a duplicate;
                  // otherwise Enter commits what was typed. Filtered options are chosen by
                  // clicking or arrowing to them, which keeps Enter unambiguous.
                  if (typedMatchesExisting) commit(typedMatchesExisting.value);
                  else if (typed.length > 0) commit(typed);
                }}
              />
              {/* Both of these live in the STICKY header, not at the foot of the list. The role
                  list runs to thousands of pixels, so an affordance below the fold is no
                  affordance at all — measured at 2210px out of view before this moved. */}
              {showCustomEntry ? (
                <button
                  type="button"
                  className={`ui-themed-select-option ui-themed-select-option-create ${isSop ? "ui-themed-select-option-sop" : ""}`}
                  role="option"
                  aria-selected={false}
                  onClick={() => commit(typed)}
                >
                  <Plus size={13} className="ui-themed-select-create-icon" aria-hidden="true" />
                  <span className="ui-themed-select-option-content">
                    <span className="ui-themed-select-option-label">Add “{typed}”</span>
                  </span>
                </button>
              ) : null}
              {!typed ? (
                <p className="ui-themed-select-create-hint" role="presentation">
                  <Plus size={12} aria-hidden="true" />
                  Type a name to add a new one
                </p>
              ) : null}
            </div>
          ) : null}
          {visibleOptions.map((option, index) => {
            const selectedOption = option.value === value;
            const showGroup = Boolean(option.group && option.group !== visibleOptions[index - 1]?.group);
            return (
              <div key={`${option.group ?? "ungrouped"}:${option.value}`} role="presentation">
                {showGroup ? (
                  <div className="ui-themed-select-group" role="presentation">
                    {option.group}
                  </div>
                ) : null}
                <button
                  type="button"
                  className={`ui-themed-select-option ${option.group ? "ui-themed-select-option-grouped" : ""} ${isSop ? "ui-themed-select-option-sop" : ""}`}
                  role="option"
                  aria-selected={selectedOption}
                  disabled={option.disabled}
                  onClick={() => commit(option.value)}
                >
                  <span
                    className="ui-themed-select-option-content"
                    title={option.description ? `${option.label} — ${option.description}` : option.label}
                  >
                    <span className="ui-themed-select-option-label">{option.label}</span>
                    {option.description ? (
                      <span className="ui-themed-select-option-description">{option.description}</span>
                    ) : null}
                  </span>
                  {selectedOption ? <Check size={13} className="ui-themed-select-check" aria-hidden="true" /> : null}
                </button>
              </div>
            );
          })}
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
