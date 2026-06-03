"use client";

import { ChevronDown, ChevronUp, Circle, Diamond, Plus, Square, Trash2, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  RASIC_CODES,
  RASIC_LABELS,
  type RasicCode,
  type SopActivity,
  type SopShape,
} from "@/domain/sop/schema";
import { AutoTextarea } from "./auto-textarea";

type Props = {
  roles: string[];
  activities: SopActivity[];
  onChange: (roles: string[], activities: SopActivity[]) => void;
};

// Clicking a RASIC tag advances through R -> A -> S -> I -> C -> cleared -> R.
const RASIC_CYCLE: Array<RasicCode | ""> = [...RASIC_CODES, ""];

// Clicking the shape control cycles through the standard flowchart shapes.
const SHAPE_CYCLE: SopShape[] = ["process", "terminator", "decision"];
const SHAPE_META: Record<SopShape, { label: string; Icon: LucideIcon }> = {
  process: { label: "Process", Icon: Square },
  terminator: { label: "Start / End", Icon: Circle },
  decision: { label: "Decision", Icon: Diamond },
};

// Keep the stored 1-based `step` aligned with array order after any structural edit.
function renumber(activities: SopActivity[]): SopActivity[] {
  return activities.map((activity, index) =>
    activity.step === index + 1 ? activity : { ...activity, step: index + 1 },
  );
}

/**
 * The SOP "Process workflow" editor — a left-to-right process map matching the company
 * template: one row per step, read across as Input | Process step | Output | RASIC. The
 * Process step column is a top-to-bottom flowchart using the standard shapes (terminator
 * pill / process rectangle / decision diamond). A Table view keeps the dense RASIC matrix
 * for fast bulk responsibility entry. Both edit the same `(roles, activities)`.
 */
