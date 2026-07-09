"use client";

import { Building2, FileText, Flag, Loader2, Plus, Trash2, UserPlus } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useConfirm } from "@/components/confirm-provider";
import type { Department, DepartmentMember, DeptRole } from "@/domain/departments";
import {
  deleteDepartment,
  listDepartments,
  listMembers,
  removeMember,
  saveDepartment,
  setMember,
} from "@/lib/departments/store";
import { SopShell } from "./sop-shell";
import { canManage, SopWorkspaceSwitcher, useSopWorkspace } from "./sop-workspace-provider";

const DEPT_ROLES: readonly DeptRole[] = ["author", "reviewer", "approver"];
const QA_GATE_NOTE =
  "Quality approvers can approve SOPs in any department — the independent gate.";

interface DepartmentDraft {
  code: string;
  name: string;
  isQualityGate: boolean;
}

function messageFrom(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function DepartmentsAdmin() {
  const confirm = useConfirm();
  const { workspaceId, role } = useSopWorkspace();
  const manage = canManage(role);

  const [departments, setDepartments] = useState<Department[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);

  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleError = useCallback((message: string) => setError(message), []);
  const handleCountChange = useCallback((departmentId: string, count: number) => {
    setCounts((prev) => (prev[departmentId] === count ? prev : { ...prev, [departmentId]: count }));
  }, []);

  const refresh = useCallback(async () => {
    if (!workspaceId) {
      setDepartments([]);
      setStatus("ready");
      return;
    }
    setStatus("loading");
    setError("");
    try {
      const next = await listDepartments(workspaceId);
      setDepartments(next);
      setSelectedId((current) =>
        current && next.some((dept) => dept.id === current) ? current : next[0]?.id,
      );
      setStatus("ready");
      // Member counts are secondary: a failure here surfaces a banner but keeps the list usable.
      try {
        const lists = await Promise.all(next.map((dept) => listMembers(dept.id)));
        const nextCounts: Record<string, number> = {};
        next.forEach((dept, index) => {
          nextCounts[dept.id] = lists[index].length;
        });
        setCounts(nextCounts);
      } catch (caught) {
        setError(messageFrom(caught, "Could not load member counts."));
      }
    } catch (caught) {
      setError(messageFrom(caught, "Could not load departments."));
      setStatus("error");
    }
  }, [workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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
      setCounts((prev) => ({ ...prev, [saved.id]: prev[saved.id] ?? 0 }));
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
    const remaining = previous.filter((entry) => entry.id !== dept.id);
    setDepartments(remaining);
    if (selectedId === dept.id) setSelectedId(remaining[0]?.id);
    try {
      await deleteDepartment(dept.id);
    } catch (caught) {
      setDepartments(previous);
      setError(messageFrom(caught, "Could not delete the department."));
    }
  }

  const sidebar = (
    <>
      <div className="ui-nav-section">SOPs</div>
      <div className="space-y-0.5">
        <Link href="/sops" className="ui-nav-item ui-nav-item-idle">
          <FileText size={15} strokeWidth={1.75} />
          <span>All SOPs</span>
        </Link>
      </div>
      <div className="ui-nav-section mt-4">Manage</div>
      <div className="space-y-0.5">
        <span className="ui-nav-item ui-nav-item-active">
          <Building2 size={15} strokeWidth={1.75} />
          <span>Departments</span>
        </span>
      </div>
      <SopWorkspaceSwitcher />
    </>
  );

  return (
    <SopShell sidebar={sidebar} crumb="Quality / Departments">
      <div className="mx-auto max-w-5xl space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="ui-section-title">Departments</h1>
            <p className="ui-section-subtitle">
              Each department authors and owns its SOPs. Roles here decide who can draft, review and approve.
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

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section className="ui-panel overflow-hidden">
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
                          className={`cursor-pointer border-b border-line transition-colors last:border-b-0 ${
                            active ? "bg-surface-muted" : "hover:bg-surface-hover"
                          }`}
                        >
                          <td className="px-4 py-3">
                            <span className="ui-chip-accent">{dept.code}</span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-sm font-medium text-ink">{dept.name}</span>
                            {dept.isQualityGate ? (
                              <span className="ui-chip ml-2 border-danger text-danger">QA gate</span>
                            ) : null}
                          </td>
                          <td className="px-4 py-3 text-right ui-mono-label text-ink-secondary">
                            {counts[dept.id] ?? "—"}
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
            <section className="ui-panel space-y-4 p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="ui-chip-accent">{selected.code}</span>
                  <span className="ui-mono-label text-ink-secondary">{selected.name}</span>
                </div>
                {selected.isQualityGate ? (
                  <span className="ui-chip border-danger text-danger">QA gate</span>
                ) : null}
              </div>

              {selected.isQualityGate ? (
                <div className="ui-notice ui-notice-warn flex gap-2 px-3 py-2.5 text-[11.5px] text-ink-secondary">
                  <Flag size={14} className="mt-0.5 shrink-0 text-danger" strokeWidth={1.75} />
                  <span>
                    <span className="font-medium text-ink">Independent QA gate.</span> {QA_GATE_NOTE}
                  </span>
                </div>
              ) : null}

              <MembersPanel
                department={selected}
                manage={manage}
                onError={handleError}
                onCountChange={handleCountChange}
              />

              {manage ? (
                <button
                  type="button"
                  className="ui-btn-ghost h-8 gap-1.5 px-3 text-ink-tertiary hover:text-danger"
                  onClick={() => void handleDeleteDepartment(selected)}
                >
                  <Trash2 size={13} />
                  Delete department
                </button>
              ) : null}
            </section>
          ) : (
            <section className="ui-panel flex items-center justify-center p-6 text-center">
              <p className="ui-section-subtitle text-ink-tertiary">Select a department to view its members.</p>
            </section>
          )}
        </div>
      </div>
    </SopShell>
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
    <section className="ui-panel space-y-3 p-4">
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
  onError: (message: string) => void;
  onCountChange: (departmentId: string, count: number) => void;
}

function MembersPanel({ department, manage, onError, onCountChange }: MembersPanelProps) {
  const [members, setMembers] = useState<DepartmentMember[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [newUserId, setNewUserId] = useState("");
  const [adding, setAdding] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const next = await listMembers(department.id);
      setMembers(next);
      onCountChange(department.id, next.length);
      setStatus("ready");
    } catch (caught) {
      onError(messageFrom(caught, "Could not load members."));
      setStatus("error");
    }
  }, [department.id, onCountChange, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleRoleChange(userId: string, nextRole: DeptRole) {
    const previous = members;
    setBusyUserId(userId);
    setMembers((current) => current.map((m) => (m.userId === userId ? { ...m, deptRole: nextRole } : m)));
    try {
      await setMember(department.id, userId, nextRole);
    } catch (caught) {
      setMembers(previous);
      onError(messageFrom(caught, "Could not change the member's role."));
    } finally {
      setBusyUserId(null);
    }
  }

  async function handleAdd() {
    const userId = newUserId.trim();
    if (!userId) return;
    setAdding(true);
    try {
      await setMember(department.id, userId, "author");
      const next = await listMembers(department.id);
      setMembers(next);
      onCountChange(department.id, next.length);
      setNewUserId("");
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
    setMembers(next);
    onCountChange(department.id, next.length);
    try {
      await removeMember(department.id, userId);
    } catch (caught) {
      setMembers(previous);
      onCountChange(department.id, previous.length);
      onError(messageFrom(caught, "Could not remove the member."));
    } finally {
      setBusyUserId(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="ui-mono-label text-ink-secondary">Members &amp; roles</div>

      {status === "loading" ? (
        <div className="flex items-center gap-2 py-2 ui-section-subtitle text-ink-tertiary">
          <Loader2 size={14} className="animate-spin" />
          Loading members…
        </div>
      ) : members.length === 0 ? (
        <p className="ui-section-subtitle text-ink-tertiary">No members yet.</p>
      ) : (
        <ul className="space-y-2">
          {members.map((member) => (
            <li key={member.userId} className="flex items-center gap-2">
              <span className="ui-mono-label min-w-0 flex-1 truncate text-ink" title={member.userId}>
                {member.userId}
              </span>
              {manage ? (
                <>
                  <select
                    className="ui-field-standalone h-8 shrink-0 px-2 py-0 text-xs disabled:opacity-50"
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
                  <button
                    type="button"
                    className="ui-btn-ghost h-8 w-8 shrink-0 px-0 text-ink-tertiary hover:text-danger disabled:opacity-50"
                    title="Remove member"
                    disabled={busyUserId === member.userId}
                    onClick={() => void handleRemove(member.userId)}
                  >
                    <Trash2 size={13} />
                  </button>
                </>
              ) : (
                <span className="ui-chip shrink-0">{member.deptRole}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {manage ? (
        <div className="space-y-1.5 border-t border-line pt-3">
          <div className="flex items-center gap-2">
            <input
              className="ui-field-standalone h-8 min-w-0 flex-1 px-2 text-xs"
              placeholder="Add member by user ID"
              value={newUserId}
              onChange={(event) => setNewUserId(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void handleAdd();
              }}
            />
            <button
              type="button"
              className="ui-btn-primary h-8 shrink-0 gap-1.5 px-3 disabled:opacity-50"
              onClick={() => void handleAdd()}
              disabled={adding || newUserId.trim().length === 0}
            >
              {adding ? <Loader2 size={13} className="animate-spin" /> : <UserPlus size={13} />}
              Add
            </button>
          </div>
          <p className="ui-mono-label text-ink-tertiary">
            Paste the member&rsquo;s Supabase user ID (UUID). Added as author — adjust the role above. A full
            name/email picker is out of scope for now.
          </p>
        </div>
      ) : null}
    </div>
  );
}
