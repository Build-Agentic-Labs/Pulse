import { describe, expect, it } from "vitest";

import {
  buildProjectToolCatalog,
  groupToolCatalogByType,
  planToolNameTidy,
  type ProjectToolCatalogEntry,
} from "./project-catalog";
import { STEP_TOOL_LISTS_FIELD } from "./step-tools";
import { canonicalToolKey } from "./tool-name-format";
import { buildProjectToolRegistry } from "./tool-registry";
import type { ToolLibraryItem } from "./supabase-planner";
import type { ToolTypeValue } from "./tool-types";
import type { Task } from "./types";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "t1",
    scenarioId: "sc1",
    stationId: "s1",
    rowType: "task",
    wbs: "1",
    name: "Task",
    plannedStart: "2026-01-01T08:00:00.000Z",
    plannedFinish: "2026-01-01T09:00:00.000Z",
    plannedDurationMinutes: 60,
    plannedOperators: 1,
    plannedManHours: 0,
    status: "not_started",
    percentComplete: 0,
    dependencyIds: [],
    criticalPath: false,
    bottleneckFlag: false,
    qualityGate: false,
    travelerSignoffRequired: false,
    customFields: {},
    ...overrides,
  };
}

function taskWithTools(stepToolLists: Record<string, string[]>, id = "t1"): Task {
  return makeTask({ id, customFields: { [STEP_TOOL_LISTS_FIELD]: stepToolLists } });
}

function makeEntry(name: string, category: ToolTypeValue): ProjectToolCatalogEntry {
  return {
    key: canonicalToolKey(name),
    rawName: name,
    id: "T01",
    name,
    color: "#000",
    colorLabel: "Black",
    category,
    stepUsageCount: 0,
    taskUsageCount: 0,
  };
}

describe("buildProjectToolCatalog", () => {
  it("displays formatted names while preserving the raw stored name", () => {
    const tasks = [taskWithTools({ s1: ["torque  wrench"] })];
    const registry = buildProjectToolRegistry(tasks, []);
    const [entry] = buildProjectToolCatalog(tasks, registry, []);

    expect(entry.name).toBe("Torque Wrench");
    expect(entry.rawName).toBe("torque  wrench");
  });

  it("counts usage correctly for a multi-space name", () => {
    const tasks = [taskWithTools({ s1: ["torque  wrench"], s2: ["torque  wrench"] })];
    const registry = buildProjectToolRegistry(tasks, []);
    const [entry] = buildProjectToolCatalog(tasks, registry, []);

    expect(entry.stepUsageCount).toBe(2);
    expect(entry.taskUsageCount).toBe(1);
  });

  it("resolves a stable registry id for a multi-space name", () => {
    const tasks = [taskWithTools({ s1: ["torque  wrench"] })];
    const registry = buildProjectToolRegistry(tasks, []);
    const [entry] = buildProjectToolCatalog(tasks, registry, []);

    expect(entry.id).toBe("T01");
  });

  it("honors a saved category from the tool library", () => {
    const tasks = [taskWithTools({ s1: ["torque  wrench"] })];
    const registry = buildProjectToolRegistry(tasks, []);
    const libraryItems: ToolLibraryItem[] = [
      { id: "lib1", toolName: "Torque Wrench", category: "socket" },
    ];
    const [entry] = buildProjectToolCatalog(tasks, registry, libraryItems);

    expect(entry.category).toBe("socket");
  });

  it("collapses size/whitespace/punctuation variants into one row, with unique keys", () => {
    const tasks = [
      taskWithTools({ s1: ["10mm socket", "10 mm socket"], s2: ['1/2" drive', "1/2 inch drive"] }),
    ];
    const registry = buildProjectToolRegistry(tasks, []);
    const catalog = buildProjectToolCatalog(tasks, registry, []);

    expect(catalog.map((entry) => entry.name).sort()).toEqual(["1/2in Drive", "10mm Socket"]);

    const keys = catalog.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("groupToolCatalogByType", () => {
  it("orders groups by canonical type order with General last and sorts within", () => {
    const entries = [
      makeEntry("Random Tool", "general"),
      makeEntry("Box Wrench", "wrench"),
      makeEntry("10mm Socket", "socket"),
      makeEntry("Allen Wrench", "wrench"),
    ];

    const groups = groupToolCatalogByType(entries);

    expect(groups.map((group) => group.type)).toEqual(["wrench", "socket", "general"]);
    expect(groups[0].label).toBe("Wrench");
    expect(groups[0].count).toBe(2);
    expect(groups[0].entries.map((entry) => entry.name)).toEqual(["Allen Wrench", "Box Wrench"]);
  });

  it("omits empty groups", () => {
    const groups = groupToolCatalogByType([makeEntry("10mm Socket", "socket")]);
    expect(groups).toHaveLength(1);
    expect(groups[0].type).toBe("socket");
  });
});

describe("planToolNameTidy", () => {
  it("plans a rename from the raw stored name to the clean form", () => {
    const tasks = [taskWithTools({ s1: ["torque  wrench"] })];
    const registry = buildProjectToolRegistry(tasks, []);
    const entries = buildProjectToolCatalog(tasks, registry, []);

    expect(planToolNameTidy(entries)).toEqual([{ from: "torque  wrench", to: "Torque Wrench" }]);
  });

  it("skips names that are already clean", () => {
    const tasks = [taskWithTools({ s1: ["Impact Gun"] })];
    const registry = buildProjectToolRegistry(tasks, []);
    const entries = buildProjectToolCatalog(tasks, registry, []);

    expect(planToolNameTidy(entries)).toEqual([]);
  });
});
