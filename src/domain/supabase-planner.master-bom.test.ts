import { describe, expect, it } from "vitest";

import { emptyPlannerState } from "./empty-planner-state";
import { PRODUCT_MASTER_BOM_FIELD, type MasterBom } from "./master-bom";
import { saveMasterBomToSupabase } from "./supabase-planner";

const NOW = "2026-08-19T12:00:00.000Z";

const bom: MasterBom = {
  fileName: "flexboost-bom.csv",
  uploadedAt: NOW,
  columns: ["Part Number", "Description", "Qty"],
  rows: [{ "Part Number": "FB-100", Description: "Cooling hose", Qty: "2" }],
};

function productRow(customFields: Record<string, unknown>) {
  return {
    id: "product-1",
    project_id: "project-1",
    name: "FlexBoost",
    revision: "A",
    status: "draft",
    demand_quantity: 1,
    demand_period: "day",
    custom_fields: customFields,
    created_at: NOW,
    updated_at: NOW,
  };
}

function createClientFixture(
  readBack: (customFields: Record<string, unknown>) => Record<string, unknown> = (customFields) => customFields,
) {
  let updatePatch: Record<string, unknown> | undefined;
  const filters: Array<[string, unknown]> = [];

  class Query {
    update(patch: Record<string, unknown>) {
      updatePatch = patch;
      return this;
    }

    eq(column: string, value: unknown) {
      filters.push([column, value]);
      return this;
    }

    select() {
      return this;
    }

    maybeSingle() {
      const customFields = (updatePatch?.custom_fields ?? {}) as Record<string, unknown>;
      return Promise.resolve({ data: productRow(readBack(customFields)), error: null });
    }
  }

  const client = {
    from(table: string) {
      expect(table).toBe("products");
      return new Query();
    },
  };

  return {
    client,
    filters,
    getUpdatePatch: () => updatePatch,
  };
}

describe("saveMasterBomToSupabase", () => {
  it("updates only custom_fields and returns only after an exact database read-back", async () => {
    const fixture = createClientFixture();
    const product = {
      ...emptyPlannerState.product,
      id: "product-1",
      projectId: "project-1",
      customFields: { keepMe: "preserved" },
    };

    const saved = await saveMasterBomToSupabase(product, bom, "project-1", fixture.client as never);

    expect(fixture.getUpdatePatch()).toEqual({
      custom_fields: {
        keepMe: "preserved",
        [PRODUCT_MASTER_BOM_FIELD]: bom,
      },
    });
    expect(fixture.filters).toEqual([
      ["id", "product-1"],
      ["project_id", "project-1"],
    ]);
    expect(saved.customFields).toEqual({ keepMe: "preserved", [PRODUCT_MASTER_BOM_FIELD]: bom });
  });

  it("rejects success when the database does not return the uploaded BOM", async () => {
    const fixture = createClientFixture(() => ({ keepMe: "preserved" }));
    const product = {
      ...emptyPlannerState.product,
      id: "product-1",
      projectId: "project-1",
      customFields: { keepMe: "preserved" },
    };

    await expect(saveMasterBomToSupabase(product, bom, "project-1", fixture.client as never)).rejects.toThrow(
      "could not be verified",
    );
  });

  it("verifies removal while preserving unrelated custom fields", async () => {
    const fixture = createClientFixture();
    const product = {
      ...emptyPlannerState.product,
      id: "product-1",
      projectId: "project-1",
      customFields: { keepMe: "preserved", [PRODUCT_MASTER_BOM_FIELD]: bom },
    };

    const saved = await saveMasterBomToSupabase(product, undefined, "project-1", fixture.client as never);

    expect(fixture.getUpdatePatch()).toEqual({ custom_fields: { keepMe: "preserved" } });
    expect(saved.customFields).toEqual({ keepMe: "preserved" });
  });
});
