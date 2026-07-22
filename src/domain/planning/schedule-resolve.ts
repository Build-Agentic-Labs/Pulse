// Resolve a parsed production-schedule row against the product-configuration catalog.
// Pure, no I/O. Phase two of three: `schedule-row.ts` parses the sheet, this resolves what to
// build, `export-column.ts` builds what goes back into the sheet.
//
// Resolution is a DICTIONARY LOOKUP on the SKU, not a search. One SKU means one BOM, and a
// different customer means a different SKU, so the customer never has to be inferred -- which
// is why the predecessor's customer normalization and combo/suffix template matching are gone.
// See docs/superpowers/specs/2026-07-21-planning-schedule-to-work-order-design.md §5.

import { aoStatus, cleanSo, normalizeBrake, parseModel } from "./schedule-row";

/** Every reason a line did not resolve cleanly. `blocking` prevents work-order creation. */
export type FlagCode =
  | "blank-model"
  | "unrecognized-model"
  | "sku-not-configured"
  | "sku-wrong-type"
  | "acc-sku-not-configured"
  | "acc-sku-wrong-type"
  | "trailer-letter-unspecified"
  | "trailer-config-missing"
  | "ao-to-enter"
  | "so-missing"
  | "model-mismatch";

/**
 * Configuration types a FINISHED-GOODS SKU may legitimately have. `accessories` is excluded on
 * purpose: a single-column paste shift in the schedule puts the ACC SKU in the FG column, and
 * without this check that line resolves perfectly cleanly and builds a "generator" work order
 * out of an accessory parts list.
 */
const FG_ORDER_TYPES: ReadonlySet<string> = new Set(["head_unit", "power_module", "trailer"]);

export interface ResolutionFlag {
  code: FlagCode;
  blocking: boolean;
  detail: string;
}

/** One product configuration: a SKU and the BOM/pairing metadata hanging off it. */
export interface ConfigEntry {
  id: string;
  sku: string;
  /** `head_unit` | `power_module` | `accessories` | … — mirrors work_order_templates.order_type. */
  orderType: string;
  /** The model this SKU builds, used to validate the sheet's MODEL TYPE text against it. */
  model: string;
  /** Generator configs point at their paired power-module config; others are null. */
  pmConfigId: string | null;
  /** Used when the sheet's trailer/brake cell is blank. */
  defaultTrailerLetter: string;
}

export interface ConfigIndex {
  bySku: ReadonlyMap<string, ConfigEntry>;
  trailerLetters: ReadonlySet<string>;
}

/** Normalize a SKU for lookup so casing and stray whitespace in the sheet never miss a config. */
function skuKey(sku: string): string {
  return (sku ?? "").trim().toUpperCase();
}

/**
 * Build the lookup the resolver reads. Entries with a blank SKU are skipped: every pre-existing
 * `work_order_templates` row defaults to `''`, and indexing those would make an empty ACC SKU
 * cell match a legacy config at random.
 */
export function buildConfigIndex(
  entries: readonly ConfigEntry[],
  trailerLetters: readonly string[],
): ConfigIndex {
  const bySku = new Map<string, ConfigEntry>();
  for (const entry of entries) {
    const key = skuKey(entry.sku);
    if (!key) continue;
    if (!bySku.has(key)) bySku.set(key, entry);
  }
  return {
    bySku,
    trailerLetters: new Set(trailerLetters.map((letter) => letter.trim().toUpperCase())),
  };
}

/** The raw fields one schedule row contributes. */
export interface ScheduleRowInput {
  model: string;
  customer: string;
  brake: string;
  fgSku: string;
  accSku: string;
  so: string;
  fgAo: string;
}

export interface LineResolution {
  status: "resolved" | "flagged";
  so: string;
  customer: string;
  model: string;
  fgSku: string;
  accSku: string;
  /** The generator config; absent when the FG SKU is unconfigured (a blocking flag). */
  genConfigId?: string;
  /** The generator config's paired power module; null when it has none. */
  pmConfigId?: string | null;
  /** The accessory config; absent when no ACC SKU was stated. */
  accConfigId?: string;
  trailerLetter: string;
  assemblyOrderNo: string;
  flags: readonly ResolutionFlag[];
}

const advisory = (code: FlagCode, detail: string): ResolutionFlag => ({ code, blocking: false, detail });
const blocking = (code: FlagCode, detail: string): ResolutionFlag => ({ code, blocking: true, detail });

/**
 * Resolve one schedule row. `resolved` means a work order can be created from it (advisory flags
 * such as a missing A# are allowed); `flagged` means something blocking must be fixed first --
 * and every blocking flag names a SKU, so the fix is always "configure this SKU", reachable in
 * one click from the preview.
 */
