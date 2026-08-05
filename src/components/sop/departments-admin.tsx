"use client";

import { Building2, Flag, Loader2, Plus, Trash2, UserPlus, UsersRound } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConfirm } from "@/components/confirm-provider";
import { QuietLoading } from "@/components/quiet-loading";
import { ThemedSelect } from "@/components/themed-select";
import type { Department, DepartmentMember, DeptRole } from "@/domain/departments";
import { isValidDepartmentSopTarget, MAX_DEPARTMENT_SOP_TARGET } from "@/domain/sop/dashboard";
import { loadMembersAccessForWorkspace } from "@/domain/supabase-planner";
import type { MemberAccess } from "@/domain/types";
import {
  deleteDepartment,
  listDepartments,
  listMembersForDepartments,
  removeMember,
  saveDepartment,
  setDepartmentSopTarget,
  setMember,
  setMemberPosition,
} from "@/lib/departments/store";
import { SOP_DEMAND_UPDATED_EVENT } from "@/lib/sop/dashboard-events";
import { jobTitleOptions } from "@/domain/departments";
import { addJobTitle, listJobTitles, type JobTitle } from "@/lib/sop/job-titles/store";
import { JobTitlesAdmin } from "./job-titles-admin";
import { RasicRolesAdmin } from "./rasic-roles-admin";
import { canManage, useSopWorkspace } from "./sop-workspace-provider";

const DEPT_ROLES: readonly DeptRole[] = ["author", "reviewer", "approver"];

interface DepartmentDraft {
  code: string;
  name: string;
  isQualityGate: boolean;
}

