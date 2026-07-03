"use client";

import { CheckSquare, Square, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ThemedSelect } from "@/components/themed-select";
import type { Task, Zone } from "@/domain/types";

const UNZONED = "__unzoned__";

/**
 * Bulk operations over the scenario's tasks: multi-select (with per-zone select-all),
 * move to a zone, or delete. Mutations run through the parent's existing handlers, so
 * scheduling side-effects, confirmation, and the undo stack all apply unchanged.
 */
export function BulkTaskEditor({
  open,
  onClose,
  tasks,
  zones,
  taskCode,
  onMoveToZone,
  onDelete,
}: {
  open: boolean;
  onClose: () => void;
  tasks: Task[];
  zones: Zone[];
  taskCode: (task: Task) => string;
  onMoveToZone: (taskIds: string[], zoneId?: string) => void;
  onDelete: (taskIds: string[]) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [targetZoneId, setTargetZoneId] = useState<string>(UNZONED);

  useEffect(() => {
    if (open) {
      setSelected(new Set());
      setQuery("");
    }
  }, [open]);

  const zoneGroups = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const visibleTasks = normalized
      ? tasks.filter(
          (task) =>
            task.name.toLowerCase().includes(normalized) || taskCode(task).toLowerCase().includes(normalized),
        )
      : tasks;

    const byZone = new Map<string, Task[]>();
    visibleTasks.forEach((task) => {
      const key = task.zoneId ?? UNZONED;
      byZone.set(key, [...(byZone.get(key) ?? []), task]);
    });

    const orderedZones: Array<{ id: string; name: string; tasks: Task[] }> = zones
      .map((zone) => ({ id: zone.id, name: zone.name, tasks: byZone.get(zone.id) ?? [] }))
      .filter((group) => group.tasks.length > 0);
    const unzoned = byZone.get(UNZONED);
    if (unzoned?.length) {
      orderedZones.push({ id: UNZONED, name: "Unzoned", tasks: unzoned });
    }
    return orderedZones;
  }, [tasks, zones, query, taskCode]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  function toggleTask(taskId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  }

  function toggleZone(zoneTasks: Task[]) {
    setSelected((current) => {
      const next = new Set(current);
      const allSelected = zoneTasks.every((task) => next.has(task.id));
      zoneTasks.forEach((task) => {
        if (allSelected) {
          next.delete(task.id);
        } else {
          next.add(task.id);
        }
      });
      return next;
    });
  }

  const selectedIds = [...selected];
  const zoneOptions = [
    ...zones.map((zone) => ({ value: zone.id, label: zone.name })),
    { value: UNZONED, label: "Unzoned" },
  ];

  function applyMove() {
    if (!selectedIds.length) return;
    onMoveToZone(selectedIds, targetZoneId === UNZONED ? undefined : targetZoneId);
    setSelected(new Set());
  }

  function applyDelete() {
    if (!selectedIds.length) return;
    // Close first: the parent's confirmation dialog owns the screen from here.
    onClose();
    onDelete(selectedIds);
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[110] flex items-start justify-center bg-black/40 px-4 pt-[10vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Bulk edit tasks"
    >
      <div className="flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-line bg-surface text-ink shadow-2xl">
        <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
          <span className="text-[13px] font-medium">Bulk edit tasks</span>
          <input
            className="ml-2 w-full bg-transparent text-[13px] outline-none placeholder:text-ink-tertiary"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter tasks…"
            spellCheck={false}
          />
          <button type="button" className="ui-btn-ghost h-7 w-7 shrink-0 px-0" onClick={onClose} title="Close">
            <X size={14} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {zoneGroups.length ? (
            zoneGroups.map((group) => {
              const allSelected = group.tasks.every((task) => selected.has(task.id));
              return (
                <div key={group.id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-4 pb-1 pt-2.5 text-left text-[10px] font-medium uppercase tracking-wider text-ink-tertiary hover:text-ink-secondary"
                    onClick={() => toggleZone(group.tasks)}
                    title={allSelected ? "Deselect all in this zone" : "Select all in this zone"}
                  >
                    {allSelected ? <CheckSquare size={12} /> : <Square size={12} />}
                    {group.name}
                    <span className="normal-case tracking-normal">· {group.tasks.length}</span>
                  </button>
                  {group.tasks.map((task) => {
                    const checked = selected.has(task.id);
                    return (
                      <button
                        key={task.id}
                        type="button"
                        className={`flex w-full items-center gap-2.5 px-4 py-1.5 text-left text-[13px] transition-colors ${
                          checked ? "bg-surface-active" : "hover:bg-surface-hover"
                        }`}
                        onClick={() => toggleTask(task.id)}
                      >
                        {checked ? (
                          <CheckSquare size={14} className="shrink-0 text-ink-secondary" />
                        ) : (
                          <Square size={14} className="shrink-0 text-ink-tertiary" />
                        )}
                        <span className="min-w-0 truncate">{task.name}</span>
                        <span className="ml-auto shrink-0 font-mono text-[11px] text-ink-tertiary">
                          {taskCode(task)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })
          ) : (
            <div className="px-4 py-6 text-center text-[13px] text-ink-tertiary">No tasks match.</div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
          <span className="text-[12px] text-ink-secondary">
            {selectedIds.length} selected
          </span>
          <div className="ml-auto flex items-center gap-2">
            <ThemedSelect
              triggerClassName="h-9 px-3"
              value={targetZoneId}
              options={zoneOptions}
              onChange={setTargetZoneId}
              ariaLabel="Target zone"
            />
            <button
              type="button"
              className="ui-btn-ghost h-9 px-3 disabled:opacity-50"
              onClick={applyMove}
              disabled={!selectedIds.length}
            >
              Move to zone
            </button>
            <button
              type="button"
              className="ui-btn-ghost h-9 gap-1.5 px-3 text-danger disabled:opacity-50"
              onClick={applyDelete}
              disabled={!selectedIds.length}
            >
              <Trash2 size={13} />
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
