// @vitest-environment jsdom
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { defaultManufacturingStepCheckDefinitions, getManufacturingStepCheckState } from "@/domain/manufacturing-step-checks";
import { ProcedureStepChecksEditor } from "./step-editors";

function Harness() {
  const [value, setValue] = useState(JSON.stringify({ selected: ["torque_required"], values: { torque_required: { value: 45, unit: "Nm" } } }));
  return <><ProcedureStepChecksEditor ariaLabel="Checks" definitions={defaultManufacturingStepCheckDefinitions} qualityCheck={value} onChange={setValue} /><output data-testid="saved">{value}</output></>;
}

describe("torque range editor", () => {
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
