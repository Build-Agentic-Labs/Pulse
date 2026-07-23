import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createPlannerSupabaseClient: vi.fn(),
  getUserFromSession: vi.fn(),
}));

vi.mock("@/domain/supabase-planner", () => ({
  createPlannerSupabaseClient: mocks.createPlannerSupabaseClient,
  getUserFromSession: mocks.getUserFromSession,
}));

import { createEmptySop } from "@/domain/sop/schema";
import { saveSop, SopConflictError } from "./store";

afterEach(() => {
  vi.restoreAllMocks();
  mocks.createPlannerSupabaseClient.mockReset();
  mocks.getUserFromSession.mockReset();
});

type Result = { data: unknown; error: { code?: string; message: string } | null };

function sopRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "sop-1",
    workspace_id: "ws-1",
    department_id: "dept-1",
    sop_number: "SOP-QAS-001",
    title: "Recovered SOP",
    version: "1.0",
    source: "authored",
    status: "draft",
    effective_date: null,
    document: {},
    created_at: "2026-07-23T00:00:00Z",
    updated_at: "2026-07-23T00:00:00Z",
    ...overrides,
  };
}

// The insert path (no expectedUpdatedAt) with a 23505 primary-key collision exercises the
// dropped-response recovery branch. Callers below queue the three round-trips saveSop makes.
function makeClient(cfg: { insert: Result; existing?: Result; recovered?: Result }) {
  const calls = { updatedWith: null as unknown, updateGuardedOn: null as unknown };
  const client = {
    from: () => ({
      insert: () => ({
        select: () => ({
          single: () => Promise.resolve(cfg.insert),
        }),
      }),
      select: () => ({
        eq: () => ({
          is: () => ({
            maybeSingle: () => Promise.resolve(cfg.existing ?? { data: null, error: null }),
          }),
        }),
      }),
      update: (values: unknown) => {
        calls.updatedWith = values;
        return {
          eq: () => ({
            eq: (_col: string, value: unknown) => {
              calls.updateGuardedOn = value;
              return {
                is: () => ({
                  select: () => ({
                    maybeSingle: () => Promise.resolve(cfg.recovered ?? { data: null, error: null }),
                  }),
                }),
              };
            },
          }),
        };
      },
    }),
  };
  return { client, calls };
}

const pkeyError = {
  code: "23505",
  message: 'duplicate key value violates unique constraint "sops_pkey"',
};

describe("saveSop first-INSERT dropped-response recovery", () => {
  it("adopts the committed row and falls through to a guarded UPDATE on a pkey collision", async () => {
    const { client, calls } = makeClient({
      insert: { data: null, error: pkeyError },
      existing: {
        data: sopRow({ created_by: "user-1", updated_at: "2026-07-23T00:05:00Z" }),
        error: null,
      },
      recovered: {
        data: sopRow({ updated_at: "2026-07-23T00:06:00Z" }),
        error: null,
      },
    });
    mocks.createPlannerSupabaseClient.mockReturnValue(client);
    mocks.getUserFromSession.mockResolvedValue({ data: { user: { id: "user-1" } } });

    const result = await saveSop(createEmptySop("sop-1", "2026-07-23T00:00:00Z"), "ws-1");

    expect(result.id).toBe("sop-1");
    expect(result.updatedAt).toBe("2026-07-23T00:06:00Z");
    // The guarded UPDATE keys on the committed row's own updated_at, not the (absent) token.
    expect(calls.updateGuardedOn).toBe("2026-07-23T00:05:00Z");
  });

  it("surfaces a conflict when the committed row moves again before the recovery UPDATE", async () => {
    const { client } = makeClient({
      insert: { data: null, error: pkeyError },
      existing: {
        data: sopRow({ created_by: "user-1", updated_at: "2026-07-23T00:05:00Z" }),
        error: null,
      },
      recovered: { data: null, error: null },
    });
    mocks.createPlannerSupabaseClient.mockReturnValue(client);
    mocks.getUserFromSession.mockResolvedValue({ data: { user: { id: "user-1" } } });

    await expect(saveSop(createEmptySop("sop-1", "2026-07-23T00:00:00Z"), "ws-1")).rejects.toBeInstanceOf(
      SopConflictError,
    );
  });

  it("surfaces the original error when the colliding row belongs to another user", async () => {
    const { client } = makeClient({
      insert: { data: null, error: pkeyError },
      existing: {
        data: sopRow({ created_by: "someone-else", updated_at: "2026-07-23T00:05:00Z" }),
        error: null,
      },
    });
    mocks.createPlannerSupabaseClient.mockReturnValue(client);
    mocks.getUserFromSession.mockResolvedValue({ data: { user: { id: "user-1" } } });

    await expect(saveSop(createEmptySop("sop-1", "2026-07-23T00:00:00Z"), "ws-1")).rejects.toThrow("sops_pkey");
  });

  it("passes a non-pkey insert error straight through the store translation", async () => {
    const { client } = makeClient({
      insert: {
        data: null,
        error: { code: "23505", message: 'duplicate key value violates unique constraint "sops_ws_number_idx"' },
      },
    });
    mocks.createPlannerSupabaseClient.mockReturnValue(client);
    mocks.getUserFromSession.mockResolvedValue({ data: { user: { id: "user-1" } } });

    await expect(saveSop(createEmptySop("sop-1", "2026-07-23T00:00:00Z"), "ws-1")).rejects.toThrow(
      "An SOP with this number already exists in this workspace.",
    );
  });
});
