/**
 * Round-trip navigation from the Review queue into an SOP and back. Plain module on purpose:
 * the queue (client), the bell summary (domain) and the editor all read the same constants.
 */

export const REVIEW_QUEUE_HREF = "/sops?tab=review";

/** Query flag an SOP link carries when it was opened from the Review queue. */
export const QUEUE_ORIGIN_PARAM = "via";
export const QUEUE_ORIGIN_VALUE = "review";

/** Marks an SOP href as opened from the queue, so the editor's back link returns there. */
export function viaReviewQueue(href: string): string {
  return `${href}${href.includes("?") ? "&" : "?"}${QUEUE_ORIGIN_PARAM}=${QUEUE_ORIGIN_VALUE}`;
}
