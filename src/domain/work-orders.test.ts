import { describe, expect, it } from "vitest";
import {
  buildTransitionPatch,
  canTransitionWorkOrder,
  missingAssemblyCount,
  nextForwardStatus,
  orderNoMonthKey,
  setNoFromOrderNo,
  suggestOrderNo,
  trailerOrderNo,
} from "./work-orders";

describe("orderNoMonthKey", () => {
  it("derives MMYY from an ISO date", () => {
    expect(orderNoMonthKey("2026-07-15")).toBe("0726");
    expect(orderNoMonthKey("2027-01-02")).toBe("0127");
  });
  it("falls back to 0000 on malformed input", () => {
    expect(orderNoMonthKey("garbage")).toBe("0000");
  });
});

describe("suggestOrderNo", () => {
  it("starts each month at 01 with the type prefix", () => {
    expect(suggestOrderNo([], "2026-07-15", "head_unit")).toBe("GEN-0726-01");
    expect(suggestOrderNo([], "2026-07-15", "accessories")).toBe("ACC-0726-01");
  });
  it("continues the month's sequence", () => {
    expect(suggestOrderNo(["GEN-0726-01", "GEN-0726-03"], "2026-07-20", "head_unit")).toBe("GEN-0726-04");
  });
  it("ignores other months and other types", () => {
    expect(suggestOrderNo(["GEN-0626-09", "MTS-0605-02", "GEN-0726-02"], "2026-07-01", "head_unit")).toBe(
      "GEN-0726-03",
    );
  });
  it("is case/whitespace tolerant", () => {
    expect(suggestOrderNo([" gen-0726-07 "], "2026-07-31", "head_unit")).toBe("GEN-0726-08");
  });
  it("grows past two digits", () => {
    expect(suggestOrderNo(["GEN-0726-99"], "2026-07-01", "head_unit")).toBe("GEN-0726-100");
  });
  it("shares one sequence pool across GEN and PM so a set's NN is never reused", () => {
    // A power module numbering off an existing Main must skip past the Main's NN.
    expect(suggestOrderNo(["GEN-0726-02"], "2026-07-10", "power_module")).toBe("PM-0726-03");
    // ...and a Main must skip past an existing PM number too.
    expect(suggestOrderNo(["PM-0726-05"], "2026-07-10", "head_unit")).toBe("GEN-0726-06");
  });
  it("keeps other types independent of the GEN/PM pool", () => {
    expect(suggestOrderNo(["GEN-0726-09", "PM-0726-09"], "2026-07-10", "accessories")).toBe("ACC-0726-01");
  });
});

describe("trailerOrderNo", () => {
  it("numbers a trailer by its config letter", () => {
    expect(trailerOrderNo("2026-07-15", "A")).toBe("TRL-0726-A");
  });
  it("uppercases and trims the letter", () => {
    expect(trailerOrderNo("2026-07-15", " b ")).toBe("TRL-0726-B");
  });
});

describe("setNoFromOrderNo", () => {
  it("extracts the trailing set segment", () => {
    expect(setNoFromOrderNo("GEN-0726-01")).toBe("01");
    expect(setNoFromOrderNo("PM-0726-03")).toBe("03");
  });
  it("tolerates junk", () => {
    expect(setNoFromOrderNo("garbage")).toBe("");
    expect(setNoFromOrderNo("")).toBe("");
  });
});

describe("canTransitionWorkOrder", () => {
  const editor = { isManager: false };
  const manager = { isManager: true };
  it("allows the forward step for editors", () => {
    expect(canTransitionWorkOrder("draft", "released", editor)).toBe(true);
    expect(canTransitionWorkOrder("released", "in_production", editor)).toBe(true);
    expect(canTransitionWorkOrder("in_production", "shipped", editor)).toBe(true);
  });
  it("blocks skipping and backwards steps for editors", () => {
    expect(canTransitionWorkOrder("draft", "in_production", editor)).toBe(false);
    expect(canTransitionWorkOrder("released", "draft", editor)).toBe(false);
  });
  it("allows managers one step back", () => {
    expect(canTransitionWorkOrder("released", "draft", manager)).toBe(true);
    expect(canTransitionWorkOrder("shipped", "in_production", manager)).toBe(true);
    expect(canTransitionWorkOrder("shipped", "draft", manager)).toBe(false);
  });
  it("allows cancelling any active order but not shipped ones", () => {
    expect(canTransitionWorkOrder("draft", "cancelled", editor)).toBe(true);
    expect(canTransitionWorkOrder("in_production", "cancelled", editor)).toBe(true);
    expect(canTransitionWorkOrder("shipped", "cancelled", editor)).toBe(false);
  });
  it("lets only managers revive a cancelled order to draft", () => {
    expect(canTransitionWorkOrder("cancelled", "draft", manager)).toBe(true);
    expect(canTransitionWorkOrder("cancelled", "draft", editor)).toBe(false);
    expect(canTransitionWorkOrder("cancelled", "released", manager)).toBe(false);
  });
});

describe("buildTransitionPatch", () => {
  const now = "2026-07-15T12:00:00.000Z";
  it("stamps the reached status and clears later stamps", () => {
    expect(buildTransitionPatch("released", now)).toEqual({
      status: "released",
      released_at: now,
      production_started_at: null,
      shipped_at: null,
      cancelled_at: null,
    });
  });
  it("keeps no stamps when returning to draft", () => {
    expect(buildTransitionPatch("draft", now)).toEqual({
      status: "draft",
      released_at: null,
      production_started_at: null,
      shipped_at: null,
      cancelled_at: null,
    });
  });
  it("stamps cancellation without touching progress stamps forward", () => {
    expect(buildTransitionPatch("cancelled", now)).toEqual({ status: "cancelled", cancelled_at: now });
  });
  it("omits released_at entirely when reaching in_production, rather than nulling it", () => {
    const patch = buildTransitionPatch("in_production", now);
    expect(patch).toEqual({
      status: "in_production",
      production_started_at: now,
      shipped_at: null,
      cancelled_at: null,
    });
    expect("released_at" in patch).toBe(false);
  });
  it("omits released_at and production_started_at entirely when reaching shipped", () => {
    const patch = buildTransitionPatch("shipped", now);
    expect(patch).toEqual({ status: "shipped", shipped_at: now, cancelled_at: null });
    expect("released_at" in patch).toBe(false);
    expect("production_started_at" in patch).toBe(false);
  });
});

describe("nextForwardStatus", () => {
  it("walks the flow and terminates", () => {
    expect(nextForwardStatus("draft")).toBe("released");
    expect(nextForwardStatus("shipped")).toBeNull();
    expect(nextForwardStatus("cancelled")).toBeNull();
  });
});

describe("missingAssemblyCount", () => {
  it("counts assembly lines without an A-number", () => {
    expect(
      missingAssemblyCount([
        { fulfillment: "assembly", assemblyOrderNo: "" },
        { fulfillment: "assembly", assemblyOrderNo: "  " },
        { fulfillment: "assembly", assemblyOrderNo: "A35987" },
        { fulfillment: "pull_from", assemblyOrderNo: "" },
        { fulfillment: "pull_from_stock", assemblyOrderNo: "" },
      ]),
    ).toBe(2);
  });
});
