drop view if exists planner_tasks;

create view planner_tasks as
select
  t.*,
  coalesce(
    array_agg(td.predecessor_task_id order by td.created_at) filter (where td.predecessor_task_id is not null),
    '{}'::text[]
  ) as dependency_ids,
  coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'id', ms.id,
          'sequence', ms.sequence,
          'instruction', ms.instruction,
          'durationMinutes', ms.duration_minutes,
          'qualityCheck', ms.quality_check,
          'dependencyIds', ms.dependency_ids
        )
        order by ms.sequence
      )
      from manufacturing_steps ms
      where ms.task_id = t.id
    ),
    '[]'::jsonb
  ) as manufacturing_steps,
  coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'id', pr.id,
          'partNumber', pr.part_number,
          'description', pr.description,
          'quantity', pr.quantity,
          'disposition', pr.disposition
        )
        order by pr.created_at, pr.id
      )
      from part_references pr
      where pr.task_id = t.id
    ),
    '[]'::jsonb
  ) as part_references
from tasks t
left join task_dependencies td on td.successor_task_id = t.id
group by t.id;

notify pgrst, 'reload schema';
