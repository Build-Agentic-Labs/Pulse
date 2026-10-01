import { describe, expect, it } from "vitest";
import { getManufacturingStepCheckState, serializeManufacturingStepCheckState } from "./manufacturing-step-checks";

describe("torque ranges", () => {
  it("preserves decimal range bounds and units through saving", () => {
    const state = { selected: new Set(["torque_required"]), values: { torque_required: { value: 12.5, maxValue: 15.75, unit: "ft-lb" } } };
    expect(getManufacturingStepCheckState(serializeManufacturingStepCheckState(state))).toEqual(state);
  });

  it("keeps existing single values and rejects malformed maximums", () => {
    for (const maxValue of [undefined, "invalid", null, true, ""]) {
      const state = getManufacturingStepCheckState(JSON.stringify({ selected: ["torque_required"], values: { torque_required: { value: 45, maxValue, unit: "Nm" } } }));
      expect(state.values.torque_required.value).toBe(45);
      expect(state.values.torque_required.maxValue).toBeUndefined();
    }
  });
});
