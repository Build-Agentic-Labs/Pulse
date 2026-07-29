// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createEmptySop } from "@/domain/sop/schema";
import { SopSearch } from "./sop-search";

describe("SopSearch", () => {
  it("opens with Ctrl+F, cycles through SOP matches, and closes with Escape", () => {
    const sop = createEmptySop("search", "2026-01-01T00:00:00.000Z");
    sop.purpose = "Alpha policy";
    sop.procedure.activities = [
      { id: "alpha-step", step: 1, description: "Alpha review", assignments: {} },
    ];
    const onNavigate = vi.fn();
    render(<SopSearch sop={sop} onNavigate={onNavigate} />);

    const shortcutWasNotCancelled = fireEvent.keyDown(window, {
      key: "f",
      ctrlKey: true,
      cancelable: true,
    });
    expect(shortcutWasNotCancelled).toBe(false);

    const input = screen.getByRole("textbox", { name: "Search keyword" });
    fireEvent.change(input, { target: { value: "alpha" } });

    expect(screen.getByText("1 of 2")).toBeInTheDocument();
    expect(screen.getByText("Overview")).toBeInTheDocument();
    expect(screen.getByText("Purpose")).toBeInTheDocument();

    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("2 of 2")).toBeInTheDocument();
    expect(screen.getByText("Procedure")).toBeInTheDocument();
    expect(screen.getByText("Activity 1")).toBeInTheDocument();
    expect(onNavigate.mock.calls.at(-1)?.[0]).toMatchObject({ stepId: "procedure", label: "Activity 1" });

    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "Search keyword" })).not.toBeInTheDocument();
  });
});