export function ProcessFlowchart({ roles, activities, onChange }: Props) {
  const [view, setView] = useState<"map" | "table">("map");

  // --- roles (RASIC functions) ---
  function setRole(index: number, value: string) {
    onChange(
      roles.map((role, i) => (i === index ? value : role)),
      activities,
    );
  }
  function addRole() {
    onChange([...roles, ""], activities);
  }
  function removeRole(index: number) {
    const removed = roles[index];
    const nextActivities = activities.map((activity) => {
      const { [removed]: _drop, ...rest } = activity.assignments;
      return { ...activity, assignments: rest };
    });
    onChange(
      roles.filter((_, i) => i !== index),
      nextActivities,
    );
  }

  // --- steps ---
  function addActivity() {
    const id = `act-${Date.now().toString(36)}-${activities.length}`;
    onChange(roles, [
      ...activities,
      { id, step: activities.length + 1, shape: "process", input: "", description: "", output: "", assignments: {} },
    ]);
  }
  function patchActivity(index: number, patch: Partial<SopActivity>) {
    onChange(
      roles,
      activities.map((activity, i) => (i === index ? { ...activity, ...patch } : activity)),
    );
  }
  function removeActivity(index: number) {
    onChange(roles, renumber(activities.filter((_, i) => i !== index)));
  }
  function moveActivity(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= activities.length) return;
    const next = [...activities];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(roles, renumber(next));
  }
  function cycleShape(index: number) {
    const current = activities[index].shape ?? "process";
    const next = SHAPE_CYCLE[(SHAPE_CYCLE.indexOf(current) + 1) % SHAPE_CYCLE.length];
    patchActivity(index, { shape: next });
  }
  function setCell(index: number, role: string, code: string) {
    const assignments = { ...activities[index].assignments };
    if (code) {
      assignments[role] = code as RasicCode;
    } else {
      delete assignments[role];
    }
    patchActivity(index, { assignments });
  }
  function cycleCell(index: number, role: string) {
    const current = (activities[index].assignments[role] ?? "") as RasicCode | "";
    const next = RASIC_CYCLE[(RASIC_CYCLE.indexOf(current) + 1) % RASIC_CYCLE.length];
    setCell(index, role, next);
  }

  return (
    <div className="mt-3 space-y-3">
      {/* Roles — shared by both views */}
      <div>
        <span className="ui-field-label">Roles (RASIC functions)</span>
        <div className="mt-2 flex flex-wrap gap-2">
          {roles.map((role, index) => (
            <div key={index} className="flex items-center gap-1">
              <input
                className="ui-field-standalone w-36 px-2 text-[12px]"
                value={role}
                placeholder="Role"
                onChange={(event) => setRole(index, event.target.value)}
              />
              <button
                type="button"
                className="ui-btn-ghost h-8 w-8 px-0 text-ink-tertiary hover:text-danger"
                title="Remove role"
                onClick={() => removeRole(index)}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          <button type="button" className="ui-btn-ghost h-8 gap-1.5 px-3" onClick={addRole}>
            <Plus size={12} />
            Role
          </button>
        </div>
      </div>

      {/* Map / Table toggle */}
      <div className="inline-flex items-center gap-0.5 rounded-lg border border-line bg-surface-muted p-0.5">
        <ViewTab active={view === "map"} onClick={() => setView("map")}>
          Map
        </ViewTab>
        <ViewTab active={view === "table"} onClick={() => setView("table")}>
          Table
        </ViewTab>
      </div>

      {view === "map" ? (
        <MapView
          roles={roles}
          activities={activities}
          onPatch={patchActivity}
          onCycle={cycleCell}
          onShape={cycleShape}
          onMove={moveActivity}
          onRemove={removeActivity}
        />
      ) : (
        <MatrixView
          roles={roles}
          activities={activities}
          onDescription={(index, value) => patchActivity(index, { description: value })}
          onSetCell={setCell}
          onRemove={removeActivity}
        />
      )}

      <button type="button" className="ui-btn-ghost mt-2 h-8 gap-1.5 px-3" onClick={addActivity}>
        <Plus size={13} />
        Add step
      </button>
    </div>
  );
}

function ViewTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`ui-mono-label rounded-md px-3 py-1 text-[11px] transition ${
        active ? "bg-accent-subtle text-accent" : "text-ink-tertiary hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

/** A flowchart node in the standard shape: terminator (pill), process (rectangle), or decision (diamond). */
function StepNode({ shape, children }: { shape: SopShape; children: ReactNode }) {
  if (shape === "decision") {
    return (
      <div className="relative mx-auto flex h-[118px] w-44 items-center justify-center">
        <span
          aria-hidden="true"
          className="absolute left-1/2 top-1/2 h-[84px] w-[84px] -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[3px] border border-line bg-surface-raised"
        />
        <div className="relative z-10 w-[62%]">{children}</div>
      </div>
    );
  }
  return (
    <div
      className={`mx-auto max-w-[230px] border border-line bg-surface-raised px-3 py-1.5 ${
        shape === "terminator" ? "rounded-full" : "rounded-md"
      }`}
    >
      {children}
    </div>
  );
}

function MapView({
  roles,
  activities,
  onPatch,
  onCycle,
  onShape,
  onMove,
  onRemove,
}: {
  roles: string[];
  activities: SopActivity[];
  onPatch: (index: number, patch: Partial<SopActivity>) => void;
  onCycle: (index: number, role: string) => void;
  onShape: (index: number) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onRemove: (index: number) => void;
}) {
  if (activities.length === 0) {
    return <p className="ui-mono-label py-3 text-ink-tertiary">No steps yet — add the first one below.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed border-collapse text-[12px]">
        <colgroup>
          <col style={{ width: "22%" }} />
          <col style={{ width: "31%" }} />
          <col style={{ width: "22%" }} />
          <col style={{ width: "19%" }} />
          <col style={{ width: "6%" }} />
        </colgroup>
        <thead>
          <tr className="border-b border-line text-left">
            <th className="px-1.5 py-2 ui-mono-label text-ink-tertiary">Input</th>
            <th className="px-1.5 py-2 text-center ui-mono-label text-ink-tertiary">Process step</th>
            <th className="px-1.5 py-2 ui-mono-label text-ink-tertiary">Output</th>
            <th className="px-1.5 py-2 ui-mono-label text-ink-tertiary">RASIC</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {activities.map((activity, index) => {
            const shape = activity.shape ?? "process";
            const ShapeIcon = SHAPE_META[shape].Icon;
            return (
              <tr key={activity.id} className="align-top">
                <td className="px-1 py-1.5">
                  <AutoTextarea
                    className="ui-field-standalone w-full py-1.5 text-[12px]"
                    maxHeight={140}
                    value={activity.input ?? ""}
                    placeholder="Input"
                    onChange={(event) => onPatch(index, { input: event.target.value })}
                  />
                </td>
                <td className="px-1 py-1.5">
                  <StepNode shape={shape}>
                    <AutoTextarea
                      className="w-full bg-transparent text-center text-[12px] text-ink outline-none placeholder:text-ink-tertiary"
                      maxHeight={shape === "decision" ? 88 : 140}
                      value={activity.description}
                      placeholder="Step"
                      onChange={(event) => onPatch(index, { description: event.target.value })}
                    />
                  </StepNode>
                  {index < activities.length - 1 ? (
                    <div className="flex justify-center pt-0.5 text-ink-tertiary" aria-hidden="true">
                      <ChevronDown size={16} />
                    </div>
                  ) : null}
                </td>
                <td className="px-1 py-1.5">
                  <AutoTextarea
                    className="ui-field-standalone w-full py-1.5 text-[12px]"
                    maxHeight={140}
                    value={activity.output ?? ""}
                    placeholder="Output"
                    onChange={(event) => onPatch(index, { output: event.target.value })}
                  />
                </td>
                <td className="px-1 py-1.5">
                  {roles.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {roles.map((role, roleIndex) => {
                        const code = activity.assignments[role];
                        return (
                          <button
                            key={roleIndex}
                            type="button"
                            title={
                              code
                                ? `${role || "Role"}: ${RASIC_LABELS[code]} — click to change`
                                : `${role || "Role"}: unassigned — click to assign`
                            }
                            onClick={() => onCycle(index, role)}
                            className={`ui-mono-label rounded-full border px-2 py-0.5 text-[10px] transition ${
                              code
                                ? "border-accent-muted bg-accent-subtle text-accent"
                                : "border-line text-ink-tertiary hover:text-ink"
                            }`}
                          >
                            {code ? `${code}: ` : ""}
                            {role || "—"}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <span className="ui-mono-label text-ink-tertiary">—</span>
                  )}
                </td>
                <td className="px-1 py-1.5">
                  <div className="flex flex-col items-center gap-0.5">
                    <button
                      type="button"
                      className="ui-btn-ghost h-7 w-7 px-0 text-ink-tertiary hover:text-ink"
                      title={`Shape: ${SHAPE_META[shape].label} — click to change`}
                      onClick={() => onShape(index)}
                    >
                      <ShapeIcon size={13} />
                    </button>
                    <button
                      type="button"
                      className="ui-btn-ghost h-7 w-7 px-0 text-ink-tertiary disabled:opacity-30"
                      title="Move up"
                      disabled={index === 0}
                      onClick={() => onMove(index, -1)}
                    >
                      <ChevronUp size={14} />
                    </button>
                    <button
                      type="button"
                      className="ui-btn-ghost h-7 w-7 px-0 text-ink-tertiary disabled:opacity-30"
                      title="Move down"
                      disabled={index === activities.length - 1}
                      onClick={() => onMove(index, 1)}
                    >
                      <ChevronDown size={14} />
                    </button>
                    <button
                      type="button"
                      className="ui-btn-ghost h-7 w-7 px-0 text-ink-tertiary hover:text-danger"
                      title="Delete step"
                      onClick={() => onRemove(index)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MatrixView({
  roles,
  activities,
  onDescription,
  onSetCell,
  onRemove,
}: {
  roles: string[];
  activities: SopActivity[];
  onDescription: (index: number, value: string) => void;
  onSetCell: (index: number, role: string, code: string) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed border-collapse text-[12px]">
        <thead>
          <tr className="border-b border-line text-left">
            <th className="w-8 py-2 pr-2 ui-mono-label text-ink-tertiary">#</th>
            <th className="py-2 pr-2 ui-mono-label text-ink-tertiary">Activity</th>
            {roles.map((role, index) => (
              <th key={index} className="w-16 px-1 py-2 text-center ui-mono-label text-ink-tertiary">
                <span className="block truncate" title={role}>
                  {role || "—"}
                </span>
              </th>
            ))}
            <th className="w-9" />
          </tr>
        </thead>
        <tbody>
          {activities.map((activity, index) => (
            <tr key={activity.id} className="border-b border-line align-top">
              <td className="py-2 pr-2 text-ink-tertiary">{index + 1}</td>
              <td className="py-2 pr-2">
                <AutoTextarea
                  className="ui-field-standalone min-h-9 w-full py-1.5"
                  maxHeight={72}
                  value={activity.description}
                  placeholder="Describe the activity"
                  onChange={(event) => onDescription(index, event.target.value)}
                />
              </td>
              {roles.map((role, roleIndex) => (
                <td key={roleIndex} className="px-1 py-2 text-center">
                  <select
                    className="ui-field-standalone w-full px-1 text-center"
                    value={activity.assignments[role] ?? ""}
                    onChange={(event) => onSetCell(index, role, event.target.value)}
                  >
                    <option value="">–</option>
                    {RASIC_CODES.map((code) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </select>
                </td>
              ))}
              <td className="py-2">
                <button
                  type="button"
                  className="ui-btn-ghost h-9 w-9 shrink-0 px-0 text-ink-tertiary hover:text-danger"
                  title="Remove activity"
                  onClick={() => onRemove(index)}
                >
                  <Trash2 size={13} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
