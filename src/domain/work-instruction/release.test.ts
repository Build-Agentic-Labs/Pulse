import { describe, expect, it } from "vitest";
import {
  fingerprintWorkInstruction,
  formatStepNumbers,
  frozenPhotoPath,
  isoDateOnly,
  latestRelease,
  nextRevisionLetter,
  releaseReadiness,
  releaseStateFor,
  releasedDocument,
  revisionLetter,
  snapshotForRelease,
  validateReleaseInput,
  withReleaseMeta,
  type WorkInstructionRelease,
} from "./release";
import type { WorkInstruction, WorkInstructionCard } from "./schema";

function card(overrides: Partial<WorkInstructionCard> = {}): WorkInstructionCard {
  return {
    stepId: "step-1",
    sequence: 1,
    part: 1,
    partCount: 1,
    code: "Z1-A-010-WI1-010",
    name: "Mount bracket",
    instruction: "Torque the four M8 bolts.",
    overflowing: false,
    durationMinutes: 5,
    tools: ["Torque wrench"],
    checks: [{ key: "torque", label: "Torque", spec: "45 Nm" }],
    photo: { id: "photo-1", url: "https://signed.example/a?token=1", storagePath: "workspaces/w/projects/p/steps/a.jpg", caption: "Bracket" },
    ...overrides,
  };
}

function instruction(overrides: Partial<WorkInstruction> = {}): WorkInstruction {
  return {
    taskId: "task-1",
    meta: {
      documentNumber: "Z1-A-010-WI1",
      title: "Install inverter bracket",
      revision: "",
      effectiveDate: "",
      preparedBy: "",
      reviewedBy: "",
      approvedBy: "",
      revisionHistory: [],
    },
    context: { productName: "FlexBoost", productCode: "FB-V2", productRevision: "A", zoneName: "Zone 1", manufacturingCode: "Z1-A-010" },
    setup: {
      purpose: "Mount the bracket.",
      safetyNotes: "Gloves.",
      tools: ["Torque wrench"],
      parts: [],
      drawingLink: "",
      sopLink: "",
      references: [],
      plannedDurationMinutes: 20,
      plannedOperators: 1,
      qualityGate: false,
    },
    cards: [card()],
    blank: false,
    ...overrides,
  };
}

function release(index: number, content: WorkInstruction, overrides: Partial<WorkInstructionRelease> = {}): WorkInstructionRelease {
  return {
    id: `rel-${index}`,
    taskId: "task-1",
    revisionIndex: index,
    revision: revisionLetter(index),
    documentNumber: content.meta.documentNumber,
    title: content.meta.title,
    changeDescription: index === 1 ? "Initial release" : `Change ${index}`,
    effectiveDate: `2026-09-${String(10 + index).padStart(2, "0")}`,
    content: snapshotForRelease(content),
    contentHash: fingerprintWorkInstruction(content),
    textHash: fingerprintWorkInstruction(content, { photos: false }),
    releasedBy: "user-1",
    releasedByName: "Rosendo Lopez",
    releasedAt: "2026-09-18T15:00:00Z",
    ...overrides,
  };
}

describe("revisionLetter", () => {
  it.each([
    [1, "A"],
    [2, "B"],
    [26, "Z"],
    [27, "AA"],
    [52, "AZ"],
    [53, "BA"],
    [702, "ZZ"],
    [703, "AAA"],
  ])("%i -> %s", (index, letter) => {
    expect(revisionLetter(index)).toBe(letter);
  });

  it.each([0, -1, 1.5, Number.NaN])("rejects %s", (index) => {
    expect(() => revisionLetter(index)).toThrow();
  });
});

describe("nextRevisionLetter / latestRelease", () => {
  it("starts at A and follows the highest released index regardless of order", () => {
    const wi = instruction();
    expect(nextRevisionLetter([])).toBe("A");
    expect(nextRevisionLetter([release(2, wi), release(1, wi)])).toBe("C");
    expect(latestRelease([release(2, wi), release(1, wi)])?.revision).toBe("B");
  });
});

