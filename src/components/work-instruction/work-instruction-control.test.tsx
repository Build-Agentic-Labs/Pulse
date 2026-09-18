// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fingerprintWorkInstruction, type WorkInstructionReleaseSummary } from "@/domain/work-instruction/release";
import type { WorkInstruction } from "@/domain/work-instruction/schema";
import {
  addWorkInstructionReference,
  listReferenceableSops,
  openWorkInstructionReferenceFile,
  releaseWorkInstruction,
  removeWorkInstructionReference,
} from "@/lib/work-instruction/store";
import { WorkInstructionControl } from "./work-instruction-control";

const confirmMock = vi.hoisted(() => vi.fn(async (_options: { title: string; body?: string; confirmLabel?: string }) => true));
vi.mock("@/components/confirm-provider", () => ({ useConfirm: () => confirmMock }));

vi.mock("@/lib/work-instruction/store", () => ({
  addWorkInstructionReference: vi.fn(),
  listReferenceableSops: vi.fn(),
  openWorkInstructionReferenceFile: vi.fn(),
  releaseWorkInstruction: vi.fn(),
  removeWorkInstructionReference: vi.fn(),
}));

function instruction(overrides: Partial<WorkInstruction> = {}): WorkInstruction {
  return {
    taskId: "task-1",
    meta: { documentNumber: "Z1-A-010-WI1", title: "Install bracket", revision: "", effectiveDate: "", preparedBy: "", reviewedBy: "", approvedBy: "", revisionHistory: [] },
    context: { productName: "FlexBoost", productCode: "FB-V2", productRevision: "A", zoneName: "Zone 1", manufacturingCode: "Z1-A-010" },
    setup: { purpose: "Mount it.", safetyNotes: "Gloves.", tools: ["Torque wrench"], parts: [], drawingLink: "", sopLink: "", references: [], plannedDurationMinutes: 20, plannedOperators: 1, qualityGate: false },
    cards: [
      {
        stepId: "s1", sequence: 1, part: 1, partCount: 1, code: "", name: "Mount", instruction: "Torque the bolts.", overflowing: false,
        tools: ["Torque wrench"], checks: [{ key: "torque", label: "Torque", spec: "45 Nm" }], photo: { id: "p1", url: "x", caption: "" },
      },
    ],
    blank: false,
    ...overrides,
  };
}

function release(wi: WorkInstruction, index = 1): WorkInstructionReleaseSummary {
  return {
    id: `rel-${index}`, taskId: "task-1", revisionIndex: index, revision: String.fromCharCode(64 + index), documentNumber: wi.meta.documentNumber, title: wi.meta.title,
    changeDescription: index === 1 ? "Initial release" : "Second", effectiveDate: "2026-09-18", contentHash: fingerprintWorkInstruction(wi),
    textHash: fingerprintWorkInstruction(wi, { photos: false }), releasedBy: "u1", releasedByName: "Rosendo Lopez", releasedAt: "2026-09-18T15:00:00Z",
  };
}

function renderControl(props: Partial<Parameters<typeof WorkInstructionControl>[0]> = {}) {
  const handlers = { onChanged: vi.fn(), onClose: vi.fn(), onPreview: vi.fn(), onEditTask: vi.fn() };
  render(<WorkInstructionControl projectId="project-1" instruction={instruction()} releases={[]} references={[]} {...handlers} {...props} />);
  return handlers;
}

beforeEach(() => {
  vi.clearAllMocks();
  confirmMock.mockResolvedValue(true);
  vi.mocked(listReferenceableSops).mockResolvedValue([{ id: "sop-1", number: "QAS-SOP-004", title: "Records", version: "2.0", status: "effective" }]);
});

