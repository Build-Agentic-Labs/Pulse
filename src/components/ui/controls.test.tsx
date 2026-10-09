// @vitest-environment jsdom
import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { Button, IconButton } from "./button";
import { Field, TextInput } from "./text-input";

it("defaults actions to non-submit and blocks pending clicks", () => {
  const click = vi.fn();
  const view = render(<Button onClick={click}>Save</Button>);
  expect(screen.getByRole("button")).toHaveAttribute("type", "button");
  fireEvent.click(screen.getByRole("button"));
  expect(click).toHaveBeenCalledTimes(1);
  view.rerender(<Button pending onClick={click}>Save</Button>);
  fireEvent.click(screen.getByRole("button"));
  expect(click).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button")).toHaveAttribute("aria-busy", "true");
});
it("preserves submit semantics and icon labels", () => {
  render(<><Button type="submit">Create</Button><IconButton label="Remove file">×</IconButton></>);
  expect(screen.getByRole("button", { name: "Create" })).toHaveAttribute("type", "submit");
  expect(screen.getByRole("button", { name: "Remove file" })).toBeInTheDocument();
});
it("forwards native field semantics, refs and help association", () => {
  const ref = createRef<HTMLInputElement>(); const change = vi.fn();
  render(<Field inputId="number" label="Document number" hint="Optional"><TextInput ref={ref} id="number" aria-describedby="number-hint" aria-invalid maxLength={64} onChange={change} /></Field>);
  const input = screen.getByRole("textbox", { name: "Document number" });
  expect(ref.current).toBe(input);
  expect(input).toHaveAccessibleDescription("Optional");
  expect(input).toHaveAttribute("aria-invalid", "true");
  fireEvent.change(input, { target: { value: "AWI-123" } });
  expect(change).toHaveBeenCalledTimes(1);
});
