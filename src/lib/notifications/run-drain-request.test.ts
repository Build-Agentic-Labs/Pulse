import { describe, expect, it } from "vitest";
import type { DrainStore, EmailSender } from "@/lib/sop/notifications-drain";
import { runDrainRequest, type DrainRunInput } from "./run-drain-request";

const now = () => new Date("2026-09-04T13:00:00Z");
const origin = "https://pulse.example.com";
const content = { subject: "s", text: "t", html: "<p>t</p>" };
const okSender: EmailSender = async () => ({ ok: true, id: "re_1" });

function emptyStore(ledger: string): DrainStore<unknown> {
  return {
    ledger,
    collect: async () => ({ items: [], oldestUnnotifiedEventAgeHours: null }),
    retryItems: async () => [],
    claim: async () => ({ claimed: true, ledgerId: 1 }),
    markSent: async () => {},
    markFailed: async () => {},
  };
}

function sendingStore(ledger: string): DrainStore<unknown> {
  return {
    ...emptyStore(ledger),
    collect: async () => ({
      items: [{ pending: { recipientId: "u1" }, email: "u1@example.com", content }],
      oldestUnnotifiedEventAgeHours: 1,
    }),
  };
}

function brokenStore(ledger: string): DrainStore<unknown> {
  return {
    ...emptyStore(ledger),
    collect: async () => {
      throw new Error("relation \"notification_digests\" does not exist");
    },
  };
}

describe("runDrainRequest", () => {
  it("runs every store, answers 200 when healthy, and records the run", async () => {
    const recorded: DrainRunInput[] = [];
    const result = await runDrainRequest({
      caller: "kick",
      stores: [
        { label: "sop", store: sendingStore("sop_notifications") },
        { label: "workspace", store: emptyStore("workspace_notifications") },
      ],
      send: okSender,
      now,
      origin,
      recordRun: async (run) => void recorded.push(run),
    });
    expect(result.status).toBe(200);
    expect(result.body.healthy).toBe(true);
    expect(result.body.configured).toBe(true);
    expect(result.body.caller).toBe("kick");
    expect(result.body.stores.sop).toMatchObject({ sent: 1 });
    expect(result.body.stores.workspace).toMatchObject({ sent: 0 });
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ caller: "kick", healthy: true, problems: [] });
    expect(recorded[0].report).toMatchObject({ sop: { sent: 1 } });
  });

  it("isolates a failing store: the others still drain, the failure is named, and the run is 503", async () => {
    const recorded: DrainRunInput[] = [];
    const result = await runDrainRequest({
      caller: "cron",
      stores: [
        { label: "sop", store: sendingStore("sop_notifications") },
        { label: "digest", store: brokenStore("notification_digests") },
      ],
      send: okSender,
      now,
      origin,
      recordRun: async (run) => void recorded.push(run),
    });
    expect(result.status).toBe(503);
    expect(result.body.stores.sop).toMatchObject({ sent: 1 });
    expect(result.body.stores.digest).toEqual({ error: 'relation "notification_digests" does not exist' });
    expect(result.body.problems).toEqual(['digest: drain failed — relation "notification_digests" does not exist']);
    expect(recorded[0]).toMatchObject({ caller: "cron", healthy: false });
  });

  it("answers 503 when unconfigured, and still records the run so the silence is visible", async () => {
    const recorded: DrainRunInput[] = [];
    const result = await runDrainRequest({
      caller: "cron",
      stores: [{ label: "sop", store: emptyStore("sop_notifications") }],
      send: null,
      now,
      origin,
      recordRun: async (run) => void recorded.push(run),
    });
    expect(result.status).toBe(503);
    expect(result.body.configured).toBe(false);
    expect(result.body.problems[0]).toContain("email is not configured");
    expect(recorded).toHaveLength(1);
  });

  it("never lets the run log break the drain: a failed record is reported, not thrown", async () => {
    const result = await runDrainRequest({
      caller: "kick",
      stores: [{ label: "sop", store: sendingStore("sop_notifications") }],
      send: okSender,
      now,
      origin,
      recordRun: async () => {
        throw new Error("runs table missing");
      },
    });
    expect(result.status).toBe(200);
    expect(result.body.stores.sop).toMatchObject({ sent: 1 });
    expect(result.body.runRecorded).toBe(false);
  });
});
