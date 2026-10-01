// @vitest-environment jsdom
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { defaultManufacturingStepCheckDefinitions, getManufacturingStepCheckState } from "@/domain/manufacturing-step-checks";
import { ProcedureStepChecksEditor } from "./step-editors";

function Harness({ compact = false, custom = false }: { compact?: boolean; custom?: boolean }) {
  const [value, setValue] = useState(JSON.stringify({ selected: ["torque_required"], values: { torque_required: { value: 45, maxValue: custom ? 50 : undefined, unit: "Nm" } } }));
  return <><ProcedureStepChecksEditor ariaLabel="Checks" compact={compact} definitions={custom ? [...defaultManufacturingStepCheckDefinitions, { key: "torque_seal", label: "Torque Seal", enabled: true, inputType: "checkbox" }] : defaultManufacturingStepCheckDefinitions} qualityCheck={value} onChange={setValue} /><output data-testid="saved">{value}</output></>;
}

describe("torque range editor", () => {
  it("preserves torque ranges and configured checks in the compact mobile editor", () => {
    render(<Harness compact custom />);
    fireEvent.click(screen.getByLabelText("Torque Seal"));
    fireEvent.click(screen.getByLabelText("QC", { exact: true }));
    const saved = getManufacturingStepCheckState(screen.getByTestId("saved").textContent!);
    expect(saved.selected.has("torque_seal")).toBe(true);
    expect(saved.selected.has("qc")).toBe(true);
    expect(saved.values.torque_required).toEqual({ value: 45, maxValue: 50, unit: "Nm" });
  });
  it("adds and edits a maximum, then returns to a single value", () => {
    render(<Harness />);
    fireEvent.click(screen.getByLabelText("Torque Spec range"));
    expect(screen.getByLabelText("Torque Spec minimum")).toBeTruthy();
    const maximum = screen.getByLabelText("Torque Spec maximum");
    fireEvent.focus(maximum);
    fireEvent.change(maximum, { target: { value: "50" } });
    fireEvent.blur(maximum);
    expect(getManufacturingStepCheckState(screen.getByTestId("saved").textContent!).values.torque_required).toEqual({ value: 45, maxValue: 50, unit: "Nm" });
    fireEvent.click(screen.getByLabelText("Torque Spec range"));
    expect(screen.queryByLabelText("Torque Spec maximum")).toBeNull();
    expect(getManufacturingStepCheckState(screen.getByTestId("saved").textContent!).values.torque_required.maxValue).toBeUndefined();
  });
});
