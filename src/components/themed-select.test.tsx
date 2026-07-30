// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ThemedSelect, type ThemedSelectOption } from "./themed-select";

const OPTIONS: ThemedSelectOption[] = [
  { value: "Quality Manager", label: "Quality Manager", group: "Quality" },
  { value: "Quality Inspector", label: "Quality Inspector", group: "General" },
  { value: "Operator", label: "Operator", group: "General" },
];

const trigger = () => screen.getByRole("button", { name: "Role" });
const search = () => screen.getByRole("textbox", { name: /type to filter or add/i });
const optionLabels = () =>
  screen.queryAllByRole("option").map((node) => node.textContent?.trim() ?? "");

describe("ThemedSelect without allowCustomValue", () => {
  // The property that protects the 56 call sites which do not opt in: nothing about the
  // default rendering may change.
  it("renders a plain listbox with no search box", () => {
    render(<ThemedSelect value="" options={OPTIONS} onChange={() => {}} ariaLabel="Role" />);
    fireEvent.click(trigger());

    expect(screen.queryByRole("textbox")).toBeNull();
    expect(optionLabels()).toEqual(["Quality Manager", "Quality Inspector", "Operator"]);
  });

  it("commits the option that was clicked", () => {
    const onChange = vi.fn();
    render(<ThemedSelect value="" options={OPTIONS} onChange={onChange} ariaLabel="Role" />);
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("option", { name: "Operator" }));

    expect(onChange).toHaveBeenCalledWith("Operator");
  });

  it("supports a taller menu for longer option lists", () => {
    render(
      <ThemedSelect
        value=""
        options={OPTIONS}
        onChange={() => {}}
        ariaLabel="Role"
        menuMaxHeight={420}
      />,
    );
    fireEvent.click(trigger());

    expect((screen.getByRole("listbox", { name: "Role" }) as HTMLElement).style.maxHeight).toBe(
      "420px",
    );
  });
});

describe("ThemedSelect with allowCustomValue", () => {
  function open() {
    render(<ThemedSelect value="" options={OPTIONS} onChange={vi.fn()} ariaLabel="Role" allowCustomValue />);
    fireEvent.click(trigger());
  }

  it("filters the options as you type", () => {
    open();
    fireEvent.change(search(), { target: { value: "quality" } });

    // The trailing entry is the add action; a partial term is still offerable as a new role,
    // so filter it out and assert on the real options.
    const real = optionLabels().filter((label) => !label.startsWith("Add"));
    expect(real).toEqual(["Quality Manager", "Quality Inspector"]);
  });

  it("offers to add a value that matches nothing", () => {
    open();
    fireEvent.change(search(), { target: { value: "Line Auditor" } });

    expect(optionLabels().some((label) => label.includes("Line Auditor"))).toBe(true);
  });

  it("commits the typed value when the add entry is chosen", () => {
    const onChange = vi.fn();
    render(<ThemedSelect value="" options={OPTIONS} onChange={onChange} ariaLabel="Role" allowCustomValue />);
    fireEvent.click(trigger());
    fireEvent.change(search(), { target: { value: "  Line   Auditor  " } });
    fireEvent.click(screen.getByRole("option", { name: /Add .*Line Auditor/ }));

    // Normalized on the way out, so spacing variants cannot become separate roles.
    expect(onChange).toHaveBeenCalledWith("Line Auditor");
  });

  // The duplicate guard: typing a case variant must select what already exists.
  it("selects the existing option for a case variant instead of offering to add it", () => {
    const onChange = vi.fn();
    render(<ThemedSelect value="" options={OPTIONS} onChange={onChange} ariaLabel="Role" allowCustomValue />);
    fireEvent.click(trigger());
    fireEvent.change(search(), { target: { value: "operator" } });

    expect(optionLabels().some((label) => label.startsWith("Add"))).toBe(false);

    fireEvent.keyDown(search(), { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("Operator");
  });

  it("commits a new value on Enter", () => {
    const onChange = vi.fn();
    render(<ThemedSelect value="" options={OPTIONS} onChange={onChange} ariaLabel="Role" allowCustomValue />);
    fireEvent.click(trigger());
    fireEvent.change(search(), { target: { value: "Line Auditor" } });
    fireEvent.keyDown(search(), { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith("Line Auditor");
  });

  // The affordance itself: opening the menu must reveal that new values are accepted, without
  // requiring the author to guess that the box is typeable.
  it("advertises that a new value can be added before anything is typed", () => {
    open();
    expect(screen.getByText(/type a name to add a new one/i)).toBeTruthy();
  });

  it("replaces the hint with the add action once something is typed", () => {
    open();
    fireEvent.change(search(), { target: { value: "Line Auditor" } });

    expect(screen.queryByText(/type a name to add a new one/i)).toBeNull();
    expect(optionLabels().some((label) => label.startsWith("Add"))).toBe(true);
  });

  it("does nothing on Enter with an empty box", () => {
    const onChange = vi.fn();
    render(<ThemedSelect value="" options={OPTIONS} onChange={onChange} ariaLabel="Role" allowCustomValue />);
    fireEvent.click(trigger());
    fireEvent.keyDown(search(), { key: "Enter" });

    expect(onChange).not.toHaveBeenCalled();
  });
});
