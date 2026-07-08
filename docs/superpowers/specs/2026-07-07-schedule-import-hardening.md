# Schedule-Import Hardening — Prerequisites for Work-Order Set Generation

**Date:** 2026-07-07
**Status:** ✅ Hardened — resolution module + dry-run validator built, all decisions resolved, dry-run passes the acceptance gate. Residual data to-dos enumerated below (not code work).
**Precedes:** the production-schedule → work-order-set importer (separate spec, not yet written)
**Builds on:** `2026-07-06-work-order-sets-design.md` (shipped), `anacorp-product-nomenclature` (memory)

## Progress (as of 2026-07-07)

**Decisions resolved:** D1–D4 confirmed as recommended · D5 = **skip** (don't author 25/125 PM yet — flag those lines) · D6 = **separate** (EBOSS25-25 is a GEN+PM set, needs a 25 PM template) · D7 = **yes** (plain Hydraulic → S) · customer fallback = **hard-flag & skip** (no combo-generic fallback).

**Data setup applied to the live workspace** by `scripts/planning/harden-schedule-import.mjs` (idempotent):
- **W1 ✅** — 4 PM templates retyped `head_unit → power_module` (`70PM`, `220PM`, `400PM`, `500PM`); a stray `SDG150 TRAILER` template retyped `head_unit → trailer`.
- **W2 ✅** — trailer catalog: `E = Electric`, `S = Surge / Hydraulic`.
- **W3 ◑** — 7 generator templates linked to the 70 PM (all 70-series). 25/125 links await their PM templates (D5 skip).

**Resolution logic built (TDD, `src/domain/schedule-import.ts`, 53 unit tests):** `parseModel`, `normalizeCustomer` (whole-word matching for short suffixes — hardened against `DOES`↛OES etc.), `normalizeBrake`, `cleanSo`, `aoStatus`, `isSectionHeaderRow`, `parseGenTemplateName`/`parsePmSize`/`buildTemplateIndex` (flags name↔model combo mismatch), `resolveLine`. Read-only inventory dump: `scripts/planning/inventory-schedule-import.mjs`.

**Dry-run over June** (`scripts/planning/dry-run-schedule-import.ts`, run via `node --experimental-strip-types`): 223 raw rows → **11 section-header rows skipped** → **212 importable → 160 resolved / 52 flagged**, every flag enumerated. Adversarially audited (Fable, 5 lenses); confirmed findings fixed. **Acceptance gate ✓.**

**Residual to-dos (data, not code) before a real import run:**
- Author **25 PM** (37 lines) + **125 PM** (9 lines) templates → clears 46 `pm-template-missing` flags (D5 unblock).
- Add gen variants: **25-25 Kiewit/CAT**, **70-45 Kiewit** (8+8 lines); the **125-65** combo has no gen template (1 line).
- Importer-stage (next spec): **dedup** — one June unit appears on two rows (shared VIN `7H6…869`); the per-line resolver doesn't dedup.

---

## Purpose

The schedule importer will be a thin layer that, for each schedule line, resolves the product,
its templates, its trailer config, and its assembly-order numbers, then creates a GEN/PM/TRL set.
Its correctness depends entirely on the **resolution tables and rules** behind it. Today those are
empty or dirty. This spec defines the prerequisite work so the importer resolves reliably instead
of guessing. **It does not cover the importer UI itself** — that is a later spec built on this
foundation.

## Current state (evidence — June Henderson schedule, 212 lines)

- **0** `power_module`-typed templates · **0** set-definitions (generator→PM links) · **0** trailer configs.
- **Generator (Main) templates exist** for 5 of the 6 hybrid combos present: `25-25, 70-40, 70-45, 70-65, 125-125`. Missing: **`125-65`** (1 unit).
- **PM templates already exist but are mistyped** as `head_unit`: `HEAD UNIT 70PM`, `HEAD UNIT BOSS220PM`, `HEAD UNIT BOSS400PM`, `HEAD UNIT BOSS500PM` → these are the 70 / 220 / 400 / 500 PMs. Missing as templates: **25 PM, 125 PM** (small PMs have no standalone sheet).
- **Templates are customer-scoped**: `HEAD UNIT 25-25 {ES|HERC|Peak|UR}`, `HEAD UNIT 70-45 {HERC|OES|REIC|T-MOBILE}`. Model alone cannot pick one.
- **Customer field is dirty**: 19 spellings for ~10 real customers — `HERC RENTALS`/`HERC Rentals`/`Herc Rentals` (3), `EQUIPMENT SHARE`/`Equipmentshare.com` (2), `Kiewit`/`PETER KIEWIT` (2); location/notes leak into the field (`SACRAMENTO - DUE BY 6/29`).
- **Brake field**: 9 variants → 3 real configs + "none", including encoding garble (`�NA`).

## Workstreams

### W1 — Power Module templates *(prerequisite data)*
The PM half of every set has nothing to build from today.
- **Retype** the 4 existing PM sheets from `head_unit` → `power_module` (`70PM`, `BOSS220PM`, `BOSS400PM`, `BOSS500PM`). No BOM authoring — they already have lines.
- **Author** the 2 missing PM templates: **25 PM** and **125 PM**. Needs BOM source — see Decision D5.
- Keeps the generator templates (`HEAD UNIT xx-yy`) as the Main templates; adds the PM templates they pair to.

### W2 — Trailer config catalog + brake normalization *(prerequisite data + rule)*
- **Catalog: exactly two trailers** (per the shop) — recommend mnemonic letters over arbitrary ones:
  `E = Electric`, `S = Surge / Hydraulic`.
- **Brake-string → letter map**, covering every June value:
  - `Electric`, `Electrical` → **E**
  - `Surge/Hydraulic`, `SURGE`, `Hydraulic` → **S**  *(plain `Hydraulic` — 58 lines — folds into the surge/hydraulic trailer; confirm D7)*
  - `N/A`, `NA`, ``, `�NA` → **none** (no trailer / not applicable — PM lines)
- Optionally link each letter to an `SDG… TRLR` trailer template so trailer restock orders inherit a BOM.

### W3 — Set-definitions *(prerequisite data)*
For each generator (`HEAD UNIT`) template, populate `pm_template_id` + `default_trailer_letter`:
- PM link derived from the combo: `HEAD UNIT {A}-{B}` → PM template = `{A} PM`.
- Default letter is a fallback only; the schedule's brake type overrides per line.

### W4 — Model + customer → template resolution *(rule + data)*
The importer's core lookup. Two-key resolution:
1. **Model → combo**: strip `(E)BOSS`/`Hybrid`, take the first two numbers → `{A}-{B}`.
2. **Customer → template suffix**: a normalization table, many spellings → canonical → suffix.
   - `EQUIPMENT SHARE` / `Equipmentshare.com` → **ES**
   - `HERC RENTALS` / `HERC Rentals` / `Herc Rentals` → **HERC**
   - `United Rentals` → **UR** · `Kiewit` / `PETER KIEWIT` → **Kiewit** · `REIC` → **REIC** · `OES` → **OES**
   - CAT dealers (`Quinn CAT`, `RING POWER- CAT`, `Western States…CAT`) → **CAT** *(no template yet)*
   - Contaminated values (`SACRAMENTO - DUE BY 6/29`, `IWCE tradeshow…`) → strip to real customer or flag
- **Resolution**: `combo + suffix` → head_unit template. **Adopted policy = hard-flag & skip** (supersedes the earlier "combo-generic fallback" idea): no exact `combo+suffix` template → block the line with `no-template-for-customer` (or `no-gen-template-for-combo` if the combo itself is missing). The resolver never borrows another customer's template. A suffix-less generic template (e.g. `HEAD UNIT BOSS125-125`) is therefore currently *not* auto-matched to a named customer; flip that only by an explicit decision.
- **Known coverage gaps to flag, not guess**: combo `125-65` (no template); customers with no variant (`DEVALL DIESEL`, `Paragon`, `Bingham`, `Sunstate`, `Red D Arc`, CAT dealers).

### W5 — Decompose & AO rules *(decisions — see below)*
Confirm the rules the importer applies per line (D1–D6).

## Decisions — RESOLVED 2026-07-07

All resolved (see Progress header): **D1–D4** confirmed as recommended · **D5 = skip** (flag 25/125 PM lines, don't author yet) · **D6 = separate** (25-25 is a GEN+PM set) · **D7 = yes** (Hydraulic → S) · customer fallback = **hard-flag & skip**. The table below is the original recommendation set, retained for rationale.

| # | Decision | Recommendation |
|---|---|---|
| **D1** | Does a hybrid line create GEN + PM orders **and reference a trailer letter** (not create a trailer order)? Trailer orders come only from `SDG…TRLR` lines. | **Yes** — trailers are supermarket stock; a unit references a letter, it doesn't build a trailer. |
| **D2** | Where does **FG SKU AO** land on the Main? Lines carry per-line A#s; there's no order-level A# field today. | Add an **order-level "assembly A#"** field to the Main (shown on the print header), fed by FG SKU AO. Simpler than picking a BOM line. |
| **D3** | Where does **TRAILER AO** land? | On the **trailer supermarket order** for that config (its assembly A#), when one is created from a trailer line — or recorded on the Main as reference. |
| **D4** | Quantity: a line/SO with N units → **N separate sets** (serialized `-01…-0N`) or one order of qty N? | **N separate sets** — serialized matching at final assembly needs distinct set numbers. |
| **D5** | Source of the **25 PM / 125 PM** BOMs (W1)? | Hand-author in the template library, **or** point me at a PM workbook / BC export to import. |
| **D6** | Does the **25-25** unit get a *separate* PM work order at all, or is the 25 PM built into the head unit? (no standalone 25 PM exists) | Confirm per shop reality — drives whether small EBOSS lines are 2-order sets or 1-order. |
| **D7** | Does plain **`Hydraulic`** (58 June lines) map to the **Surge/Hydraulic (S)** trailer? Only two trailers exist, and it isn't Electric — so it should. | **Yes → S.** Confirm, since 58 lines ride on it. |

## Data-quality rules (applied by the importer, defined here)
- **Customer normalization** table (W4) — the largest cleanup; ~19 spellings → ~10 canonicals → suffixes.
- **Brake normalization** (W2).
- **SO# cleaning**: strip trailing transfer text (`S-ORD144307 TO5745` → `S-ORD144307`); treat `NEED`/blank as "no SO — flag".
- **AO status**: `A#####` = ok; `NEED MTS#`/blank = flag "A# to enter"; the 9 flagged June lines are known and acceptable.

## Acceptance criteria — "hardened" means  ✅ MET
Run the June Henderson sheet through the resolution logic as a **dry run (no writes)**. Every line
must either resolve to a **complete set** (generator + PM template + trailer letter + AO status) or
**flag a specific, actionable reason**, and the flagged set must be small, enumerated, understood.

**Result** (`node --experimental-strip-types scripts/planning/dry-run-schedule-import.ts`): 223 raw
rows → 11 section-header rows skipped → **212 importable → 160 resolved / 52 flagged**, 0 silent.
The 52 flags are four buckets, all understood: 46 `pm-template-missing` (25/125 PM unauthored, D5),
16 `no-template-for-customer` (Kiewit/CAT variants), 5 `unrecognized-model` (PDS185EZ/SDG65S), 1
`no-gen-template-for-combo` (125-65). Advisories surfaced separately: 9 `ao-to-enter`, 32
`trailer-letter-unspecified`, 2 `template-model-mismatch` (the 70-45-OES name↔model bug), 18 no-SO.

## What's still needed (to run a real import, not code)
The resolver + gate are done. The remaining work is **data authoring + the importer build**, in order:

1. **Author the two missing PM templates** — `25 PM` (37 lines) and `125 PM` (9 lines). Clears all 46
   `pm-template-missing` flags. This is decision **D5** (deferred as "skip"); needs the BOM source.
2. **Fill the gen-template gaps** — add customer variants `25-25 Kiewit`, `25-25 CAT`, `70-45 Kiewit`
   (16 lines), and create a `125-65` generator template (1 line). Or accept those as hard-flagged.
3. **(optional) 125-125 generic policy** — the suffix-less `HEAD UNIT BOSS125-125` is currently *not*
   auto-matched to CAT (hard-flag & skip). One-line flip in `resolveLine` if generic templates should
   serve any recognized customer. Decision pending.
4. **Fix the `70-45 OES` template** — its `model` column says `BOSS70-40`; confirm/repair the row so
   the `template-model-mismatch` advisory clears.
5. **Re-run the dry-run** after 1–2 to confirm the flagged set shrinks as expected, then **build the
   importer** (next spec — see Out of scope) on top of `resolveLine`.

Regenerate the inventory snapshot after template edits:
`node --env-file=.env.local scripts/planning/inventory-schedule-import.mjs` (read-only) then update
`scripts/planning/template-inventory-snapshot.json`.

## Out of scope
The importer UI/flow (upload → worklist queue → one-line-at-a-time create), and cross-line **dedup**
(one June unit spans two rows, shared VIN — the per-line resolver doesn't dedup). Both belong to the
next spec, built on this foundation now that the dry-run passes.
