import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MobileStepTools } from "./mobile-step-tools";

describe("mobile step tools", () => {
  it("shows each assigned tool once and keeps removal scoped to that tool", () => {
    const onRemoveTool = vi.fn();
    render(
      <MobileStepTools
        selectedTools={["Wrench", "", "Wrench", "Driver"]}
        toolLibrary={[]}
        onAddTool={vi.fn()}
        onRemoveTool={onRemoveTool}
      />,
    );
    expect(screen.getAllByText("Wrench")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Remove Driver" }));
    expect(onRemoveTool).toHaveBeenCalledExactlyOnceWith("Driver");
  });
  it("preserves the empty state without creating a manual entry control", () => {
    render(
      <MobileStepTools
        selectedTools={[]}
        toolLibrary={[]}
        onAddTool={vi.fn()}
        onRemoveTool={vi.fn()}
      />,
    );
    expect(
      screen.getByText("No tools added to this step yet."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});
