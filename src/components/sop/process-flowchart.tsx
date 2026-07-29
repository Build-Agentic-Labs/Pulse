"use client";

import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { rasicRoleOptions, type Department } from "@/domain/departments";
import {
  RASIC_CODES,
  RASIC_LABELS,
  type RasicCode,
  type SopActivity,
  type SopShape,
} from "@/domain/sop/schema";
import { ThemedSelect, type ThemedSelectOption } from "@/components/themed-select";
import { AutoTextarea } from "./auto-textarea";

type Props = {
  roles: string[];
  activities: SopActivity[];
  departments: Department[];
  /** The SOP's OWNING department — its titles lead the role dropdown. */
  owningDepartmentId?: string | null;
  /** Roles this workspace has already added, offered under "Added by your team". */
  workspaceRoleNames?: readonly string[];
  /** Called when an author commits a role that is in none of the offered groups. */
  onCreateRole?: (name: string) => void;
  /** Read-only mode: inputs are disabled and structural controls (add/move/delete) are hidden. */
  disabled?: boolean;
  onChange: (roles: string[], activities: SopActivity[]) => void;
};

// Shape options offered by the Builder and rendered by the Viewer.
const SHAPE_CYCLE: SopShape[] = ["process", "terminator", "decision"];
const SHAPE_META: Record<SopShape, { label: string }> = {
  process: { label: "Process" },
  terminator: { label: "Start / End" },
  decision: { label: "Decision" },
};

const DECISION_END_VALUE = "__end__";
type DecisionOutcome = "yes" | "no";

function decisionTargetLabel(
  targetActivityId: string | null | undefined,
  activities: SopActivity[],
): string {
  if (targetActivityId === null) return "End process";
  if (!targetActivityId) return "Select destination";
  const target = activities.find((activity) => activity.id === targetActivityId);
  return target
    ? `${target.step}. ${target.description.trim() || "Untitled step"}`
    : "Missing step";
}

// Keep the stored 1-based `step` aligned with array order after any structural edit.
function renumber(activities: SopActivity[]): SopActivity[] {
  return activities.map((activity, index) =>
    activity.step === index + 1 ? activity : { ...activity, step: index + 1 },
  );
}

/**
 * The SOP process workflow has two explicit modes. Builder is the editable source of truth
 * for step details and RASIC assignments. Viewer renders those same activities as a read-only
 * left-to-right process map using the standard terminator, process, and decision shapes.
 */
