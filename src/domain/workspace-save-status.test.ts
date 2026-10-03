import { describe, expect, it } from "vitest";
import { settleWriteBatch, WorkspaceWriteTracker, workspaceSaveBarrier, workspaceSaveStatus } from "./workspace-save-status";

describe("save barriers during recovery", () => {
  function failedBom() {
    const tracker = new WorkspaceWriteTracker();
    tracker.begin("master-bom")(new Error("BOM connection failed"));
    return tracker;
  }

  it("permits a BOM retry and only clears its failure after confirmation", () => {
    const tracker = failedBom();
    expect(workspaceSaveBarrier("error", "BOM connection failed", tracker.getSnapshot(), [], false, "master-bom")).toBe("ready");
    const retry = tracker.begin("master-bom");
    expect(workspaceSaveStatus("saving", undefined, tracker.getSnapshot(), [], false).state).toBe("error");
    retry();
    expect(workspaceSaveBarrier("saved", undefined, tracker.getSnapshot(), [], false)).toBe("ready");
  });

  it("continues blocking navigation while the BOM remains failed", () => {
    expect(workspaceSaveBarrier("saved", undefined, failedBom().getSnapshot(), [], false)).toBe("blocked");
  });

  it("waits for another pending write before retrying the BOM", () => {
    const tracker = failedBom();
    const tool = tracker.begin("tool");
    expect(workspaceSaveBarrier("saving", undefined, tracker.getSnapshot(), [], false, "master-bom")).toBe("waiting");
    tool();
    expect(workspaceSaveBarrier("saved", undefined, tracker.getSnapshot(), [], false, "master-bom")).toBe("ready");
  });

  it("cannot bypass another failed write or a procedure conflict", () => {
    const tracker = failedBom();
    const procedure = { state: "conflict", pending: true, inFlight: false, lastError: new Error("Conflict") };
    expect(workspaceSaveBarrier("error", "BOM connection failed", tracker.getSnapshot(), [procedure], false, "master-bom")).toBe("blocked");
    tracker.begin("tool")(new Error("Tool failed"));
    expect(workspaceSaveBarrier("error", "BOM connection failed", tracker.getSnapshot(), [], false, "master-bom")).toBe("blocked");
  });

  it("cannot bypass an unrelated reported error even with a failed BOM", () => {
    expect(workspaceSaveBarrier("error", "Refresh failed", failedBom().getSnapshot(), [], false, "master-bom")).toBe("blocked");
  });

  it("waits for a debounced edit before retrying", () => {
    expect(workspaceSaveBarrier("error", "BOM connection failed", failedBom().getSnapshot(), [], true, "master-bom")).toBe("waiting");
  });
});

