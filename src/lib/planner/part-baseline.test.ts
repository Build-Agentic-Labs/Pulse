import { describe, expect, it } from "vitest";
import { mapPartReferenceRecord, partReferenceRows } from "./row-mappers";
import type { Task } from "@/domain/types";

describe("part save baselines", () => {
  it.each(["", "  ", " Buy ", null])("preserves stored optional text %j through a load/save", (value) => {
    const row = { id: "part", task_id: "task", part_number: "PN-1", description: value, disposition: value, quantity: 1 };
    const task = { id: "task", partReferences: [mapPartReferenceRecord(row)] } as Task;
    expect(partReferenceRows([task])).toEqual([row]);
  });
});