export function resolveScheduleLine(row: ScheduleRowInput, index: ConfigIndex): LineResolution {
  const flags: ResolutionFlag[] = [];
  const parsedModel = parseModel(row.model);
  const { so, flag: soMissing } = cleanSo(row.so);
  const assemblyOrderNo = (row.fgAo ?? "").trim();

  // ── the generator config, from the FG SKU ──
  const fgSku = (row.fgSku ?? "").trim();
  const genConfig = index.bySku.get(skuKey(fgSku));
  if (!genConfig) {
    flags.push(
      blocking(
        "sku-not-configured",
        fgSku ? `FG SKU "${fgSku}" has no product configuration` : "no FG SKU on this line",
      ),
    );
  } else if (!FG_ORDER_TYPES.has(genConfig.orderType)) {
    flags.push(
      blocking(
        "sku-wrong-type",
        `FG SKU "${fgSku}" is configured as ${genConfig.orderType}, which cannot be built as a main order — check the sheet's columns are not shifted`,
      ),
    );
  }

  // Model text is a CROSS-CHECK on the SKU, not the thing being resolved: under one-SKU-one-BOM
  // the SKU decides what gets built, so a model the parser does not recognize is advisory
  // (naming drifts, and blocking would stall legitimate rows). The dangerous case — the SKU
  // itself being wrong — is caught by the order-type check above, not by this text.
  if (parsedModel.kind === "blank") {
    flags.push(blocking("blank-model", "empty MODEL TYPE"));
  } else if (parsedModel.kind === "other") {
    flags.push(advisory("unrecognized-model", `"${parsedModel.raw.trim()}" is not a recognized model name`));
  } else if (genConfig && genConfig.model.trim() && parsedModel.raw.trim()) {
    // Compare KIND as well as combo. Comparing combos alone silently passes a standalone-PM
    // sheet row married to a hybrid SKU — exactly the disagreement this validator exists for,
    // because neither side yields a comparable combo.
    const configModel = parseModel(genConfig.model);
    const kindDiffers = parsedModel.kind !== configModel.kind;
    const comboDiffers = (parsedModel.combo ?? "") !== (configModel.combo ?? "");
    if (kindDiffers || comboDiffers) {
      flags.push(
        advisory(
          "model-mismatch",
          `sheet says "${parsedModel.raw.trim()}" but SKU ${genConfig.sku} builds "${genConfig.model}" — verify before building`,
        ),
      );
    }
  }

  // ── the accessory config, from the ACC SKU (optional) ──
  let accConfigId: string | undefined;
  const accSku = (row.accSku ?? "").trim();
  if (accSku) {
    const accConfig = index.bySku.get(skuKey(accSku));
    if (!accConfig) {
      flags.push(
        blocking("acc-sku-not-configured", `accessory SKU "${accSku}" has no product configuration`),
      );
    } else if (accConfig.orderType !== "accessories") {
      // The mirror of the FG check: a shifted column would append a whole generator BOM to the
      // order as though it were accessories.
      flags.push(
        blocking(
          "acc-sku-wrong-type",
          `accessory SKU "${accSku}" is configured as ${accConfig.orderType}, not accessories — check the sheet's columns are not shifted`,
        ),
      );
    } else {
      accConfigId = accConfig.id;
    }
  }

  // ── the trailer letter: the sheet wins, the config's default is the fallback ──
  const fromBrake = normalizeBrake(row.brake);
  let trailerLetter = "";
  if (fromBrake !== "none") {
    trailerLetter = fromBrake;
  } else {
    trailerLetter = (genConfig?.defaultTrailerLetter ?? "").trim().toUpperCase();
    flags.push(
      advisory(
        "trailer-letter-unspecified",
        trailerLetter
          ? `no trailer type on the sheet — using SKU default "${trailerLetter}"`
          : "no trailer type on the sheet and no SKU default — planner picks the configuration",
      ),
    );
  }
  if (trailerLetter && !index.trailerLetters.has(trailerLetter)) {
    flags.push(
      advisory("trailer-config-missing", `trailer configuration "${trailerLetter}" is not in the catalog`),
    );
  }

  // ── advisories on the two numbers the planner may still owe ──
  if (soMissing) {
    flags.push(advisory("so-missing", "no sales order number on this line"));
  }
  if (aoStatus(assemblyOrderNo) === "flag") {
    flags.push(advisory("ao-to-enter", "assembly A# to enter"));
  }

  return {
    status: flags.some((flag) => flag.blocking) ? "flagged" : "resolved",
    so,
    customer: (row.customer ?? "").trim(),
    model: parsedModel.raw.trim(),
    fgSku: (row.fgSku ?? "").trim(),
    accSku,
    genConfigId: genConfig?.id,
    pmConfigId: genConfig ? genConfig.pmConfigId : undefined,
    accConfigId,
    trailerLetter,
    assemblyOrderNo: aoStatus(assemblyOrderNo) === "ok" ? assemblyOrderNo : "",
    flags,
  };
}
