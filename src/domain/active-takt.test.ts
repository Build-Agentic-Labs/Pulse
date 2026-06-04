import { describe, expect, it } from "vitest";

import {
  calculateActiveTaktMinutes,
  calculateAvailabilityMinutesForDemandPeriod,
  calculateTaktMinutes,
} from "./calculations";
import { emptyPlannerState } from "./empty-planner-state";
import type { Product } from "./types";

// A product with real (non-zero) availability so takt math is meaningful:
//   daily available = 480 min; week = 480*5; month = 480*5*4; year = month*12.
//   product takt = daily / demandQuantity = 480 / 2 = 240 min.
const product: Product = {
  ...emptyPlannerState.product,
  grossAvailableMinutes: 480,
  breakMinutes: 0,
  lunchMinutes: 0,
  meetingMinutes: 0,
  plannedDowntimeMinutes: 0,
  workDaysPerWeek: 5,
  workWeeksPerMonth: 4,
  demandPeriod: "day",
  demandQuantity: 2,
  manualTaktMinutes: 0,
};

const productTakt = calculateTaktMinutes(product);

describe("calculateActiveTaktMinutes", () => {
  it("uses the scenario target (units + period) when populated", () => {
    const result = calculateActiveTaktMinutes(product, { targetOutput: 500, targetOutputPeriod: "year" });
    const expected = calculateAvailabilityMinutesForDemandPeriod(product, "year") / 500;

    expect(result).toBe(expected);
    // Sanity: a yearly 500-unit target must differ from the product's daily takt.
    expect(result).not.toBe(productTakt);
  });

  it("honors the scenario's own period even when it differs from the product period", () => {
    // product.demandPeriod is "day"; scenario asks for weekly availability.
    const result = calculateActiveTaktMinutes(product, { targetOutput: 10, targetOutputPeriod: "week" });
    expect(result).toBe(calculateAvailabilityMinutesForDemandPeriod(product, "week") / 10);
  });

  it("falls back to product takt when the target is zero", () => {
    expect(calculateActiveTaktMinutes(product, { targetOutput: 0, targetOutputPeriod: "year" })).toBe(productTakt);
  });

  it("falls back to product takt when the target is negative", () => {
    expect(calculateActiveTaktMinutes(product, { targetOutput: -5, targetOutputPeriod: "year" })).toBe(productTakt);
  });

  it("falls back to product takt when the target is non-finite", () => {
    expect(calculateActiveTaktMinutes(product, { targetOutput: Number.NaN, targetOutputPeriod: "year" })).toBe(
      productTakt,
    );
    expect(
      calculateActiveTaktMinutes(product, { targetOutput: Number.POSITIVE_INFINITY, targetOutputPeriod: "year" }),
    ).toBe(productTakt);
  });

  it("falls back to product takt when the target is missing", () => {
    expect(
      calculateActiveTaktMinutes(product, { targetOutput: undefined as unknown as number, targetOutputPeriod: "year" }),
    ).toBe(productTakt);
  });

  it("falls back to product takt when the period is invalid/unrecognized", () => {
    expect(
      calculateActiveTaktMinutes(product, {
        targetOutput: 100,
        targetOutputPeriod: "fortnight" as unknown as string,
      }),
    ).toBe(productTakt);
    expect(calculateActiveTaktMinutes(product, { targetOutput: 100, targetOutputPeriod: "" })).toBe(productTakt);
  });

  it("respects a manual product takt in the fallback path", () => {
    const manualProduct: Product = { ...product, manualTaktMinutes: 333 };
    // Invalid scenario target → fallback should return the product's manual takt.
    expect(calculateActiveTaktMinutes(manualProduct, { targetOutput: 0, targetOutputPeriod: "year" })).toBe(333);
  });
});

describe("calculateAvailabilityMinutesForDemandPeriod (period override is backward compatible)", () => {
  it("defaults to the product's own demand period when no period is passed", () => {
    expect(calculateAvailabilityMinutesForDemandPeriod(product)).toBe(
      calculateAvailabilityMinutesForDemandPeriod(product, product.demandPeriod),
    );
  });

  it("computes different availability for different periods", () => {
    const daily = calculateAvailabilityMinutesForDemandPeriod(product, "day");
    const yearly = calculateAvailabilityMinutesForDemandPeriod(product, "year");
    expect(yearly).toBeGreaterThan(daily);
  });
});
