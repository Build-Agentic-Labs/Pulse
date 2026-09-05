/**
 * How a ledger row reads to a human: the console's state chip. Pure. Mirrors
 * the drain's own rules — a configuration fault holds the attempt count (so
 * `lastError` with zero attempts spent is a hold, not a failure), and the
 * attempt cap without a send is dead.
 */

export type LedgerState = "sent" | "skipped" | "dead" | "blocked" | "pending";

export interface LedgerRowFacts {
  sentAt: string | null;
  attempts: number;
  lastError: string | null;
  skippedReason: string | null;
  maxAttempts: number;
}

export function classifyLedgerRow(row: LedgerRowFacts): LedgerState {
  if (row.sentAt) return "sent";
  if (row.skippedReason) return "skipped";
  if (row.attempts >= row.maxAttempts) return "dead";
  if (row.lastError && row.attempts === 0) return "blocked";
  return "pending";
}
