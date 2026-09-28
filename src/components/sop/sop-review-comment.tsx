"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { addSopCommentReply, saveSopAuthorResponse, type SopReviewAnnotation } from "@/lib/sop/review-annotations";

export function commentDetails(body: string): string {
  return body.replace(/(^|\n\n)\[Attachment:[^\]]+\] /g, "$1Attachment: ").replace(/(^|\n\n)Selected text: “[\s\S]*?”\n/g, "$1").trim();
}

export function SopReviewComment({ remark, actions, canReply = false, canReviewerReply = false, viewerIsReviewer = false, onOpenAttachment, onReplyStateChange }: { remark: SopReviewAnnotation; actions?: ReactNode; canReply?: boolean; canReviewerReply?: boolean; viewerIsReviewer?: boolean; onOpenAttachment?: (id: string) => void; onReplyStateChange?: (editing: boolean) => void }) {
  const [collapsed, setCollapsed] = useState(false);
  const threadContentId = useId();
  const pendingReply = useRef<{ id: string; body: string } | null>(null);
  const [thread, setThread] = useState(remark.replies ?? []);
  const [threadDraft, setThreadDraft] = useState("");
  const [threadEditing, setThreadEditing] = useState(false);
  const [reply, setReply] = useState(remark.authorResponse ?? "");
  const [savedReply, setSavedReply] = useState(remark.authorResponse ?? "");
  const [replying, setReplying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setSavedReply(remark.authorResponse ?? ""); }, [remark.authorResponse]);
  useEffect(() => { if (!replying) setReply(savedReply); }, [savedReply, replying]);
  useEffect(() => { setThread(remark.replies ?? []); }, [remark.replies]);
  async function sendThreadReply() {
    if (saving || !threadDraft.trim()) return;
    setSaving(true); setError("");
    try { const pending = pendingReply.current ?? { id: crypto.randomUUID(), body: threadDraft.trim() }; pendingReply.current = pending; const sent = await addSopCommentReply(remark.id, pending.body, pending.id); pendingReply.current = null; setThread(items => [...items, sent]); setThreadDraft(""); setThreadEditing(false); onReplyStateChange?.(false); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not send reply"); }
    finally { setSaving(false); }
  }
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
  function bubble(body: string, reviewer: boolean, key?: string) {
    const mine = reviewer === viewerIsReviewer;
    return <div key={key} className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
      <span className="mb-1 px-1 text-[10px] text-ink-tertiary">{mine ? "You" : reviewer ? name : "Author"}</span>
      <p className={`max-w-[90%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-xs leading-5 ${mine ? "rounded-br-sm bg-accent text-canvas" : "rounded-bl-sm border border-line bg-surface-raised text-ink"}`}>{body}</p>
    </div>;
  }
  return (
    <div className="rounded-xl border border-line bg-canvas p-3">
      <div className="flex items-center gap-2">
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
        <button
          type="button"
          aria-label={collapsed ? "Expand conversation" : "Minimize conversation"}
          aria-expanded={!collapsed}
          aria-controls={threadContentId}
          title={collapsed ? "Expand conversation" : "Minimize conversation"}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-secondary hover:bg-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          onClick={() => setCollapsed(value => !value)}
        >
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d={collapsed ? "m9 6 6 6-6 6" : "m6 9 6 6 6-6"} />
          </svg>
        </button>
      </div>
      <div id={threadContentId} hidden={collapsed}>
      {onOpenAttachment ? attachments.map((match, index) => <button key={index} type="button" className="mt-2 block text-xs text-ink underline" onClick={() => { try { onOpenAttachment(decodeURIComponent(match[1])); } catch { setError("This attachment link is invalid."); } }}>{match[2]}</button>) : null}
      <div className="mt-4 space-y-3">
        {bubble(commentDetails(onOpenAttachment ? remark.body.replace(/(^|\n\n)\[Attachment:[^\]]+\] [^\n]+\n/g, "$1") : remark.body), true)}
        {savedReply ? bubble(savedReply, false) : null}
        {thread.map(item => bubble(item.body, item.createdBy === remark.createdBy, item.id))}
      </div>
      {(canReviewerReply || (canReply && thread.length > 0)) && !threadEditing ? <button type="button" className="mt-1 text-[11px] text-ink-secondary" onClick={() => { setThreadEditing(true); onReplyStateChange?.(true); }}>Reply</button> : null}
      {threadEditing ? <div className="relative mt-2"><textarea aria-label="Conversation reply" className="ui-field-standalone min-h-24 w-full !pb-9 text-xs" maxLength={2000} value={threadDraft} disabled={saving} onChange={event => setThreadDraft(event.target.value)} /><div className="absolute bottom-2 right-2 flex gap-3"><button aria-label="Cancel conversation reply" disabled={saving} onClick={() => { setThreadEditing(false); setThreadDraft(""); onReplyStateChange?.(false); }}>×</button><button aria-label="Send conversation reply" disabled={saving || !threadDraft.trim()} onClick={() => void sendThreadReply()}>✓</button></div></div> : null}
      {canReply && thread.length === 0 && !replying ? <button type="button" className="mt-1 text-[11px] text-ink-secondary" onClick={() => { setReplying(true); onReplyStateChange?.(true); }}>{savedReply ? "Edit reply" : "Reply"}</button> : null}
      {replying ? <div className="mt-2"><textarea aria-label="Author reply" className="ui-field-standalone w-full text-xs" maxLength={2000} value={reply} disabled={saving} onChange={(event) => setReply(event.target.value)} /><div className="flex justify-end gap-2"><button type="button" aria-label="Cancel reply" disabled={saving} onClick={() => { setReply(savedReply); setReplying(false); onReplyStateChange?.(false); }}>×</button><button type="button" aria-label="Save reply" disabled={saving || !reply.trim()} onClick={() => void saveReply()}>✓</button></div></div> : null}
      {error ? <p role="alert" className="mt-1 text-xs text-danger">{error}</p> : null}
      </div>
    </div>
  );
}