describe("workspace save completion", () => {
  it("keeps a failed photo batch pending until its remaining writes settle", async () => {
    let release!: (value: string) => void;
    const remaining = new Promise<string>((resolve) => { release = resolve; });
    const failure = new Error("First upload failed");
    let settled = false;
    const batch = settleWriteBatch([Promise.reject(failure), remaining]);
    const rejection = expect(batch).rejects.toBe(failure);
    void batch.then(() => { settled = true; }, () => { settled = true; });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    release("Second upload finished");
    await rejection;
    expect(settled).toBe(true);
  });

  it("returns confirmed batch results in their original order", async () => {
    await expect(settleWriteBatch([Promise.resolve("first"), Promise.resolve("second")])).resolves.toEqual(["first", "second"]);
  });
  it.each(["tool", "procedure"])("waits for both independent writes when %s finishes first", (first) => {
    const tracker = new WorkspaceWriteTracker();
    const tool = tracker.begin("tool");
    const procedure = tracker.begin("procedure");
    (first === "tool" ? tool : procedure)();
    expect(workspaceSaveStatus("saved", undefined, tracker.getSnapshot(), [], false).state).toBe("saving");
    (first === "tool" ? procedure : tool)();
    expect(workspaceSaveStatus("saved", undefined, tracker.getSnapshot(), [], false).state).toBe("saved");
  });

  it("keeps a debounced procedure pending after another write completes", () => {
    const tracker = new WorkspaceWriteTracker();
    const finish = tracker.begin("tool");
    finish();
    expect(workspaceSaveStatus("saved", undefined, tracker.getSnapshot(), [{ state: "dirty-pending", pending: true, inFlight: false }], false).state).toBe("draft");
  });

  it("does not let a successful read or different write hide a failed write", () => {
    const tracker = new WorkspaceWriteTracker();
    tracker.begin("tool")(new Error("Tool did not save"));
    tracker.begin("photo")();
    expect(workspaceSaveStatus("saved", undefined, tracker.getSnapshot(), [], false)).toEqual({ state: "error", error: "Tool did not save" });
    const retry = tracker.begin("tool");
    expect(tracker.getSnapshot().failures).toHaveLength(1);
    retry();
    expect(workspaceSaveStatus("saved", undefined, tracker.getSnapshot(), [], false).state).toBe("saved");
  });

  it("retains failed procedure state through another save and clears it only on confirmation", () => {
    const tracker = new WorkspaceWriteTracker();
    tracker.begin("tool")();
    const queue = { state: "retrying", pending: true, inFlight: false, lastError: new Error("Temporary outage") };
    expect(workspaceSaveStatus("saved", undefined, tracker.getSnapshot(), [queue], false)).toEqual({ state: "retrying", error: "Temporary outage" });
    expect(workspaceSaveStatus("saved", undefined, tracker.getSnapshot(), [{ ...queue, lastError: new Error("AWI save conflict") }], false).state).toBe("error");
    expect(workspaceSaveStatus("saved", undefined, tracker.getSnapshot(), [], false).state).toBe("saved");
  });

  it("an older success cannot erase a newer failed change to the same resource", () => {
    const tracker = new WorkspaceWriteTracker();
    const older = tracker.begin("tool");
    const newer = tracker.begin("tool");
    newer(new Error("New change failed"));
    older();
    expect(tracker.getSnapshot().failures[0].message).toBe("New change failed");
  });

  it("does not reintroduce an older failure after a newer change was confirmed", () => {
    const tracker = new WorkspaceWriteTracker();
    const older = tracker.begin("tool");
    tracker.begin("tool")();
    older(new Error("Old request failed"));
    expect(tracker.getSnapshot()).toEqual({ pending: 0, failures: [] });
  });

  it("settles only once and keeps snapshots stable between changes", () => {
    const tracker = new WorkspaceWriteTracker();
    const finish = tracker.begin("tool");
    const pending = tracker.getSnapshot();
    expect(tracker.getSnapshot()).toBe(pending);
    finish(new Error("Failed"));
    const failed = tracker.getSnapshot();
    finish();
    expect(tracker.getSnapshot()).toBe(failed);
    expect(pending).toEqual({ pending: 1, failures: [] });
  });

  it("keeps old workspace completions isolated from a new workspace", () => {
    const previous = new WorkspaceWriteTracker();
    const finish = previous.begin("tool");
    const current = new WorkspaceWriteTracker();
    const currentFinish = current.begin("tool");
    finish(new Error("Previous workspace failure"));
    expect(current.getSnapshot()).toEqual({ pending: 1, failures: [] });
    currentFinish();
    expect(current.getSnapshot()).toEqual({ pending: 0, failures: [] });
  });

  it("never reports a pending planner edit or unconfirmed initial load as saved", () => {
    const tracker = new WorkspaceWriteTracker();
    expect(workspaceSaveStatus("saved", undefined, tracker.getSnapshot(), [], true).state).toBe("draft");
    tracker.begin("tool")(new Error("Failure"));
    expect(workspaceSaveStatus("loading", undefined, tracker.getSnapshot(), [], false).state).toBe("loading");
  });
});
