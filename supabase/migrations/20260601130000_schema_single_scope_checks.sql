-- Schema integrity (audit #14-A): a document_type_code and a custom_column must each belong to
-- EXACTLY ONE scope, never both.
--
-- The original CHECKs only required "at least one" FK to be set:
--   document_type_codes: check (project_id is not null or product_id is not null)
--   custom_columns:      check (product_id is not null or scenario_id is not null)
-- so a row with BOTH set was allowed but semantically ambiguous -- the RLS project-resolvers
-- (document_type_code_project_id / custom_column_project_id) silently COALESCE-prefer one FK and
-- ignore the other, which can place the row's access scope on a different project than intended.
--
-- num_nonnulls(a, b) = 1 enforces exactly-one (which also implies the original "at least one").
-- Verified 0 existing rows violate this, so ADD CONSTRAINT validates cleanly. Additive and
-- non-destructive: no row is changed; the statement fails (and rolls back) if any row violated.

alter table document_type_codes
  add constraint document_type_codes_single_scope
  check (num_nonnulls(project_id, product_id) = 1);

alter table custom_columns
  add constraint custom_columns_single_scope
  check (num_nonnulls(product_id, scenario_id) = 1);
