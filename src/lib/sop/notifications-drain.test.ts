import { describe, expect, it } from "vitest";
import type { SopEmailContent } from "@/domain/sop/notifications";
import {
  BACKLOG_ALERT_HOURS,
  RETRY_BASE_MINUTES,
  assessDrainHealth,
  classifyResendFailure,
  createResendSender,
  isAuthorizedCronRequest,
  isRetryDue,
  retryBackoffMinutes,
  runSopNotificationDrain,
  type DrainBatch,
  type DrainItem,
  type DrainReport,
  type DrainStore,
  type EmailSender,
  type RetryItem,
} from "./notifications-drain";

const content: SopEmailContent = { subject: "s", text: "t", html: "<p>t</p>" };
const item = (over: Partial<DrainItem> = {}): DrainItem => ({
  pending: { recipientId: "u1", kind: "review_requested", sopId: "sop-1", eventId: 10, reminderIndex: 0, reviewCycle: 1 },
  email: "u1@example.com",
  content,
  ...over,
});

function fakeStore(batch: DrainBatch, retries: RetryItem[] = []) {
  const calls = {
    sent: [] as number[],
    failed: [] as { id: number; attempts: number }[],
    retryClaims: [] as { id: number; expected: number }[],
  };
  let nextLedgerId = 100;
  const store: DrainStore = {
    ledger: "sop_notifications",
    collect: async () => batch,
    retryItems: async () => retries,
    claim: async () => ({ claimed: true, ledgerId: nextLedgerId++ }),
    claimRetry: async (id, expected) => {
      calls.retryClaims.push({ id, expected });
      return true;
    },
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

describe("createResendSender", () => {
  it("sends an Idempotency-Key so a resend of the same ledger row cannot double-deliver", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ id: "re_abc" }), { status: 200 });
    };
    const send = createResendSender("re_key", "Pulse <n@pulse.test>", fetchImpl as typeof fetch);
    const result = await send("to@example.com", content, { idempotencyKey: "sop_notifications:7" });
    expect(result).toEqual({ ok: true, id: "re_abc" });
    expect(seen).toHaveLength(1);
    const headers = seen[0].init.headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBe("sop_notifications:7");
    expect(headers.Authorization).toBe("Bearer re_key");
    expect(JSON.parse(String(seen[0].init.body))).toMatchObject({ to: ["to@example.com"], subject: "s" });
  });
});

