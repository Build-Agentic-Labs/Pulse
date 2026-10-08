"use client";
import { useEffect, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import type { ConversionReview, ConversionJob } from "@/domain/quality-wi/conversion";
import {
  uploadConversionSource,
  removeConversionSource,
} from "@/lib/sop/conversion-upload";
import { wiConversionRequest } from "@/lib/quality-wi/conversion-client";
import { WiConversionSource } from "./wi-conversion-source";

type Props = {
  workspaceId: string;
  userId: string;
  departmentId: string;
  departmentName: string;
  conversionId?: string;
  onStarted?: (job: ConversionJob) => void;
  onSubmissionError?: (message: string) => void;
  onClose: () => void;
  onImported: (id: string) => void;
};
export default function WiConvertDialog({
  workspaceId,
  userId,
  departmentId,
  departmentName,
  onClose,
  onImported,
  conversionId,
  onStarted,
  onSubmissionError,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const active = useRef(true);
  const inFlight = useRef(false);
  const [file, setFile] = useState<File | null>(null);
  const [review, setReview] = useState<ConversionReview | null>(null);
  const [jobId, setJobId] = useState<string | null>(conversionId ?? null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [fields, setFields] = useState({
    title: "",
    purpose: "",
    responsibilities: "",
  });
  const scopeKey = `${userId}:${workspaceId}:${departmentId}`;
  const imported = useRef(onImported);
  useEffect(() => {
    imported.current = onImported;
  }, [onImported]);
  function close() {
    dialog.current?.close();
    onClose();
  }
  function remember(id: string | null) { setJobId(id); }
  function accept(value: ConversionReview) {
    if (!active.current) return;
    if (value.departmentId !== departmentId)
      throw new Error("This conversion belongs to a different department.");
    setReview(value);
    if (value.status === "imported") {
      remember(null);
      imported.current(value.id);
      return;
    }
    if (value.status === "ready" && value.payload)
      setFields({
        title: value.payload.title,
        purpose: value.payload.purpose,
        responsibilities: value.payload.responsibilities,
      });
    if (value.status === "failed")
      setError(
        value.error ||
          "The conversion could not finish. Choose a file to try again.",
      );
  }
  useEffect(() => {
    active.current = true;
    dialog.current?.showModal();
    setJobId(conversionId ?? null);
    return () => {
      active.current = false;
    };
  }, [scopeKey, conversionId]);
  // Polling also recovers a lost POST response or a reopened dialog without rerunning AI.
  useEffect(() => {
    if (
      !jobId ||
      review?.status === "ready" ||
      review?.status === "failed" ||
      review?.status === "imported"
    )
      return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const started = Date.now();
    const poll = async () => {
      try {
        if (inFlight.current) return;
        if (Date.now() - started > 320_000) {
          setError(
            "The conversion is taking too long. Reopen the converter to check again, or start a new conversion.",
          );
          return;
        }
        const value = await wiConversionRequest(
          userId,
          `/api/quality-wi/convert?id=${jobId}`,
          undefined,
          AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
        );
        if (!stopped) {
          accept(value);
          if (value.status !== "processing") setBusy("");
        }
      } catch (caught) {
        if (!stopped && !inFlight.current)
          setError(
            caught instanceof Error
              ? caught.message
              : "Could not check conversion status.",
          );
      } finally {
        if (!stopped && Date.now() - started <= 320_000)
          timer = setTimeout(poll, 4000);
      }
    };
    timer = setTimeout(poll, 1500);
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller.abort();
    };
    // accept only reads this dialog's immutable scope; keyed by the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, review?.status, userId]);
  async function convert() {
    if (!file || inFlight.current) return;
    if (
      !/\.docx$/i.test(file.name) ||
      !file.size ||
      file.size > 20 * 1024 * 1024
    ) {
      setError("Choose a DOCX file no larger than 20 MB.");
      return;
    }
    inFlight.current = true;
    setError("");
    setReview(null);
    remember(null);
    setBusy("Uploading your document…");
    let path: string | undefined;
    let submitted = false;
    let handedOff = false;
    try {
      path = await uploadConversionSource({ userId, workspaceId, file });
      if (!active.current) {
        await removeConversionSource(path);
        return;
      }
      const id = crypto.randomUUID();
      remember(id);
      setBusy("Reading the steps and images, then checking the conversion…");
      submitted = true;
      const request = wiConversionRequest(
        userId,
        "/api/quality-wi/convert",
        {
          id,
          workspaceId,
          departmentId,
          storagePath: path,
          fileName: file.name,
        },
      );
      onStarted?.({ id, status: "processing", departmentId, fileName: file.name, createdAt: new Date().toISOString() });
      handedOff = !!onStarted;
      const value = await request;
      accept(value);
    } catch (caught) {
      if (active.current)
        setError(
          caught instanceof Error
            ? caught.message
            : "The conversion could not finish. Check its status before starting again.",
        );
      if (handedOff) onSubmissionError?.(caught instanceof Error ? caught.message : "Could not submit conversion. Please retry.");
      if (path && !submitted) await removeConversionSource(path);
    } finally {
      inFlight.current = false;
      if (active.current) setBusy("");
    }
  }
  async function refreshImages() {
    if (!review || inFlight.current) return;
    inFlight.current = true;
    setBusy("Refreshing source images…");
    setError("");
    try {
      const value = await wiConversionRequest(
        userId,
        `/api/quality-wi/convert?id=${review.id}`,
        undefined,
        AbortSignal.timeout(30_000),
      );
      if (active.current) {
        if (value.status !== "ready")
          throw new Error(
            value.error || "This conversion is no longer available.",
          );
        setReview(value);
      }
    } catch (caught) {
      if (active.current)
        setError(
          caught instanceof Error
            ? caught.message
            : "Could not refresh the images.",
        );
    } finally {
      inFlight.current = false;
      if (active.current) setBusy("");
    }
  }
  async function createDraft() {
    if (!review || inFlight.current) return;
    inFlight.current = true;
    setBusy("Creating your draft…");
    setError("");
    try {
      const result = await wiConversionRequest<{ id: string }>(
        userId,
        "/api/quality-wi/convert/import",
        { id: review.id, ...fields },
        AbortSignal.timeout(30_000),
      );
      if (active.current) {
        remember(null);
        imported.current(result.id);
      }
    } catch (caught) {
      if (active.current)
        setError(
          caught instanceof Error
            ? caught.message
            : "Could not confirm the draft. Try again; it will not create a duplicate.",
        );
    } finally {
      inFlight.current = false;
      if (active.current) setBusy("");
    }
  }
  const payload = review?.status === "ready" ? review.payload : undefined;
  const pending = !!jobId && !payload && review?.status !== "failed";
  return (
    <dialog
      ref={dialog}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      className="ui-panel m-auto max-h-[90dvh] w-[min(960px,calc(100vw-32px))] overflow-hidden p-0 text-ink shadow-2xl backdrop:bg-black/55"
      aria-labelledby="wi-convert-title"
    >
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <div>
          <h2 id="wi-convert-title" className="text-base font-semibold">
            Convert a work instruction
          </h2>
          <p className="mt-1 text-xs text-ink-secondary">{departmentName}</p>
        </div>
        <button
          type="button"
          className="ui-btn-ghost h-9 w-9"
          aria-label="Close converter"
          onClick={close}
        >
          <X size={16} />
        </button>
      </div>
      <div className="max-h-[65dvh] space-y-5 overflow-y-auto overscroll-contain p-5">
        {error ? (
          <p className="ui-notice ui-notice-warn p-3 text-sm" role="alert">
            {error}
          </p>
        ) : null}
        {busy || pending ? (
          <div role="status" className="flex items-center gap-3 py-4 text-sm">
            <Loader2
              size={18}
              className="animate-spin motion-reduce:animate-none"
            />
            <div>
              {busy || "Checking your conversion…"}
              <p className="mt-1 text-xs text-ink-secondary">
                Progress appears in the WI Builder table. You can continue
                working and return there when the conversion is ready.
              </p>
            </div>
          </div>
        ) : null}
        {!payload && !pending && !busy ? (
          <>
            <p className="text-sm text-ink-secondary">
              Upload a DOCX to extract its steps and pictures into the ANA WI
              template. Review the proposed sequence and any uncertainties
              before creating a draft.
            </p>
            <label className="block">
              <span className="ui-field-label">Source work instruction</span>
              <input
                type="file"
                accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="mt-2 block w-full text-sm"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setError("");
                }}
              />
            </label>
            <p className="text-xs text-ink-secondary">
              {file ? `Selected: ${file.name}. ` : ""}Up to 20 MB and 40
              embedded images. Your document is processed by the app’s AI
              conversion service.
            </p>
          </>
        ) : null}
        {payload ? (
          <>
            <p className="text-sm text-ink-secondary">
              {payload.steps.length} steps extracted. You will own the new draft
              in {departmentName}; Pulse assigns its WI number when published.
              Original names and revision details are retained below.
            </p>
            {(
              [
                ["title", "Title"],
                ["purpose", "Purpose / scope"],
                ["responsibilities", "Responsibilities"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="block">
                <span className="ui-field-label">{label}</span>
                {key === "title" ? (
                  <input
                    className="ui-input w-full"
                    value={fields[key]}
                    maxLength={300}
                    onChange={(e) =>
                      setFields({ ...fields, [key]: e.target.value })
                    }
                  />
                ) : (
                  <textarea
                    className="ui-textarea w-full"
                    rows={3}
                    value={fields[key]}
                    maxLength={12000}
                    onChange={(e) =>
                      setFields({ ...fields, [key]: e.target.value })
                    }
                  />
                )}
              </label>
            ))}
            <WiConversionSource source={payload.source} />
            <button
              className="ui-btn-ghost h-8 px-2 text-xs"
              disabled={!!busy}
              onClick={() => void refreshImages()}
            >
              Refresh images
            </button>
            <h3 className="text-sm font-semibold">Proposed steps</h3>
            <ol className="space-y-4">
              {payload.steps.map((step, index) => (
                <li key={step.id} className="rounded border border-line p-4">
                  <h4 className="text-sm font-semibold">
                    {index + 1}. {step.title}
                  </h4>
                  <div
                    className={`mt-3 grid gap-4 ${step.image ? "sm:grid-cols-2" : ""}`}
                  >
                    {step.image ? (
                      <div>
                        {/* Immutable private images are signed for this review. */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={step.image.url}
                          alt={
                            payload.analysis.images.find(
                              (i) =>
                                payload.uploads.find(
                                  (u) => u.id === step.image?.id,
                                )?.sourceImageId === i.imageId,
                            )?.description || step.image.name
                          }
                          className="max-h-64 w-full object-contain"
                          loading="lazy"
                        />
                        <p className="mt-2 text-xs text-ink-tertiary">
                          {step.image.name}
                        </p>
                      </div>
                    ) : null}
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">
                      {step.instruction}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
            <details className="rounded border border-line p-4">
              <summary className="cursor-pointer text-sm font-medium">
                Image mapping and source coverage
              </summary>
              <ul className="mt-4 space-y-4">
                {payload.analysis.images.map((item) => {
                  const image = payload.uploads.find(
                    (u) => u.sourceImageId === item.imageId,
                  );
                  return (
                    <li key={item.imageId} className="text-xs">
                      <p className="font-medium">
                        {item.imageId} · {item.disposition}
                      </p>
                      <p className="mt-1">{item.description}</p>
                      <p className="mt-1 text-ink-secondary">{item.reason}</p>
                      {item.disposition !== "step" && image?.url ? (
                        <div className="mt-2">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={image.url}
                            alt={item.description}
                            className="max-h-40 max-w-full object-contain"
                            loading="lazy"
                          />
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              <p className="mt-4 text-xs text-ink-secondary">
                {payload.analysis.coverage.length} source blocks accounted for.
              </p>
            </details>
          </>
        ) : null}
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-4">
        <button className="ui-btn-ghost h-9 px-3" onClick={close}>
          Close
        </button>
        {pending && !busy ? (
          <button
            className="ui-btn-secondary h-9 px-3"
            onClick={() => {
              remember(null);
              setReview(null);
              setError("");
            }}
          >
            Start a new conversion
          </button>
        ) : null}
        {payload ? (
          <button
            className="ui-btn-primary h-9 px-4"
            disabled={!!busy || !fields.title.trim()}
            onClick={() => void createDraft()}
          >
            Create draft
          </button>
        ) : !pending ? (
          <button
            className="ui-btn-primary h-9 px-4"
            disabled={!!busy || !file}
            onClick={() => void convert()}
          >
            Convert DOCX
          </button>
        ) : null}
      </div>
    </dialog>
  );
}
