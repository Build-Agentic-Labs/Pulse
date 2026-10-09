import { useState } from "react";
import Link from "next/link";
import {
  Check,
  Loader2,
  Paperclip,
  Pencil,
  Plus,
  Upload,
  X,
} from "lucide-react";
import { ThemedSelect } from "@/components/themed-select";
import {
  linkedSopLabel,
  type SopLinkedSop,
  type SopReferenceDoc,
} from "@/domain/sop/schema";
import {
  SOP_ANNEX_FILE_ACCEPT,
  type SopAnnexFile,
} from "@/lib/sop/annex-files";
import type { SopListItem } from "@/lib/sop/store";
import { RowDeleteButton } from "./editor-controls";

export function ReferenceLibraryEditor({
  references,
  links,
  docs,
  files,
  options,
  loading,
  error,
  disabled = false,
  uploading = false,
  onChangeReferences,
  onChangeLinks,
  onUpload,
  onOpenDoc,
  onRemoveDoc,
  onRenameDoc,
}: {
  references: string[];
  links: SopLinkedSop[];
  docs: SopReferenceDoc[];
  /** Reference-doc id -> uploaded file (for open/remove and the "missing file" state). */
  files: Map<string, SopAnnexFile>;
  /** Workspace SOPs offered by the picker (the current SOP already excluded). */
  options: SopListItem[];
  loading: boolean;
  error: string;
  disabled?: boolean;
  uploading?: boolean;
  onChangeReferences: (references: string[]) => void;
  onChangeLinks: (links: SopLinkedSop[]) => void;
  onUpload: (file: File) => void;
  onOpenDoc: (doc: SopReferenceDoc) => void;
  onRemoveDoc: (doc: SopReferenceDoc) => void;
  onRenameDoc: (id: string, name: string) => void;
}) {
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerMode, setComposerMode] = useState<"sop" | "text">("sop");
  const [typedReference, setTypedReference] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(
    null,
  );
  function saveReferenceName() {
    if (disabled || !renaming?.name.trim()) return;
    onRenameDoc(renaming.id, renaming.name.trim());
    setRenaming(null);
  }
  const available = options.filter(
    (option) => !links.some((link) => link.sopId === option.id),
  );

  function addTypedReference() {
    const value = typedReference.trim();
    if (!value) return;
    onChangeReferences([...references, value]);
    setTypedReference("");
    setComposerOpen(false);
  }

  return (
    <div className="space-y-2">
      <div className="mb-3 flex min-h-9 items-center justify-between gap-3">
        <h2 className="ui-setup-section-title">References</h2>
        {!disabled && !composerOpen ? (
          <ThemedSelect
            className="w-fit shrink-0"
            menuAlign="right"
            triggerClassName="h-9 gap-2.5 px-3 text-xs font-medium"
            leadingIcon={<Plus size={14} />}
            ariaLabel="Add reference"
            value=""
            placeholder="Add reference"
            options={[
              { value: "sop", label: "Effective SOP" },
              { value: "text", label: "Typed reference" },
            ]}
            onChange={(mode) => {
              setComposerMode(mode === "text" ? "text" : "sop");
              setComposerOpen(true);
            }}
          />
        ) : null}
      </div>
      {references.map((reference, index) => (
        <div
          key={`reference-${index}`}
          className="flex min-h-9 items-center gap-2"
        >
          <input
            className="ui-field-standalone min-w-0 flex-1"
            value={reference}
            placeholder="e.g. ISO 9001:2015"
            disabled={disabled}
            onChange={(event) => {
              const next = [...references];
              next[index] = event.target.value;
              onChangeReferences(next);
            }}
          />
          {disabled ? null : (
            <RowDeleteButton
              title="Remove reference"
              onClick={() =>
                onChangeReferences(
                  references.filter((_, rowIndex) => rowIndex !== index),
                )
              }
            />
          )}
        </div>
      ))}

      {links.map((link) => (
        <div key={link.sopId} className="flex min-h-9 items-center gap-2">
          <span className="ui-chip shrink-0">{link.sopNumber || "SOP"}</span>
          <Link
            href={`/sops/${link.sopId}`}
            className="min-w-0 flex-1 truncate text-sm text-ink hover:underline"
            title={linkedSopLabel(link)}
          >
            {link.title || "Untitled SOP"}
          </Link>
          {disabled ? null : (
            <RowDeleteButton
              title="Remove SOP reference"
              onClick={() =>
                onChangeLinks(links.filter((item) => item.sopId !== link.sopId))
              }
            />
          )}
        </div>
      ))}

      {docs.map((doc) => {
        const file = files.get(doc.id);
        return (
          <div key={doc.id} className="flex min-h-9 items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center text-ink-tertiary">
              <Paperclip size={14} />
            </span>
            {renaming?.id === doc.id && !disabled ? (
              <>
                <input
                  autoFocus
                  aria-label="Reference name"
                  className="ui-field-standalone min-w-0 flex-1"
                  value={renaming.name}
                  maxLength={260}
                  onChange={(event) =>
                    setRenaming({ id: doc.id, name: event.target.value })
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      saveReferenceName();
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      event.stopPropagation();
                      setRenaming(null);
                    }
                  }}
                />
                <button
                  type="button"
                  className="ui-btn-ghost h-9 w-9 shrink-0 px-0"
                  aria-label="Save reference name"
                  title="Save reference name"
                  disabled={!renaming.name.trim()}
                  onClick={saveReferenceName}
                >
                  <Check size={14} />
                </button>
                <button
                  type="button"
                  className="ui-btn-ghost h-9 w-9 shrink-0 px-0"
                  aria-label="Cancel rename"
                  title="Cancel rename"
                  onClick={() => setRenaming(null)}
                >
                  <X size={14} />
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left text-sm text-ink hover:underline"
                  title={
                    file ? `Open ${doc.name}` : `${doc.name} (file missing)`
                  }
                  onClick={() => onOpenDoc(doc)}
                >
                  {doc.name}
                  {!file ? (
                    <span className="ml-2 text-[11px] text-danger">
                      file missing
                    </span>
                  ) : null}
                </button>
                {disabled ? null : (
                  <button
                    type="button"
                    className="ui-btn-ghost h-9 w-9 shrink-0 px-0 text-ink-tertiary"
                    aria-label={`Rename ${doc.name}`}
                    title="Rename reference"
                    onClick={() => setRenaming({ id: doc.id, name: doc.name })}
                  >
                    <Pencil size={13} />
                  </button>
                )}
              </>
            )}
            {disabled ? null : (
              <RowDeleteButton
                title="Remove document reference"
                onClick={() => onRemoveDoc(doc)}
              />
            )}
          </div>
        );
      })}

      {error ? <p className="text-xs text-danger">{error}</p> : null}

      {disabled ? null : composerOpen ? (
        <div className="mt-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              {composerMode === "sop" ? (
                loading ? (
                  <div className="flex min-h-9 items-center gap-2 text-xs text-ink-tertiary">
                    <Loader2 size={13} className="animate-spin" /> Loading
                    effective SOPs…
                  </div>
                ) : available.length ? (
                  <ThemedSelect
                    className="w-full"
                    ariaLabel="Select an effective SOP"
                    value=""
                    placeholder="Select effective SOP…"
                    options={available.map((option) => ({
                      value: option.id,
                      label: `${option.sopNumber || "—"} · ${option.title || "Untitled SOP"}`,
                    }))}
                    onChange={(sopId) => {
                      const target = available.find(
                        (option) => option.id === sopId,
                      );
                      if (!target) return;
                      onChangeLinks([
                        ...links,
                        {
                          sopId: target.id,
                          sopNumber: target.sopNumber,
                          title: target.title,
                        },
                      ]);
                      setComposerOpen(false);
                    }}
                  />
                ) : (
                  <div className="flex min-h-9 items-center rounded-md border border-line px-3 text-xs text-ink-tertiary">
                    {options.length
                      ? "Every effective SOP is already referenced."
                      : "No effective SOPs are available yet."}
                  </div>
                )
              ) : (
                <div className="flex gap-2">
                  <input
                    id="typed-sop-reference"
                    className="ui-field-standalone min-w-0 flex-1"
                    aria-label="Typed reference"
                    value={typedReference}
                    placeholder="e.g. ISO 9001:2015"
                    onChange={(event) => setTypedReference(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") return;
                      event.preventDefault();
                      addTypedReference();
                    }}
                  />
                  <button
                    type="button"
                    className="ui-btn-primary h-9 shrink-0 px-3 disabled:opacity-40"
                    disabled={!typedReference.trim()}
                    onClick={addTypedReference}
                  >
                    Add
                  </button>
                </div>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-1">
              {composerMode === "text" ? (
                <label
                  className={`ui-btn-ghost inline-flex h-9 w-9 items-center justify-center px-0 ${
                    uploading
                      ? "pointer-events-none cursor-wait opacity-60"
                      : "cursor-pointer"
                  }`}
                  aria-disabled={uploading}
                  aria-label={
                    uploading
                      ? "Attaching reference document"
                      : "Attach reference document"
                  }
                  title={uploading ? "Attaching document…" : "Attach document"}
                >
                  {uploading ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Upload size={13} />
                  )}
                  <span className="sr-only">
                    {uploading ? "Attaching…" : "Attach document"}
                  </span>
                  <input
                    type="file"
                    className="sr-only"
                    aria-label="Attach reference document"
                    accept={SOP_ANNEX_FILE_ACCEPT}
                    disabled={uploading}
                    onChange={(event) => {
                      const selected = event.target.files?.[0];
                      if (selected) onUpload(selected);
                      event.target.value = "";
                    }}
                  />
                </label>
              ) : null}
              <button
                type="button"
                className="ui-btn-ghost h-9 w-9 shrink-0 px-0 text-ink-tertiary"
                aria-label="Close reference options"
                title="Close"
                onClick={() => {
                  setComposerOpen(false);
                  setComposerMode("sop");
                  setTypedReference("");
                }}
              >
                <X size={13} />
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