describe("runSopNotificationDrain", () => {
  const now = () => new Date("2026-07-21T12:00:00Z");
  const origin = "https://pulse.example.com";

  it("keys every send on the ledger name and row id, first-touch and retry alike", async () => {
    const keys: string[] = [];
    const recordingSender: EmailSender = async (_to, _content, options) => {
      keys.push(options.idempotencyKey);
      return { ok: true, id: "re_1" };
    };
    const retries: RetryItem[] = [{ ledgerId: 55, email: "u1@example.com", content, attempts: 1 }];
    const { store } = fakeStore({ items: [item()], oldestUnnotifiedEventAgeHours: null }, retries);
    await runSopNotificationDrain({ store, send: recordingSender, now, origin });
    expect(keys).toEqual(["sop_notifications:100", "sop_notifications:55"]);
  });

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
    store.claim = async (pending, rendered) => {
      claims += 1;
      return baseClaim(pending, rendered);
    };
    const report = await runSopNotificationDrain({ store, send: okSender, now, origin });
    expect(report.skippedNoEmail).toBe(1);
    expect(claims).toBe(0);
    expect(calls.sent).toEqual([]);
  });

  it("a recipient rejection jumps attempts to the cap (dead row, never retried)", async () => {
    const { store, calls } = fakeStore({ items: [item()], oldestUnnotifiedEventAgeHours: null });
    const bouncer = async () => ({ ok: false as const, status: 422, error: "invalid to", failure: "recipient" as const });
    const report = await runSopNotificationDrain({ store, send: bouncer, now, origin });
    expect(report.failed).toBe(1);
    expect(calls.failed).toEqual([{ id: 100, attempts: 3 }]);
  });

  it("a transient failure increments attempts by one", async () => {
    const { store, calls } = fakeStore({ items: [item()], oldestUnnotifiedEventAgeHours: null });
    const flaky = async () => ({ ok: false as const, status: 500, error: "boom", failure: "transient" as const });
    await runSopNotificationDrain({ store, send: flaky, now, origin });
    expect(calls.failed).toEqual([{ id: 100, attempts: 1 }]);
  });

  it("a CONFIGURATION rejection records the error without consuming an attempt", async () => {
    // The RESEND_FROM outage: our own `from` header was malformed, every send
    // 422'd, and the old blanket "4xx is permanent" rule burned the cap
    // instantly — killing the notification forever for a fault that a one-line
    // env fix would have cleared. Holding attempts lets the row deliver itself
    // on the next drain after a human fixes the config.
    const { store, calls } = fakeStore({ items: [item()], oldestUnnotifiedEventAgeHours: null });
    const misconfigured = async () => ({
      ok: false as const,
      status: 422,
      error: "Invalid `from` field",
      failure: "configuration" as const,
    });
    const report = await runSopNotificationDrain({ store, send: misconfigured, now, origin });
    expect(report.blocked).toBe(1);
    expect(report.failed).toBe(0);
    expect(calls.failed).toEqual([{ id: 100, attempts: 0 }]);
  });

  it("a configuration rejection on the retry lane holds that row's attempt count too", async () => {
    const retries: RetryItem[] = [{ ledgerId: 55, email: "u1@example.com", content, attempts: 1 }];
    const { store, calls } = fakeStore({ items: [], oldestUnnotifiedEventAgeHours: null }, retries);
    const misconfigured = async () => ({
      ok: false as const,
      status: 401,
      error: "API key is invalid",
      failure: "configuration" as const,
    });
    const report = await runSopNotificationDrain({ store, send: misconfigured, now, origin });
    expect(report.blocked).toBe(1);
    expect(report.retried).toBe(0);
    expect(calls.failed).toEqual([{ id: 55, attempts: 1 }]);
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

  it("retry lane atomically claims each row (at its attempt count) before sending", async () => {
    const retries: RetryItem[] = [{ ledgerId: 55, email: "u1@example.com", content, attempts: 1 }];
    const { store, calls } = fakeStore({ items: [], oldestUnnotifiedEventAgeHours: null }, retries);
    await runSopNotificationDrain({ store, send: okSender, now, origin });
    expect(calls.retryClaims).toEqual([{ id: 55, expected: 1 }]);
    expect(calls.sent).toEqual([55]);
  });

  it("a lost retry claim (concurrent drain won the row) skips without sending", async () => {
    const retries: RetryItem[] = [{ ledgerId: 55, email: "u1@example.com", content, attempts: 1 }];
    const { store, calls } = fakeStore({ items: [], oldestUnnotifiedEventAgeHours: null }, retries);
    store.claimRetry = async () => false;
    const report = await runSopNotificationDrain({ store, send: okSender, now, origin });
    expect(report.skippedDuplicate).toBe(1);
    expect(report.retried).toBe(0);
    expect(report.failed).toBe(0);
    expect(calls.sent).toEqual([]);
  });

  it("a store.claim rejection costs only that item", async () => {
    const items = [item(), item({ pending: { ...item().pending, recipientId: "u2" }, email: "u2@example.com" })];
    const { store, calls } = fakeStore({ items, oldestUnnotifiedEventAgeHours: null });
    let first = true;
    const baseClaim = store.claim;
    store.claim = async (pending, rendered) => {
      if (first) {
        first = false;
        throw new Error("db timeout");
      }
      return baseClaim(pending, rendered);
    };
    const report = await runSopNotificationDrain({ store, send: okSender, now, origin });
    expect(report.failed).toBe(1);
    expect(report.sent).toBe(1);
    expect(calls.sent).toHaveLength(1);
  });

  it("a rejecting markFailed after a failed send still costs only that item", async () => {
    const items = [item(), item({ pending: { ...item().pending, recipientId: "u2" }, email: "u2@example.com" })];
    const { store } = fakeStore({ items, oldestUnnotifiedEventAgeHours: null });
    store.markFailed = async () => {
      throw new Error("db down");
    };
    let first = true;
    const flakySender = async () => {
      if (first) {
        first = false;
        return { ok: false as const, status: 500, error: "boom", failure: "transient" as const };
      }
      return { ok: true as const, id: "re_2" };
    };
    const report = await runSopNotificationDrain({ store, send: flakySender, now, origin });
    expect(report.failed).toBe(1);
    expect(report.sent).toBe(1);
  });
});

