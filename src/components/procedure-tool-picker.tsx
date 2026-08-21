"use client";

import { Plus, Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";

import { canonicalToolKey, formatToolName } from "@/domain/tool-name-format";

type DropdownPosition = {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
};

type ToolOption = {
  name: string;
  custom: boolean;
};

export function ProcedureToolPicker({
  value,
  toolLibrary,
  assignedTools,
  stepSequence,
  compact = false,
  onValueChange,
  onAdd,
}: {
  value: string;
  toolLibrary: string[];
  assignedTools: string[];
  stepSequence: number;
  compact?: boolean;
  onValueChange: (value: string) => void;
  onAdd: (toolName: string) => void;
}) {
  const listId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState<DropdownPosition | null>(null);

  const typedTool = formatToolName(value);
  const assignedKeys = useMemo(() => new Set(assignedTools.map(canonicalToolKey)), [assignedTools]);
  const availableTools = useMemo(() => {
    const toolsByKey = new Map<string, string>();
    toolLibrary.forEach((tool) => {
      const name = formatToolName(tool);
      const key = canonicalToolKey(name);
      if (key && !assignedKeys.has(key) && !toolsByKey.has(key)) {
        toolsByKey.set(key, name);
      }
    });
    return [...toolsByKey.values()].sort((left, right) =>
      left.localeCompare(right, undefined, { sensitivity: "base" }),
    );
  }, [assignedKeys, toolLibrary]);
  const typedKey = canonicalToolKey(typedTool);
  const matchingTools = useMemo(
    () => (typedKey ? availableTools.filter((tool) => canonicalToolKey(tool).includes(typedKey)) : availableTools),
    [availableTools, typedKey],
  );
  const exactMatch = useMemo(
    () => availableTools.find((tool) => canonicalToolKey(tool) === typedKey),
    [availableTools, typedKey],
  );
  const options = useMemo<ToolOption[]>(
    () => [
      ...matchingTools.map((name) => ({ name, custom: false })),
      ...(typedTool && !exactMatch ? [{ name: typedTool, custom: true }] : []),
    ],
    [exactMatch, matchingTools, typedTool],
  );

  function updatePosition() {
    const wrap = wrapRef.current;
    if (!wrap) {
      return;
    }

    const rect = wrap.getBoundingClientRect();
    const margin = 4;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const openUp = spaceBelow < 220 && spaceAbove > spaceBelow;
    const maxHeight = Math.max(128, Math.min(260, (openUp ? spaceAbove : spaceBelow) - 12));
    setPosition({
      left: rect.left,
      width: rect.width,
      top: openUp ? undefined : rect.bottom + margin,
      bottom: openUp ? window.innerHeight - rect.top + margin : undefined,
      maxHeight,
    });
  }

  useEffect(() => {
    if (!open) {
      return;
    }

    updatePosition();
    const handlePositionChange = () => updatePosition();
    window.addEventListener("scroll", handlePositionChange, true);
    window.addEventListener("resize", handlePositionChange);
    return () => {
      window.removeEventListener("scroll", handlePositionChange, true);
      window.removeEventListener("resize", handlePositionChange);
    };
  }, [open, options.length]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (target && !wrapRef.current?.contains(target) && !listRef.current?.contains(target)) {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [open]);

  function choose(option: ToolOption | undefined) {
    if (!option) {
      return;
    }

    onAdd(option.name);
    onValueChange("");
    setOpen(false);
    setActiveIndex(0);
  }

  function commitTypedTool() {
    if (!typedTool) {
      return;
    }
    choose({ name: exactMatch ?? typedTool, custom: !exactMatch });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => (open ? Math.min(index + 1, Math.max(options.length - 1, 0)) : 0));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (open && options.length > 0) {
        choose(options[Math.min(activeIndex, options.length - 1)]);
      } else {
        commitTypedTool();
      }
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  const dropdown =
    open && position && options.length > 0
      ? createPortal(
          <div
            ref={listRef}
            style={{
              position: "fixed",
              left: position.left,
              top: position.top,
              bottom: position.bottom,
              width: position.width,
              maxHeight: position.maxHeight,
              zIndex: 60,
            }}
            className="overflow-y-auto overscroll-contain rounded-md border border-line bg-surface shadow-lg"
          >
            <ul id={listId} role="listbox" aria-label={`Available tools for step ${stepSequence}`}>
              {options.map((option, index) => (
                <li key={`${option.custom ? "custom" : "library"}-${canonicalToolKey(option.name)}`}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={index === activeIndex}
                    className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs ${
                      index === activeIndex ? "bg-surface-raised" : ""
                    }`}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      choose(option);
                    }}
                    onMouseEnter={() => setActiveIndex(index)}
                  >
                    {option.custom ? <Plus size={12} className="shrink-0 text-accent" aria-hidden="true" /> : null}
                    <span className="min-w-0 flex-1 truncate font-semibold text-ink">
                      {option.custom ? `Add new tool “${option.name}”` : option.name}
                    </span>
                    {!option.custom ? (
                      <span className="shrink-0 text-[10px] text-ink-tertiary">Library</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </div>,
          document.body,
        )
      : null;

  return (
    <div
      ref={wrapRef}
      className={`relative flex min-w-0 flex-1 items-center gap-1.5 border-b border-line focus-within:border-accent ${
        compact ? "h-7" : "h-8"
      }`}
    >
      <Search size={compact ? 12 : 13} className="shrink-0 text-ink-tertiary" aria-hidden="true" />
      <input
        className={`min-w-0 flex-1 bg-transparent font-semibold text-ink outline-none ${compact ? "text-[11px]" : "text-xs"}`}
        value={value}
        onChange={(event) => {
          onValueChange(event.target.value);
          setOpen(true);
          setActiveIndex(0);
        }}
        onFocus={() => {
          setOpen(true);
          setActiveIndex(0);
        }}
        onKeyDown={handleKeyDown}
        placeholder="Search or add tool…"
        aria-label={`Search or add tool for step ${stepSequence}`}
        aria-autocomplete="list"
        aria-controls={listId}
        aria-expanded={open && options.length > 0}
        role="combobox"
      />
      <button
        type="button"
        onClick={commitTypedTool}
        disabled={!typedTool}
        className={`shrink-0 font-semibold text-ink-secondary hover:text-accent disabled:cursor-default disabled:opacity-35 ${
          compact ? "px-1 text-[9px]" : "px-2 text-[10px]"
        }`}
      >
        {typedTool && !exactMatch ? "Add new" : "Add"}
      </button>
      {dropdown}
    </div>
  );
}
