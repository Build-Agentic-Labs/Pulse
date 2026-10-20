import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { listSopApproverNames } from "./review";

describe("SOP-scoped approver names", () => {
  it("requests SOP IDs through the restricted RPC and never queries profiles", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [
      { signer_id: "assigned", display_name: "Assigned Person" },
      { signer_id: "unnamed", display_name: null },
    ], error: null });
    const from = vi.fn();
    const client = { rpc, from } as unknown as SupabaseClient<Database>;
    expect(await listSopApproverNames(["sop-1", "sop-1"], client)).toEqual(new Map([["assigned", "Assigned Person"]]));
    expect(rpc).toHaveBeenCalledWith("sop_approver_display_names", { p_sops: ["sop-1"] });
    expect(from).not.toHaveBeenCalled();
    rpc.mockClear();
    expect(await listSopApproverNames([], client)).toEqual(new Map());
    expect(rpc).not.toHaveBeenCalled();
  });
  it("surfaces lookup errors instead of silently hiding the names", async () => {
    const client = { rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "Permission denied" } }) } as unknown as SupabaseClient<Database>;
    await expect(listSopApproverNames(["sop-1"], client)).rejects.toThrow("Permission denied");
  });
});
