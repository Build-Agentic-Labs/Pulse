"use client";

import { Building2, ChevronDown, Flag, Loader2, Plus, Trash2, UserPlus, UsersRound } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConfirm } from "@/components/confirm-provider";
import { standardPositionTitlesForDepartment, type Department, type DepartmentMember, type DeptRole } from "@/domain/departments";
import { loadMembersAccessForWorkspace } from "@/domain/supabase-planner";
import type { MemberAccess } from "@/domain/types";
import {
  deleteDepartment,
  listDepartments,
  listMembersForDepartments,
  removeMember,
  saveDepartment,
  setMember,
  setMemberPosition,
} from "@/lib/departments/store";
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

export function DepartmentsAdmin({ active = true }: { active?: boolean }) {
  const confirm = useConfirm();
  const { workspaceId, role } = useSopWorkspace();
  const manage = canManage(role);

  const [departments, setDepartments] = useState<Department[]>([]);
  const [membersByDepartment, setMembersByDepartment] = useState<Record<string, DepartmentMember[]>>({});
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);

  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [directory, setDirectory] = useState<MemberAccess[]>([]);
  const freshnessRef = useRef<{ workspaceId?: string; loadedAt: number }>({ loadedAt: 0 });

  const handleError = useCallback((message: string) => setError(message), []);
  const handleMembersChange = useCallback((departmentId: string, members: DepartmentMember[]) => {
    setMembersByDepartment((current) => ({ ...current, [departmentId]: members }));
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
      const nextMembers = Object.fromEntries(
        next.map((department) => [department.id, [] as DepartmentMember[]]),
      );
      for (const member of members) {
        nextMembers[member.departmentId]?.push(member);
      }
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
    if (!active) return;
    const hasCurrentData =
      freshnessRef.current.workspaceId === workspaceId && freshnessRef.current.loadedAt > 0;
    if (hasCurrentData && Date.now() - freshnessRef.current.loadedAt < 30_000) return;
    void refresh({ background: hasCurrentData });
  }, [active, refresh, workspaceId]);

  // The workspace member directory powers the name/email member picker (no raw UUIDs).
  useEffect(() => {
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
  }, [workspaceId]);

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
    <div className="ui-depts mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="ui-section-title">Departments</h1>
            <p className="ui-section-subtitle">
              Assign ownership and control who can author, review, and approve SOPs.
            </p>
          </div>
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
              <div className="flex items-center justify-center px-4 py-12">
                <Loader2 size={18} className="animate-spin text-ink-tertiary" />
              </div>
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
                      <th className="ui-mono-label px-4 py-2.5 text-left text-ink-tertiary">Code</th>
                      <th className="ui-mono-label px-4 py-2.5 text-left text-ink-tertiary">Department</th>
                      <th className="ui-mono-label px-4 py-2.5 text-right text-ink-tertiary">Members</th>
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
                            <span className="text-sm font-medium text-ink">{dept.name}</span>
                            {dept.isQualityGate ? (
                              <span className="ui-dept-gate ml-2">
                                <Flag size={11} strokeWidth={1.8} />
                                Quality gate
                              </span>
                            ) : null}
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
                  <h2 className="truncate text-lg font-semibold leading-tight text-ink">{selected.name}</h2>
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

              <MembersPanel
                key={selected.id}
                department={selected}
                manage={manage}
                directory={directory}
                members={membersByDepartment[selected.id] ?? []}
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
      </div>
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
    <section className="space-y-3 border-y border-line bg-surface px-5 py-4">
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
}

function MembersPanel({
  department,
  manage,
  directory,
  members,
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
    } catch (caught) {
      onMembersChange(department.id, previous);
      onError(messageFrom(caught, "Could not save the member's position."));
    } finally {
      setBusyUserId(null);
    }
  }

  const positionOptions = standardPositionTitlesForDepartment(department.code);

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
      <div className="border-b border-line pb-3">
        <h3 className="text-sm font-semibold text-ink">Members and SOP access</h3>
      </div>

      {members.length === 0 ? (
        <div className="flex min-h-40 items-center justify-center border-y border-line text-center text-ink-tertiary">
          <div>
            <UsersRound size={20} className="mx-auto" strokeWidth={1.5} />
            <p className="mt-2 text-sm">No department members</p>
          </div>
        </div>
      ) : (
        <ul className="min-h-40 divide-y divide-line border-y border-line">
          {members.map((member) => (
            <li key={member.userId} className="py-4">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-ink" title={member.userId}>
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
                  <label className="block min-w-0">
                    <span className="ui-mono-label mb-1 block text-ink-tertiary">Position / job title</span>
                    <div className="relative">
                      <select
                        className="ui-field-standalone h-8 w-full cursor-pointer appearance-none pl-2.5 pr-7 text-xs shadow-none transition-colors hover:border-border-strong focus:border-border-strong disabled:opacity-50"
                        value={member.positionTitle}
                        disabled={busyUserId === member.userId}
                        onChange={(event) => void handlePositionChange(member.userId, event.target.value)}
                      >
                        <option value="">Select a position…</option>
                        {member.positionTitle && !positionOptions.includes(member.positionTitle) ? (
                          <option value={member.positionTitle}>{member.positionTitle} (existing)</option>
                        ) : null}
                        {positionOptions.map((positionTitle) => (
                          <option key={positionTitle} value={positionTitle}>{positionTitle}</option>
                        ))}
                      </select>
                      <ChevronDown
                        size={13}
                        strokeWidth={2}
                        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-tertiary"
                      />
                    </div>
                  </label>
                  <label className="block">
                    <span className="ui-mono-label mb-1 block text-ink-tertiary">SOP access</span>
                    <div className="relative">
                    <select
                      className="ui-field-standalone h-8 w-full cursor-pointer appearance-none pl-2.5 pr-7 text-xs shadow-none transition-colors hover:border-border-strong focus:border-border-strong disabled:opacity-50"
                      value={member.deptRole}
                      disabled={busyUserId === member.userId}
                      onChange={(event) => void handleRoleChange(member.userId, event.target.value as DeptRole)}
                    >
                      {DEPT_ROLES.map((deptRole) => (
                        <option key={deptRole} value={deptRole}>
                          {deptRole}
                        </option>
                      ))}
                    </select>
                    <ChevronDown
                      size={13}
                      strokeWidth={2}
                      className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-tertiary"
                    />
                  </div>
                  </label>
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
        <div className="mt-auto border-t border-line pt-4">
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <select
                className="ui-field-standalone h-8 w-full cursor-pointer appearance-none pl-2.5 pr-8 text-xs shadow-none transition-colors hover:border-border-strong focus:border-border-strong disabled:opacity-50"
                value={pick}
                disabled={adding || available.length === 0}
                onChange={(event) => setPick(event.target.value)}
              >
                <option value="">
                  {directory.length === 0
                    ? "No workspace members found"
                    : available.length === 0
                      ? "Everyone is already a member"
                      : "Add a member…"}
                </option>
                {available.map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {memberLabel(member)}
                    {member.fullName && member.email ? ` · ${member.email}` : ""}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={14}
                strokeWidth={2}
                className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-tertiary"
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