describe("fingerprintWorkInstruction", () => {
  it("ignores control meta, photo URLs and photo storage paths", () => {
    const base = instruction();
    const resigned = instruction({
      meta: { ...base.meta, revision: "Rev A", effectiveDate: "2026-09-18", preparedBy: "X", approvedBy: "X", revisionHistory: [{ revision: "A", date: "d", description: "x", author: "y" }] },
      cards: [card({ photo: { id: "photo-1", url: "https://signed.example/a?token=2", storagePath: "workspaces/w/projects/p/wi-releases/t/u/photo-1.jpg", caption: "Bracket" } })],
    });
    expect(fingerprintWorkInstruction(resigned)).toBe(fingerprintWorkInstruction(base));
  });

  it("is independent of object key order", () => {
    const base = instruction();
    const reordered = { ...base, context: Object.fromEntries(Object.entries(base.context).reverse()) as WorkInstruction["context"] };
    expect(fingerprintWorkInstruction(reordered)).toBe(fingerprintWorkInstruction(base));
  });

  it.each([
    ["step text", instruction({ cards: [card({ instruction: "Torque the four M8 bolts to spec." })] })],
    ["a check spec", instruction({ cards: [card({ checks: [{ key: "torque", label: "Torque", spec: "50 Nm" }] })] })],
    ["a swapped photo", instruction({ cards: [card({ photo: { id: "photo-2", url: "", caption: "Bracket" } })] })],
    ["a photo caption", instruction({ cards: [card({ photo: { id: "photo-1", url: "", caption: "Bracket, rear" } })] })],
    ["the title", instruction({ meta: { ...instruction().meta, title: "Install bracket" } })],
    ["the product revision", instruction({ context: { ...instruction().context, productRevision: "B" } })],
    ["a reference", instruction({ setup: { ...instruction().setup, references: [{ kind: "sop", documentNumber: "QAS-SOP-004", title: "Records", version: "2.0", url: "" }] } })],
  ])("changes when %s changes", (_label, changed) => {
    expect(fingerprintWorkInstruction(changed)).not.toBe(fingerprintWorkInstruction(instruction()));
  });
});

describe("snapshotForRelease", () => {
  it("blanks control meta and drops the signed URL of a stored photo", () => {
    const snapshot = snapshotForRelease(instruction({ meta: { ...instruction().meta, revision: "Draft", preparedBy: "X" } }));
    expect(snapshot.meta.revision).toBe("");
    expect(snapshot.meta.preparedBy).toBe("");
    expect(snapshot.cards[0].photo).toMatchObject({ url: "", storagePath: "workspaces/w/projects/p/steps/a.jpg" });
  });

  it("re-points photos at frozen copies and leaves unstored photos alone", () => {
    const wi = instruction({
      cards: [card(), card({ stepId: "step-2", sequence: 2, photo: { id: "photo-inline", url: "data:image/png;base64,AAA", caption: "" } })],
    });
    const snapshot = snapshotForRelease(wi, new Map([["photo-1", "workspaces/w/projects/p/wi-releases/task-1/u/photo-1.jpg"]]));
    expect(snapshot.cards[0].photo?.storagePath).toBe("workspaces/w/projects/p/wi-releases/task-1/u/photo-1.jpg");
    expect(snapshot.cards[1].photo?.url).toBe("data:image/png;base64,AAA");
  });

  it("does not mutate its input", () => {
    const wi = instruction();
    snapshotForRelease(wi, new Map([["photo-1", "frozen"]]));
    expect(wi.cards[0].photo?.url).toBe("https://signed.example/a?token=1");
  });
});

