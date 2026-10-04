import type { MobileNewStepDraftRecord } from "./recovery-draft-store";

// Presentational only: reviewing never starts autosave. The editor owns explicit adoption.
export function LegacyDraftReview({ draft, reviewing, busy = false, blocked = false, onReview, onDismiss, onBack, onUse }: {
  draft: MobileNewStepDraftRecord;
  reviewing: boolean;
  busy?: boolean;
  blocked?: boolean;
  onReview: () => void;
  onDismiss: () => void;
  onBack: () => void;
  onUse: () => void;
}) {
  return <section className="rounded-md border border-line bg-surface-muted p-3" aria-label="Earlier saved draft">
    <div className="ui-photo-mobile-notice-title">{reviewing ? "Review saved draft" : "Earlier saved draft"}</div>
    <p className="ui-photo-mobile-notice-body">{reviewing
      ? "Only use this draft if you recognize it and intend to save it to this product. Its author is unknown."
      : "A draft from an earlier version is saved on this device. Its author is unknown."}</p>
    {reviewing ? <div className="mt-3 space-y-2 text-sm">
      <p className="font-medium">{draft.name || "Unnamed step"}</p>
      <p className="whitespace-pre-wrap break-words">{draft.instruction || "No instruction text."}</p>
      <p className="ui-photo-mobile-caption">Duration: {draft.durationText} min</p>
      {draft.tools.length ? <p className="ui-photo-mobile-caption">Tools: {draft.tools.join(", ")}</p> : null}
      {draft.photos.length ? <p className="ui-photo-mobile-caption">Photos: {draft.photos.map((photo) => photo.name).join(", ")}</p> : null}
      {draft.checks.length ? <p className="ui-photo-mobile-caption">Checks: {draft.checks.join(", ")}</p> : null}
      {blocked ? <p role="status" className="ui-photo-mobile-caption">Finish your current draft before using this one.</p> : null}
    </div> : null}
    <div className="mt-3 grid grid-cols-2 gap-2">
      <button type="button" className="ui-photo-mobile-btn-secondary min-h-11" disabled={busy} onClick={reviewing ? onBack : onDismiss}>{reviewing ? "Back" : "Not now"}</button>
      <button type="button" className="ui-photo-mobile-btn-accent min-h-11 disabled:opacity-60" disabled={busy || (reviewing && blocked)} onClick={reviewing ? onUse : onReview}>{reviewing ? (busy ? "Opening…" : "Use this draft") : "Review saved draft"}</button>
    </div>
  </section>;
}
