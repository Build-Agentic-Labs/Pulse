"use client";

import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Sop } from "@/domain/sop/schema";
import { searchSop, type SopSearchResult } from "@/lib/sop/search";

export function SopSearch({
  sop,
  disabled = false,
  onNavigate,
  onClose,
}: {
  sop: Sop;
  disabled?: boolean;
  onNavigate: (result: SopSearchResult, query: string, resultIndexInStep: number) => void;
  onClose?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const results = useMemo(() => searchSop(sop, query), [query, sop]);
  const activeResult = results[activeIndex];

  const openSearch = useCallback(() => {
    if (disabled) return;
    setOpen(true);
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [disabled]);

  const closeSearch = useCallback(() => {
    setOpen(false);
    onClose?.();
  }, [onClose]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (disabled) return;
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLocaleLowerCase() === "f") {
        event.preventDefault();
        openSearch();
        return;
      }
      if (open && event.key === "Escape") {
        event.preventDefault();
        closeSearch();
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [closeSearch, disabled, open, openSearch]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (disabled) closeSearch();
  }, [closeSearch, disabled]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (!open || !activeResult) return;
    const indexInStep = results
      .slice(0, activeIndex)
      .filter((result) => result.stepId === activeResult.stepId).length;
    onNavigate(activeResult, query.trim(), indexInStep);
  }, [activeIndex, activeResult, onNavigate, open, query, results]);

  function move(direction: -1 | 1) {
    if (!results.length) return;
    setActiveIndex((current) => (current + direction + results.length) % results.length);
  }

  return (
    <>
      <button
        type="button"
        className="ui-btn-ghost h-9 w-9 px-0"
        onClick={openSearch}
        disabled={disabled}
        title="Search this SOP (Ctrl/⌘ F)"
        aria-label="Search this SOP"
        aria-expanded={open}
      >
        <Search size={15} />
      </button>

      {open ? (
        <div
          role="search"
          aria-label="Search this SOP"
          className="fixed right-4 top-14 z-[80] w-[min(28rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-line bg-surface-raised shadow-xl"
        >
          <div className="flex items-center gap-1.5 p-2">
            <Search size={14} className="ml-1 shrink-0 text-ink-tertiary" aria-hidden />
            <input
              ref={inputRef}
              className="h-8 min-w-0 flex-1 bg-transparent px-1 text-sm text-ink outline-none placeholder:text-ink-tertiary"
              aria-label="Search keyword"
              placeholder="Search this SOP"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  move(event.shiftKey ? -1 : 1);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  closeSearch();
                }
              }}
            />
            <span className="min-w-14 text-center text-[11px] tabular-nums text-ink-tertiary" aria-live="polite">
              {query.trim()
                ? results.length
                  ? `${activeIndex + 1} of ${results.length}`
                  : "No matches"
                : "0 matches"}
            </span>
            <button
              type="button"
              className="ui-btn-ghost h-8 w-8 px-0"
              onClick={() => move(-1)}
              disabled={!results.length}
              title="Previous match (Shift+Enter)"
              aria-label="Previous match"
            >
              <ChevronUp size={14} />
            </button>
            <button
              type="button"
              className="ui-btn-ghost h-8 w-8 px-0"
              onClick={() => move(1)}
              disabled={!results.length}
              title="Next match (Enter)"
              aria-label="Next match"
            >
              <ChevronDown size={14} />
            </button>
            <button
              type="button"
              className="ui-btn-ghost h-8 w-8 px-0"
              onClick={closeSearch}
              title="Close (Escape)"
              aria-label="Close search"
            >
              <X size={14} />
            </button>
          </div>
          {query.trim() && activeResult ? (
            <div className="border-t border-line px-3 py-2 text-xs text-ink-secondary">
              <span className="font-medium text-ink">{activeResult.section}</span>
              <span className="mx-1.5 text-ink-tertiary">·</span>
              <span>{activeResult.label}</span>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
