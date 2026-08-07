// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SopActivity } from "@/domain/sop/schema";
import { ProcessFlowchart } from "./process-flowchart";

const activities: SopActivity[] = [
  {
    id: "decision",
    step: 1,
    shape: "decision",
    input: "Reviewed request",
    description: "Is the request approved?",
    output: "Approval decision",
    decisionBranches: {
      yesTargetActivityId: "approve",
      noTargetActivityId: "revise",
    },
    assignments: {},
  },
  {
    id: "approve",
    step: 2,
    shape: "process",
    description: "Approve request",
    assignments: {},
  },
  {
    id: "revise",
    step: 3,
    shape: "process",
    description: "Revise request",
    assignments: {},
  },
];

describe("ProcessFlowchart decision branches", () => {
  it("shows configured Yes and No destinations in Builder and Viewer", () => {
    render(
      <ProcessFlowchart
        roles={[]}
        activities={activities}
        departments={[]}
        onChange={() => {}}
      />,
    );

    expect(screen.getByRole("button", { name: "Yes branch destination for activity 1" })).toHaveTextContent(
      "2. Approve request",
    );
    expect(screen.getByRole("button", { name: "No branch destination for activity 1" })).toHaveTextContent(
      "3. Revise request",
    );
    expect(screen.queryByRole("img", { name: /Required:/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Viewer" }));

    expect(screen.getByText("Yes →")).toBeInTheDocument();
    expect(screen.getByText("No →")).toBeInTheDocument();
    expect(screen.getByText("2. Approve request")).toBeInTheDocument();
    expect(screen.getByText("3. Revise request")).toBeInTheDocument();
  });

  it("stores the selected destination by stable activity id", () => {
    const onChange = vi.fn();
    const unsetBranches = activities.map((activity, index) =>
      index === 0 ? { ...activity, decisionBranches: undefined } : activity,
    );
    render(
      <ProcessFlowchart
        roles={[]}
        activities={unsetBranches}
        departments={[]}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Yes branch destination for activity 1" }));
    fireEvent.click(screen.getByRole("option", { name: "2. Approve request" }));

    const [, updatedActivities] = onChange.mock.calls.at(-1) as [string[], SopActivity[]];
    expect(updatedActivities[0].decisionBranches?.yesTargetActivityId).toBe("approve");
  });

  it("marks incomplete decision input with a compact required tooltip", () => {
    const incomplete = activities.map((activity, index) =>
      index === 0 ? { ...activity, decisionBranches: undefined } : activity,
    );
    render(
      <ProcessFlowchart
        roles={[]}
        activities={incomplete}
        departments={[]}
        onChange={() => {}}
      />,
    );

    const flag = screen.getByRole("img", { name: /choose a destination or End process/ });
    expect(flag).toHaveAttribute("title", expect.stringContaining("Required:"));
    expect(screen.getByRole("tooltip", { hidden: true })).toHaveTextContent(
      "choose a destination or End process",
    );
  });

  it("marks converted decisions whose Yes and No paths are identical", () => {
    const duplicate = activities.map((activity, index) =>
      index === 0
        ? {
            ...activity,
            decisionBranches: {
              yesTargetActivityId: "approve",
              noTargetActivityId: "approve",
            },
          }
        : activity,
    );
    render(
      <ProcessFlowchart
        roles={[]}
        activities={duplicate}
        departments={[]}
        onChange={() => {}}
      />,
    );

    expect(screen.getByRole("img", { name: /Yes and No cannot point to the same destination/ })).toBeInTheDocument();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(
      "Yes and No cannot point to the same destination",
    );
    expect(alert.parentElement).toHaveClass("border-danger", "bg-danger-muted");
    expect(screen.getByRole("button", { name: "Yes branch destination for activity 1" })).toHaveClass(
      "!border-danger",
    );
    expect(screen.getByRole("button", { name: "No branch destination for activity 1" })).toHaveClass(
      "!border-danger",
    );
  });
});
