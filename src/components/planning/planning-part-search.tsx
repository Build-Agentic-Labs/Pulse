"use client";

import { Loader2, Search } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { searchItems } from "@/lib/planning/store";

/**
 * Typeahead over `planning_item_master` — the Business Central item master imported in Planning
 * settings — for picking BOM parts on a product configuration.
 *
 * Deliberately NOT `BomPartSearch`: that component searches the Product space's `MasterBom` via
 * `detectBomFieldColumns`, a different catalog with a different shape. Sharing it would couple
 * two unrelated part sources through one component's props.
 */

export interface PartSelection {
  itemNo: string;
  description: string;
}

const DEBOUNCE_MS = 200;
const MAX_RESULTS = 12;

export function PlanningPartSearch({
  workspaceId,
  disabled = false,
  onSelect,
}: {
  workspaceId: string;
  disabled?: boolean;
  onSelect: (part: PartSelection) => void;
}) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PartSelection[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Debounced search. `cancelled` guards against an out-of-order response overwriting a newer
  // one — the shorter query often resolves last.
  useEffect(() => {
    const term = query.trim();
    if (!workspaceId || term.length < 2) {
      setResults([]);
      setBusy(false);
      return;
    }

    let cancelled = false;
    setBusy(true);
    const timer = setTimeout(() => {
      searchItems(workspaceId, term, MAX_RESULTS)
        .then((items) => {
          if (cancelled) return;
          setResults(items);
          setHighlighted(0);
          setOpen(true);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        })
        .finally(() => {
          if (!cancelled) setBusy(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, workspaceId]);

  // Close on outside click so the dropdown never strands over the rest of the editor.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function choose(part: PartSelection) {
    onSelect(part);
    setQuery("");
    setResults([]);
    setOpen(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!open || results.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlighted((current) => (current + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlighted((current) => (current - 1 + results.length) % results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const part = results[highlighted];
      if (part) choose(part);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} className="planning-part-search relative">
      <div className="relative">
        <Search
          size={14}
          strokeWidth={1.75}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-tertiary"
          aria-hidden="true"
        />
        <input
          className="ui-input w-full pl-8"
          value={query}
          disabled={disabled}
          placeholder="Search the item master to add a part…"
          aria-label="Search the item master"
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded={open}
          role="combobox"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => results.length > 0 && setOpen(true)}
        />
        {busy ? (
          <Loader2
            size={14}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-ink-tertiary"
            aria-hidden="true"
          />
        ) : null}
      </div>

      {open && results.length > 0 ? (
        <ul id={listId} role="listbox" className="planning-part-search-menu">
          {results.map((part, index) => (
            <li key={part.itemNo} role="option" aria-selected={index === highlighted}>
              <button
                type="button"
                className={`planning-part-search-option ${index === highlighted ? "is-highlighted" : ""}`}
                onMouseEnter={() => setHighlighted(index)}
                onClick={() => choose(part)}
              >
                <span className="font-mono text-[12px] text-ink">{part.itemNo}</span>
                <span className="truncate text-[12px] text-ink-secondary">{part.description}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
