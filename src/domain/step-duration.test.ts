import { describe, expect, it } from "vitest";
import { sumStepDurationMinutes } from "./step-duration";
import type { ManufacturingStep } from "./types";

const step = (durationMinutes?: number) => ({ id: "s", sequence: 1, name: "s", instruction: "", durationMinutes }) as ManufacturingStep;

describe("sumStepDurationMinutes", () => {
  it("adds step times, treating missing and negative times as zero", () => {
    expect(sumStepDurationMinutes([step(5), step(7.5), step(undefined), step(-3)])).toBe(12.5);
    expect(sumStepDurationMinutes([])).toBe(0);
  });
});
