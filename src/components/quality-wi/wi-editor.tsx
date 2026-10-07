"use client";
import { useState, type MouseEvent, useEffect } from "react";
import { Eye, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import type { QualityWi } from "@/domain/quality-wi/schema";
import { SopShell } from "@/components/sop/sop-shell";
import { SopTabNav } from "@/components/sop/sop-tab-nav";
import { useConfirm } from "@/components/confirm-provider";
import { WiDetails } from "./wi-details";
import { WiStepEditor } from "./wi-step-editor";
import { useWiEditor } from "./use-wi-editor";
import { WiPreview } from "./wi-preview";
export function WiEditor({
  initial,
  userId,
  canEdit,
  manage,
}: {
  initial: QualityWi;
  userId: string;
  canEdit: boolean;
  manage: boolean;
}) {
  const state = useWiEditor(initial, userId);
  const [photoBusy, setPhotoBusy] = useState(0);
  const [preview, setPreview] = useState(false);
  const [description, setDescription] = useState(
    initial.publishedRevisionId ? "" : "Initial release",
  );
  const confirm = useConfirm();
  const router = useRouter();
  const disabled =
    !canEdit || !state.ready || state.publishing || photoBusy > 0;
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (state.pending || state.publishing || photoBusy) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [state.pending, state.publishing, photoBusy]);
  async function canLeave() {
    if (photoBusy)
      return confirm({
        title: "An image is still being prepared",
        body: "Wait for it to finish before leaving to keep the image in your draft.",
        confirmLabel: "Leave now",
        cancelLabel: "Keep editing",
      });
    if (!state.pending) return true;
    if (await state.flush()) return true;
    return confirm({
      title: "This draft has not finished saving",
      body: "Pending changes are retained in this browser when recovery is available. Stay here to retry, or leave without publishing.",
      confirmLabel: "Leave draft",
      cancelLabel: "Keep editing",
    });
  }
  function guardSidebar(event: MouseEvent<HTMLDivElement>) {
    const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>(
      "a[href]",
    );
    if (
      !anchor ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    if (!state.pending && !photoBusy) return;
    event.preventDefault();
    event.stopPropagation();
    void canLeave().then((allowed) => {
      if (allowed) router.push(anchor.getAttribute("href")!);
    });
  }
  return (
    <SopShell
      sidebar={
        <div onClickCapture={guardSidebar}>
          <SopTabNav active="work-instructions" manage={manage} />
        </div>
      }
      back={{ href: "/sops/work-instructions", label: "Work instructions" }}
      crumb={state.document.title || "Untitled work instruction"}
      confirmLeave={canLeave}
      actions={
        <div className="flex shrink-0 items-center gap-2">
          <span className="mr-1 whitespace-nowrap text-xs text-ink-tertiary" role="status">
            {!state.ready
              ? "Loading…"
              : state.status === "saved"
                ? "Saved"
                : state.status === "saving"
                  ? "Saving…"
                  : "Not saved"}
          </span>
          <button
            type="button"
            className="ui-btn-ghost h-8 shrink-0 gap-1.5 whitespace-nowrap px-2.5"
            onClick={() => setPreview(true)}
          >
            <Eye size={14} strokeWidth={1.75} className="shrink-0" /> Preview
          </button>
          {canEdit ? (
            <button
              type="button"
              className="ui-btn-primary h-8 shrink-0 gap-1.5 whitespace-nowrap px-3 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={disabled || !state.document.hasChanges}
              onClick={() => void state.publish(description)}
            >
              <Upload size={14} strokeWidth={1.75} className="shrink-0" />{" "}
              {state.publishing ? "Publishing…" : "Publish WI"}
            </button>
          ) : null}
        </div>
      }
    >
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">Work instruction builder</h1>
            <p className="ui-section-subtitle mt-1">
              {state.document.departmentName} ·{" "}
              {state.document.documentNumber ??
                `WI-${state.document.departmentCode}-###`}{" "}
              ·{" "}
              {state.document.publishedRevisionId
                ? state.document.hasChanges
                  ? "Published · draft changes"
                  : "Published"
                : "Draft"}
            </p>
          </div>
          {canEdit ? (
            <label className="block min-w-64">
              <span className="ui-field-label">Revision description</span>
              <input
                className="ui-input w-full"
                aria-label="Revision description"
                maxLength={500}
                value={description}
                disabled={state.publishing}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Describe this release"
              />
            </label>
          ) : (
            <span className="ui-section-subtitle">Read only</span>
          )}
        </div>
        {state.message ? (
          <div className="ui-notice ui-notice-warn p-3" role="alert">
            {state.message}
            {state.status === "error" && canEdit ? (
              <button
                className="ui-btn-ghost ml-2"
                onClick={() => void state.flush()}
              >
                Retry save
              </button>
            ) : null}
          </div>
        ) : null}
        {state.localWarning ? (
          <p className="ui-notice ui-notice-warn p-3 text-xs">
            {state.localWarning}
          </p>
        ) : null}
        <WiDetails
          document={state.document}
          disabled={disabled}
          onEdit={state.edit}
        />
        <div className="border-t border-line pt-5">
          <h2 className="ui-section-title mb-4">Procedure steps</h2>
          <WiStepEditor
            document={state.document}
            userId={userId}
            disabled={disabled}
            onEdit={state.edit}
            onBusy={(busy) =>
              setPhotoBusy((count) => Math.max(0, count + (busy ? 1 : -1)))
            }
          />
        </div>
        {state.status === "error" && state.pending ? (
          <p className="ui-section-subtitle">
            Your pending edits remain in this browser. A conflict is not
            overwritten automatically.
          </p>
        ) : null}
      </div>
      {preview ? (
        <WiPreview
          document={state.document}
          onClose={() => setPreview(false)}
        />
      ) : null}
    </SopShell>
  );
}
