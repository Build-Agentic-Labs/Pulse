// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { ProcedureToolPicker } from "./procedure-tool-picker";

function PickerHarness({
  onAdd,
  assignedTools = [],
}: {
  onAdd: (toolName: string) => void;
  assignedTools?: string[];
}) {
  const [value, setValue] = useState("");
  return (
    <ProcedureToolPicker
      value={value}
      toolLibrary={["13mm Deep Socket", "3/8in Impact Gun", "Torque Wrench"]}
      assignedTools={assignedTools}
      stepSequence={1}
      onValueChange={setValue}
      onAdd={onAdd}
    />
  );
}

describe("ProcedureToolPicker", () => {
  it("filters library tools while typing and adds the selected existing tool", () => {
    const onAdd = vi.fn();
    render(<PickerHarness onAdd={onAdd} />);

    const input = screen.getByRole("combobox", { name: "Search or add tool for step 1" });
    fireEvent.change(input, { target: { value: "impact" } });

    expect(screen.getByRole("option", { name: /3\/8in Impact Gun/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /13mm Deep Socket/ })).not.toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole("option", { name: /3\/8in Impact Gun/ }));
    expect(onAdd).toHaveBeenCalledWith("3/8in Impact Gun");
    expect(input).toHaveValue("");
  });

  it("adds a typed tool when the library has no match", () => {
    const onAdd = vi.fn();
    render(<PickerHarness onAdd={onAdd} />);

    const input = screen.getByRole("combobox", { name: "Search or add tool for step 1" });
    fireEvent.change(input, { target: { value: "insulated pry bar" } });
    fireEvent.click(screen.getByRole("button", { name: "Add new" }));

    expect(onAdd).toHaveBeenCalledWith("Insulated Pry Bar");
    expect(input).toHaveValue("");
  });

  it("does not suggest tools already assigned to the step", () => {
    render(<PickerHarness onAdd={vi.fn()} assignedTools={["Torque Wrench"]} />);

    fireEvent.focus(screen.getByRole("combobox", { name: "Search or add tool for step 1" }));

    expect(screen.queryByRole("option", { name: /Torque Wrench/ })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: /13mm Deep Socket/ })).toBeInTheDocument();
  });
});
