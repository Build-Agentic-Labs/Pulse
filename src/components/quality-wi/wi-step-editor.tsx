"use client";
import { ArrowDown, ArrowUp, GripVertical, Plus, Trash2 } from "lucide-react";
import { Fragment, useState } from "react";
import { InstructionFormatToolbar } from "@/components/line-workspace/instruction-format-toolbar";
import { useConfirm } from "@/components/confirm-provider";
import type { QualityWi, WiEdit } from "@/domain/quality-wi/schema";
import { WiPhotos } from "./wi-photos";
export function WiStepEditor({
  document,
  userId,
  disabled,
  onEdit,
  onBusy,
}: {
  document: QualityWi;
  userId: string;
  disabled: boolean;
  onEdit: (edit: WiEdit) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [dragged, setDragged] = useState<string | null>(null);
  const confirm = useConfirm();
  function move(from: number, to: number) {
    if (disabled || from === to || to < 0 || to >= document.steps.length)
      return;
    const ids = document.steps.map((step) => step.id);
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    onEdit({ kind: "reorder", payload: { ids } });
  }
  return (
    <section className="space-y-5" aria-label="Work instruction steps">
      {document.steps.map((step, index) => (
        <Fragment key={step.id}>
        <article
          data-instruction-step
          className="ui-procedure-card rounded border border-line p-4"
          onDragOver={(event) => {
            if (dragged && !disabled) event.preventDefault();
          }}
          onDrop={(event) => {
            event.preventDefault();
            if (dragged)
              move(
                document.steps.findIndex((item) => item.id === dragged),
                index,
              );
            setDragged(null);
          }}
        >
          <div className="mb-4 flex items-center gap-2">
            <button
              draggable={!disabled}
              className="ui-btn-ghost h-8 w-8"
              disabled={disabled}
              aria-label={`Drag step ${index + 1}`}
              onDragStart={() => setDragged(step.id)}
              onDragEnd={() => setDragged(null)}
            >
              <GripVertical size={15} />
            </button>
            <span className="ui-field-label shrink-0">Step {index + 1}</span>
            <input
              className="ui-input min-w-0 flex-1"
              aria-label={`Step ${index + 1} title`}
              maxLength={300}
              value={step.title}
              disabled={disabled}
              placeholder="Step title"
              onChange={(event) =>
                onEdit({
                  kind: "step",
                  payload: { id: step.id, title: event.target.value },
                })
              }
            />
            <button
              className="ui-btn-ghost h-8 w-8"
              disabled={disabled || index === 0}
              aria-label={`Move step ${index + 1} up`}
              onClick={() => move(index, index - 1)}
            >
              <ArrowUp size={14} />
            </button>
            <button
              className="ui-btn-ghost h-8 w-8"
              disabled={disabled || index === document.steps.length - 1}
              aria-label={`Move step ${index + 1} down`}
              onClick={() => move(index, index + 1)}
            >
              <ArrowDown size={14} />
            </button>
            <button
              className="ui-btn-ghost h-8 w-8 text-danger"
              disabled={disabled}
              aria-label={`Remove step ${index + 1}`}
              onClick={async () => {
                if (
                  await confirm({
                    title: "Remove this step from the draft?",
                    body: "Published revisions and stored images will be preserved.",
                    confirmLabel: "Remove from draft",
                  })
                )
                  onEdit({ kind: "remove_step", payload: { id: step.id } });
              }}
            >
              <Trash2 size={14} />
            </button>
          </div>
          <div className="mb-3 flex justify-end">
            <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-ink-secondary">
              <input
                type="checkbox"
                role="switch"
                aria-label={`Show photo for step ${index + 1}`}
                className="ui-checkbox"
                checked={step.showPhoto !== false}
                disabled={disabled}
                onChange={(event) => onEdit({
                  kind: "step",
                  payload: { id: step.id, showPhoto: event.target.checked },
                })}
              />
              Show photo
            </label>
          </div>
          <div className={`grid gap-5${step.showPhoto !== false ? " lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" : ""}`}>
            {step.showPhoto !== false ? (
              <WiPhotos
                document={document}
                step={step}
                sequence={index + 1}
                userId={userId}
                disabled={disabled}
                onEdit={onEdit}
                onBusy={onBusy}
              />
            ) : null}
            <div>
              <span className="ui-field-label">Instruction</span>
              {!disabled ? (
                <InstructionFormatToolbar
                  sequence={index + 1}
                  value={step.instruction}
                  onChange={(instruction) =>
                    onEdit({
                      kind: "step",
                      payload: { id: step.id, instruction },
                    })
                  }
                />
              ) : null}
              <textarea
                aria-label={`Step ${index + 1} instruction`}
                className="ui-input mt-2 min-h-48 w-full resize-y"
                value={step.instruction}
                disabled={disabled}
                placeholder="Describe the action, starting with a verb."
                onChange={(event) =>
                  onEdit({
                    kind: "step",
                    payload: { id: step.id, instruction: event.target.value },
                  })
                }
              />
            </div>
          </div>
        </article>
        {index < document.steps.length - 1 ? (
          <div className="flex justify-center">
            <button
              className="ui-btn-ghost inline-flex h-8 items-center gap-1.5 px-3 text-xs"
              disabled={disabled}
              aria-label={`Insert step after step ${index + 1}`}
              onClick={() => onEdit({
                kind: "add_step",
                payload: { id: crypto.randomUUID(), afterId: step.id },
              })}
            >
              <Plus size={13} /> Insert step
            </button>
          </div>
        ) : null}
        </Fragment>
      ))}
      <button
        className="ui-btn-ghost h-9 px-3"
        disabled={disabled}
        onClick={() =>
          onEdit({ kind: "add_step", payload: { id: crypto.randomUUID() } })
        }
      >
        + Add step
      </button>
    </section>
  );
}
