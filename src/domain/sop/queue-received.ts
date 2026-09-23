/**
 * "Received" dates for the review queue: when each item landed on the viewer. Pure.
 * Every input is already an immutable record (sop_event_log, sop_review_submissions),
 * so the same derivation can later feed turnaround metrics.
 */

interface CycleSop {
  id: string;
  reviewCycle: number;
}

interface HandoffEvent {
  sopId: string;
  reviewCycle: number;
  eventType: string;
  details: Record<string, unknown>;
  createdAt: string;
}

interface ReturnedReview {
  sopId: string;
  reviewCycle: number;
  submittedAt: string;
}

function latestBySop<T extends { sopId: string }>(
  items: readonly T[],
  sops: readonly CycleSop[],
  cycleOf: (item: T) => number,
  timeOf: (item: T) => string,
  include: (item: T) => boolean = () => true,
): Record<string, string> {
  const cycles = new Map(sops.map((sop) => [sop.id, sop.reviewCycle]));
  const out: Record<string, string> = {};
  for (const item of items) {
    if (cycles.get(item.sopId) !== cycleOf(item) || !include(item)) continue;
    const at = timeOf(item);
    if (!out[item.sopId] || at > out[item.sopId]) out[item.sopId] = at;
  }
  return out;
}

/**
 * When a review reached this reviewer in the SOP's current cycle: the author sending it for
 * review, or — if later — the seat being reassigned to them.
 */
export function reviewReceivedAt(
  events: readonly HandoffEvent[],
  sops: readonly CycleSop[],
  reviewerId: string,
): Record<string, string> {
  return latestBySop(
    events,
    sops,
    (event) => event.reviewCycle,
    (event) => event.createdAt,
    (event) =>
      event.eventType === "review_sent" ||
      (event.eventType === "seat_reassigned" && event.details.to_signer_id === reviewerId),
  );
}

/** When an author's feedback was complete: the last current-cycle review to come back. */
export function feedbackReceivedAt(
  returns: readonly ReturnedReview[],
  sops: readonly CycleSop[],
): Record<string, string> {
  return latestBySop(
    returns,
    sops,
    (entry) => entry.reviewCycle,
    (entry) => entry.submittedAt,
  );
}
