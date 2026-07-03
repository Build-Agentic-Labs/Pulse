"use client";

import { CornerDownLeft, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type CommandPaletteItem = {
  id: string;
  label: string;
  // Right-aligned secondary text (e.g. "Scenario", a WBS code, a shortcut hint).
  hint?: string;
  // Extra text matched by the search but not displayed.
  keywords?: string;
  action: () => void;
};

export type CommandPaletteGroup = {
  label: string;
  items: CommandPaletteItem[];
  // Hide the group until the user types — for large corpora (steps, parts) that
  // would otherwise drown the default view.
  searchOnly?: boolean;
};

const MAX_ITEMS_PER_GROUP = 6;
const MAX_TOTAL_ITEMS = 24;

type FlatItem = CommandPaletteItem & { groupLabel: string };

function scoreItem(item: CommandPaletteItem, query: string): number {
  const label = item.label.toLowerCase();
  if (label.startsWith(query)) return 0;
  if (label.includes(query)) return 1;
  if (item.keywords?.toLowerCase().includes(query)) return 2;
  if (item.hint?.toLowerCase().includes(query)) return 3;
  return -1;
}

/**
 * App-wide Cmd+K palette. Purely presentational: the host supplies groups of items
 * with actions; this component handles search, keyboard navigation, and dismissal.
 */
export function CommandPalette({
  open,
  onClose,
  groups,
  placeholder = "Jump to a module, task, scenario, project…",
}: {
  open: boolean;
  onClose: () => void;
  groups: CommandPaletteGroup[];
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [highlightIndex, setHighlightIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setHighlightIndex(0);
      // Focus after the portal paints.
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const flatItems = useMemo<FlatItem[]>(() => {
    const normalized = query.trim().toLowerCase();
    const result: FlatItem[] = [];

    for (const group of groups) {
      if (group.searchOnly && !normalized) {
        continue;
      }
      const matches = normalized
        ? group.items
            .map((item) => ({ item, score: scoreItem(item, normalized) }))
            .filter((entry) => entry.score >= 0)
            .sort((left, right) => left.score - right.score)
            .map((entry) => entry.item)
        : group.items;

      for (const item of matches.slice(0, MAX_ITEMS_PER_GROUP)) {
        result.push({ ...item, groupLabel: group.label });
        if (result.length >= MAX_TOTAL_ITEMS) {
          return result;
        }
      }
    }

    return result;
  }, [groups, query]);

  useEffect(() => {
    setHighlightIndex(0);
  }, [query]);

  useEffect(() => {
    // Keep the highlighted row visible while arrowing through results.
    const container = listRef.current;
    const target = container?.querySelector<HTMLElement>(`[data-palette-index="${highlightIndex}"]`);
    target?.scrollIntoView({ block: "nearest" });
  }, [highlightIndex]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  function runItem(item: FlatItem | undefined) {
    if (!item) return;
    onClose();
    item.action();
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightIndex((index) => Math.min(index + 1, flatItems.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      runItem(flatItems[highlightIndex]);
    }
  }

  let lastGroupLabel = "";

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-start justify-center bg-black/40 px-4 pt-[12vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div className="w-full max-w-xl overflow-hidden rounded-xl border border-line bg-surface text-ink shadow-2xl">
        <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
          <Search size={15} className="shrink-0 text-ink-tertiary" />
          <input
            ref={inputRef}
            className="w-full bg-transparent text-[14px] outline-none placeholder:text-ink-tertiary"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            spellCheck={false}
          />
          <kbd className="ui-chip shrink-0 font-mono text-[10px]">Esc</kbd>
        </div>

        <div ref={listRef} className="max-h-[46vh] overflow-y-auto py-1.5">
          {flatItems.length ? (
            flatItems.map((item, index) => {
              const showGroupHeader = item.groupLabel !== lastGroupLabel;
              lastGroupLabel = item.groupLabel;
              const highlighted = index === highlightIndex;
              return (
                <div key={`${item.groupLabel}:${item.id}`}>
                  {showGroupHeader ? (
                    <div className="px-4 pb-1 pt-2.5 text-[10px] font-medium uppercase tracking-wider text-ink-tertiary">
                      {item.groupLabel}
                    </div>
                  ) : null}
                  <button
                    type="button"
                    data-palette-index={index}
                    className={`flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-[13px] transition-colors ${
                      highlighted ? "bg-surface-active" : "hover:bg-surface-hover"
                    }`}
                    onMouseEnter={() => setHighlightIndex(index)}
                    onClick={() => runItem(item)}
                  >
                    <span className="min-w-0 truncate">{item.label}</span>
                    <span className="flex shrink-0 items-center gap-2 text-[11px] text-ink-tertiary">
                      {item.hint ? <span className="truncate">{item.hint}</span> : null}
                      {highlighted ? <CornerDownLeft size={12} aria-hidden="true" /> : null}
                    </span>
                  </button>
                </div>
              );
            })
          ) : (
            <div className="px-4 py-6 text-center text-[13px] text-ink-tertiary">No matches.</div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
