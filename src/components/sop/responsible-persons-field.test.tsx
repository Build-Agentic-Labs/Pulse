// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { ResponsiblePersonsField } from "./responsible-persons-field";

/** Mirrors the editor: the field is controlled by the persisted roster array. */
function Harness({ initial = [] as string[] }) {
  const [entries, setEntries] = useState<string[]>(initial);
  return (
    <>
      <ResponsiblePersonsField entries={entries} onChange={setEntries} />
      <output data-testid="stored">{JSON.stringify(entries)}</output>
    </>
  );
}

const field = () => screen.getByRole("textbox", { name: /responsible persons/i });
const stored = () => JSON.parse(screen.getByTestId("stored").textContent ?? "[]") as string[];

describe("ResponsiblePersonsField", () => {
  it("shows one entry per line", () => {
    render(<Harness initial={["Quality Manager", "Process Owner"]} />);
    expect((field() as HTMLTextAreaElement).value).toBe("Quality Manager\nProcess Owner");
  });

  // The regression this component exists for. Normalizing on every keystroke made Enter appear
  // dead: the parser dropped the new blank line, React re-rendered the controlled value without
  // it, and the caret snapped back to the end of the previous line.
  it("keeps the newline when Enter is pressed at the end", () => {
    render(<Harness initial={["Quality Manager"]} />);

    // What the browser hands us when Enter is pressed at the end of the last line.
    fireEvent.change(field(), { target: { value: "Quality Manager\n" } });

    expect((field() as HTMLTextAreaElement).value).toBe("Quality Manager\n");
  });

  it("lets a blank line survive long enough to type the next entry", () => {
    render(<Harness initial={["Quality Manager"]} />);

    fireEvent.change(field(), { target: { value: "Quality Manager\n" } });
    // Build on what the field ACTUALLY shows, the way typing does. Setting the whole value
    // instead would hide a reverted newline and let this pass against the bug.
    const el = field() as HTMLTextAreaElement;
    fireEvent.change(el, { target: { value: `${el.value}Process Owner` } });

    expect((field() as HTMLTextAreaElement).value).toBe("Quality Manager\nProcess Owner");
    expect(stored()).toEqual(["Quality Manager", "Process Owner"]);
  });

  // The trailing blank line is a typing artifact, never a roster entry.
  it("never stores an empty entry", () => {
    render(<Harness initial={["Quality Manager"]} />);

    fireEvent.change(field(), { target: { value: "Quality Manager\n" } });

    expect(stored()).toEqual(["Quality Manager"]);
  });

  it("adopts a roster replaced from outside the field", () => {
    const { rerender } = render(<ResponsiblePersonsField entries={["Old"]} onChange={() => {}} />);
    rerender(<ResponsiblePersonsField entries={["Fresh", "Roster"]} onChange={() => {}} />);
    expect((field() as HTMLTextAreaElement).value).toBe("Fresh\nRoster");
  });
});
