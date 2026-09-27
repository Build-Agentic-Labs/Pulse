import { MessageSquare } from "lucide-react";

export function AttachmentCommentButton({ id, name, category }: { id: string; name: string; category: "references" | "annexes" }) {
  return <button type="button" aria-label={`Comment on ${name}`} title={`Comment on ${name}`} data-comment-attachment={id} data-comment-name={name} data-comment-category={category} className="sop-attachment-comment ml-2 inline-flex h-6 w-6 items-center justify-center rounded text-ink-secondary hover:bg-surface-hover"><MessageSquare size={13} /></button>;
}
