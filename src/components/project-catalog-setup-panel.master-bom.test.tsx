import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MasterBom } from "@/domain/master-bom";
import type { Task } from "@/domain/types";
import { parseBomFile } from "@/lib/parse-bom";
import { MasterBomPanel, ProjectCatalogSetupPanel } from "./project-catalog-setup-panel";

vi.mock("@/lib/parse-bom", () => ({ parseBomFile: vi.fn() }));

const uploadedBom: MasterBom = {
  fileName: "replacement.csv",
  uploadedAt: "2026-08-19T12:00:00.000Z",
  columns: ["Part Number", "Description"],
  rows: [{ "Part Number": "FB-100", Description: "Cooling hose" }],
};

function selectBomFile() {
  fireEvent.change(screen.getByLabelText("Master BOM file"), {
    target: { files: [new File(["Part Number,Description"], "replacement.csv", { type: "text/csv" })] },
  });
}

describe("MasterBomPanel", () => {
  beforeEach(() => {
    vi.mocked(parseBomFile).mockReset();
    vi.mocked(parseBomFile).mockResolvedValue(uploadedBom);
  });

  it("shows Reading, Saving, then Saved and waits for persistence before success", async () => {
    let finishSave: (() => void) | undefined;
    const onChange = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve;
        }),
    );

    render(<MasterBomPanel onChange={onChange} onConfirmAction={vi.fn()} />);
    selectBomFile();

    expect(screen.getByRole("status")).toHaveTextContent("Reading file…");
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(uploadedBom));
    expect(screen.getByRole("status")).toHaveTextContent("Saving…");

    await act(async () => finishSave?.());

    expect(screen.getByRole("status")).toHaveTextContent("Saved");
  });

  it("keeps the last confirmed BOM visible after failure and retries the same replacement", async () => {
    const confirmedBom: MasterBom = {
      fileName: "confirmed.csv",
      uploadedAt: "2026-08-18T12:00:00.000Z",
      columns: ["Part Number", "Description"],
      rows: [{ "Part Number": "OLD-1", Description: "Confirmed part" }],
    };
    const onChange = vi
      .fn<(bom: MasterBom | undefined) => Promise<void>>()
      .mockRejectedValueOnce(new Error("Database unavailable"))
      .mockResolvedValueOnce(undefined);

    render(
      <MasterBomPanel
        masterBom={confirmedBom}
        onChange={onChange}
        onConfirmAction={(confirmation) => confirmation.onConfirm()}
      />,
    );
    selectBomFile();

    expect(await screen.findByRole("alert")).toHaveTextContent("Database unavailable");
    expect(screen.getByText("OLD-1")).toBeInTheDocument();
    expect(screen.queryByText("FB-100")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));
    expect(onChange).toHaveBeenLastCalledWith(uploadedBom);
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
  });

  it("searches every visible BOM column with case-insensitive multi-term matching", () => {
    const searchableBom: MasterBom = {
      fileName: "parts.csv",
      uploadedAt: "2026-08-19T12:00:00.000Z",
      columns: ["Part Number", "Description", "Replenishment System"],
      rows: [
        { "Part Number": "FB-100", Description: "Cooling hose", "Replenishment System": "Purchase" },
        { "Part Number": "FB-200", Description: "Control panel", "Replenishment System": "Make" },
        { "Part Number": "FB-300", Description: "Cooling fan", "Replenishment System": "Purchase" },
      ],
    };

    render(<MasterBomPanel masterBom={searchableBom} onChange={vi.fn()} onConfirmAction={vi.fn()} />);

    expect(screen.getByText("3 rows")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search master BOM" }), {
      target: { value: "COOLING fb-100" },
    });

    expect(screen.getByText("1 of 3 rows")).toBeInTheDocument();
    expect(screen.getByText("FB-100")).toBeInTheDocument();
    expect(screen.queryByText("FB-200")).not.toBeInTheDocument();
    expect(screen.queryByText("FB-300")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear BOM search" }));

    expect(screen.getByText("3 rows")).toBeInTheDocument();
    expect(screen.getByText("FB-200")).toBeInTheDocument();
    expect(screen.getByText("FB-300")).toBeInTheDocument();
  });

  it("shows a clear empty result when no BOM rows match", () => {
    render(<MasterBomPanel masterBom={uploadedBom} onChange={vi.fn()} onConfirmAction={vi.fn()} />);

    fireEvent.change(screen.getByRole("searchbox", { name: "Search master BOM" }), {
      target: { value: "not-a-real-part" },
    });

    expect(screen.getByText("0 of 1 rows")).toBeInTheDocument();
    expect(screen.getByText("No BOM rows match “not-a-real-part”.")).toBeInTheDocument();
  });

  it("hides the Warning column from both the table and search matching", () => {
    const bomWithWarning: MasterBom = {
      fileName: "warnings.csv",
      columns: ["Part Number", "Description", "Warning"],
      rows: [{ "Part Number": "FB-100", Description: "Cooling hose", Warning: "hidden-warning-token" }],
    };

    render(<MasterBomPanel masterBom={bomWithWarning} onChange={vi.fn()} onConfirmAction={vi.fn()} />);

    expect(screen.queryByRole("columnheader", { name: "Warning" })).not.toBeInTheDocument();
    expect(screen.queryByText("hidden-warning-token")).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search master BOM" }), {
      target: { value: "hidden-warning-token" },
    });

    expect(screen.getByText("0 of 1 rows")).toBeInTheDocument();
  });

  it("shows the number of procedure steps allocated to each BOM part", () => {
    const allocationBom: MasterBom = {
      fileName: "allocations.csv",
      columns: ["No.", "Description"],
      rows: [
        { "No.": "FB-100", Description: "Cooling hose" },
        { "No.": "FB-200", Description: "Control panel" },
      ],
    };
    const tasks = [
      {
        id: "task-1",
        wbs: "1.1",
        name: "Install cooling",
        partReferences: [{ id: "part-1", partNumber: " fb-100 " }],
        manufacturingSteps: [
          { id: "step-1", sequence: 1, name: "Fit hose", partReferenceIds: ["part-1"] },
          { id: "step-2", sequence: 2, name: "Clamp hose", partReferenceIds: ["part-1"] },
        ],
      },
    ] as Task[];

    render(<MasterBomPanel masterBom={allocationBom} tasks={tasks} onChange={vi.fn()} onConfirmAction={vi.fn()} />);

    expect(screen.getByRole("columnheader", { name: "Allocated" })).toBeInTheDocument();
    expect(screen.getByLabelText("2 allocated steps")).toHaveTextContent("2 steps");
    expect(screen.getByLabelText("2 allocated steps")).toHaveAttribute(
      "title",
      "1.1 · Install cooling · Step 1 · Fit hose\n1.1 · Install cooling · Step 2 · Clamp hose",
    );

    fireEvent.change(screen.getByRole("searchbox", { name: "Search master BOM" }), {
      target: { value: "allocated" },
    });

    expect(screen.getByText("1 of 2 rows")).toBeInTheDocument();
    expect(screen.queryByText("FB-200")).not.toBeInTheDocument();
  });

  it("does not render the separate Parts in use area", () => {
    render(
      <ProjectCatalogSetupPanel
        tasks={[]}
        projectToolRegistry={new Map()}
        section="parts"
        masterBom={uploadedBom}
        onMasterBomChange={vi.fn()}
        onSaveTool={vi.fn()}
        onDeleteTool={vi.fn()}
        onConfirmAction={vi.fn()}
      />,
    );

    expect(screen.getByText("Master BOM")).toBeInTheDocument();
    expect(screen.queryByText("Parts in use")).not.toBeInTheDocument();
  });
});
