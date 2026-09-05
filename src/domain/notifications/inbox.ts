/**
 * Inbox rows are derived from the email that was (or would have been) sent, so
 * the in-app record and the mailbox never disagree about what happened. Pure.
 */

import type { EmailContent } from "@/domain/notification-email-shell";

export const INBOX_BODY_MAX = 280;

export interface InboxTarget {
  /** App-relative link the row opens, e.g. "/sops/<id>". */
  link: string | null;
  entityType: string | null;
  entityId: string | null;
}

export interface InboxEntry extends InboxTarget {
  title: string;
  body: string;
}

export function inboxEntryFromEmail(content: EmailContent, target: InboxTarget): InboxEntry {
  const firstParagraph = content.text.split(/\n\s*\n/)[0]?.trim() ?? "";
  return {
    title: content.subject,
    body: firstParagraph.slice(0, INBOX_BODY_MAX),
    link: target.link,
    entityType: target.entityType,
    entityId: target.entityId,
  };
}
