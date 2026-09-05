import { describe, expect, it } from "vitest";
import { classifyLedgerRow } from "./ledger-state";

describe("classifyLedgerRow", () => {
  const base = { sentAt: null, attempts: 0, lastError: null, skippedReason: null, maxAttempts: 3 };

  it("sent beats everything", () => {
    expect(classifyLedgerRow({ ...base, sentAt: "2026-09-04T00:00:00Z", attempts: 3, lastError: "x" })).toBe("sent");
  });

  it("a skipped row is terminal without a send", () => {
    expect(classifyLedgerRow({ ...base, skippedReason: "preference" })).toBe("skipped");
  });

  it("attempts at the cap without a send is dead", () => {
    expect(classifyLedgerRow({ ...base, attempts: 3, lastError: "422: Invalid `to`" })).toBe("dead");
  });

  it("an error with no attempt spent is a configuration hold", () => {
    expect(classifyLedgerRow({ ...base, attempts: 0, lastError: "422: Invalid `from` field" })).toBe("blocked");
  });

  it("everything else is pending (claimed, retrying, or never tried)", () => {
    expect(classifyLedgerRow(base)).toBe("pending");
    expect(classifyLedgerRow({ ...base, attempts: 1, lastError: "500: upstream" })).toBe("pending");
  });
});
