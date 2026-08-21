import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { routeErrorStateSpy } = vi.hoisted(() => ({
  routeErrorStateSpy: vi.fn(),
}));

vi.mock("@/components/route-error-state", () => ({
  RouteErrorState: (props: {
    title: string;
    error: Error;
    reset: () => void;
    recoverStaleClient?: boolean;
  }) => {
    routeErrorStateSpy(props);
    return <div>{props.title}</div>;
  },
}));

import ProjectError from "./error";

describe("project route error boundary", () => {
  it("enables stale client recovery for planner chunk failures", () => {
    const error = new Error("Module factory is not available");
    const reset = vi.fn();

    render(<ProjectError error={error} reset={reset} />);

    expect(screen.getByText("The project workspace could not load")).toBeInTheDocument();
    expect(routeErrorStateSpy).toHaveBeenCalledWith(expect.objectContaining({
      error,
      reset,
      recoverStaleClient: true,
    }));
  });
});
