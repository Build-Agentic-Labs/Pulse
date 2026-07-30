"use client";

import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { useConfirm } from "@/components/confirm-provider";
import { deleteJobTitle, renameJobTitle, type JobTitle } from "@/lib/sop/job-titles/store";

function messageFrom(caught: unknown, fallback: string): string {
  return caught instanceof Error && caught.message ? caught.message : fallback;
}

/**
 * Curation for job titles the workspace typed itself.
 *
 * Only typed titles appear here. Each department's standard titles ship in code and are not
 * editable — that is why they ship in code: the baseline cannot be broken, and cleanup applies
 * exactly where drift happens.
 *
 * Renaming or removing changes what the picker OFFERS. A member already holding the title keeps
 * it: the title is stored on the membership row, not as a reference to this list.
 */
export function JobTitlesAdmin({
  titles,
  manage,
  onChanged,
}: {
  titles: readonly JobTitle[];
  manage: boolean;
  onChanged: (titles: JobTitle[]) => void;
}) {
  const confirm = useConfirm();
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  async function handleRename(title: JobTitle) {
    const name = draftName.trim();
    setEditingId(null);
    if (!name || name === title.name) return;
    const previous = [...titles];
    setBusyId(title.id);
    onChanged(titles.map((item) => (item.id === title.id ? { ...item, name } : item)));
    try {
      await renameJobTitle(title.id, name);
      setError("");
    } catch (caught) {
      onChanged(previous);
      setError(messageFrom(caught, "Could not rename the job title."));
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(title: JobTitle) {
    const ok = await confirm({
      title: `Remove "${title.name}"?`,
      body: "It stops being offered when assigning a position. Anyone already holding it keeps it.",
      tone: "danger",
      confirmLabel: "Remove title",
    });
    if (!ok) return;
    const previous = [...titles];
    setBusyId(title.id);
    onChanged(titles.filter((item) => item.id !== title.id));
    try {
      await deleteJobTitle(title.id);
      setError("");
    } catch (caught) {
      onChanged(previous);
      setError(messageFrom(caught, "Could not remove the job title."));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="ui-panel overflow-hidden bg-transparent">
      <div className="border-b border-line px-4 py-3">
        <h3 className="ui-setup-section-title">Job titles added by your team</h3>
        <p className="mt-1 text-xs text-ink-tertiary">
          {`Titles typed when assigning someone a position. Each department's standard titles are always offered and are not listed here. Renaming or removing one changes what the picker offers; anyone already holding it keeps it.`}
        </p>
      </div>

      {error ? <div className="ui-notice ui-notice-warn m-4 px-4 py-3 text-xs">{error}</div> : null}

      {titles.length === 0 ? (
        <p className="px-4 py-8 text-center text-xs text-ink-tertiary">
          No job titles have been added yet. Type one in a member&apos;s position picker to add it.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {titles.map((title) => (
            <li key={title.id} className="flex items-center gap-3 px-4 py-2.5">
              {editingId === title.id ? (
                <input
                  type="text"
                  autoFocus
                  className="ui-field-standalone min-w-0 flex-1"
                  aria-label={`Rename ${title.name}`}
                  value={draftName}
                  disabled={busyId === title.id}
                  onChange={(event) => setDraftName(event.target.value)}
                  onBlur={() => void handleRename(title)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void handleRename(title);
                    if (event.key === "Escape") setEditingId(null);
                  }}
                />
              ) : (
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{title.name}</span>
              )}

              {manage && editingId !== title.id ? (
                <>
                  <button
                    type="button"
                    className="ui-btn-ghost h-8 w-8 px-0 text-ink-tertiary hover:text-ink"
                    title="Rename job title"
                    disabled={busyId === title.id}
                    onClick={() => {
                      setEditingId(title.id);
                      setDraftName(title.name);
                    }}
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    type="button"
                    className="ui-btn-ghost h-8 w-8 px-0 text-ink-tertiary hover:text-danger"
                    title="Remove job title"
                    disabled={busyId === title.id}
                    onClick={() => void handleDelete(title)}
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
