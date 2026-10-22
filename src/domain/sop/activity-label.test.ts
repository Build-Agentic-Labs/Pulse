import { describe, expect, it } from "vitest";
import { automaticRoutingDetails } from "./activity-label";
describe("automatic routing activity", () => {
  it("distinguishes automatic signature routing from an author request", () => {
    expect(automaticRoutingDetails("final_approval_requested", { automatic: true })?.title).toBe("Automatically routed for signatures");
    expect(automaticRoutingDetails("final_approval_requested", { automatic: false })).toBeNull();
    expect(automaticRoutingDetails("final_approval_requested", null)).toBeNull();
  });
  it("explains the Quality handoff", () => {
    expect(automaticRoutingDetails("status_changed", { to_status: "approved" })?.reason).toContain("Every required department signature");
    expect(automaticRoutingDetails("status_changed", { to_status: "effective" })).toBeNull();
  });
});
