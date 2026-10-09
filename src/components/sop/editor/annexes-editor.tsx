import { useState } from "react";
import { Check, Loader2, Paperclip, Pencil, Upload, X } from "lucide-react";
import type { Sop } from "@/domain/sop/schema";
import {
  SOP_ANNEX_FILE_ACCEPT,
  type SopAnnexFile,
} from "@/lib/sop/annex-files";
import { AddButton, RowDeleteButton } from "./editor-controls";

export type AnnexUploadStatus = {
  annexId: string;
  phase: "saving" | "uploading" | "success" | "error";
  message: string;
};

function newAnnexId(sopId: string): string {
  const suffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${sopId}-annex-${suffix}`;
}

export function AnnexesEditor({
  sopId,
  rows,
  files,
  disabled = false,
  uploadingAnnexId,
  uploadStatus,
  onChange,
  onUpload,
  onOpen,
  onRename,
  onRemoveFile,
  onRemoveRow,
}: {
  sopId: string;
  rows: Sop["annexes"];
  files: SopAnnexFile[];
  disabled?: boolean;
  uploadingAnnexId: string | null;
  uploadStatus: AnnexUploadStatus | null;
  onChange: (changeRows: (current: Sop["annexes"]) => Sop["annexes"]) => void;
  onUpload: (index: number, file: File) => void | Promise<void>;
  onOpen: (file: SopAnnexFile) => void;
  onRename: (file: SopAnnexFile, name: string) => Promise<void>;
  onRemoveFile: (file: SopAnnexFile) => void;
  onRemoveRow: (index: number) => void;
}) {
  const [renaming, setRenaming] = useState<{
    file: SopAnnexFile;
    name: string;
  } | null>(null);
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState("");
  async function saveName() {
    if (!renaming?.name.trim() || renameBusy || disabled) return;
    setRenameBusy(true);
    setRenameError("");
    try {
      await onRename(renaming.file, renaming.name.trim());
      setRenaming(null);
    } catch (error) {
      setRenameError(
        error instanceof Error
          ? error.message
          : "Could not rename the attachment.",
      );
    } finally {
      setRenameBusy(false);
    }
  }
  function patch(index: number, field: "label" | "description", value: string) {
    onChange((current) =>
      current.map((row, rowIndex) =>
        rowIndex === index ? { ...row, [field]: value } : row,
      ),
    );
  }

  return (
    <div>
      {rows.length ? (
        <div className="hidden grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] gap-2 px-1 pb-2 sm:grid">
          <span className="ui-field-label">Form name</span>
          <span className="ui-field-label">Description</span>
          <span className="w-9" aria-hidden="true" />
        </div>
      ) : null}
      <div
        className={
          rows.length ? "divide-y divide-line border-y border-line" : ""
        }
      >
        {rows.map((row, index) => {
          const file = files.find((item) => item.annexId === row.id);
          const uploading = uploadingAnnexId === row.id;
          const rowStatus =
            uploadStatus?.annexId === row.id ? uploadStatus : null;
          const uploadLabel = uploading
            ? rowStatus?.phase === "saving"
              ? "Saving attachment"
              : "Uploading attachment"
            : file
              ? "Replace attachment"
              : "Upload attachment";
          return (
            <div key={row.id ?? index} className="py-3 first:pt-2 last:pb-2">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]">
                <input
                  className="ui-field-standalone col-start-1 row-start-1 min-w-0 sm:col-start-auto sm:row-start-auto"
                  value={row.label}
                  aria-label="Form name"
                  data-example="Appendix A"
                  disabled={disabled}
                  onChange={(event) =>
                    patch(index, "label", event.target.value)
                  }
                />
                <input
                  className="ui-field-standalone col-span-2 row-start-2 min-w-0 sm:col-span-1 sm:row-start-auto"
                  value={row.description}
                  aria-label="Form description"
                  data-example="Order escalation approval form"
                  disabled={disabled}
                  onChange={(event) =>
                    patch(index, "description", event.target.value)
                  }
                />
                <div className="col-start-2 row-start-1 sm:col-start-auto sm:row-start-auto">
                  {disabled ? (
                    <span className="block w-9" />
                  ) : (
                    <RowDeleteButton
                      title="Delete annex row"
                      onClick={() => onRemoveRow(index)}
                    />
                  )}
                </div>
              </div>

              <div className="mt-2 flex min-h-9 items-center gap-2 border-t border-line/70 pt-2">
                {file && renaming?.file.id === file.id && !disabled ? (
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <input
                      autoFocus
                      aria-label="Attachment name"
                      className="ui-field-standalone min-w-0 flex-1"
                      maxLength={260}
                      value={renaming.name}
                      disabled={renameBusy}
                      onChange={(event) =>
                        setRenaming({ file, name: event.target.value })
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void saveName();
                        }
                        if (event.key === "Escape" && !renameBusy) {
                          event.preventDefault();
                          setRenaming(null);
                          setRenameError("");
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="ui-btn-ghost h-9 w-9 px-0"
                      aria-label="Save attachment name"
                      disabled={renameBusy || !renaming.name.trim()}
                      onClick={() => void saveName()}
                    >
                      {renameBusy ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Check size={14} />
                      )}
                    </button>
                    <button
                      type="button"
                      className="ui-btn-ghost h-9 w-9 px-0"
                      aria-label="Cancel attachment rename"
                      disabled={renameBusy}
                      onClick={() => {
                        setRenaming(null);
                        setRenameError("");
                      }}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : file ? (
                  <button
                    type="button"
                    className="group flex min-w-0 flex-1 items-center gap-2 text-left"
                    title={`Open ${file.originalName}`}
                    onClick={() => onOpen(file)}
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center text-ink-secondary">
                      <Paperclip size={14} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-ink group-hover:underline">
                        {file.originalName}
                      </span>
                    </span>
                  </button>
                ) : (
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center text-ink-tertiary">
                      <Paperclip size={14} />
                    </span>
                    <span className="text-xs text-ink-tertiary">
                      No form attached
                    </span>
                  </div>
                )}
                {disabled ? null : (
                  <div className="flex shrink-0 items-center gap-1">
                    {file && !renaming ? (
                      <button
                        type="button"
                        className="ui-btn-ghost h-8 w-8 px-0 text-ink-tertiary"
                        aria-label={`Rename ${file.originalName}`}
                        title="Rename attachment"
                        onClick={() => {
                          setRenaming({ file, name: file.originalName });
                          setRenameError("");
                        }}
                      >
                        <Pencil size={13} />
                      </button>
                    ) : null}
                    <label
                      className={`ui-btn-ghost inline-flex h-8 w-8 items-center justify-center px-0 ${
                        uploading
                          ? "pointer-events-none cursor-wait opacity-60"
                          : "cursor-pointer"
                      }`}
                      aria-disabled={uploading}
                      aria-label={uploadLabel}
                      title={uploadLabel}
                    >
                      {uploading ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <Upload size={13} />
                      )}
                      <span className="sr-only">{uploadLabel}</span>
                      <input
                        type="file"
                        className="sr-only"
                        aria-label={uploadLabel}
                        accept={SOP_ANNEX_FILE_ACCEPT}
                        disabled={uploading}
                        onChange={(event) => {
                          const selected = event.target.files?.[0];
                          if (selected) void onUpload(index, selected);
                          event.target.value = "";
                        }}
                      />
                    </label>
                    {file ? (
                      <button
                        type="button"
                        className="ui-btn-ghost h-8 w-8 px-0 text-ink-tertiary hover:text-danger"
                        title="Remove attachment"
                        aria-label="Remove attachment"
                        onClick={() => onRemoveFile(file)}
                      >
                        <X size={14} />
                      </button>
                    ) : null}
                  </div>
                )}
              </div>
              {renaming?.file.annexId === row.id && renameError ? (
                <p role="alert" className="mt-2 text-xs text-danger">
                  {renameError}
                </p>
              ) : null}
              {rowStatus ? (
                <div
                  role="status"
                  aria-live="polite"
                  className={`mt-2 flex items-center gap-1.5 text-[11px] ${
                    rowStatus.phase === "error"
                      ? "text-danger"
                      : rowStatus.phase === "success"
                        ? "text-success"
                        : "text-ink-secondary"
                  }`}
                >
                  {rowStatus.phase === "saving" ||
                  rowStatus.phase === "uploading" ? (
                    <Loader2 size={12} className="shrink-0 animate-spin" />
                  ) : rowStatus.phase === "success" ? (
                    <Check size={12} className="shrink-0" />
                  ) : (
                    <X size={12} className="shrink-0" />
                  )}
                  <span>
                    {rowStatus.phase === "success"
                      ? "Upload complete."
                      : rowStatus.message}
                  </span>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {disabled ? null : (
        <AddButton
          label="Add form"
          onClick={() =>
            onChange((current) => [
              ...current,
              { id: newAnnexId(sopId), label: "", description: "" },
            ])
          }
        />
      )}
    </div>
  );
}