export function ProcessFlowchart({
  roles,
  activities,
  departments,
  owningDepartmentId,
  workspaceRoleNames = [],
  onCreateRole,
  disabled = false,
  onChange,
}: Props) {
  const [view, setView] = useState<"builder" | "viewer">("builder");
  const [autoOpenRoleIndex, setAutoOpenRoleIndex] = useState<number | null>(null);
  const builderDisabled = disabled || view !== "builder";
  const roleOptions = useMemo<ThemedSelectOption[]>(
    () => rasicRoleOptions(owningDepartmentId, departments, workspaceRoleNames),
    [departments, owningDepartmentId, workspaceRoleNames],
  );

  // --- roles (RASIC functions) ---
  function setRole(index: number, value: string) {
    const previousRole = roles[index];
    setAutoOpenRoleIndex(null);
    // Absent from every offered group => the author typed it. The document write is the
    // onChange below; this adds it to the workspace list in the same gesture.
    if (value && !roleOptions.some((option) => option.value === value)) onCreateRole?.(value);
    onChange(
      roles.map((role, i) => (i === index ? value : role)),
      activities.map((activity) => {
        if (!previousRole || previousRole === value || !(previousRole in activity.assignments)) return activity;
        const { [previousRole]: assignment, ...remainingAssignments } = activity.assignments;
        return { ...activity, assignments: { ...remainingAssignments, [value]: assignment } };
      }),
    );
  }
  function addRole() {
    if (roles.some((role) => !role)) return;
    setAutoOpenRoleIndex(roles.length);
    onChange([...roles, ""], activities);
  }
  function removeRole(index: number) {
    setAutoOpenRoleIndex(null);
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
    const removedId = activities[index]?.id;
    const remaining = activities
      .filter((_, i) => i !== index)
      .map((activity) => {
        const branches = activity.decisionBranches;
        if (!branches || !removedId) return activity;
        const yesTargetActivityId =
          branches.yesTargetActivityId === removedId ? undefined : branches.yesTargetActivityId;
        const noTargetActivityId =
          branches.noTargetActivityId === removedId ? undefined : branches.noTargetActivityId;
        return {
          ...activity,
          decisionBranches: {
            ...(yesTargetActivityId !== undefined ? { yesTargetActivityId } : {}),
            ...(noTargetActivityId !== undefined ? { noTargetActivityId } : {}),
          },
        };
      });
    onChange(roles, renumber(remaining));
  }
  function moveActivity(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= activities.length) return;
    const next = [...activities];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(roles, renumber(next));
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
  return (
    <div className="mt-3 space-y-3">
      {/* Roles — shared by both views */}
      <div>
        <span className="ui-field-label">Roles (RASIC functions)</span>
        <div className="mt-2 flex flex-col items-start gap-2">
          {roles.map((role, index) => (
            <div key={index} className="flex w-full items-center gap-1">
              <ThemedSelect
                variant="sop"
                className="min-w-0 flex-1"
                value={role}
                placeholder="Select role"
                ariaLabel={`Role ${index + 1} for RASIC functions`}
                autoOpen={autoOpenRoleIndex === index}
                allowCustomValue
                disabled={builderDisabled}
                options={[
                  ...(role && !roleOptions.some((option) => option.value === role)
                    ? [{ value: role, label: role, group: "Current role" }]
                    : []),
                  ...roleOptions.map((option) => ({
                    ...option,
                    disabled: roles.some((selectedRole, selectedIndex) => selectedIndex !== index && selectedRole === option.value),
                  })),
                ]}
                onChange={(value) => setRole(index, value)}
              />
              {builderDisabled ? null : (
                <button
                  type="button"
                  className="ui-btn-ghost h-8 w-8 px-0 text-ink-tertiary hover:text-danger"
                  title="Remove role"
                  onClick={() => removeRole(index)}
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          ))}
          {builderDisabled ? null : (
            <button
              type="button"
              className="ui-btn-ghost h-8 gap-1.5 px-3"
              disabled={roles.some((role) => !role) || roleOptions.length === 0}
              title={roleOptions.length === 0 ? "No department roles are available" : undefined}
              onClick={addRole}
            >
              <Plus size={12} />
              Role
            </button>
          )}
        </div>
      </div>

      {/* Builder owns all authoring; Viewer is the read-only process-map presentation. */}
      <div>
        <span className="ui-field-label">Process flow</span>
        {/* mt-2 on top of the label's own mb-1 makes 12px — the same rhythm as the parent's
            space-y-3, so the toggle sits away from its heading rather than crowding it. */}
        <div className="mt-2 inline-flex items-center gap-0.5 rounded-lg border border-line bg-surface-muted p-0.5">
          <ViewTab active={view === "builder"} onClick={() => setView("builder")}>
            Builder
          </ViewTab>
          <ViewTab active={view === "viewer"} onClick={() => setView("viewer")}>
            Viewer
          </ViewTab>
        </div>
      </div>

      {view === "viewer" ? (
        <MapView roles={roles} activities={activities} />
      ) : (
        <MatrixView
          roles={roles}
          activities={activities}
          disabled={disabled}
          onPatch={patchActivity}
          onSetCell={setCell}
          onMove={moveActivity}
          onRemove={removeActivity}
        />
      )}

      {disabled || view !== "builder" ? null : (
        <button type="button" className="ui-btn-ghost mt-2 h-8 gap-1.5 px-3" onClick={addActivity}>
          <Plus size={13} />
          Add step
        </button>
      )}
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
      className={`mx-auto flex min-h-10 items-center justify-center border border-line bg-surface-raised px-3 py-1.5 ${
        shape === "terminator"
          ? "w-[82%] max-w-[200px] rounded-full border-2"
          : "w-full max-w-[230px] rounded-[2px]"
      }`}
    >
      {children}
    </div>
  );
}

function DecisionBranchSummary({
  activity,
  activities,
}: {
  activity: SopActivity;
  activities: SopActivity[];
}) {
  const branches = activity.decisionBranches;
  const outcomes: Array<{ label: string; targetActivityId: string | null | undefined }> = [
    { label: "Yes", targetActivityId: branches?.yesTargetActivityId },
    { label: "No", targetActivityId: branches?.noTargetActivityId },
  ];

  return (
    <div className="mx-auto mt-1.5 grid max-w-[280px] grid-cols-2 gap-1.5">
      {outcomes.map(({ label, targetActivityId }) => (
        <div key={label} className="min-w-0 rounded-md border border-line bg-surface-muted px-2 py-1.5 text-left">
          <span className="ui-mono-label text-[9px] text-ink-tertiary">{label} →</span>
          <p className="mt-0.5 text-[10px] leading-3 text-ink">
            {decisionTargetLabel(targetActivityId, activities)}
          </p>
        </div>
      ))}
    </div>
  );
}

function MapView({ roles, activities }: { roles: string[]; activities: SopActivity[] }) {
  if (activities.length === 0) {
    return <p className="ui-mono-label py-3 text-ink-tertiary">No steps to preview.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed border-collapse text-[12px]">
        <colgroup>
          <col style={{ width: "22%" }} />
          <col style={{ width: "32%" }} />
          <col style={{ width: "22%" }} />
          <col style={{ width: "24%" }} />
        </colgroup>
        <thead>
          <tr className="border-b border-line text-left">
            <th className="px-1.5 py-2 ui-mono-label text-ink-tertiary">Input</th>
            <th className="px-1.5 py-2 text-center ui-mono-label text-ink-tertiary">Process step</th>
            <th className="px-1.5 py-2 ui-mono-label text-ink-tertiary">Output</th>
            <th className="px-1.5 py-2 ui-mono-label text-ink-tertiary">RASIC</th>
          </tr>
        </thead>
        <tbody>
          {activities.map((activity, index) => {
            const shape = activity.shape ?? "process";
            const assignments = roles.flatMap((role) => {
              const code = activity.assignments[role];
              return code ? [{ role, code }] : [];
            });
            return (
              <tr key={activity.id} className="align-top">
                <td className="px-1 py-1.5">
                  <p className="min-h-9 rounded-md bg-surface-muted px-2 py-2 text-[11px] leading-4 text-ink">
                    {activity.input?.trim() || "—"}
                  </p>
                </td>
                <td className="px-1 py-1.5">
                  <StepNode shape={shape}>
                    <p className="text-center text-[12px] leading-4 text-ink">
                      {activity.description.trim() || "Untitled step"}
                    </p>
                  </StepNode>
                  {shape === "decision" ? (
                    <DecisionBranchSummary activity={activity} activities={activities} />
                  ) : index < activities.length - 1 ? (
                    <div className="flex justify-center pt-0.5 text-ink-tertiary" aria-hidden="true">
                      <ChevronDown size={16} />
                    </div>
                  ) : null}
                </td>
                <td className="px-1 py-1.5">
                  <p className="min-h-9 rounded-md bg-surface-muted px-2 py-2 text-[11px] leading-4 text-ink">
                    {activity.output?.trim() || "—"}
                  </p>
                </td>
                <td className="px-1 py-1.5">
                  {assignments.length > 0 ? (
                    <div className="space-y-1">
                      {assignments.map(({ role, code }) => (
                        <div key={role} className="flex w-full items-center gap-1.5 px-1.5 py-1">
                          <span className="ui-mono-label flex h-5 w-5 shrink-0 items-center justify-center rounded border border-accent-muted bg-accent-subtle text-accent">
                            {code}
                          </span>
                          <span className="min-w-0 flex-1 text-[10px] leading-3 text-ink">{role || "—"}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="ui-mono-label px-1.5 py-2 text-ink-tertiary">No assignments</span>
                  )}
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
  disabled,
  onPatch,
  onSetCell,
  onMove,
  onRemove,
}: {
  roles: string[];
  activities: SopActivity[];
  disabled: boolean;
  onPatch: (index: number, patch: Partial<SopActivity>) => void;
  onSetCell: (index: number, role: string, code: string) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onRemove: (index: number) => void;
}) {
  const minTableWidth = Math.max(760, 472 + roles.length * 96);

  return (
    <div className="overflow-x-auto">
      <table
        className="w-full table-fixed border-collapse text-[12px]"
        style={{ minWidth: `${minTableWidth}px` }}
      >
        <thead>
          <tr className="border-b border-line text-left">
            <th className="w-8 py-2 pr-2 text-center align-bottom ui-mono-label text-ink-tertiary">#</th>
            <th className="py-2 pr-2 align-bottom ui-mono-label text-ink-tertiary">Process details</th>
            {roles.map((role, index) => (
              <th key={index} className="w-24 px-1.5 py-2 text-center align-bottom ui-mono-label text-ink-tertiary">
                <span className="block whitespace-normal break-words leading-4" title={role}>
                  {role || "—"}
                </span>
              </th>
            ))}
            <th className="w-9" />
          </tr>
        </thead>
        <tbody>
          {activities.map((activity, index) => {
            const decisionTargetOptions: ThemedSelectOption[] = [
              { value: "", label: "Select destination" },
              { value: DECISION_END_VALUE, label: "End process" },
              ...activities
                .filter((target) => target.id !== activity.id)
                .map((target) => ({
                  value: target.id,
                  label: `${target.step}. ${target.description.trim() || "Untitled step"}`,
                })),
            ];
            const setDecisionBranch = (outcome: DecisionOutcome, value: string) => {
              const targetActivityId =
                value === DECISION_END_VALUE ? null : value || undefined;
              const decisionBranches = { ...activity.decisionBranches };
              if (outcome === "yes") {
                decisionBranches.yesTargetActivityId = targetActivityId;
              } else {
                decisionBranches.noTargetActivityId = targetActivityId;
              }
              onPatch(index, { decisionBranches });
            };

            return (
              <tr key={activity.id} className="border-b border-line">
              <td className="py-2 pr-2 align-top text-center text-ink-tertiary">
                <span className="flex h-9 items-center justify-center">{index + 1}</span>
              </td>
              <td className="py-2 pr-2 align-top">
                <AutoTextarea
                  className="ui-field-standalone min-h-9 w-full py-1.5"
                  maxHeight={72}
                  value={activity.description}
                  placeholder="Describe the activity"
                  aria-label={`Activity ${index + 1}`}
                  disabled={disabled}
                  onChange={(event) => onPatch(index, { description: event.target.value })}
                />
                <div className="mt-1 grid grid-cols-3 items-stretch gap-1.5">
                  <AutoTextarea
                    className="ui-field-standalone min-h-8 w-full py-1.5 text-[11px]"
                    maxHeight={72}
                    value={activity.input ?? ""}
                    placeholder="Input"
                    aria-label={`Input for activity ${index + 1}`}
                    disabled={disabled}
                    onChange={(event) => onPatch(index, { input: event.target.value })}
                  />
                  <AutoTextarea
                    className="ui-field-standalone min-h-8 w-full py-1.5 text-[11px]"
                    maxHeight={72}
                    value={activity.output ?? ""}
                    placeholder="Output"
                    aria-label={`Output for activity ${index + 1}`}
                    disabled={disabled}
                    onChange={(event) => onPatch(index, { output: event.target.value })}
                  />
                  <ThemedSelect
                    variant="sop"
                    className="h-full min-w-0"
                    triggerClassName="ui-sop-select-compact !h-full min-h-9"
                    ariaLabel={`Shape for activity ${index + 1}`}
                    value={activity.shape ?? "process"}
                    selectedLabel={SHAPE_META[activity.shape ?? "process"].label}
                    disabled={disabled}
                    options={SHAPE_CYCLE.map((shape) => ({
                      value: shape,
                      label: SHAPE_META[shape].label,
                    }))}
                    onChange={(value) => onPatch(index, { shape: value as SopShape })}
                  />
                </div>
                {activity.shape === "decision" ? (
                  <div className="mt-1.5 space-y-1.5 rounded-md border border-line bg-surface-muted p-1.5">
                    {(["yes", "no"] as const).map((outcome) => {
                      const targetActivityId =
                        outcome === "yes"
                          ? activity.decisionBranches?.yesTargetActivityId
                          : activity.decisionBranches?.noTargetActivityId;
                      const value =
                        targetActivityId === null
                          ? DECISION_END_VALUE
                          : targetActivityId ?? "";
                      return (
                        <div
                          key={outcome}
                          className="grid min-w-0 grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-1.5"
                        >
                          <span className="ui-mono-label text-right text-[9px] text-ink-tertiary">
                            {outcome === "yes" ? "Yes" : "No"} →
                          </span>
                          <ThemedSelect
                            variant="sop"
                            className="min-w-0"
                            triggerClassName="ui-sop-select-compact"
                            ariaLabel={`${outcome === "yes" ? "Yes" : "No"} branch destination for activity ${index + 1}`}
                            value={value}
                            selectedLabel={decisionTargetLabel(targetActivityId, activities)}
                            disabled={disabled}
                            options={decisionTargetOptions}
                            onChange={(nextValue) => setDecisionBranch(outcome, nextValue)}
                          />
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </td>
              {roles.map((role, roleIndex) => (
                <td key={roleIndex} className="relative text-center align-middle">
                  <div className="absolute inset-x-2 inset-y-2">
                    <ThemedSelect
                      variant="sop"
                      className="h-full w-full"
                      triggerClassName="ui-sop-select-compact !h-full min-h-9 text-[13px] font-medium"
                      ariaLabel={`RASIC assignment for ${role || `role ${roleIndex + 1}`}, activity ${index + 1}`}
                      value={activity.assignments[role] ?? ""}
                      selectedLabel={activity.assignments[role] ?? "–"}
                      disabled={disabled}
                      options={[
                        { value: "", label: "Unassigned" },
                        ...RASIC_CODES.map((code) => ({ value: code, label: RASIC_LABELS[code] })),
                      ]}
                      onChange={(value) => onSetCell(index, role, value)}
                    />
                  </div>
                </td>
              ))}
              <td className="py-2 align-middle">
                {disabled ? null : (
                  <div className="flex flex-col items-center gap-0.5">
                    <button
                      type="button"
                      className="ui-btn-ghost h-7 w-7 px-0 text-ink-tertiary disabled:opacity-30"
                      title="Move up"
                      aria-label={`Move activity ${index + 1} up`}
                      disabled={index === 0}
                      onClick={() => onMove(index, -1)}
                    >
                      <ChevronUp size={14} />
                    </button>
                    <button
                      type="button"
                      className="ui-btn-ghost h-7 w-7 px-0 text-ink-tertiary disabled:opacity-30"
                      title="Move down"
                      aria-label={`Move activity ${index + 1} down`}
                      disabled={index === activities.length - 1}
                      onClick={() => onMove(index, 1)}
                    >
                      <ChevronDown size={14} />
                    </button>
                    <button
                      type="button"
                      className="ui-btn-ghost h-7 w-7 px-0 text-ink-tertiary hover:text-danger"
                      title="Remove activity"
                      aria-label={`Remove activity ${index + 1}`}
                      onClick={() => onRemove(index)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                )}
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
