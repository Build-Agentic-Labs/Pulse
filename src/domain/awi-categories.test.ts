import { describe, expect, it } from "vitest";
import type { AwiMaster } from "@/lib/awi/store";
import { groupAwiMasters } from "./awi-categories";

describe("AWI category grouping", () => {
  it("merges category casing, sorts AWI numbers naturally, and puts uncategorized last", () => {
    const rows = [
      { id: "a", category: "Trailer", document_number: "AWI-10" },
      { id: "b", category: "trailer", document_number: "AWI-2" },
      { id: "c", category: "", document_number: "AWI-1" },
      { id: "d", category: "Accessory", document_number: "AWI-5" },
    ] as AwiMaster[];
    const groups = groupAwiMasters(rows);
    expect(groups.map(group => group.category)).toEqual(["Accessory", "Trailer", "Uncategorized"]);
    expect(groups[1].masters.map(master => master.id)).toEqual(["b", "a"]);
    expect(rows.map(master => master.id)).toEqual(["a", "b", "c", "d"]);
  });
});
