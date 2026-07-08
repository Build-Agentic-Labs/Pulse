-- The SOP surface is the "quality" space. space_access.space is CHECK-constrained to the
-- known spaces, so adding a per-space gate for SOPs (matching Planning) requires extending it.
alter table public.space_access drop constraint if exists space_access_known_space;
alter table public.space_access add constraint space_access_known_space
  check (space in ('planning', 'production', 'quality'));
