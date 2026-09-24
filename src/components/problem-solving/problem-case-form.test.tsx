// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { ProblemCase } from "@/domain/problem-solving";
const mocks = vi.hoisted(() => ({ details: vi.fn(), add: vi.fn(), save: vi.fn() }));
vi.mock("@/lib/problem-solving/store", () => ({ caseDetails: mocks.details, addAction: mocks.add, saveCase: mocks.save, completeAction: vi.fn(), evidenceUrl: vi.fn(), uploadEvidence: vi.fn() }));
vi.mock("@/components/confirm-provider", () => ({ useConfirm: () => vi.fn().mockResolvedValue(false) }));
import { ProblemCaseForm } from "./problem-case-form";
const row = { id: "case-1", number: 1, title: "Test case", stage: "define", source: "Internal", owner: "", reported_on: "2026-09-24", severity: "Medium", problem: "", expected: "", affected: "", containment: "", root_cause: "", cause_evidence: "", prevention: "", verification_plan: "", verification_result: "", verified_on: null } as ProblemCase;
beforeEach(() => { vi.clearAllMocks(); mocks.details.mockResolvedValue({ actions: [], evidence: [], history: [] }); mocks.add.mockResolvedValue(undefined); mocks.save.mockImplementation(async value => value); });
it("persists native date input when adding an action", async () => {
  render(<ProblemCaseForm initial={row} onDirty={vi.fn()} onSaved={vi.fn()} onBack={vi.fn()} />);
  await waitFor(() => expect(screen.getByLabelText("Action", { exact: true })).toBeEnabled());
  fireEvent.change(screen.getByLabelText("Action", { exact: true }), { target: { value: "Isolate unit" } });
  fireEvent.change(screen.getByLabelText("Owner", { exact: true }), { target: { value: "RL" } });
  fireEvent.input(screen.getByLabelText("Due date"), { target: { value: "2026-09-25" } });
  fireEvent.click(screen.getByRole("button", { name: "Add action" }));
  await waitFor(() => expect(mocks.add).toHaveBeenCalledWith({ case_id: "case-1", kind: "containment", description: "Isolate unit", owner: "RL", due_on: "2026-09-25" }));
});
