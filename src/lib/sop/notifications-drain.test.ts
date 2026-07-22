import { describe, expect, it } from "vitest";
import type { SopEmailContent } from "@/domain/sop/notifications";
import {
  isAuthorizedCronRequest,
  runSopNotificationDrain,
  type DrainBatch,
  type DrainItem,
  type DrainStore,
  type RetryItem,
} from "./notifications-drain";

const content: SopEmailContent = { subject: "s", text: "t", html: "<p>t</p>" };
const item = (over: Partial<DrainItem> = {}): DrainItem => ({
  pending: { recipientId: "u1", kind: "review_requested", sopId: "sop-1", eventId: 10, reminderIndex: 0 },
  email: "u1@example.com",
  content,
  ...over,
});

function fakeStore(batch: DrainBatch, retries: RetryItem[] = []) {
  const calls = { claims: 0, sent: [] as number[], failed: [] as { id: number; attempts: number }[] };
  let nextLedgerId = 100;
  const store: DrainStore = {
    collect: async () => batch,
    retryItems: async () => retries,
    claim: async () => ({ claimed: true, ledgerId: nextLedgerId++ }),
    markSent: async (id) => void calls.sent.push(id),
    markFailed: async (id, _error, attempts) => void calls.failed.push({ id, attempts }),
  };
  return { store, calls };
}

const okSender = async () => ({ ok: true as const, id: "re_123" });

describe("isAuthorizedCronRequest", () => {
  it("accepts the CRON_SECRET bearer and nothing else", () => {
    process.env.CRON_SECRET = "topsecret";
    const withAuth = (value?: string) =>
      new Request("https://x.test/api", { headers: value ? { authorization: value } : {} });
    expect(isAuthorizedCronRequest(withAuth("Bearer topsecret"))).toBe(true);
    expect(isAuthorizedCronRequest(withAuth("Bearer wrong"))).toBe(false);
    expect(isAuthorizedCronRequest(withAuth())).toBe(false);
    delete process.env.CRON_SECRET;
    expect(isAuthorizedCronRequest(withAuth("Bearer topsecret"))).toBe(false);
  });
});

describe("runSopNotificationDrain", () => {
  const now = () => new Date("2026-07-21T12:00:00Z");
  const origin = "https://pulse.example.com";

  it("unconfigured (no sender): reports without claiming anything", async () => {
    const { store, calls } = fakeStore({ items: [item()], oldestUnnotifiedEventAgeHours: 5 });
    const report = await runSopNotificationDrain({ store, send: null, now, origin });
    expect(report.configured).toBe(false);
    expect(report.sent).toBe(0);
    expect(report.oldestUnnotifiedEventAgeHours).toBe(5);
    expect(calls.sent).toEqual([]);
  });

  it("claims, sends, and stamps each item", async () => {
    const { store, calls } = fakeStore({ items: [item()], oldestUnnotifiedEventAgeHours: null });
    const report = await runSopNotificationDrain({ store, send: okSender, now, origin });
    expect(report.sent).toBe(1);
    expect(calls.sent).toEqual([100]);
  });

  it("a lost claim (unique-index race) is a skip, not a failure", async () => {
    const { store } = fakeStore({ items: [item()], oldestUnnotifiedEventAgeHours: null });
    store.claim = async () => ({ claimed: false, ledgerId: null });
    const report = await runSopNotificationDrain({ store, send: okSender, now, origin });
    expect(report.skippedDuplicate).toBe(1);
    expect(report.sent).toBe(0);
    expect(report.failed).toBe(0);
  });

  it("missing email skips WITHOUT claiming (retries when the profile gains one)", async () => {
    const { store, calls } = fakeStore({ items: [item({ email: null })], oldestUnnotifiedEventAgeHours: null });
    let claims = 0;
    const baseClaim = store.claim;
    store.claim = async (pending) => {
      claims += 1;
      return baseClaim(pending);
    };
    const report = await runSopNotificationDrain({ store, send: okSender, now, origin });
    expect(report.skippedNoEmail).toBe(1);
    expect(claims).toBe(0);
    expect(calls.sent).toEqual([]);
  });

  it("a permanent send failure jumps attempts to the cap (dead row, never retried)", async () => {
    const { store, calls } = fakeStore({ items: [item()], oldestUnnotifiedEventAgeHours: null });
    const bouncer = async () => ({ ok: false as const, status: 422, error: "invalid to", permanent: true });
    const report = await runSopNotificationDrain({ store, send: bouncer, now, origin });
    expect(report.failed).toBe(1);
    expect(calls.failed).toEqual([{ id: 100, attempts: 3 }]);
  });

  it("a transient failure increments attempts by one", async () => {
    const { store, calls } = fakeStore({ items: [item()], oldestUnnotifiedEventAgeHours: null });
    const flaky = async () => ({ ok: false as const, status: 500, error: "boom", permanent: false });
    await runSopNotificationDrain({ store, send: flaky, now, origin });
    expect(calls.failed).toEqual([{ id: 100, attempts: 1 }]);
  });

  it("one thrown send never aborts the batch", async () => {
    const items = [item(), item({ pending: { ...item().pending, recipientId: "u2" }, email: "u2@example.com" })];
    const { store } = fakeStore({ items, oldestUnnotifiedEventAgeHours: null });
    let first = true;
    const explosive = async () => {
      if (first) {
        first = false;
        throw new Error("network died");
      }
      return { ok: true as const, id: "re_2" };
    };
    const report = await runSopNotificationDrain({ store, send: explosive, now, origin });
    expect(report.sent).toBe(1);
    expect(report.failed).toBe(1);
  });

  it("retry lane resends claimed-but-unsent rows below the attempt cap", async () => {
    const retries: RetryItem[] = [
      { ledgerId: 55, email: "u1@example.com", content, attempts: 1 },
      { ledgerId: 56, email: null, content, attempts: 1 },
    ];
    const { store, calls } = fakeStore({ items: [], oldestUnnotifiedEventAgeHours: null }, retries);
    const report = await runSopNotificationDrain({ store, send: okSender, now, origin });
    expect(report.retried).toBe(1);
    expect(calls.sent).toEqual([55]);
    expect(report.skippedNoEmail).toBe(1);
  });
});
