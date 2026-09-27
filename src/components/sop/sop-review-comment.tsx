"use client";

import { useEffect, useState, type ReactNode } from "react";
import { saveSopAuthorResponse, type SopReviewAnnotation } from "@/lib/sop/review-annotations";

export function commentDetails(body: string): string {
  return body.replace(/(^|\n\n)\[Attachment:[^\]]+\] /g, "$1Attachment: ").replace(/(^|\n\n)Selected text: “[\s\S]*?”\n/g, "$1").trim();
}

export function SopReviewComment({ remark, actions, canReply = false, onOpenAttachment, onReplyStateChange }: { remark: SopReviewAnnotation; actions?: ReactNode; canReply?: boolean; onOpenAttachment?: (id: string) => void; onReplyStateChange?: (editing: boolean) => void }) {
  const [reply, setReply] = useState(remark.authorResponse ?? "");
  const [savedReply, setSavedReply] = useState(remark.authorResponse ?? "");
  const [replying, setReplying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setSavedReply(remark.authorResponse ?? ""); setReply(remark.authorResponse ?? ""); }, [remark.authorResponse]);
  const attachments = Array.from(remark.body.matchAll(/(?:^|\n\n)\[Attachment:([^\]]+)\] ([^\n]+)/g));
  async function saveReply() {
    if (saving) return;
    setSaving(true); setError("");
    try { await saveSopAuthorResponse(remark.id, reply); setSavedReply(reply.trim()); setReplying(false); onReplyStateChange?.(false); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save reply"); }
    finally { setSaving(false); }
  }
  const name = remark.authorName?.trim() || "Reviewer";
  const [failedAvatar, setFailedAvatar] = useState<string | null>(null);
  const parts = name.split(/\s+/);
  const initials = (parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : name.slice(0, 2)).toUpperCase();
  const date = new Date(remark.createdAt);
  const validDate = !Number.isNaN(date.getTime());
  const today = validDate && date.toDateString() === new Date().toDateString();
  const timestamp = validDate
    ? `${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} ${today ? "Today" : date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}`
    : "";
  return (
    <div className="rounded-xl border-2 border-border-strong bg-surface-raised p-3">
      <div className="flex items-start gap-2">
        <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border-strong bg-surface-raised font-mono text-[10px] text-ink">
          {remark.authorAvatarUrl && failedAvatar !== remark.authorAvatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={remark.authorAvatarUrl} alt="" className="h-full w-full object-cover" onError={() => setFailedAvatar(remark.authorAvatarUrl ?? null)} />
          ) : initials}
        </span>
        <div className="min-w-0 flex-1">
          <p className="break-words text-xs font-semibold leading-4 text-ink">{name}</p>
          {validDate ? <time dateTime={remark.createdAt} title={date.toLocaleString()} className="block text-[10px] leading-4 text-ink-secondary">{timestamp}</time> : null}
        </div>
        {actions}
      </div>
      {onOpenAttachment ? attachments.map((match, index) => <button key={index} type="button" className="mt-2 block text-xs text-ink underline" onClick={() => { try { onOpenAttachment(decodeURIComponent(match[1])); } catch { setError("This attachment link is invalid."); } }}>{match[2]}</button>) : null}
      <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-ink-secondary">{commentDetails(onOpenAttachment ? remark.body.replace(/(^|\n\n)\[Attachment:[^\]]+\] [^\n]+\n/g, "$1") : remark.body)}</p>
      {savedReply ? <div className="mt-2 border-t border-line pt-2 text-xs"><span className="text-[10px] text-ink-tertiary">Author response</span><p className="whitespace-pre-wrap break-words">{savedReply}</p></div> : null}
      {canReply && !replying ? <button type="button" className="mt-1 text-[11px] text-ink-secondary" onClick={() => { setReplying(true); onReplyStateChange?.(true); }}>{savedReply ? "Edit reply" : "Reply"}</button> : null}
      {replying ? <div className="mt-2"><textarea aria-label="Author reply" className="ui-field-standalone w-full text-xs" maxLength={2000} value={reply} disabled={saving} onChange={(event) => setReply(event.target.value)} /><div className="flex justify-end gap-2"><button type="button" aria-label="Cancel reply" disabled={saving} onClick={() => { setReply(savedReply); setReplying(false); onReplyStateChange?.(false); }}>×</button><button type="button" aria-label="Save reply" disabled={saving || !reply.trim()} onClick={() => void saveReply()}>✓</button></div></div> : null}
      {error ? <p role="alert" className="mt-1 text-xs text-danger">{error}</p> : null}
    </div>
  );
}