describe("assessDrainHealth", () => {
  const clean: DrainReport = {
    configured: true,
    sent: 3,
    retried: 0,
    skippedDuplicate: 0,
    skippedNoEmail: 0,
    failed: 0,
    blocked: 0,
    oldestUnnotifiedEventAgeHours: 1,
  };

  it("a drain that sent its batch is healthy", () => {
    expect(assessDrainHealth([{ label: "sop", report: clean }])).toEqual({ healthy: true, problems: [] });
  });

  it("flags a configuration block — the signal that was missing during the outage", () => {
    const health = assessDrainHealth([{ label: "sop", report: { ...clean, sent: 0, blocked: 1 } }]);
    expect(health.healthy).toBe(false);
    expect(health.problems[0]).toContain("blocked by configuration");
  });

  it("flags an unconfigured sender — nothing can send at all", () => {
    const health = assessDrainHealth([{ label: "sop", report: { ...clean, configured: false } }]);
    expect(health.healthy).toBe(false);
    expect(health.problems[0]).toContain("not configured");
  });

  it("flags a backlog older than the threshold", () => {
    const stale = { ...clean, oldestUnnotifiedEventAgeHours: BACKLOG_ALERT_HOURS + 1 };
    expect(assessDrainHealth([{ label: "sop", report: stale }]).healthy).toBe(false);
    const fresh = { ...clean, oldestUnnotifiedEventAgeHours: BACKLOG_ALERT_HOURS - 1 };
    expect(assessDrainHealth([{ label: "sop", report: fresh }]).healthy).toBe(true);
  });

  it("does NOT alert on ordinary bounces — a dead address is not an outage", () => {
    // Noisy health checks get ignored, which is how the real one gets missed.
    expect(assessDrainHealth([{ label: "sop", report: { ...clean, failed: 1 } }]).healthy).toBe(true);
  });

  it("reports every unhealthy store, labelled", () => {
    const health = assessDrainHealth([
      { label: "sop", report: { ...clean, blocked: 2 } },
      { label: "workspace", report: { ...clean, configured: false } },
    ]);
    expect(health.problems).toHaveLength(2);
    expect(health.problems[0]).toContain("sop");
    expect(health.problems[1]).toContain("workspace");
  });
});

describe("classifyResendFailure", () => {
  // The exact body Resend returned during the 2026-07-29 outage.
  const badFrom =
    '{"statusCode":422,"name":"validation_error","message":"Invalid `from` field. The email address needs to follow the `email@example.com` or `Name <email@example.com>` format."}';

  it("treats a malformed `from` as OUR configuration, not a dead recipient", () => {
    expect(classifyResendFailure(422, badFrom)).toBe("configuration");
  });

  it("treats auth and domain rejections as configuration", () => {
    expect(classifyResendFailure(401, '{"message":"API key is invalid"}')).toBe("configuration");
    expect(classifyResendFailure(403, '{"message":"The domain is not verified"}')).toBe("configuration");
  });

  it("treats a rejected `to` address as a recipient fault", () => {
    expect(classifyResendFailure(422, '{"message":"Invalid `to` field: not an email"}')).toBe("recipient");
  });

  it("treats rate limiting and provider errors as transient", () => {
    expect(classifyResendFailure(429, "slow down")).toBe("transient");
    expect(classifyResendFailure(500, "boom")).toBe("transient");
    expect(classifyResendFailure(503, "unavailable")).toBe("transient");
  });

  it("defaults an unrecognised 4xx to configuration so the row survives", () => {
    // Deliberate bias: a stuck-and-visible row beats a silently dead one. The
    // outage this guards against was two weeks of mail nobody knew was lost.
    expect(classifyResendFailure(400, "something we have never seen")).toBe("configuration");
  });
});

describe("retry lease backoff", () => {
  it("doubles the minimum spacing with each recorded attempt", () => {
    expect(retryBackoffMinutes(0)).toBe(RETRY_BASE_MINUTES);
    expect(retryBackoffMinutes(1)).toBe(RETRY_BASE_MINUTES * 2);
    expect(retryBackoffMinutes(2)).toBe(RETRY_BASE_MINUTES * 4);
  });

  it("holds a row until its attempt-scaled lease elapses", () => {
    const last = new Date("2026-07-21T12:00:00Z");
    const spacingMs = RETRY_BASE_MINUTES * 2 * 60 * 1000; // attempts = 1
    expect(isRetryDue(new Date(last.getTime() + spacingMs - 1000), last, last, 1)).toBe(false);
    expect(isRetryDue(new Date(last.getTime() + spacingMs + 1000), last, last, 1)).toBe(true);
  });

  it("leases a claimed-but-never-attempted row off created_at", () => {
    const created = new Date("2026-07-21T12:00:00Z");
    const spacingMs = RETRY_BASE_MINUTES * 60 * 1000; // attempts = 0
    expect(isRetryDue(new Date(created.getTime() + spacingMs - 1000), null, created, 0)).toBe(false);
    expect(isRetryDue(new Date(created.getTime() + spacingMs + 1000), null, created, 0)).toBe(true);
  });
});
