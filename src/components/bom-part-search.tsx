"use client";

import { Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";

import { detectBomFieldColumns, type MasterBom } from "@/domain/master-bom";

export type BomPartSelection = {
  partNumber: string;
  description: string;
  quantity: number;
};

type DropdownPosition = {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
};

export function BomPartSearch({
  masterBom,
  onSelect,
  compact = false,
}: {
  masterBom: MasterBom;
  onSelect: (entry: BomPartSelection) => void;
  compact?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState<DropdownPosition | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const fields = useMemo(() => detectBomFieldColumns(masterBom.columns), [masterBom.columns]);

  const entries = useMemo<BomPartSelection[]>(() => {
    return masterBom.rows
      .map((row) => {
        const partNumber = (fields.partNumber ? row[fields.partNumber] : "")?.trim() ?? "";
        const description = (fields.description ? row[fields.description] : "")?.trim() ?? "";
        const quantityValue = fields.quantity ? Number.parseFloat(row[fields.quantity] ?? "") : Number.NaN;
        return {
          partNumber,
          description,
          quantity: Number.isFinite(quantityValue) ? quantityValue : 1,
        };
      })
      .filter((entry) => entry.partNumber);
  }, [masterBom.rows, fields]);

  const results = useMemo<BomPartSelection[]>(() => {
    const q = query.trim().toLowerCase();
    return q
      ? entries.filter(
          (entry) => entry.partNumber.toLowerCase().includes(q) || entry.description.toLowerCase().includes(q),
        )
      : entries;
  }, [entries, query]);

  function updatePosition() {
    const el = wrapRef.current;
    if (!el) {
      return;
    }
    const rect = el.getBoundingClientRect();
    const margin = 4;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const openUp = spaceBelow < 240 && spaceAbove > spaceBelow;
    const maxHeight = Math.max(140, Math.min(280, (openUp ? spaceAbove : spaceBelow) - 12));
    setPosition({
      left: rect.left,
      width: rect.width,
      top: openUp ? undefined : rect.bottom + margin,
      bottom: openUp ? window.innerHeight - rect.top + margin : undefined,
      maxHeight,
    });
  }

  // Keep the portal aligned to the input as the page/containers scroll or resize.
  useEffect(() => {
    if (!open) {
      return;
    }
    updatePosition();
    const handle = () => updatePosition();
    window.addEventListener("scroll", handle, true);
    window.addEventListener("resize", handle);
    return () => {
      window.removeEventListener("scroll", handle, true);
      window.removeEventListener("resize", handle);
    };
  }, [open, results.length]);

  // Close when clicking outside the input or the portal list.
  useEffect(() => {
    if (!open) {
      return;
    }
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (wrapRef.current?.contains(target) || listRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [open]);

  function choose(entry: BomPartSelection | undefined) {
    if (!entry) {
      return;
    }
    onSelect(entry);
    setQuery("");
    setOpen(false);
    setActiveIndex(0);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => Math.min(index + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      if (open && results.length > 0) {
        event.preventDefault();
        choose(results[activeIndex]);
      }
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  const dropdown =
    open && position
      ? createPortal(
          <div
            ref={listRef}
            data-bom-part-search-dropdown="true"
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
            {results.length > 0 ? (
              <ul id={listId}>
                {results.map((entry, index) => (
                  <li key={`${entry.partNumber}-${index}`}>
                    <button
                      type="button"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        choose(entry);
                      }}
                      onMouseEnter={() => setActiveIndex(index)}
                      className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs ${
                        index === activeIndex ? "bg-surface-raised" : ""
                      }`}
                    >
                      <span className="ui-mono-label shrink-0 text-ink">{entry.partNumber}</span>
                      <span className="min-w-0 flex-1 truncate text-ink-secondary" title={entry.description}>
                        {entry.description}
                      </span>
                      <span className="shrink-0 text-[10px] text-ink-tertiary">Qty {entry.quantity}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="px-2.5 py-2 text-xs text-ink-tertiary">No BOM match for “{query.trim()}”.</div>
            )}
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={wrapRef} className="relative">
      <div className="flex items-center gap-1.5 border-b border-line focus-within:border-accent">
        <Search size={compact ? 12 : 13} className="shrink-0 text-ink-tertiary" />
        <input
          className={`min-w-0 flex-1 bg-transparent text-xs font-semibold text-ink outline-none ${compact ? "h-7" : "h-8"}`}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setActiveIndex(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Search master BOM…"
          aria-label="Search master BOM"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
        />
      </div>
      {dropdown}
    </div>
  );
}
