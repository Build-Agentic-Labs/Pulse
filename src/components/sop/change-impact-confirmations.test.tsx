import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChangeImpactAssessment, ChangeQualityConfirmations, emptyImpactAssessment, emptyQualityConfirmations } from "./change-impact-confirmations";
import { createEmptySop } from "@/domain/sop/schema";
import { getSopDetectedChanges } from "@/lib/sop/controlled-changes";
vi.mock("@/lib/sop/controlled-changes", () => ({ getSopDetectedChanges: vi.fn() }));
const document = createEmptySop("s1", "2026-10-22");
const source = { sopId: "s1", document, refreshKey: "" };
beforeEach(() => { vi.mocked(getSopDetectedChanges).mockReset().mockResolvedValue(["Procedure", "Approvers"]); });
describe("controlled change confirmations", () => {
 it("shows detected changes without a textbox and keeps the explicit process-owner confirmation", async () => {
  function Form() { const [value,onChange] = useState(emptyImpactAssessment); return <ChangeImpactAssessment {...source} minor value={value} onChange={onChange} />; }
  render(<Form />);
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(await screen.findByText("Procedure · Approvers")).toBeTruthy();
  const owner = screen.getByRole("checkbox", { name: /As process owner/ });
  expect((owner as HTMLInputElement).checked).toBe(false);
  fireEvent.click(owner);
  expect((owner as HTMLInputElement).checked).toBe(true);
 });
 it("keeps major changes on an impact assessment without a false no-impact declaration", () => {
  render(<ChangeImpactAssessment {...source} minor={false} value={emptyImpactAssessment} onChange={() => {}} />);
  expect(screen.queryByRole("checkbox", { name: /As process owner/ })).toBeNull();
  expect(screen.getByRole("checkbox", { name: /I reviewed the impact/ })).toBeTruthy();
 });
 it("handles detection errors without showing an editable fallback", async () => {
  vi.mocked(getSopDetectedChanges).mockRejectedValue(new Error("Unavailable"));
  render(<ChangeImpactAssessment {...source} minor value={emptyImpactAssessment} onChange={() => {}} />);
  expect(await screen.findByText(/Changes could not be checked/)).toBeTruthy();
  expect(screen.queryByRole("textbox")).toBeNull();
 });
 it("separately captures classification, document and history verification", () => {
  function Form() { const [value,onChange] = useState(emptyQualityConfirmations); return <ChangeQualityConfirmations minor value={value} onChange={onChange} />; }
  render(<Form />);
  const checks = screen.getAllByRole("checkbox") as HTMLInputElement[];
  expect(checks).toHaveLength(3);
  checks.forEach(check => expect(check.checked).toBe(false));
  fireEvent.click(screen.getByRole("checkbox", { name: /Acting as Document Control/ }));
  expect(checks.map(check => check.checked)).toEqual([false,true,false]);
 });
});
