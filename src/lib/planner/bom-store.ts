// The product master BOM save: a single project-scoped update of the product's custom fields whose
// returned row is verified against the intended BOM before success is reported. Bypasses the debounced
// planner-shell autosave on purpose. Moved verbatim from supabase-planner.ts (Phase 5); the facade
// re-exports it.

import { plannerClient } from "./client";
import { throwIfError } from "./query-helpers";
import { mapProduct } from "./row-mappers";
import {
  getMasterBom,
  type MasterBom,
  PRODUCT_MASTER_BOM_FIELD,
  serializeMasterBom,
} from "@/domain/master-bom";
import type { Product } from "@/domain/types";
import type { Json } from "@/lib/database.types";

/**
 * Persist only the product-level master BOM and verify the exact value returned
 * by the database before the UI reports success. This intentionally bypasses
 * the broader planner-shell autosave so an upload cannot be lost to debounce or
 * page-unload timing.
 */
export async function saveMasterBomToSupabase(
  product: Product,
  bom: MasterBom | undefined,
  projectId: string,
  client?: ReturnType<typeof plannerClient>,
): Promise<Product> {
  if (!product.projectId || String(product.projectId) !== String(projectId)) {
    throw new Error("The master BOM does not belong to the active project.");
  }

  const expectedBom = bom ? serializeMasterBom(bom) : undefined;
  const customFields = { ...(product.customFields ?? {}) };
  if (expectedBom) {
    customFields[PRODUCT_MASTER_BOM_FIELD] = expectedBom;
  } else {
    delete customFields[PRODUCT_MASTER_BOM_FIELD];
  }

  const supabase = client ?? plannerClient();
  const savedRow = await throwIfError(
    supabase
      .from("products")
      .update({ custom_fields: customFields as Json })
      .eq("id", product.id)
      .eq("project_id", projectId)
      .select("*")
      .maybeSingle(),
  );

  if (!savedRow) {
    throw new Error("The master BOM could not be saved. Check your project edit access and retry.");
  }

  const savedProduct = mapProduct(savedRow);
  const verifiedBom = getMasterBom(savedProduct.customFields);
  const didVerify = expectedBom
    ? JSON.stringify(verifiedBom) === JSON.stringify(expectedBom)
    : !Object.prototype.hasOwnProperty.call(savedProduct.customFields ?? {}, PRODUCT_MASTER_BOM_FIELD);

  if (!didVerify) {
    throw new Error("The master BOM save could not be verified. Retry before leaving this page.");
  }

  return savedProduct;
}
