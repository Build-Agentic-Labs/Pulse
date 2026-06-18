-- Exploded views are task-level, not per-step. Drop the NOT NULL on step_id so task-level rows store
-- null (the column is kept for historical/forward compatibility; the FK still cascades when a step is
-- referenced). No data is modified.

alter table step_exploded_views alter column step_id drop not null;
