"use client";

import { Pencil, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useConfirm } from "@/components/confirm-provider";
import { GENERAL_RASIC_ROLES } from "@/domain/departments";
import {
  deleteRasicRole,
  listRasicRoles,
  renameRasicRole,
  type RasicRole,
} from "@/lib/sop/rasic-roles/store";

function messageFrom(caught: unknown, fallback: string): string {
  return caught instanceof Error && caught.message ? caught.message : fallback;
}

/**
 * Curation for the roles SOP authors have typed.
 *
 * Only workspace-added roles appear here. The department position titles and the eight General
 * roles ship in code and are not editable — which is the point of shipping them in code: the
 * baseline cannot be broken, and cleanup applies exactly where drift happens.
 *
 * Renaming or deleting changes what the dropdown OFFERS. Documents keep whatever string they
 * already store — `procedure.roles` is free text, so a used role survives its removal here and
 * renders through the editor's "Current role" group. Rewriting documents instead would move
 * their content_hash and void signatures.
 */
export function RasicRolesAdmin({ workspaceId, manage }: { workspaceId?: string; manage: boolean }) {
  const confirm = useConfirm();
  const [roles, setRoles] = useState<RasicRole[]>([]);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceId) return;
    let active = true;
    listRasicRoles(workspaceId)
      .then((next) => {
        if (active) setRoles(next);
      })
      .catch((caught) => {
        if (active) setError(messageFrom(caught, "Could not load the role list."));
      });
    return () => {
      active = false;
    };
  }, [workspaceId]);

  async function handleRename(role: RasicRole) {
    const name = draftName.trim();
    setEditingId(null);
    if (!name || name === role.name) return;
    const previous = roles;
    setBusyId(role.id);
    setRoles((current) => current.map((item) => (item.id === role.id ? { ...item, name } : item)));
    try {
      await renameRasicRole(role.id, name);
      setError("");
    } catch (caught) {
      setRoles(previous);
      setError(messageFrom(caught, "Could not rename the role."));
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(role: RasicRole) {
    const ok = await confirm({
      title: `Remove "${role.name}"?`,
      body: "It stops being offered in the role dropdown. SOPs already using it keep the name.",
      tone: "danger",
      confirmLabel: "Remove role",
    });
    if (!ok) return;
    const previous = roles;
    setBusyId(role.id);
    setRoles((current) => current.filter((item) => item.id !== role.id));
    try {
      await deleteRasicRole(role.id);
      setError("");
    } catch (caught) {
      setRoles(previous);
      setError(messageFrom(caught, "Could not remove the role."));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="ui-panel overflow-hidden bg-transparent">
      <div className="border-b border-line px-4 py-3">
        <h3 className="ui-setup-section-title">RASIC roles added by your team</h3>
        <p className="mt-1 text-xs text-ink-tertiary">
          {`Roles authors typed in an SOP's procedure. The ${GENERAL_RASIC_ROLES.length} general roles and each department's standard titles are always offered and are not listed here. Renaming or removing one changes what the dropdown offers; SOPs already using it keep the name.`}
        </p>
      </div>

      {error ? <div className="ui-notice ui-notice-warn m-4 px-4 py-3 text-xs">{error}</div> : null}

      {roles.length === 0 ? (
        <p className="px-4 py-8 text-center text-xs text-ink-tertiary">
          No roles have been added yet. Authors add them by typing in the role dropdown.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {roles.map((role) => (
            <li key={role.id} className="flex items-center gap-3 px-4 py-2.5">
              {editingId === role.id ? (
                <input
                  type="text"
                  autoFocus
                  className="ui-field-standalone min-w-0 flex-1"
                  aria-label={`Rename ${role.name}`}
                  value={draftName}
                  disabled={busyId === role.id}
                  onChange={(event) => setDraftName(event.target.value)}
                  onBlur={() => void handleRename(role)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void handleRename(role);
                    if (event.key === "Escape") setEditingId(null);
                  }}
                />
              ) : (
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{role.name}</span>
              )}

              {manage && editingId !== role.id ? (
                <>
                  <button
                    type="button"
                    className="ui-btn-ghost h-8 w-8 px-0 text-ink-tertiary hover:text-ink"
                    title="Rename role"
                    disabled={busyId === role.id}
                    onClick={() => {
                      setEditingId(role.id);
                      setDraftName(role.name);
                    }}
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    type="button"
                    className="ui-btn-ghost h-8 w-8 px-0 text-ink-tertiary hover:text-danger"
                    title="Remove role"
                    disabled={busyId === role.id}
                    onClick={() => void handleDelete(role)}
                  >
                    <Trash2 size={12} />
                  </button>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
