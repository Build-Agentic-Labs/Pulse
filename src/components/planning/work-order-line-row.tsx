"use client";

import { Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { ThemedSelect, type ThemedSelectOption } from "@/components/themed-select";
import { lineNeedsAssemblyNo, type WorkOrderFulfillment } from "@/domain/work-orders";
import { searchItems, type WorkOrderLine } from "@/lib/planning/store";

const FULFILLMENT_LABELS: Record<WorkOrderFulfillment, string> = {
  assembly: "Assembly",
  pull_from: "Pull from",
  pull_from_stock: "Pull from stock",
};

const FULFILLMENT_OPTIONS: ThemedSelectOption[] = (Object.keys(FULFILLMENT_LABELS) as WorkOrderFulfillment[]).map(
  (value) => ({ value, label: FULFILLMENT_LABELS[value] }),
);

/** Item-no autocomplete waits this long after the last keystroke before searching. */
const ITEM_SEARCH_DEBOUNCE_MS = 250;
const ITEM_SEARCH_LIMIT = 8;

type ItemSuggestion = { itemNo: string; description: string };

export type WorkOrderLineRowProps = {
  line: WorkOrderLine;
  workspaceId: string;
  canWrite: boolean;
  /** Shipped qty is only ever entered once production has started. */
  canEditShippedQty: boolean;
  /** Persists one or more fields for this line; the parent owns optimistic update + rollback + error surfacing. */
  onFieldSave: (lineId: string, patch: Partial<Omit<WorkOrderLine, "id">>) => void;
  /** Parent owns the confirm dialog and the actual delete, so every row shares one confirm flow. */
  onDelete: (line: WorkOrderLine) => void;
};

/**
 * One editable row of a work order's line table. Every text/number field is locally buffered and
 * persisted on blur (via `onFieldSave`); the fulfillment select and the item-no autocomplete pick
 * persist immediately since they're discrete selections, not free text. Each buffer re-syncs from
 * its own `line.<field>` prop independently (see the per-field effects below) so a sibling field's
 * commit on this same row -- which produces a new `line` object from the parent -- can never wipe
 * out an unrelated field's uncommitted keystrokes.
 */
export function WorkOrderLineRow({
  line,
  workspaceId,
  canWrite,
  canEditShippedQty,
  onFieldSave,
  onDelete,
}: WorkOrderLineRowProps) {
  const [itemNo, setItemNo] = useState(line.itemNo);
  const [description, setDescription] = useState(line.description);
  const [buildQty, setBuildQty] = useState(String(line.buildQty));
  const [shippedQty, setShippedQty] = useState(line.shippedQty === null ? "" : String(line.shippedQty));
  const [fulfillment, setFulfillment] = useState<WorkOrderFulfillment>(line.fulfillment);
  const [assemblyOrPull, setAssemblyOrPull] = useState(
    line.fulfillment === "assembly" ? line.assemblyOrderNo : line.pullFromRef,
  );

  const [suggestions, setSuggestions] = useState<ItemSuggestion[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const suggestionsListId = useId();

  // Stale-response guard for the debounced search, same idiom as work-order-board.tsx's
  // loadSeqRef: only the most recent search may commit its results.
  const searchSeqRef = useRef(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => setItemNo(line.itemNo), [line.itemNo]);
  useEffect(() => setDescription(line.description), [line.description]);
  useEffect(() => setBuildQty(String(line.buildQty)), [line.buildQty]);
  useEffect(() => setShippedQty(line.shippedQty === null ? "" : String(line.shippedQty)), [line.shippedQty]);
  useEffect(() => setFulfillment(line.fulfillment), [line.fulfillment]);
  useEffect(() => {
    setAssemblyOrPull(line.fulfillment === "assembly" ? line.assemblyOrderNo : line.pullFromRef);
  }, [line.fulfillment, line.assemblyOrderNo, line.pullFromRef]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      // Invalidate any in-flight search when this row unmounts (line deleted, order reloaded).
      searchSeqRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!suggestionsOpen) {
      return;
    }
    function handlePointerDown(event: PointerEvent) {
      if (rootRef.current?.contains(event.target as Node)) {
        return;
      }
      setSuggestionsOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [suggestionsOpen]);

  function handleItemNoChange(value: string) {
    setItemNo(value);
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    const trimmed = value.trim();
    if (trimmed === "") {
      // Invalidate any in-flight search too -- a slow response arriving after the clear
      // must not reopen the dropdown over an empty field.
      searchSeqRef.current += 1;
      setSuggestions([]);
      setSuggestionsOpen(false);
      return;
    }
    debounceTimerRef.current = setTimeout(() => {
      const seq = ++searchSeqRef.current;
      searchItems(workspaceId, trimmed, ITEM_SEARCH_LIMIT)
        .then((results) => {
          if (seq !== searchSeqRef.current) return;
          setSuggestions(results);
          setSuggestionsOpen(results.length > 0);
        })
        .catch(() => {
          if (seq !== searchSeqRef.current) return;
          setSuggestions([]);
          setSuggestionsOpen(false);
        });
    }, ITEM_SEARCH_DEBOUNCE_MS);
  }

  /** Stop any scheduled or in-flight search so a late response can't reopen the dropdown. */
  function cancelPendingSearch() {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    searchSeqRef.current += 1;
  }

  function pickSuggestion(suggestion: ItemSuggestion) {
    cancelPendingSearch();
    setItemNo(suggestion.itemNo);
    setDescription(suggestion.description);
    setSuggestionsOpen(false);
    setSuggestions([]);
    onFieldSave(line.id, { itemNo: suggestion.itemNo, description: suggestion.description });
  }

  function handleItemNoBlur() {
    cancelPendingSearch();
    setSuggestionsOpen(false);
    const trimmed = itemNo.trim();
    if (trimmed !== line.itemNo) {
      onFieldSave(line.id, { itemNo: trimmed });
    }
  }

  function handleDescriptionBlur() {
    if (description !== line.description) {
      onFieldSave(line.id, { description });
    }
  }

  function handleBuildQtyBlur() {
    const parsed = Number(buildQty);
    // Clamp at zero: `min={0}` on the input is advisory only and doesn't stop typed negatives.
    const next = Number.isFinite(parsed) ? Math.max(0, parsed) : line.buildQty;
    setBuildQty(String(next));
    if (next !== line.buildQty) {
      onFieldSave(line.id, { buildQty: next });
    }
  }

  function handleShippedQtyBlur() {
    if (shippedQty.trim() === "") {
      if (line.shippedQty !== null) {
        onFieldSave(line.id, { shippedQty: null });
      }
      return;
    }
    const parsed = Number(shippedQty);
    // Clamp at zero, same as build qty -- the input's `min={0}` doesn't stop typed negatives.
    const next = Number.isFinite(parsed) ? Math.max(0, parsed) : line.shippedQty;
    setShippedQty(next === null ? "" : String(next));
    if (next !== line.shippedQty) {
      onFieldSave(line.id, { shippedQty: next });
    }
  }

  function handleFulfillmentChange(value: string) {
    const next = value as WorkOrderFulfillment;
    setFulfillment(next);
    onFieldSave(line.id, { fulfillment: next });
  }

  function handleAssemblyOrPullBlur() {
    const trimmed = assemblyOrPull.trim();
    if (fulfillment === "assembly") {
      if (trimmed !== line.assemblyOrderNo) {
        onFieldSave(line.id, { assemblyOrderNo: trimmed });
      }
      return;
    }
    if (trimmed !== line.pullFromRef) {
      onFieldSave(line.id, { pullFromRef: trimmed });
    }
  }

  const needsAssemblyNo = lineNeedsAssemblyNo(line);
  const shippedQtyEnabled = canWrite && canEditShippedQty;

  if (!canWrite) {
    return (
      <tr className="border-b border-line/60 last:border-b-0">
        <td className="px-3 py-2.5 font-mono text-ink">{line.itemNo}</td>
        <td className="px-3 py-2.5 text-ink">{line.description}</td>
        <td className="whitespace-nowrap px-3 py-2.5 text-ink-secondary">{line.buildQty}</td>
        <td className="whitespace-nowrap px-3 py-2.5 text-ink-secondary">{FULFILLMENT_LABELS[line.fulfillment]}</td>
        <td className={`whitespace-nowrap px-3 py-2.5 ${needsAssemblyNo ? "text-danger" : "text-ink-secondary"}`}>
          {line.fulfillment === "assembly" ? line.assemblyOrderNo || "—" : line.pullFromRef || "—"}
        </td>
        <td className="whitespace-nowrap px-3 py-2.5 text-ink-secondary">{line.shippedQty ?? "—"}</td>
        <td className="px-3 py-2.5" aria-hidden="true" />
      </tr>
    );
  }

  return (
    <tr className="border-b border-line/60 align-top last:border-b-0">
      <td className="px-3 py-2">
        <div ref={rootRef} className="relative">
          <input
            type="text"
            className="ui-input"
            value={itemNo}
            onChange={(event) => handleItemNoChange(event.target.value)}
            onBlur={handleItemNoBlur}
            onFocus={() => suggestions.length > 0 && setSuggestionsOpen(true)}
            placeholder="Item no."
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={suggestionsOpen}
            aria-controls={suggestionsListId}
          />
          {suggestionsOpen && suggestions.length > 0 ? (
            <div
              id={suggestionsListId}
              role="listbox"
              className="absolute left-0 top-full z-20 mt-1 max-h-56 w-64 overflow-y-auto rounded-md border border-line bg-surface shadow-lg"
            >
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion.itemNo}
                  type="button"
                  role="option"
                  aria-selected={false}
                  className="flex w-full flex-col items-start gap-0 px-3 py-2 text-left transition-colors hover:bg-surface-hover"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => pickSuggestion(suggestion)}
                >
                  <span className="font-mono text-sm text-ink">{suggestion.itemNo}</span>
                  <span className="ui-mono-label truncate text-ink-tertiary">{suggestion.description}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </td>
      <td className="px-3 py-2">
        <input
          type="text"
          className="ui-input"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          onBlur={handleDescriptionBlur}
        />
      </td>
      <td className="w-24 px-3 py-2">
        <input
          type="number"
          className="ui-input"
          value={buildQty}
          onChange={(event) => setBuildQty(event.target.value)}
          onBlur={handleBuildQtyBlur}
          min={0}
        />
      </td>
      <td className="w-40 px-3 py-2">
        <ThemedSelect
          value={fulfillment}
          onChange={handleFulfillmentChange}
          options={FULFILLMENT_OPTIONS}
          ariaLabel="Fulfillment"
          className="w-full"
        />
      </td>
      <td className="w-40 px-3 py-2">
        <input
          type="text"
          className={`ui-input ${needsAssemblyNo ? "border-danger" : ""}`}
          value={assemblyOrPull}
          onChange={(event) => setAssemblyOrPull(event.target.value)}
          onBlur={handleAssemblyOrPullBlur}
          placeholder={fulfillment === "assembly" ? "A# …" : "Pull ref …"}
        />
      </td>
      <td className="w-24 px-3 py-2">
        <input
          type="number"
          className="ui-input disabled:cursor-not-allowed disabled:opacity-40"
          value={shippedQty}
          onChange={(event) => setShippedQty(event.target.value)}
          onBlur={handleShippedQtyBlur}
          disabled={!shippedQtyEnabled}
          min={0}
        />
      </td>
      <td className="px-3 py-2">
        <button
          type="button"
          className="ui-btn-ghost h-8 w-8 shrink-0 px-0 text-ink-tertiary hover:text-danger"
          title="Delete line"
          aria-label="Delete line"
          onClick={() => onDelete(line)}
        >
          <Trash2 size={13} />
        </button>
      </td>
    </tr>
  );
}
