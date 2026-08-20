// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { MasterBom } from "@/domain/master-bom";
import { BomPartSearch } from "./bom-part-search";

function largeBom(): MasterBom {
  return {
    fileName: "large-bom.xlsx",
    columns: ["No.", "Description", "Qty. per Parent"],
    rows: Array.from({ length: 80 }, (_, index) => ({
      "No.": `P-${String(index + 1).padStart(3, "0")}`,
      Description: `Shared match part ${index + 1}`,
      "Qty. per Parent": "1",
    })),
  };
}

describe("BomPartSearch", () => {
  it("makes every BOM part available when the query is empty", () => {
    render(<BomPartSearch masterBom={largeBom()} onSelect={vi.fn()} />);

    fireEvent.focus(screen.getByRole("combobox", { name: "Search master BOM" }));

    expect(screen.getByRole("button", { name: /P-001/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /P-080/ })).toBeInTheDocument();
  });

  it("makes every matching BOM part available without a result cap", () => {
    render(<BomPartSearch masterBom={largeBom()} onSelect={vi.fn()} />);

    fireEvent.change(screen.getByRole("combobox", { name: "Search master BOM" }), {
      target: { value: "shared match" },
    });

    expect(screen.getAllByRole("button")).toHaveLength(80);
    expect(screen.getByRole("button", { name: /P-080/ })).toBeInTheDocument();
  });
});
