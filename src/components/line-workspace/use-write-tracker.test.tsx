import { act, renderHook } from "@testing-library/react";
import { expect, it } from "vitest";
import { useWriteTracker } from "./use-write-tracker";

it("publishes concurrent completion and disconnects the previous project", () => {
  const { result, rerender, unmount } = renderHook(({ projectId }) => useWriteTracker(projectId), { initialProps: { projectId: "first" } });
  let oldFinish!: (error?: unknown) => void;
  act(() => { oldFinish = result.current.tracker.begin("tool"); });
  expect(result.current.snapshot.pending).toBe(1);
  const firstTracker = result.current.tracker;
  rerender({ projectId: "first" });
  expect(result.current.tracker).toBe(firstTracker);
  rerender({ projectId: "second" });
  expect(result.current.snapshot).toEqual({ pending: 0, failures: [] });
  let currentFinish!: (error?: unknown) => void;
  act(() => { currentFinish = result.current.tracker.begin("photo"); });
  act(() => { oldFinish(new Error("Old project failed")); });
  expect(result.current.snapshot).toEqual({ pending: 1, failures: [] });
  act(() => { currentFinish(); });
  expect(result.current.snapshot).toEqual({ pending: 0, failures: [] });
  // An operation may finish after navigation unmounts its owner.
  let lateFinish!: (error?: unknown) => void;
  act(() => { lateFinish = result.current.tracker.begin("late"); });
  unmount();
  expect(() => lateFinish()).not.toThrow();
});
