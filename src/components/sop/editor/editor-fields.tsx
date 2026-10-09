import type { ReactNode } from "react";
import { History } from "lucide-react";
import type { Sop } from "@/domain/sop/schema";
import { versionLabel } from "@/domain/sop/version";
import { AddButton, RowDeleteButton } from "./editor-controls";

export function Section({
  title,
  hideHeading = false,
  children,
  reviewAttention = false,
  feedback,
  reserveMargin = false,
}: {
  title: string;
  hideHeading?: boolean;
  children: ReactNode;
  reviewAttention?: boolean;
  feedback?: ReactNode;
  reserveMargin?: boolean;
}) {
  return (
    <div
      className={`grid gap-4 ${reserveMargin ? "xl:grid-cols-[minmax(0,16rem)_minmax(0,56rem)_minmax(0,16rem)] xl:gap-6" : ""}`}
    >
      <section
        className={`min-w-0 border-b border-line bg-transparent px-5 py-4 transition-[border-color,background-color] duration-200 ${reserveMargin ? "xl:col-start-2" : ""}`}
        style={
          reviewAttention
            ? {
                borderColor: "var(--color-warn)",
                backgroundColor:
                  "color-mix(in srgb, var(--color-warn) 5%, var(--color-canvas))",
              }
            : undefined
        }
        data-review-attention={reviewAttention ? "true" : undefined}
      >
        {hideHeading ? null : (
          <h2 className="ui-setup-section-title mb-3">{title}</h2>
        )}
        {children}
      </section>
      {feedback ? (
        <aside className="min-w-0 py-4 xl:col-start-3">{feedback}</aside>
      ) : null}
    </div>
  );
}

export function Field({
  label,
  optional = false,
  children,
}: {
  label: string;
  /**
   * Marks a field the author may leave blank. Nothing enforces these fields anyway — this only
   * says so, so a blank one doesn't read as unfinished work on a controlled document.
   */
  optional?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="ui-field-label">
        {label}
        {optional ? (
          <span className="ml-1.5 font-normal text-ink-tertiary">
            (optional)
          </span>
        ) : null}
      </span>
      {children}
    </label>
  );
}

export function DocumentField({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <span className="ui-setup-section-title mb-2 block">{label}</span>
      {children}
    </label>
  );
}

export function StringListEditor({
  items,
  placeholder,
  disabled = false,
  onChange,
}: {
  items: string[];
  placeholder: string;
  disabled?: boolean;
  onChange: (items: string[]) => void;
}) {
  return (
    <div className="space-y-2">
      {items.map((item, index) => (
        <div key={index} className="flex items-center gap-2">
          <input
            className="ui-field-standalone min-w-0 flex-1"
            value={item}
            placeholder={placeholder}
            disabled={disabled}
            onChange={(event) => {
              const next = [...items];
              next[index] = event.target.value;
              onChange(next);
            }}
          />
          {disabled ? null : (
            <RowDeleteButton
              title="Remove"
              onClick={() => onChange(items.filter((_, i) => i !== index))}
            />
          )}
        </div>
      ))}
      {disabled ? null : (
        <AddButton label="Add" onClick={() => onChange([...items, ""])} />
      )}
    </div>
  );
}

export type PairRow<K extends string, V extends string> = Record<K | V, string>;

export function PairListEditor<K extends string, V extends string>({
  rows,
  keyLabel,
  valueLabel,
  keyExample,
  valueExample,
  keyName,
  valueName,
  disabled = false,
  onChange,
}: {
  rows: Array<PairRow<K, V>>;
  keyLabel: string;
  valueLabel: string;
  keyExample?: string;
  valueExample?: string;
  keyName: K;
  valueName: V;
  disabled?: boolean;
  onChange: (rows: Array<PairRow<K, V>>) => void;
}) {
  function patch(index: number, field: K | V, value: string) {
    const next = rows.map((row, i) =>
      i === index ? { ...row, [field]: value } : row,
    );
    onChange(next);
  }

  return (
    <div className="space-y-2">
      {rows.map((row, index) => (
        <div
          key={index}
          className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] gap-2"
        >
          <input
            className="ui-field-standalone min-w-0"
            value={row[keyName]}
            placeholder={keyLabel}
            data-example={keyExample}
            disabled={disabled}
            onChange={(event) => patch(index, keyName, event.target.value)}
          />
          <input
            className="ui-field-standalone min-w-0"
            value={row[valueName]}
            placeholder={valueLabel}
            data-example={valueExample}
            disabled={disabled}
            onChange={(event) => patch(index, valueName, event.target.value)}
          />
          {disabled ? null : (
            <RowDeleteButton
              title="Remove"
              onClick={() => onChange(rows.filter((_, i) => i !== index))}
            />
          )}
        </div>
      ))}
      {disabled ? null : (
        <AddButton
          label="Add"
          onClick={() =>
            onChange([
              ...rows,
              { [keyName]: "", [valueName]: "" } as PairRow<K, V>,
            ])
          }
        />
      )}
    </div>
  );
}

export function SystemChangeHistory({ rows }: { rows: Sop["changeHistory"] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-line">
      <div className="flex items-center gap-2 border-b border-line bg-canvas px-3 py-2">
        <History size={13} className="text-ink-tertiary" />
        <p className="text-[11px] leading-4 text-ink-tertiary">
          Managed by the SOP lifecycle. Entries cannot be edited or removed.
        </p>
      </div>
      {rows.length ? (
        <div className="divide-y divide-line">
          {rows.map((row, index) => (
            <div
              key={`${row.version}-${row.createdByDate}-${index}`}
              className="grid gap-3 px-3 py-3 sm:grid-cols-[5rem_minmax(0,1fr)_minmax(10rem,0.55fr)_7rem] sm:items-center"
            >
              <span className="ui-chip w-fit border-ink/20 bg-transparent font-medium text-ink">
                {versionLabel(row.version) || "—"}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium leading-5 text-ink">
                  {row.changes || "System change"}
                </p>
                <p className="mt-0.5 text-[11px] text-ink-tertiary sm:hidden">
                  {row.createdByName || "SOP author"} ·{" "}
                  {row.createdByPosition || "Department Author"}
                </p>
              </div>
              <div className="hidden min-w-0 sm:block">
                <p className="truncate text-xs text-ink">
                  {row.createdByName || "SOP author"}
                </p>
                <p className="mt-0.5 truncate text-[11px] text-ink-tertiary">
                  {row.createdByPosition || "Department Author"}
                </p>
              </div>
              <time
                className="text-xs tabular-nums text-ink-tertiary"
                dateTime={row.createdByDate}
              >
                {row.createdByDate || "Pending"}
              </time>
            </div>
          ))}
        </div>
      ) : (
        <div className="px-3 py-5 text-sm text-ink-tertiary">
          V1 will be recorded automatically when this SOP is first saved.
        </div>
      )}
    </div>
  );
}
