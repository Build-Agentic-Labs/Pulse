# Smart Allocation Status

Last updated: May 13, 2026

## Status

Smart Allocation is marked complete for the current product-planning version.

The current implementation is good enough to support manual headcount planning, run an IE-style smart allocation pass, reject invalid assignments, and expose unresolved staffing exceptions in the UI for review.

## Current Operating Model

- Manual assignment remains the base workflow.
- Smart Allocation is a reset-and-rebuild workflow. It clears current operator selections and proposes a fresh headcount plan.
- Smart Allocation uses the IE agent path through `/api/smart-allocation`.
- The IE agent receives the current Gantt tasks, available operators, takt, demand, target labor content, budgeted crew equivalent, physical staffing requirement, and operator capacity basis.
- The app validates the returned allocation before applying it.
- Invalid agent output is rejected and does not update the Gantt.
- Unallocated required work is surfaced as a planning exception instead of being hidden.

## Completed Capabilities

- Budgeted crew logic uses industry language:
  - Net Available Time
  - Takt Time
  - Target Labor Content
  - Budgeted Crew Equivalent
  - Whole-Person Staffing Requirement
  - Peak Manpower
  - Planned Labor Load
  - Labor Variance
  - Crew Utilization
- Setup includes meetings and planned downtime as net-time inputs.
- Operators are visualized with compact lettered person icons.
- Task rows allow manual operator selection.
- Selected operators feed task headcount and planned MH.
- Zone headcount is based on actual task/operator assignments, not a sum of sequential task rows.
- Operators are blocked from overlapping assignments.
- Operator period capacity is checked against demand-period capacity.
- Smart Allocation audit packet can be copied for review.
- Themed notification modal summarizes allocation results.
- Planning recommendations now show in the Crew Plan card for unallocated required work.
- The recommendation UI includes:
  - task
  - classification
  - condition
  - impact
  - recommended fix
  - action label
  - Review task button

## Validation Rules

The allocation is considered valid only when:

- No operator is assigned to overlapping task windows.
- No operator exceeds physical period capacity.
- Summary rows do not receive operator assignments.
- Task-level headcount matches selected operators.
- Zone headcount is derived from peak simultaneous assigned operators.

The allocation may still be applied with review items when:

- A task exceeds takt.
- Planned labor is above target.
- Required work remains unallocated but the unallocated work is explicitly shown as an exception.

## Known Gaps

- Smart Allocation assigns headcount only. It does not automatically change task timing, split tasks, or redesign the Gantt.
- Required but unallocated work is identified, but the recommended actions are not yet one-click actions.
- No skill matrix is modeled yet. Operators are treated as interchangeable.
- No certification, tooling, station access, or ergonomic constraints are modeled.
- No shift-level or day-level calendar is modeled beyond net available time for the demand period.
- No partial-shift availability or planned absence model exists.
- The IE agent can reason about the plan, but deterministic validation still controls whether the plan is accepted.
- The current smart allocation strategy is not guaranteed to find a mathematically optimal global balance.
- Audit history is not persisted as a separate record.
- The planning recommendations panel has code/build verification, but no automated visual regression test yet.

## Future Improvement Path

The next practical layer should be exception resolution, not deeper prompt tuning.

Recommended next actions:

1. Add one-click planning actions for unallocated required work:
   - split task
   - move task after blocker
   - add operator capacity
   - mark as dedicated resource work
2. Add operator skills and constraints.
3. Add a true capacity review view by operator and time window.
4. Persist allocation audit runs so plans can be compared.
5. Add visual tests for the Crew Plan recommendation UI.

## Current Decision

Stop active iteration on Smart Allocation for now.

Use the current version as the baseline and move forward with the broader planning workflow.
