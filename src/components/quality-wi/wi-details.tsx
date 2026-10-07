"use client";
import type { QualityWi, WiEdit } from "@/domain/quality-wi/schema";
export function WiDetails({
  document,
  disabled,
  onEdit,
}: {
  document: QualityWi;
  disabled: boolean;
  onEdit: (edit: WiEdit) => void;
}) {
  return (
    <section className="space-y-4" aria-label="Work instruction details">
      <label className="block">
        <span className="ui-field-label">Title</span>
        <input
          aria-label="Work instruction title"
          className="ui-input w-full"
          maxLength={300}
          value={document.title}
          disabled={disabled}
          placeholder="Name this work instruction"
          onChange={(event) =>
            onEdit({ kind: "details", payload: { title: event.target.value } })
          }
        />
      </label>
      <div className="grid gap-4 md:grid-cols-2">
        {(
          [
            ["purpose", "Purpose / scope"],
            ["responsibilities", "Responsibilities"],
          ] as const
        ).map(([field, label]) => (
          <label key={field} className="block">
            <span className="ui-field-label">{label}</span>
            <textarea
              aria-label={label}
              className="ui-input min-h-28 w-full resize-y"
              value={document[field]}
              disabled={disabled}
              onChange={(event) =>
                onEdit({
                  kind: "details",
                  payload: { [field]: event.target.value },
                })
              }
            />
          </label>
        ))}
      </div>
    </section>
  );
}
