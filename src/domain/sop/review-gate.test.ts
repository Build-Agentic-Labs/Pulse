import { describe, expect, it } from "vitest";
import { draftReviewGate } from "./review-gate";

const responded = (noChanges: boolean) => ({ submission: { noChanges } });
const pending = {};

describe("draftReviewGate", () => {
  it("blocks changes when no reviewers are assigned", () => {
    const gate = draftReviewGate([]);
    expect(gate.allResponded).toBe(false);
    expect(gate.changesRequested).toBe(false);
    expect(gate.canMakeChanges).toBe(false);
    expect(gate.reason).toBe("no-reviewers");
  });

  it("blocks changes while any reviewer has not responded", () => {
    const gate = draftReviewGate([responded(false), pending]);
    expect(gate.allResponded).toBe(false);
    expect(gate.changesRequested).toBe(true);
    expect(gate.canMakeChanges).toBe(false);
    expect(gate.reason).toBe("waiting");
  });

  it("blocks changes when every reviewer approved with no changes", () => {
    const gate = draftReviewGate([responded(true), responded(true)]);
    expect(gate.allResponded).toBe(true);
    expect(gate.changesRequested).toBe(false);
    expect(gate.canMakeChanges).toBe(false);
    expect(gate.reason).toBe("approved");
  });

  it("allows changes only when all responded and at least one requested changes", () => {
    const gate = draftReviewGate([responded(true), responded(false)]);
    expect(gate.allResponded).toBe(true);
    expect(gate.changesRequested).toBe(true);
    expect(gate.canMakeChanges).toBe(true);
    expect(gate.reason).toBe("changes");
  });

  it("allows changes when a single reviewer requests changes", () => {
    const gate = draftReviewGate([responded(false)]);
    expect(gate.canMakeChanges).toBe(true);
    expect(gate.reason).toBe("changes");
  });
});