describe("releaseStateFor / withReleaseMeta", () => {
  it("is unreleased with no releases, and a live draft says so without inventing history", () => {
    const wi = instruction();
    const state = releaseStateFor(wi, []);
    expect(state).toEqual({ kind: "unreleased" });
    const shown = withReleaseMeta(wi, [], state);
    expect(shown.meta.revision).toBe("Draft");
    expect(shown.meta.effectiveDate).toBe("");
    expect(shown.meta.revisionHistory).toEqual([]);
  });

  it("carries the release's revision, date and author while the content still matches", () => {
    const wi = instruction();
    const releases = [release(1, wi)];
    const state = releaseStateFor(wi, releases);
    expect(state.kind).toBe("released");
    const shown = withReleaseMeta(wi, releases, state);
    expect(shown.meta).toMatchObject({ revision: "Rev A", effectiveDate: "2026-09-11T12:00:00", preparedBy: "Rosendo Lopez", approvedBy: "Rosendo Lopez", reviewedBy: "" });
    expect(shown.meta.revisionHistory).toEqual([{ revision: "A", date: "2026-09-11T12:00:00", description: "Initial release", author: "Rosendo Lopez" }]);
  });

  it("turns back into a draft once the content drifts, keeping the released history", () => {
    const releases = [release(1, instruction())];
    const edited = instruction({ cards: [card({ instruction: "Torque to 50 Nm." })] });
    const state = releaseStateFor(edited, releases);
    expect(state).toMatchObject({ kind: "modified", release: { revision: "A" } });
    const shown = withReleaseMeta(edited, releases, state);
    expect(shown.meta.revision).toBe("Draft");
    expect(shown.meta.effectiveDate).toBe("");
    expect(shown.meta.revisionHistory).toHaveLength(1);
  });

  it("leaves the blank fill-in template untouched", () => {
    const blank = instruction({ blank: true, cards: [] });
    expect(withReleaseMeta(blank, [], { kind: "unreleased" })).toBe(blank);
  });
});

describe("releaseStateFor without photos loaded", () => {
  it("does not mistake missing photos for a change, but still sees a text change", () => {
    const releases = [release(1, instruction())];
    const withoutPhotos = instruction({ cards: [card({ photo: undefined })] });
    expect(releaseStateFor(withoutPhotos, releases).kind).toBe("modified");
    expect(releaseStateFor(withoutPhotos, releases, { photosLoaded: false }).kind).toBe("released");
    const edited = instruction({ cards: [card({ photo: undefined, instruction: "Torque to 50 Nm." })] });
    expect(releaseStateFor(edited, releases, { photosLoaded: false }).kind).toBe("modified");
  });
});

describe("releasedDocument", () => {
  it("renders the frozen content with history only up to that revision", () => {
    const first = instruction();
    const second = instruction({ cards: [card({ instruction: "Torque to 50 Nm." })] });
    const releases = [release(1, first), release(2, second)];
    const shownA = releasedDocument(releases[0], releases);
    expect(shownA.cards[0].instruction).toBe("Torque the four M8 bolts.");
    expect(shownA.meta.revision).toBe("Rev A");
    expect(shownA.meta.revisionHistory.map((entry) => entry.revision)).toEqual(["A"]);
    const shownB = releasedDocument(releases[1], releases);
    expect(shownB.cards[0].instruction).toBe("Torque to 50 Nm.");
    expect(shownB.meta.revisionHistory.map((entry) => entry.revision)).toEqual(["A", "B"]);
  });
});

describe("releaseReadiness", () => {
  it("passes a complete instruction, with photo and notes as the only possible warnings", () => {
    expect(releaseReadiness(instruction())).toEqual({ blocking: [], warnings: [] });
  });

  it("blocks on no steps, no number, overflow, no tools and no checks", () => {
    expect(releaseReadiness(instruction({ cards: [], blank: true })).blocking).toContain("Add at least one step.");
    expect(releaseReadiness(instruction({ meta: { ...instruction().meta, documentNumber: "" } })).blocking[0]).toMatch(/manufacturing code/);
    expect(releaseReadiness(instruction({ cards: [card({ overflowing: true })] })).blocking[0]).toMatch(/Step 1 has text too wide/);
    expect(releaseReadiness(instruction({ setup: { ...instruction().setup, tools: [] } })).blocking).toContain("Assign tools to the steps.");
    expect(releaseReadiness(instruction({ cards: [card({ checks: [] })] })).blocking).toContain("Assign a checklist to at least one step.");
  });

  it("counts steps, not continuation cards, when warning about photos", () => {
    const wi = instruction({
      cards: [card({ partCount: 2 }), card({ part: 2, partCount: 2, photo: undefined, checks: [] }), card({ stepId: "step-2", sequence: 2, photo: undefined })],
    });
    expect(releaseReadiness(wi).warnings).toContain("1 of 2 steps have no photo.");
  });

  it("does not report missing photos while the task's photos are still loading", () => {
    const wi = instruction({ cards: [card({ photo: undefined })] });
    expect(releaseReadiness(wi).warnings).toContain("1 of 1 steps have no photo.");
    expect(releaseReadiness(wi, { photosLoaded: false }).warnings.join(" ")).not.toMatch(/photo/);
  });

  it("summarises many empty steps as a count with ranges instead of a wall of numbers", () => {
    const empty = [2, 3, 4, 5, 8, 10, 11, 14];
    const cards = Array.from({ length: 14 }, (_, index) =>
      card({ stepId: `s${index + 1}`, sequence: index + 1, instruction: empty.includes(index + 1) ? "  " : "Do it." }),
    );
    expect(releaseReadiness(instruction({ cards })).warnings).toContain("8 of 14 steps have no instruction text (2–5, 8, 10, 11, 14).");
    expect(releaseReadiness(instruction({ cards: [card({ instruction: "" })] })).warnings).toContain("Step 1 has no instruction text.");
  });

  it("uses the plural for several unprintable steps", () => {
    const cards = [card({ overflowing: true }), card({ stepId: "s2", sequence: 2, overflowing: true }), card({ stepId: "s3", sequence: 3, overflowing: true })];
    expect(releaseReadiness(instruction({ cards })).blocking[0]).toBe("Steps 1–3 have text too wide to print; shorten or break it.");
  });
});

