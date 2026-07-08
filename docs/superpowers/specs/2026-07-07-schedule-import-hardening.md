# Schedule-Import Hardening — Prerequisites for Work-Order Set Generation

**Date:** 2026-07-07
**Status:** Draft for review
**Precedes:** the production-schedule → work-order-set importer (separate spec, not yet written)
**Builds on:** `2026-07-06-work-order-sets-design.md` (shipped), `anacorp-product-nomenclature` (memory)

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
- **Catalog letters** (recommend): `A = Electric brakes`, `B = Surge / Hydraulic`, `C = Hydraulic`.
- **Brake-string → letter map** (with cleaning), covering every June value:
  - `Electric`, `Electrical` → **A**
  - `Surge/Hydraulic`, `SURGE` → **B**
  - `Hydraulic` → **C**
  - `N/A`, `NA`, ``, `�NA` → **none** (no trailer / not applicable — these are PM lines)
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
- **Resolution**: `combo + suffix` → head_unit template. No exact customer match → fall back to any template for that combo (flag "customer-generic"), or flag "no template" if the combo itself is missing.
- **Known coverage gaps to flag, not guess**: combo `125-65` (no template); customers with no variant (`DEVALL DIESEL`, `Paragon`, `Bingham`, `Sunstate`, `Red D Arc`, CAT dealers).

### W5 — Decompose & AO rules *(decisions — see below)*
Confirm the rules the importer applies per line (D1–D6).

## Decisions requiring your input

| # | Decision | Recommendation |
|---|---|---|
| **D1** | Does a hybrid line create GEN + PM orders **and reference a trailer letter** (not create a trailer order)? Trailer orders come only from `SDG…TRLR` lines. | **Yes** — trailers are supermarket stock; a unit references a letter, it doesn't build a trailer. |
| **D2** | Where does **FG SKU AO** land on the Main? Lines carry per-line A#s; there's no order-level A# field today. | Add an **order-level "assembly A#"** field to the Main (shown on the print header), fed by FG SKU AO. Simpler than picking a BOM line. |
| **D3** | Where does **TRAILER AO** land? | On the **trailer supermarket order** for that config (its assembly A#), when one is created from a trailer line — or recorded on the Main as reference. |
| **D4** | Quantity: a line/SO with N units → **N separate sets** (serialized `-01…-0N`) or one order of qty N? | **N separate sets** — serialized matching at final assembly needs distinct set numbers. |
| **D5** | Source of the **25 PM / 125 PM** BOMs (W1)? | Hand-author in the template library, **or** point me at a PM workbook / BC export to import. |
| **D6** | Does the **25-25** unit get a *separate* PM work order at all, or is the 25 PM built into the head unit? (no standalone 25 PM exists) | Confirm per shop reality — drives whether small EBOSS lines are 2-order sets or 1-order. |

## Data-quality rules (applied by the importer, defined here)
- **Customer normalization** table (W4) — the largest cleanup; ~19 spellings → ~10 canonicals → suffixes.
- **Brake normalization** (W2).
- **SO# cleaning**: strip trailing transfer text (`S-ORD144307 TO5745` → `S-ORD144307`); treat `NEED`/blank as "no SO — flag".
- **AO status**: `A#####` = ok; `NEED MTS#`/blank = flag "A# to enter"; the 9 flagged June lines are known and acceptable.

## Acceptance criteria — "hardened" means
Run the June Henderson sheet through the resolution logic as a **dry run (no writes)**. Every line
must either:
1. resolve to a **complete set** — generator template + PM template + trailer letter + AO status, **or**
2. **flag a specific, actionable reason** (missing template for combo X, unknown customer Y, A# to enter).

And the flagged set is **small, enumerated, and understood** — we can point at each flagged line and
say why. Target from today's data: the ~1 missing combo (`125-65`), the handful of no-template
customers, and the 9 missing-AO lines — nothing resolving silently wrong.

## Out of scope
The importer UI/flow (upload → worklist queue → one-line-at-a-time create). That is the next spec,
built once this foundation passes the dry-run.

## Sequence
W1–W3 are data setup (partly parallel). W4–W5 are rules/decisions, pinnable now. Land D1–D6, do
W1–W3, encode W4's tables, then a **dry-run validator over the June file** proves readiness → build
the importer.