function messageFrom(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/** Display a member by their real identity, never the raw Supabase UUID. */
function memberLabel(member: MemberAccess): string {
  return member.fullName || member.email || member.userId;
}

function groupMembers(
  departments: readonly Department[],
  members: readonly DepartmentMember[],
): Record<string, DepartmentMember[]> {
  const grouped = Object.fromEntries(
    departments.map((department) => [department.id, [] as DepartmentMember[]]),
  );
  for (const member of members) grouped[member.departmentId]?.push(member);
  return grouped;
}

export function DepartmentsAdmin({
  active = true,
  preload = false,
  embedded = false,
  initialDepartments,
  initialMembers,
  initialDirectory,
  initialWorkspaceId,
}: {
  active?: boolean;
  preload?: boolean;
  embedded?: boolean;
  initialDepartments?: Department[];
  initialMembers?: DepartmentMember[];
  initialDirectory?: MemberAccess[];
  initialWorkspaceId?: string;
}) {
  const confirm = useConfirm();
  const { workspaceId, role } = useSopWorkspace();
  const manage = canManage(role);
  // Shared across every department's picker, so a title typed for one is offered to the rest.
  const [jobTitles, setJobTitles] = useState<JobTitle[]>([]);

  useEffect(() => {
    if (!workspaceId) return;
    let active = true;
    listJobTitles(workspaceId)
      .then((next) => {
        if (active) setJobTitles(next);
      })
      // The standard titles still populate the picker, and typing still works.
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [workspaceId]);

  function handleJobTitleAdded(name: string) {
    if (!workspaceId) return;
    void addJobTitle(workspaceId, name)
      .then((title) => {
        setJobTitles((current) =>
          current.some((existing) => existing.name.toLowerCase() === title.name.toLowerCase())
            ? current
            : [...current, title],
        );
      })
      // The member keeps the title; only the sharing failed.
      .catch(() => undefined);
  }
  const seeded =
    initialDepartments !== undefined &&
    initialMembers !== undefined &&
    initialWorkspaceId === workspaceId;

  const [departments, setDepartments] = useState<Department[]>(
    seeded ? initialDepartments : [],
  );
  const [membersByDepartment, setMembersByDepartment] = useState<Record<string, DepartmentMember[]>>(
    () => seeded ? groupMembers(initialDepartments, initialMembers) : {},
  );
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    seeded ? "ready" : "loading",
  );
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | undefined>(
    seeded ? initialDepartments[0]?.id : undefined,
  );

  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [directory, setDirectory] = useState<MemberAccess[]>(
    seeded ? initialDirectory ?? [] : [],
  );
  const freshnessRef = useRef<{ workspaceId?: string; loadedAt: number }>(
    seeded ? { workspaceId, loadedAt: Date.now() } : { loadedAt: 0 },
  );

  const handleError = useCallback((message: string) => setError(message), []);
  const handleMembersChange = useCallback((departmentId: string, members: DepartmentMember[]) => {
    setMembersByDepartment((current) => ({ ...current, [departmentId]: members }));
  }, []);
  const handleDepartmentChange = useCallback((department: Department) => {
    setDepartments((current) =>
      current.map((entry) => (entry.id === department.id ? department : entry)),
    );
  }, []);

  const refresh = useCallback(async (options: { background?: boolean } = {}) => {
    if (!workspaceId) {
      setDepartments([]);
      setMembersByDepartment({});
      setStatus("ready");
      freshnessRef.current = { workspaceId, loadedAt: Date.now() };
      return;
    }
    if (!options.background) {
      setStatus("loading");
      setError("");
    }
    try {
      const next = await listDepartments(workspaceId);
      const members = await listMembersForDepartments(next.map((department) => department.id));
      const nextMembers = groupMembers(next, members);
      setDepartments(next);
      setMembersByDepartment(nextMembers);
      setSelectedId((current) =>
        current && next.some((dept) => dept.id === current) ? current : next[0]?.id,
      );
      setError("");
      setStatus("ready");
      freshnessRef.current = { workspaceId, loadedAt: Date.now() };
    } catch (caught) {
      if (!options.background) {
        setError(messageFrom(caught, "Could not load departments and members."));
        setStatus("error");
      }
    }
  }, [workspaceId]);

  useEffect(() => {
    if (!active && !preload) return;
    const hasCurrentData =
      freshnessRef.current.workspaceId === workspaceId && freshnessRef.current.loadedAt > 0;
    if (hasCurrentData && Date.now() - freshnessRef.current.loadedAt < 30_000) return;
    void refresh({ background: hasCurrentData });
  }, [active, preload, refresh, workspaceId]);

  // The workspace member directory powers the name/email member picker (no raw UUIDs).
  useEffect(() => {
    if (seeded) return;
    if (!workspaceId) {
      setDirectory([]);
      return;
    }
    let active = true;
    void loadMembersAccessForWorkspace(workspaceId)
      .then((rows) => {
        if (active) setDirectory(rows);
      })
      .catch(() => {
        /* directory is optional; existing members still list, just without name/email */
      });
    return () => {
      active = false;
    };
  }, [workspaceId, seeded]);

  const selected = useMemo(
    () => departments.find((dept) => dept.id === selectedId),
    [departments, selectedId],
  );

  async function handleCreate(input: DepartmentDraft) {
    if (!workspaceId) return;
    setSaving(true);
    setError("");
    try {
      const saved = await saveDepartment(workspaceId, input);
      setDepartments((prev) => {
        const withSaved = prev.some((dept) => dept.id === saved.id)
          ? prev.map((dept) => (dept.id === saved.id ? saved : dept))
          : [...prev, saved];
        return [...withSaved].sort((a, b) => a.code.localeCompare(b.code));
      });
      setMembersByDepartment((current) => ({ ...current, [saved.id]: current[saved.id] ?? [] }));
      setSelectedId(saved.id);
      setShowForm(false);
    } catch (caught) {
      setError(messageFrom(caught, "Could not save the department."));
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteDepartment(dept: Department) {
    const ok = await confirm({
      title: `Delete "${dept.code}"?`,
      body: "Its members and role assignments are removed. SOPs already numbered under it are unaffected.",
      tone: "danger",
      confirmLabel: "Delete department",
    });
    if (!ok) return;
    const previous = departments;
    const previousMembers = membersByDepartment;
    const remaining = previous.filter((entry) => entry.id !== dept.id);
    const remainingMembers = { ...previousMembers };
    delete remainingMembers[dept.id];
    setDepartments(remaining);
    setMembersByDepartment(remainingMembers);
    if (selectedId === dept.id) setSelectedId(remaining[0]?.id);
    try {
      await deleteDepartment(dept.id);
    } catch (caught) {
      setDepartments(previous);
      setMembersByDepartment(previousMembers);
      setError(messageFrom(caught, "Could not delete the department."));
    }
  }

  return (
    <div className={`ui-depts space-y-6 ${embedded ? "" : "mx-auto max-w-6xl"}`}>
        <div className={`flex flex-wrap items-start gap-4 ${embedded ? "justify-end" : "justify-between"}`}>
          {!embedded ? (
            <div>
              <h1 className="ui-section-title">Departments</h1>
              <p className="ui-section-subtitle">
                Assign ownership and control who can author, review, and approve SOPs.
              </p>
            </div>
          ) : null}
          {manage ? (
            <button
              type="button"
              className="ui-btn-primary h-9 gap-1.5 px-3"
              onClick={() => setShowForm((open) => !open)}
            >
              <Plus size={14} strokeWidth={2} />
              New department
            </button>
          ) : null}
        </div>

        {!manage ? (
          <div className="ui-notice px-4 py-3 ui-section-subtitle text-ink-secondary">
            You have read-only access. Ask a workspace owner or admin to change departments, members or roles.
          </div>
        ) : null}

        {error ? <div className="ui-notice ui-notice-warn px-4 py-3 ui-section-subtitle">{error}</div> : null}

        {manage && showForm ? (
          <NewDepartmentForm
            saving={saving}
            onSubmit={(input) => void handleCreate(input)}
            onCancel={() => setShowForm(false)}
          />
        ) : null}

        <div className="ui-dept-workbench grid grid-cols-1 lg:grid-cols-[minmax(360px,0.9fr)_minmax(0,1.1fr)]">
          <section className="min-w-0 overflow-hidden">
            {status === "loading" ? (
              <QuietLoading
                active={active}
                label="Loading departments"
                reserveClassName="min-h-[120px]"
              />
            ) : status === "error" ? (
              <div className="px-4 py-12 text-center">
                <p className="ui-section-subtitle text-ink-tertiary">{error || "Could not load departments."}</p>
                <button type="button" className="ui-btn-ghost mt-3 inline-flex h-9 px-3" onClick={() => void refresh()}>
                  Retry
                </button>
              </div>
            ) : departments.length === 0 ? (
              <div className="px-4 py-12 text-center">
                <Building2 size={20} className="mx-auto text-ink-tertiary" />
                <p className="mt-2 ui-section-subtitle text-ink-tertiary">
                  No departments yet. {manage ? "Create one to organize SOP ownership." : "Ask a manager to add one."}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b border-line">
                      <th className="ui-settings-table-label px-4 py-2.5 text-left">Code</th>
                      <th className="ui-settings-table-label px-4 py-2.5 text-left">Department</th>
                      <th className="ui-settings-table-label px-4 py-2.5 text-right">Demand</th>
                      <th className="ui-settings-table-label px-4 py-2.5 text-right">Members</th>
                    </tr>
                  </thead>
                  <tbody>
                    {departments.map((dept) => {
                      const active = dept.id === selectedId;
                      return (
                        <tr
                          key={dept.id}
                          onClick={() => setSelectedId(dept.id)}
                          aria-selected={active}
                          className={`ui-dept-row cursor-pointer border-b border-line transition-colors last:border-b-0 ${
                            active ? "ui-dept-row-active" : "hover:bg-surface-hover"
                          }`}
                        >
                          <td className="px-4 py-3">
                            <span className="ui-dept-code">{dept.code}</span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-[13px] font-medium text-ink">{dept.name}</span>
                            {dept.isQualityGate ? (
                              <span className="ui-dept-gate ml-2">
                                <Flag size={11} strokeWidth={1.8} />
                                Quality gate
                              </span>
                            ) : null}
                          </td>
                          <td className="px-4 py-3 text-right ui-mono-label text-ink-secondary">
                            {dept.sopTarget > 0 ? dept.sopTarget : "—"}
                          </td>
                          <td className="px-4 py-3 text-right ui-mono-label text-ink-secondary">
                            {membersByDepartment[dept.id]?.length ?? 0}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {selected ? (
            <section className="flex min-h-[28rem] min-w-0 flex-col border-t border-line p-5 lg:border-l lg:border-t-0 lg:p-6">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="ui-settings-section-title truncate">{selected.name}</h2>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-xs text-ink-tertiary">
                    {membersByDepartment[selected.id]?.length ?? 0}{" "}
                    {(membersByDepartment[selected.id]?.length ?? 0) === 1 ? "member" : "members"}
                  </span>
                  {selected.isQualityGate ? (
                    <span className="ui-dept-gate">
                      <Flag size={11} strokeWidth={1.8} />
                      Quality gate
                    </span>
                  ) : null}
                  {manage ? (
                    <button
                      type="button"
                      className="ui-btn-ghost h-8 w-8 shrink-0 px-0 text-ink-tertiary hover:text-danger"
                      title="Delete department"
                      aria-label={`Delete ${selected.name} department`}
                      onClick={() => void handleDeleteDepartment(selected)}
                    >
                      <Trash2 size={14} />
                    </button>
                  ) : null}
                </div>
              </div>

              <DepartmentDemandTarget
                key={`demand-${selected.id}`}
                department={selected}
                manage={manage}
                onChanged={handleDepartmentChange}
              />

              <MembersPanel
                key={selected.id}
                department={selected}
                manage={manage}
                directory={directory}
                members={membersByDepartment[selected.id] ?? []}
                workspaceJobTitles={jobTitles.map((title) => title.name)}
                onJobTitleAdded={handleJobTitleAdded}
                onError={handleError}
                onMembersChange={handleMembersChange}
              />
            </section>
          ) : (
            <section className="flex min-h-64 items-center justify-center border-t border-line p-6 text-center lg:border-l lg:border-t-0">
              <p className="ui-section-subtitle text-ink-tertiary">Select a department to view its members.</p>
            </section>
          )}
        </div>

        <JobTitlesAdmin
          titles={jobTitles}
          manage={manage}
          onChanged={setJobTitles}
        />

        <RasicRolesAdmin workspaceId={workspaceId} manage={manage} />
      </div>
  );
}

function DepartmentDemandTarget({
  department,
  manage,
  onChanged,
}: {
  department: Department;
  manage: boolean;
  onChanged: (department: Department) => void;
}) {
  const [value, setValue] = useState(String(department.sopTarget));
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"" | "saved" | "error">("");
  const target = Number(value);
  const valid = value.trim().length > 0 && isValidDepartmentSopTarget(target);
  const dirty = valid && target !== department.sopTarget;

  async function saveTarget() {
    if (!manage || !dirty) return;
    setSaving(true);
    setStatus("");
    try {
      const saved = await setDepartmentSopTarget(department.id, target);
      setValue(String(saved.sopTarget));
      onChanged(saved);
      setStatus("saved");
      window.dispatchEvent(new Event(SOP_DEMAND_UPDATED_EVENT));
    } catch {
      setStatus("error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mt-5 border-y border-line py-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-md">
          <h3 className="ui-settings-section-title">SOP demand target</h3>
          <p className="mt-1 text-xs leading-relaxed text-ink-secondary">
            Required SOPs for this department. Completion counts only effective documents.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <label className="block">
            <span className="ui-mono-label mb-1 block text-ink-tertiary">Required SOPs</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={MAX_DEPARTMENT_SOP_TARGET}
              step={1}
              className="ui-field-standalone h-9 w-28 px-2.5 text-right tabular-nums"
              value={value}
              disabled={!manage || saving}
              aria-invalid={!valid}
              onChange={(event) => {
                setValue(event.target.value);
                setStatus("");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") void saveTarget();
              }}
            />
          </label>
          {manage ? (
            <button
              type="button"
              className="ui-btn-primary h-9 px-3 disabled:opacity-40"
              disabled={!dirty || saving}
              onClick={() => void saveTarget()}
            >
              {saving ? "Saving…" : "Save target"}
            </button>
          ) : null}
        </div>
      </div>
      <div className="mt-2 min-h-4 text-right ui-mono-label" aria-live="polite">
        {!valid ? (
          <span className="text-danger">Enter a whole number from 0 to {MAX_DEPARTMENT_SOP_TARGET.toLocaleString()}.</span>
        ) : status === "saved" ? (
          <span className="text-success">[SAVED]</span>
        ) : status === "error" ? (
          <span className="text-danger">[ERROR] Target was not saved. Retry.</span>
        ) : null}
      </div>
    </section>
  );
}

interface NewDepartmentFormProps {
  saving: boolean;
  onSubmit: (input: DepartmentDraft) => void;
  onCancel: () => void;
}

function NewDepartmentForm({ saving, onSubmit, onCancel }: NewDepartmentFormProps) {
  const [draft, setDraft] = useState<DepartmentDraft>({ code: "", name: "", isQualityGate: false });
  const canSubmit = draft.code.trim().length > 0 && draft.name.trim().length > 0;

  function submit() {
    if (!canSubmit) return;
    onSubmit({ code: draft.code.trim(), name: draft.name.trim(), isQualityGate: draft.isQualityGate });
  }

  return (
    <section className="space-y-3 border-y border-line px-5 py-4">
      <div className="ui-mono-label text-ink-secondary">New department</div>
      <div className="grid gap-3 sm:grid-cols-[120px_1fr]">
        <input
          className="ui-field-standalone w-full"
          placeholder="Code (e.g. QA)"
          value={draft.code}
          onChange={(event) => setDraft((prev) => ({ ...prev, code: event.target.value }))}
        />
        <input
          className="ui-field-standalone w-full"
          placeholder="Department name"
          value={draft.name}
          onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
        />
      </div>
      <label className="flex items-center gap-2 text-sm text-ink-secondary">
        <input
          type="checkbox"
          checked={draft.isQualityGate}
          onChange={(event) => setDraft((prev) => ({ ...prev, isQualityGate: event.target.checked }))}
        />
        Independent Quality gate (approvers here can approve SOPs in any department)
      </label>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="ui-btn-primary h-9 gap-1.5 px-3 disabled:opacity-50"
          onClick={submit}
          disabled={saving || !canSubmit}
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : null}
          {saving ? "Saving…" : "Save department"}
        </button>
        <button type="button" className="ui-btn-ghost h-9 px-3" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </section>
  );
}

interface MembersPanelProps {
  department: Department;
  manage: boolean;
  directory: MemberAccess[];
  members: DepartmentMember[];
  onError: (message: string) => void;
  onMembersChange: (departmentId: string, members: DepartmentMember[]) => void;
  /** Titles this workspace has typed, offered alongside the department's standard ones. */
  workspaceJobTitles: readonly string[];
  /** Called when a member is given a title that was not on offer, so it can be shared. */
  onJobTitleAdded: (title: string) => void;
}

function MembersPanel({
  department,
  manage,
  directory,
  members,
  workspaceJobTitles,
  onJobTitleAdded,
  onError,
  onMembersChange,
}: MembersPanelProps) {
  const [pick, setPick] = useState("");
  const [adding, setAdding] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  const byId = useMemo(() => new Map(directory.map((member) => [member.userId, member])), [directory]);
  const labelFor = (userId: string) => {
    const member = byId.get(userId);
    return member ? memberLabel(member) : userId;
  };
  const emailFor = (userId: string) => {
    const member = byId.get(userId);
    return member?.fullName && member.email ? member.email : "";
  };
  // Workspace members not already in this department — the pool the picker offers.
  const available = useMemo(
    () => directory.filter((member) => !members.some((existing) => existing.userId === member.userId)),
    [directory, members],
  );

  async function handleRoleChange(userId: string, nextRole: DeptRole) {
    const previous = members;
    setBusyUserId(userId);
    onMembersChange(
      department.id,
      members.map((member) => (member.userId === userId ? { ...member, deptRole: nextRole } : member)),
    );
    try {
      await setMember(department.id, userId, nextRole);
    } catch (caught) {
      onMembersChange(department.id, previous);
      onError(messageFrom(caught, "Could not change the member's role."));
    } finally {
      setBusyUserId(null);
    }
  }

  async function handlePositionChange(userId: string, positionTitle: string) {
    const previous = members;
    setBusyUserId(userId);
    onMembersChange(
      department.id,
      members.map((member) => (member.userId === userId ? { ...member, positionTitle } : member)),
    );
    try {
      await setMemberPosition(department.id, userId, positionTitle);
      // A title absent from every offered group was typed here; share it with the workspace so
      // the next department can pick it. Failing to share must not fail the assignment — the
      // member keeps the title either way.
      if (positionTitle && !positionOptions.some((option) => option.value === positionTitle)) {
        onJobTitleAdded(positionTitle);
      }
    } catch (caught) {
      onMembersChange(department.id, previous);
      onError(messageFrom(caught, "Could not save the member's position."));
    } finally {
      setBusyUserId(null);
    }
  }

  // Standard titles for this department plus whatever the workspace has typed. Assembly,
  // ordering and dedupe live in the domain; this only renders the result.
  const positionOptions = useMemo(
    () => jobTitleOptions(department.code, workspaceJobTitles),
    [department.code, workspaceJobTitles],
  );

  async function handleAdd() {
    const userId = pick.trim();
    if (!userId) return;
    setAdding(true);
    try {
      await setMember(department.id, userId, "author");
      onMembersChange(department.id, [
        ...members,
        {
          departmentId: department.id,
          userId,
          deptRole: "author",
          positionTitle: "",
        },
      ]);
      setPick("");
    } catch (caught) {
      onError(messageFrom(caught, "Could not add the member."));
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(userId: string) {
    const previous = members;
    const next = previous.filter((m) => m.userId !== userId);
    setBusyUserId(userId);
    onMembersChange(department.id, next);
    try {
      await removeMember(department.id, userId);
    } catch (caught) {
      onMembersChange(department.id, previous);
      onError(messageFrom(caught, "Could not remove the member."));
    } finally {
      setBusyUserId(null);
    }
  }

  return (
    <div className="mt-5 flex min-h-0 flex-1 flex-col gap-4">
      <h3 className="ui-settings-section-title">Members and SOP access</h3>

      {members.length === 0 ? (
        <div className="flex min-h-40 items-center justify-center text-center text-ink-tertiary">
          <div>
            <UsersRound size={20} className="mx-auto" strokeWidth={1.5} />
            <p className="mt-2 text-[12px]">No department members</p>
          </div>
        </div>
      ) : (
        <ul className="min-h-40 space-y-5">
          {members.map((member) => (
            <li key={member.userId}>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-ink" title={member.userId}>
                    {labelFor(member.userId)}
                  </div>
                  {emailFor(member.userId) ? (
                    <div className="ui-mono-label truncate text-ink-tertiary">{emailFor(member.userId)}</div>
                  ) : null}
                </div>
                {manage ? (
                  <button
                    type="button"
                    className="ui-btn-ghost h-8 w-8 shrink-0 px-0 text-ink-tertiary hover:text-danger disabled:opacity-50"
                    title="Remove member"
                    disabled={busyUserId === member.userId}
                    onClick={() => void handleRemove(member.userId)}
                  >
                    <Trash2 size={13} />
                  </button>
                ) : null}
              </div>
              {manage ? (
                <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_128px]">
                  <div className="block min-w-0">
                    <span className="ui-mono-label mb-1 block text-ink-tertiary">Position / job title</span>
                    <ThemedSelect
                      variant="sop"
                      className="w-full"
                      triggerClassName="ui-themed-select-trigger-compact px-2.5 text-xs"
                      ariaLabel="Position or job title"
                      value={member.positionTitle}
                      disabled={busyUserId === member.userId}
                      onChange={(value) => void handlePositionChange(member.userId, value)}
                      allowCustomValue
                      options={[
                        { value: "", label: "Select a position…" },
                        ...(member.positionTitle &&
                        !positionOptions.some((option) => option.value === member.positionTitle)
                          ? [{ value: member.positionTitle, label: `${member.positionTitle} (existing)` }]
                          : []),
                        ...positionOptions,
                      ]}
                    />
                  </div>
                  <div className="block">
                    <span className="ui-mono-label mb-1 block text-ink-tertiary">SOP access</span>
                    <ThemedSelect
                      variant="sop"
                      className="w-full"
                      triggerClassName="ui-themed-select-trigger-compact px-2.5 text-xs"
                      ariaLabel="SOP access"
                      value={member.deptRole}
                      disabled={busyUserId === member.userId}
                      onChange={(value) => void handleRoleChange(member.userId, value as DeptRole)}
                      options={DEPT_ROLES.map((deptRole) => ({ value: deptRole, label: deptRole }))}
                    />
                  </div>
                </div>
              ) : (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-ink-secondary">{member.positionTitle || "Position not assigned"}</span>
                  <span className="ui-chip shrink-0">{member.deptRole}</span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {manage ? (
        <div className="mt-auto pt-3">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <ThemedSelect
                variant="sop"
                className="w-full"
                triggerClassName="ui-themed-select-trigger-compact px-2.5 text-xs"
                ariaLabel="Add a department member"
                value={pick}
                disabled={adding || available.length === 0}
                onChange={setPick}
                options={[
                  {
                    value: "",
                    label: directory.length === 0
                      ? "No workspace members found"
                      : available.length === 0
                        ? "Everyone is already a member"
                        : "Add a member…",
                  },
                  ...available.map((member) => ({
                    value: member.userId,
                    label: `${memberLabel(member)}${member.fullName && member.email ? ` · ${member.email}` : ""}`,
                  })),
                ]}
              />
            </div>
            <button
              type="button"
              className="ui-btn-primary h-8 shrink-0 gap-1.5 px-3 disabled:opacity-50"
              onClick={() => void handleAdd()}
              disabled={adding || pick.length === 0}
            >
              {adding ? <Loader2 size={13} className="animate-spin" /> : <UserPlus size={13} />}
              Add
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