describe("formatStepNumbers", () => {
  it.each([
    [[1], "1"],
    [[1, 2], "1, 2"],
    [[1, 2, 3], "1–3"],
    [[5, 3, 4, 3, 9], "3–5, 9"],
    [[], ""],
  ])("%j -> %s", (numbers, expected) => {
    expect(formatStepNumbers(numbers)).toBe(expected);
  });
});

describe("validateReleaseInput / isoDateOnly", () => {
  it("requires a change description and a real date", () => {
    expect(validateReleaseInput({ changeDescription: "  ", effectiveDate: "2026-09-18" })).toMatch(/what changed/);
    expect(validateReleaseInput({ changeDescription: "x".repeat(501), effectiveDate: "2026-09-18" })).toMatch(/under 500/);
    expect(validateReleaseInput({ changeDescription: "Initial release", effectiveDate: "" })).toMatch(/effective date/);
    expect(validateReleaseInput({ changeDescription: "Initial release", effectiveDate: "09/18/2026" })).toMatch(/effective date/);
    expect(validateReleaseInput({ changeDescription: "Initial release", effectiveDate: "2026-09-18" })).toBeNull();
  });

  it("formats the local calendar day", () => {
    expect(isoDateOnly(new Date(2026, 8, 5, 23, 30))).toBe("2026-09-05");
  });
});

describe("frozenPhotoPath", () => {
  const target = { workspaceId: "ws-1", projectId: "project-flexboost", taskId: "task flex/1", batchId: "batch-1", photoId: "photo:1" };

  it("puts the copy under the release's own workspace and project", () => {
    expect(frozenPhotoPath({ ...target, sourcePath: "workspaces/ws-1/projects/project-flexboost/tasks/t/steps/s/abc-photo.JPG" })).toBe(
      "workspaces/ws-1/projects/project-flexboost/wi-releases/task-flex-1/batch-1/photo-1.jpg",
    );
  });

  it("freezes a photo at a legacy path too, since the destination does not depend on the source's shape", () => {
    expect(frozenPhotoPath({ ...target, sourcePath: "task-1778789409179/step-abc/photo-1778789457309-7j7sbw.jpg" })).toBe(
      "workspaces/ws-1/projects/project-flexboost/wi-releases/task-flex-1/batch-1/photo-1.jpg",
    );
    expect(frozenPhotoPath({ ...target, sourcePath: "legacy/photo-without-extension" })).toBe(
      "workspaces/ws-1/projects/project-flexboost/wi-releases/task-flex-1/batch-1/photo-1",
    );
  });

  it("returns null when there is no source or the project cannot form a path", () => {
    expect(frozenPhotoPath({ ...target, sourcePath: "" })).toBeNull();
    expect(frozenPhotoPath({ ...target, workspaceId: "", sourcePath: "a.jpg" })).toBeNull();
    expect(frozenPhotoPath({ ...target, projectId: "p/x", sourcePath: "a.jpg" })).toBeNull();
  });
});
