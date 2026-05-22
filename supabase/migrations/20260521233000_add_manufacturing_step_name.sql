alter table manufacturing_steps
add column if not exists name text not null default '';
