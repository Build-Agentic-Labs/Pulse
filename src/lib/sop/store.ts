/**
 * Prototype persistence for SOPs.
 *
 * Deliberately backed by localStorage, not Supabase: the SOP data model is still
 * settling, so we avoid a schema/migration until it's locked. Swapping this module
 * for Supabase-backed calls later is the only change the UI should need.
 */

"use client";

import { createEmptySop, type Sop } from "@/domain/sop/schema";
import type { ExtractedSop } from "@/domain/sop/extraction";

const STORAGE_KEY = "pulse:sops:v1";

function nowIso(): string {
  return new Date().toISOString();
}

export function newSopId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `sop_${Date.now().toString(36)}`;
}

export function listSops(): Sop[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Sop[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function getSop(id: string): Sop | undefined {
  return listSops().find((sop) => sop.id === id);
}

export function saveSop(sop: Sop): Sop {
  const next = { ...sop, updatedAt: nowIso() };
  const all = listSops();
  const index = all.findIndex((entry) => entry.id === sop.id);
  if (index >= 0) {
    all[index] = next;
  } else {
    all.unshift(next);
  }
  writeAll(all);
  return next;
}

export function deleteSop(id: string): void {
  writeAll(listSops().filter((sop) => sop.id !== id));
}

function writeAll(sops: Sop[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sops));
}

/** Build a full, persistable `Sop` from a Claude extraction result. */
export function sopFromExtraction(extracted: ExtractedSop): Sop {
  const base = createEmptySop(newSopId(), nowIso());
  // The model output is trusted but not guaranteed; fall back to base values so a
  // partial/malformed payload can't throw while we build the Sop.
  const procedure = extracted.procedure ?? base.procedure;
  const approvals = extracted.approvals ?? [];
  return {
    ...base,
    ...extracted,
    // Keep app-managed fields from the base; never let the model set them.
    id: base.id,
    source: "converted",
    createdAt: base.createdAt,
    updatedAt: base.updatedAt,
    procedure: {
      ...base.procedure,
      ...procedure,
      activities: (procedure.activities ?? []).map((activity, index) => ({
        id: `${base.id}-act-${index}`,
        step: activity.step || index + 1,
        description: activity.description,
        assignments: activity.assignments ?? {},
      })),
    },
    // If the legacy doc had no approval rows, keep the standard template rows.
    approvals: approvals.length > 0 ? approvals : base.approvals,
  };
}
