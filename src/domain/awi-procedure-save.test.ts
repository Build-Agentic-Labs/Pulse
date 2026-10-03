import { describe, expect, it } from "vitest";
import { awiProcedureSaveBaseline } from "./awi-procedure-save";
import type { Task } from "./types";

describe("master AWI confirmed save baseline", () => {
  it("retains deleted step versions and original parts while the user edits the task", () => {
    const task = {
      manufacturingSteps: [{ id: "existing", version: 3 }, { id: "new" }],
      partReferences: [{ id: "part", partNumber: "PN", quantity: 2 }],
    } as Task;
    const baseline = awiProcedureSaveBaseline(task);
    task.manufacturingSteps = [];
    task.partReferences![0].quantity = 5;
    expect(baseline).toEqual({
      stepVersions: { existing: 3 }, partReferences: [{ id: "part", partNumber: "PN", quantity: 2 }],
    });
  });
});