describe("WorkInstructionControl", () => {
  it("lists what blocks a release and keeps the release button disabled", () => {
    renderControl({ instruction: instruction({ setup: { ...instruction().setup, tools: [] } }) });
    expect(screen.getByText("Assign tools to the steps.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Release$/ }));
    expect(screen.getByRole("button", { name: "Release Rev A" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Resolve the readiness items first.")).toBeTruthy();
  });

  it("releases the first revision as Rev A with the default change note, then shows the history", async () => {
    vi.mocked(releaseWorkInstruction).mockResolvedValue(release(instruction()));
    const handlers = renderControl({ initialStep: "release" });
    fireEvent.click(screen.getByRole("button", { name: "Release Rev A" }));
    await waitFor(() => expect(releaseWorkInstruction).toHaveBeenCalledTimes(1));
    expect(vi.mocked(releaseWorkInstruction).mock.calls[0][0]).toMatchObject({
      projectId: "project-1",
      changeDescription: "Initial release",
      effectiveDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      instruction: expect.objectContaining({ taskId: "task-1" }),
    });
    await waitFor(() => expect(handlers.onChanged).toHaveBeenCalled());
    expect(await screen.findByText("Released as Rev A.")).toBeTruthy();
  });

  it("asks before the permanent release and does nothing when the author backs out", async () => {
    confirmMock.mockResolvedValue(false);
    renderControl({ initialStep: "release" });
    fireEvent.click(screen.getByRole("button", { name: "Release Rev A" }));
    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
    expect(confirmMock.mock.calls[0][0]).toMatchObject({
      title: "Release Rev A?",
      confirmLabel: "Release Rev A",
      body: expect.stringMatching(/cannot be edited or deleted.*release Rev B/),
    });
    expect(releaseWorkInstruction).not.toHaveBeenCalled();
    // Still on the release step, ready to try again.
    expect(screen.getByRole("button", { name: "Release Rev A" }).hasAttribute("disabled")).toBe(false);
  });

  it("makes fixing the task the highlighted action while something blocks, and links the blocked reason back", () => {
    renderControl({ instruction: instruction({ setup: { ...instruction().setup, tools: [] } }) });
    expect(screen.getByRole("button", { name: "Edit the task" }).className).toContain("ui-btn-primary");
    expect(screen.getByRole("button", { name: "Next: references" }).className).toContain("ui-btn-ghost");

    fireEvent.click(screen.getByRole("button", { name: /Release$/ }));
    fireEvent.click(screen.getByRole("button", { name: "Resolve the readiness items first." }));
    expect(screen.getByText("Assign tools to the steps.")).toBeTruthy();
  });

  it("highlights Next once the document is ready", () => {
    renderControl();
    expect(screen.getByRole("button", { name: "Next: references" }).className).toContain("ui-btn-primary");
    expect(screen.getByRole("button", { name: "Edit the task" }).className).toContain("ui-btn-ghost");
  });

  it("warns on the release step about a reference that was typed but never added", () => {
    renderControl({ initialStep: "references" });
    fireEvent.click(screen.getByRole("button", { name: "Reference kind" }));
    fireEvent.click(screen.getByRole("option", { name: "Document" }));
    fireEvent.change(screen.getByPlaceholderText("FRM-010"), { target: { value: "FRM-010" } });
    fireEvent.click(screen.getByRole("button", { name: "Next: release" }));
    expect(screen.getByText(/started a reference but have not added it/)).toBeTruthy();
  });

  it("refuses to re-release an unchanged document and offers Rev B once it has drifted", () => {
    const released = instruction();
    const { unmount } = render(
      <WorkInstructionControl projectId="p" instruction={released} releases={[release(released)]} references={[]} initialStep="release" onChanged={vi.fn()} onClose={vi.fn()} onPreview={vi.fn()} onEditTask={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "Release Rev B" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Nothing has changed since Rev A.")).toBeTruthy();
    unmount();

    const edited = instruction({ cards: [{ ...instruction().cards[0], instruction: "Torque to 50 Nm." }] });
    render(
      <WorkInstructionControl projectId="p" instruction={edited} releases={[release(released)]} references={[]} initialStep="release" onChanged={vi.fn()} onClose={vi.fn()} onPreview={vi.fn()} onEditTask={vi.fn()} />,
    );
    expect(screen.getByText("Modified since Rev A")).toBeTruthy();
    // A later revision needs its own change note; "Initial release" is only the first one's default.
    expect(screen.getByRole("button", { name: "Release Rev B" }).hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByPlaceholderText(/Added torque check/), { target: { value: "Raised torque to 50 Nm." } });
    expect(screen.getByRole("button", { name: "Release Rev B" }).hasAttribute("disabled")).toBe(false);
  });

  it("waits for the task's photos before allowing a release", () => {
    renderControl({ initialStep: "release", photosLoaded: false });
    expect(screen.getByRole("button", { name: "Release Rev A" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Loading this task's photos…")).toBeTruthy();
  });

  it("adds an SOP reference and removes a managed one", async () => {
    vi.mocked(addWorkInstructionReference).mockResolvedValue(undefined);
    vi.mocked(removeWorkInstructionReference).mockResolvedValue(undefined);
    const wi = instruction({ setup: { ...instruction().setup, references: [{ kind: "document", documentNumber: "FRM-010", title: "Torque log", url: "" }] } });
    const handlers = renderControl({
      instruction: wi,
      initialStep: "references",
      references: [{ id: "ref-1", taskId: "task-1", kind: "document", sopId: null, documentNumber: "FRM-010", title: "Torque log", url: "", position: 1 }],
    });

    fireEvent.click(screen.getByRole("button", { name: "Remove reference FRM-010 · Torque log" }));
    await waitFor(() => expect(removeWorkInstructionReference).toHaveBeenCalledWith(expect.objectContaining({ id: "ref-1" })));

    await waitFor(() => expect(listReferenceableSops).toHaveBeenCalledWith("project-1"));
    fireEvent.click(await screen.findByRole("button", { name: "SOP to reference" }));
    fireEvent.click(await screen.findByRole("option", { name: /QAS-SOP-004/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add reference" }));
    await waitFor(() =>
      expect(addWorkInstructionReference).toHaveBeenCalledWith(
        { projectId: "project-1", taskId: "task-1", position: 2 },
        expect.objectContaining({ kind: "sop", sopId: "sop-1" }),
        null,
      ),
    );
    expect(handlers.onChanged).toHaveBeenCalled();
  });

  it("uploads a file with a drawing reference, refuses a bad one, and opens a stored file", async () => {
    vi.mocked(addWorkInstructionReference).mockResolvedValue(undefined);
    vi.mocked(openWorkInstructionReferenceFile).mockResolvedValue(undefined);
    const stored = { storagePath: "workspaces/w/projects/p/wi-references/task-1/u-frame.pdf", name: "frame.pdf", contentType: "application/pdf", sizeBytes: 2_500_000 };
    renderControl({
      instruction: instruction({ setup: { ...instruction().setup, references: [{ kind: "drawing", documentNumber: "DWG-1140", title: "Frame", url: "", fileName: "frame.pdf" }] } }),
      initialStep: "references",
      references: [{ id: "ref-9", taskId: "task-1", kind: "drawing", sopId: null, documentNumber: "DWG-1140", title: "Frame", url: "", position: 1, file: stored }],
    });

    fireEvent.click(screen.getByRole("button", { name: /Open file/ }));
    await waitFor(() => expect(openWorkInstructionReferenceFile).toHaveBeenCalledWith(stored));

    // An SOP is picked, not uploaded: the file input only appears for drawings and documents.
    expect(screen.queryByLabelText("Reference file")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reference kind" }));
    fireEvent.click(screen.getByRole("option", { name: "Drawing" }));
    const input = screen.getByLabelText("Reference file") as HTMLInputElement;

    fireEvent.change(input, { target: { files: [new File(["x"], "model.step", { type: "application/octet-stream" })] } });
    expect(screen.getByText("Choose a PDF, Word, Excel, CSV, JPG or PNG file.")).toBeTruthy();

    const pdf = new File(["%PDF-1.7"], "Harness layout.pdf", { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [pdf] } });
    fireEvent.click(screen.getByRole("button", { name: "Add reference" }));
    await waitFor(() =>
      expect(addWorkInstructionReference).toHaveBeenCalledWith(
        { projectId: "project-1", taskId: "task-1", position: 2 },
        expect.objectContaining({ kind: "drawing" }),
        pdf,
      ),
    );
  });

  it("hides every write control for view-only access", () => {
    renderControl({ readOnly: true, initialStep: "references" });
    expect(screen.queryByRole("form", { name: "Add a reference" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Release$/ }));
    expect(screen.getByRole("button", { name: "Release Rev A" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("You have view-only access to this project.")).toBeTruthy();
  });

  it("opens a past revision exactly as released from the history", () => {
    const wi = instruction();
    const handlers = renderControl({ releases: [release(wi, 1), { ...release(wi, 2), contentHash: "other" }], initialStep: "history" });
    const viewButtons = screen.getAllByRole("button", { name: "View" });
    expect(viewButtons).toHaveLength(2);
    fireEvent.click(viewButtons[1]);
    expect(handlers.onPreview).toHaveBeenCalledWith({ releaseId: "rel-1" });
  });
});
