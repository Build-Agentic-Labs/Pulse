# Manufacturing Line Development Gantt App — Product Requirements & Build Specification

## 1. Product Vision

Build a manufacturing planning application that uses a Gantt-chart-based line development system to design, simulate, measure, and improve the production flow for a specific product.

This is not a generic project management Gantt chart. The app is for manufacturing process engineering, production planning, line balancing, takt-time planning, cycle-time tracking, labor planning, and KPI control.

The top-level object in the app is the **Product**.

For each product, the user should be able to define:

- Product name
- Product model or SKU
- Production man-hour target
- Customer demand
- Available production time
- Required takt time
- Expected cycle times
- Labor assumptions
- Station sequence
- Task sequence
- Task dependencies
- Parallel work
- Critical path
- Bottlenecks
- Capacity gaps
- Target vs actual performance
- Playback simulation of how the line flows over time

The goal is to let the user develop the production line for a product before the line is built, then use the same structure to measure the real line once production starts.

---

## 2. Core Problem Being Solved

Manufacturing teams often build schedules, work instructions, manpower plans, and production targets in separate files. This creates a disconnect between:

- Product demand
- Takt time
- Cycle time
- Labor loading
- Station balance
- Man-hour targets
- Production sequence
- Real performance
- Bottlenecks
- Rework or downtime impact

This app should combine all of those into one visual planning system.

The Gantt chart becomes the production line model.

Instead of only showing dates and project tasks, the chart should show the manufacturing flow of one product through stations, tasks, operators, resources, constraints, and time.

---

## 3. Research-Validated Manufacturing Logic

### 3.1 Gantt Chart Logic

A Gantt chart is a timeline-based planning tool. It normally displays tasks on one axis and time on the other. Each task is represented by a horizontal bar whose length represents duration.

For manufacturing line planning, the Gantt chart should support:

- Task start and finish times
- Task durations
- Task sequencing
- Dependencies between tasks
- Milestones
- Progress completion
- Parallel activities
- Resource assignments
- Bottleneck visibility
- Critical path visibility
- Planned vs actual timing
- Delays and downstream impact

In this application, the Gantt chart should be treated as both:

1. A **process design tool** for building the production flow.
2. A **production control tool** for comparing target flow against actual execution.

### 3.2 Manufacturing Application of a Gantt Chart

For manufacturing, a Gantt chart can be used to visualize:

- Product build sequence
- Station sequence
- Work package sequence
- Labor requirements by station
- Shared resource conflicts
- Parallel work opportunities
- Waiting time
- Queue time
- Inspection gates
- Material readiness gates
- Rework loops
- Changeover events
- Shift boundaries
- Line capacity
- Bottlenecks

The chart should help answer:

- What needs to be done?
- In what order?
- How long should each task take?
- Which tasks can run in parallel?
- Which tasks must wait on other tasks?
- Who is assigned?
- What station owns the work?
- What is the expected labor content?
- What happens if one task is late?
- Does the line meet takt?
- Does the total labor fit the man-hour target?

### 3.3 Takt Time Logic

Takt time is the pace required to meet demand.

Formula:

```text
Takt Time = Available Production Time / Customer Demand
```

Example:

```text
Available production time per day = 480 minutes
Demand per day = 4 units
Takt time = 480 / 4 = 120 minutes per unit
```

This means the production system must complete one unit every 120 minutes to meet demand.

### 3.4 Cycle Time Logic

Cycle time is the actual or planned time required to complete a task, station, process, or unit.

The app should track cycle time at multiple levels:

- Task cycle time
- Station cycle time
- Product cycle time
- Operator cycle time
- Actual cycle time
- Planned cycle time
- Average cycle time
- Best observed cycle time
- Worst observed cycle time

### 3.5 Lead Time Logic

Lead time is the total time from start to finish. For this app, lead time can be shown as:

- Total product build lead time
- Time from first task start to final task completion
- Time from order release to production completion
- Time including queue/wait time
- Time excluding queue/wait time

### 3.6 Man-Hour Logic

Man-hours measure labor content.

Formula:

```text
Task Man-Hours = Task Duration in Hours × Number of Operators
```

Example:

```text
Task duration = 2.5 hours
Operators = 3
Task man-hours = 2.5 × 3 = 7.5 man-hours
```

Product-level man-hour target:

```text
Product Man-Hour Variance = Actual Product Man-Hours - Target Product Man-Hours
```

Man-hour efficiency:

```text
Man-Hour Efficiency % = Target Man-Hours / Actual Man-Hours × 100
```

If target is 100 man-hours and actual is 125 man-hours:

```text
Efficiency = 100 / 125 × 100 = 80%
```

---

## 4. Primary User

The main user is a manufacturing, industrial engineering, process engineering, or operations leader who wants to design and control a production line.

The user needs to:

- Build a product-level process model
- Define all manufacturing stations
- Assign tasks to stations
- Define standard times
- Define required operators
- Set takt-time targets
- Set product man-hour targets
- Simulate line flow
- See bottlenecks
- Adjust tasks and labor
- Compare plan vs actual
- Improve the line over time

---

## 5. App Name Options

Possible names:

- LineLogic
- BuildFlow
- TaktBoard
- FlowForge
- LineBuilder
- Manufacturing Flow Planner
- Product Line Gantt
- Factory Flow Designer
- BuildLogic Line Planner

Recommended working name:

```text
BuildLogic Line Planner
```

---

## 6. Top-Level Data Hierarchy

The top-level object is the **Product**.

```text
Product
  └── Product Revision
        └── Production Scenario
              └── Line Plan
                    └── Area / Department
                          └── Station
                                └── Work Package
                                      └── Task
                                            └── Subtask / Step
```

### 6.1 Product

A product is the main item being manufactured.

Example:

```text
Product: Hybrid Generator Model X
Product Type: Generator / Hybrid Conversion
Target Man-Hours: 140
Demand: 2 units per day
Available Time: 900 minutes per day
Required Takt Time: 450 minutes per unit
```

### 6.2 Product Revision

The user should be able to maintain versions.

Example:

```text
Product: Hybrid Generator Model X
Revision: Rev A
Revision Date: 2026-05-07
Status: Draft
```

Revision statuses:

- Draft
- In Review
- Approved
- Released
- Obsolete

### 6.3 Production Scenario

A product can have multiple planning scenarios.

Examples:

- Prototype build
- Low-rate production
- Full-rate production
- One-shift plan
- Two-shift plan
- 5 units per week
- 1 unit per day
- 2 units per day
- Future-state line
- Current-state line

### 6.4 Line Plan

The line plan contains the Gantt chart and station structure.

A product can have multiple line plans.

Example:

```text
Line Plan: Hybrid Conversion Disassembly Lane
Goal: Develop one-piece-flow disassembly process
Target Output: 1 completed donor unit per day
```

### 6.5 Station

A station is a defined area of work in the production flow.

Example stations:

- Fluid Drain, LOTO & Safe Teardown Prep
- Electrical Disconnect, Labeling & Control Cabinet Recovery
- Cooling, Aftertreatment & Accessory Removal
- Engine / Alternator Coupled Module Removal
- Fuel Tank & Containment Tank Reorientation
- Panel Recovery, Rework & Service Parts Station
- Hybrid Base / Battery Pack Assembly
- Electric Motor Integration & Precision Alignment
- Final Test & Inspection

### 6.6 Work Package

A work package is a group of related tasks inside a station.

Example:

```text
Station: Fuel Tank & Containment Tank Reorientation
Work Package: Rotate Fuel Tank 180 Degrees
```

### 6.7 Task

A task is the smallest schedulable Gantt object.

Example:

```text
Task: Remove 6 bolts and 2 nuts from SDG125 base to containment tank
Duration: 20 minutes
Operators: 1
Station: Fuel Tank & Containment Tank Reorientation
Dependency: Engine / Alternator Coupled Module Removed
```

---

## 7. Key Product-Level Inputs

Every product should have a product setup panel with the following fields.

### 7.1 Product Identity Fields

| Field | Description |
|---|---|
| Product Name | Name of product |
| Product Code / SKU | Internal product identifier |
| Product Family | Product grouping |
| Product Revision | Revision or version |
| Product Description | Short explanation |
| Product Owner | Responsible engineer or manager |
| Status | Draft, Approved, Released, Obsolete |
| Effective Date | Date this product plan becomes active |

### 7.2 Production Target Fields

| Field | Description |
|---|---|
| Target Man-Hours | Total labor target for one finished unit |
| Target Build Time | Planned elapsed time from start to finish |
| Target Takt Time | Required production pace |
| Target Throughput | Units per day, week, or month |
| Customer Demand | Required quantity over a time period |
| Available Production Time | Usable production time after breaks, meetings, downtime allowance |
| Shift Length | Total scheduled shift length |
| Number of Shifts | Shifts per day |
| Planned Operators | Total planned labor |
| Efficiency Target | Expected labor efficiency |
| First Pass Yield Target | Quality target |
| Rework Allowance | Expected rework time percentage |
| Downtime Allowance | Expected downtime percentage |

### 7.3 Takt-Time Inputs

| Field | Description |
|---|---|
| Demand Quantity | Number of units required |
| Demand Period | Day, week, month, custom |
| Gross Available Time | Total scheduled time |
| Break Time | Non-working time |
| Meeting Time | Startup meetings, safety meetings, etc. |
| Planned Downtime | Maintenance, changeover, known constraints |
| Net Available Time | Gross time minus unavailable time |
| Calculated Takt Time | Net available time divided by demand |
| Manual Takt Override | Optional user override |
| Takt Unit | Minutes/unit, hours/unit, days/unit |

### 7.4 Man-Hour Inputs

| Field | Description |
|---|---|
| Target Man-Hours per Unit | Desired labor target |
| Planned Man-Hours per Unit | Sum of planned task labor |
| Actual Man-Hours per Unit | Actual recorded labor |
| Man-Hour Variance | Actual minus target |
| Man-Hour Efficiency | Target divided by actual |
| Labor Rate | Optional cost calculation |
| Labor Cost Target | Target man-hours multiplied by labor rate |
| Labor Cost Actual | Actual man-hours multiplied by labor rate |

---

## 8. Main App Modules

The app should have the following main modules.

```text
1. Product Dashboard
2. Product Setup
3. Line Plan Builder
4. Gantt Chart View
5. Station Balance View
6. Takt & Capacity Calculator
7. Man-Hour Target Manager
8. Playback / Simulation Mode
9. KPI Dashboard
10. Actuals Tracking
11. Custom Columns Manager
12. Reports & Exports
13. Settings
```

---

## 9. Product Dashboard

The product dashboard should show all products and their current line-development status.

### 9.1 Product Dashboard Cards

Each product card should show:

- Product name
- Product revision
- Product status
- Target man-hours
- Planned man-hours
- Actual man-hours
- Takt time
- Demand
- Available time
- Number of stations
- Number of tasks
- Current bottleneck station
- Line balance score
- Last updated date
- Owner

### 9.2 Product Dashboard Table Columns

Default columns:

| Column | Description |
|---|---|
| Product | Product name |
| Rev | Revision |
| Status | Draft / Released / Obsolete |
| Demand | Required output |
| Available Time | Net available production time |
| Takt Time | Required pace |
| Target MH | Target man-hours |
| Planned MH | Planned man-hours |
| Actual MH | Actual man-hours |
| Variance | Actual minus target |
| Bottleneck | Station with highest cycle time |
| Balance Score | How evenly work is distributed |
| Owner | Responsible person |
| Updated | Last updated date |

### 9.3 Dashboard Filters

Filters:

- Product family
- Product owner
- Product status
- Product revision
- Demand scenario
- Released only
- Draft only
- Over target man-hours
- Under takt
- Bottleneck present
- Missing cycle times
- Missing labor assignments

---

## 10. Product Setup Screen

The product setup screen should be where the user enters product-level targets.

### 10.1 Sections

```text
Product Identity
Production Demand
Available Time
Takt Time
Man-Hour Target
Quality Targets
Labor Assumptions
Scenario Settings
```

### 10.2 Takt Calculator

The user should be able to enter:

```text
Demand = 10 units per week
Available production time = 45 hours per week
Breaks = 5 hours per week
Meetings = 2.5 hours per week
Planned downtime = 2.5 hours per week
Net available time = 35 hours per week
Takt time = 35 / 10 = 3.5 hours per unit
```

The app should show:

```text
Required Takt: 3.5 hours per unit
Equivalent: 210 minutes per unit
Required Output Rate: 0.286 units per hour
```

### 10.3 Takt Status

The app should compare planned production capability to required takt.

Statuses:

| Status | Meaning |
|---|---|
| Green | Planned line meets or beats takt |
| Yellow | Planned line is within tolerance |
| Red | Planned line cannot meet takt |
| Gray | Missing data |

### 10.4 Product Man-Hour Target

The user should be able to set a target such as:

```text
Target Man-Hours per Product: 120
```

The app should calculate planned man-hours by summing all tasks:

```text
Planned Man-Hours = SUM(Task Duration × Operators)
```

Then show:

```text
Target Man-Hours: 120
Planned Man-Hours: 138
Variance: +18
Variance %: +15%
Status: Over Target
```

---

## 11. Gantt Chart View

The Gantt chart is the core view.

### 11.1 Gantt Layout

The Gantt should have:

```text
Left Table Panel + Right Timeline Panel
```

Left table:

- Product
- Station
- Work package
- Task
- Duration
- Operators
- Man-hours
- Start
- Finish
- Dependencies
- Status
- Owner
- Custom columns

Right timeline:

- Horizontal bars
- Time scale
- Dependencies
- Milestones
- Current time marker
- Planned vs actual overlays
- Baseline view
- Critical path highlight
- Bottleneck highlight
- Shift boundaries
- Takt markers

### 11.2 Timeline Scales

The timeline should support:

- Minutes
- Hours
- Shifts
- Days
- Weeks
- Months

Manufacturing line planning should default to minutes or hours, not months.

### 11.3 Gantt Row Types

The Gantt should support multiple row types.

| Row Type | Description |
|---|---|
| Product Summary Row | Top-level product row |
| Scenario Row | Planning scenario |
| Area Row | Manufacturing area |
| Station Row | Workstation or process area |
| Work Package Row | Group of tasks |
| Task Row | Schedulable work item |
| Milestone Row | Gate or key event |
| Inspection Row | Quality checkpoint |
| Material Gate Row | Material readiness check |
| Hold Row | Planned wait or queue time |
| Rework Row | Rework loop |
| Buffer Row | Planned buffer |

### 11.4 Product Summary Row

The product row should summarize:

- Product duration
- Total planned man-hours
- Total actual man-hours
- Takt status
- Bottleneck
- Percent complete
- Total tasks
- Number of incomplete tasks
- Number of tasks over cycle time
- Critical path length

### 11.5 Station Rows

Station rows should show:

- Station name
- Station sequence number
- Planned station cycle time
- Actual station cycle time
- Station man-hours
- Operators assigned
- Station takt status
- Station WIP limit
- Station owner
- Station readiness status

### 11.6 Task Bars

Task bars should visually represent:

- Planned start
- Planned finish
- Actual start
- Actual finish
- Percent complete
- Delay
- Early finish
- Overrun
- Assigned station
- Assigned operator count
- Dependency status
- Constraint status

### 11.7 Milestones

Milestones should represent gates such as:

- Product released to production
- Materials ready
- Station complete
- Quality gate passed
- Traveler signed
- Unit released to next station
- Final inspection complete
- Product shipped

### 11.8 Dependencies

The app should support:

| Dependency Type | Meaning |
|---|---|
| Finish-to-Start | Task B cannot start until Task A finishes |
| Start-to-Start | Task B can start when Task A starts |
| Finish-to-Finish | Task B cannot finish until Task A finishes |
| Start-to-Finish | Rare, but supported if needed |

The most common manufacturing dependency should be finish-to-start.

Example:

```text
Electrical Disconnect cannot begin until Fluid Drain, LOTO & Safe Teardown Prep is complete.
```

### 11.9 Manufacturing-Specific Dependency Rules

The app should also support manufacturing constraints:

- Safety gate dependency
- Quality gate dependency
- Material availability dependency
- Tooling availability dependency
- Fixture availability dependency
- Labor availability dependency
- Inspection approval dependency
- Engineering release dependency
- Traveler signoff dependency

---

## 12. Gantt Manufacturing Columns

The Gantt table should support standard columns and custom columns.

### 12.1 Default Required Columns

| Column | Type | Description |
|---|---|---|
| WBS | Text | Work breakdown structure number |
| Row Type | Select | Product, Station, Task, Milestone, etc. |
| Product | Text | Product name |
| Product Rev | Text | Product revision |
| Scenario | Text | Planning scenario |
| Station # | Number | Station sequence |
| Station Name | Text | Manufacturing station |
| Work Package | Text | Grouping of tasks |
| Task Name | Text | Task description |
| Task Description | Long Text | Detailed explanation |
| Planned Duration | Duration | Planned cycle time |
| Actual Duration | Duration | Actual cycle time |
| Duration Variance | Formula | Actual minus planned |
| Operators | Number | Number of operators assigned |
| Planned Man-Hours | Formula | Planned duration × operators |
| Actual Man-Hours | Formula | Actual duration × actual operators |
| Man-Hour Variance | Formula | Actual MH minus planned MH |
| Planned Start | Date/Time | Planned start time |
| Planned Finish | Date/Time | Planned finish time |
| Actual Start | Date/Time | Actual start time |
| Actual Finish | Date/Time | Actual finish time |
| Status | Select | Not Started, In Progress, Complete, Hold |
| Percent Complete | Percent | Completion percentage |
| Owner | Person | Responsible person |
| Role | Text | Required role or skill |
| Skill Level | Select | Apprentice, Trained, Certified, Expert |
| Dependencies | Relation | Linked predecessor tasks |
| Successors | Relation | Linked successor tasks |
| Constraint | Select | Safety, Material, Labor, Quality, Tooling |
| Constraint Notes | Long Text | Explanation of constraint |
| Critical Path | Boolean | Whether task is on critical path |
| Bottleneck Flag | Boolean | Whether task or station is a bottleneck |
| Quality Gate | Boolean | Whether task requires QC signoff |
| Traveler Signoff | Boolean | Whether traveler signoff is required |
| SOP Link | URL/File | Standard operating procedure |
| Work Instruction Link | URL/File | Detailed work instruction |
| Drawing Link | URL/File | Engineering drawing |
| Material Kit | Text | Required material kit |
| Tools Required | Text/List | Required tools |
| Equipment Required | Text/List | Fixtures, cranes, jigs, etc. |
| Safety Notes | Long Text | Safety requirements |
| QC Checklist | Text/File | Inspection checklist |
| Rework Risk | Select | Low, Medium, High |
| Notes | Long Text | General notes |

### 12.2 Custom Columns

The user should be able to create custom columns at any level.

Supported custom column types:

- Text
- Long text
- Number
- Currency
- Percent
- Duration
- Date
- Date/time
- Checkbox
- Select
- Multi-select
- Person
- Formula
- URL
- File attachment
- Relation
- Rollup
- Status
- Rating
- Risk score

### 12.3 Custom Column Settings

Each custom column should allow:

- Column name
- Column type
- Description
- Required or optional
- Default value
- Allowed values
- Formula expression
- Unit of measure
- Decimal precision
- Visibility
- Locking
- Permission control
- Apply to product only
- Apply to station only
- Apply to task only
- Apply to all row types

### 12.4 Manufacturing Custom Column Examples

Examples of custom columns:

| Column | Type | Example |
|---|---|---|
| Torque Spec | Text | 85 ft-lb |
| Bolt Count | Number | 6 |
| Nut Count | Number | 2 |
| Fixture ID | Text | JIG-004 |
| Crane Required | Checkbox | Yes |
| QC Hold Reason | Long Text | Missing inspection signoff |
| Material Status | Select | Ready, Short, Backordered |
| Part Disposition | Select | Reuse, Rework, Service Part, QC Hold |
| Serial Number Required | Checkbox | Yes |
| Photo Required | Checkbox | Yes |
| LOTO Required | Checkbox | Yes |
| Fluid Controlled | Checkbox | Yes |
| Traveler Gate | Select | Not Required, Required, Complete |
| Engineering Approval | Select | Pending, Approved, Rejected |
| Risk Level | Select | Low, Medium, High |
| Cost Center | Text | Assembly |
| Labor Code | Text | MECH-01 |

---

## 13. Playback / Simulation Mode

The app must include a playback mode that simulates the production flow over time.

This is one of the most important features.

The user wants to visually watch the line run.

### 13.1 Purpose of Playback Mode

Playback mode should let the user see:

- When each task starts
- When each task finishes
- How stations become active
- Where work waits
- Where bottlenecks appear
- How many operators are needed at each moment
- How WIP moves through the line
- Whether the product can meet takt
- Whether the planned line fits available labor
- How delays affect downstream tasks
- How parallel work changes the total timeline

### 13.2 Playback Modes

The app should support:

| Mode | Description |
|---|---|
| Planned Playback | Simulates planned schedule |
| Actual Playback | Replays actual production history |
| Baseline Playback | Shows original released plan |
| Scenario Playback | Simulates a future-state plan |
| Comparison Playback | Plays planned and actual together |
| Bottleneck Playback | Focuses on blocked or delayed tasks |
| Labor Playback | Shows labor loading over time |
| Station Playback | Shows station activity over time |

### 13.3 Playback Controls

Controls:

- Play
- Pause
- Stop
- Restart
- Step forward
- Step backward
- Jump to start
- Jump to end
- Jump to selected task
- Jump to next bottleneck
- Jump to next milestone
- Jump to next delay
- Loop playback
- Playback speed selector

### 13.4 Playback Speed

Playback speed should be highly flexible.

The user should be able to choose speed using preset buttons and custom settings.

Recommended playback speed presets:

| Speed | Meaning |
|---|---|
| 0.25x | Very slow review |
| 0.5x | Slow review |
| 1x | Normal simulation |
| 2x | Fast simulation |
| 5x | Rapid review |
| 10x | High-speed review |
| 25x | Shift-level review |
| 50x | Day-level review |
| 100x | Full-line fast forward |
| Custom | User-defined speed |

### 13.5 Manufacturing Time Compression

The app should also allow manufacturing-based playback settings.

Example:

```text
1 real second = 1 production minute
1 real second = 5 production minutes
1 real second = 15 production minutes
1 real second = 1 production hour
1 real second = 1 production shift
```

Recommended UI:

```text
Playback Speed:
[ 1 sec = 1 min ] [ 1 sec = 5 min ] [ 1 sec = 15 min ] [ 1 sec = 1 hr ] [ Custom ]
```

### 13.6 Custom Playback Speed Formula

User can define:

```text
Real Seconds : Production Time
```

Examples:

```text
1 second = 10 minutes
3 seconds = 1 hour
10 seconds = 1 shift
```

### 13.7 Playback Timeline Indicator

The Gantt chart should show a vertical moving line representing current playback time.

The playback line should move across the timeline while tasks become active or complete.

### 13.8 Task Visual States During Playback

Task states:

| State | Visual Behavior |
|---|---|
| Not Started | Muted |
| Ready | Highlighted outline |
| Blocked | Red outline |
| In Progress | Active color / animation |
| Complete | Filled or checked |
| Late | Red overrun |
| Early | Green finish |
| Waiting | Yellow hold state |
| QC Hold | Purple or warning state |

### 13.9 Station Visual States During Playback

Station states:

| State | Meaning |
|---|---|
| Idle | No active work |
| Active | Station is working |
| Blocked | Waiting on dependency |
| Starved | No incoming work |
| Overloaded | More work than capacity |
| Complete | Station complete |
| QC Hold | Waiting on inspection |

### 13.10 Playback Side Panel

During playback, a side panel should show:

- Current simulation time
- Active product
- Active station
- Active tasks
- Operators currently needed
- Operators available
- Labor gap
- Current bottleneck
- WIP count
- Tasks blocked
- Tasks complete
- Next milestone
- Takt status
- Man-hour consumed so far
- Expected finish time

### 13.11 Playback KPI Strip

At the top of playback mode, show:

```text
Elapsed Build Time
Required Takt
Current Cycle Time
Operators Active
Man-Hours Consumed
Bottleneck Station
Tasks Complete
Tasks Late
Projected Finish
```

### 13.12 Playback Event Log

Playback should create a running event log.

Example:

```text
00:00 - Product build started
00:15 - LOTO complete
00:45 - Fluid control complete
01:00 - Electrical disconnect started
02:30 - Control cabinet removed
02:45 - Cooling removal started
04:10 - Engine/alternator module removed
05:00 - Fuel tank rotation started
06:20 - Containment package complete
```

### 13.13 Playback What-If Adjustments

While paused, the user should be able to adjust:

- Task duration
- Operator count
- Start time
- Dependency
- Station assignment
- Work sequence
- Parallel work
- Added buffer
- Removed buffer
- Inspection gate
- Material delay
- Labor shortage

Then replay the scenario.

---

## 14. Station Balance View

The station balance view should show whether work is evenly distributed across the line.

### 14.1 Station Balance Chart

Show each station as a bar.

Each bar should include:

- Planned cycle time
- Actual cycle time
- Takt time line
- Labor count
- Man-hours
- Variance from takt

### 14.2 Station Balance Status

| Status | Meaning |
|---|---|
| Under Takt | Station can keep pace |
| At Takt | Station matches required pace |
| Over Takt | Station is a bottleneck |
| Missing Data | Cycle time not defined |

### 14.3 Balance Score

Suggested formula:

```text
Line Balance Score = Sum of Station Work Content / (Bottleneck Cycle Time × Number of Stations)
```

Example:

```text
Total station work content = 400 minutes
Bottleneck station = 100 minutes
Number of stations = 5
Line balance score = 400 / (100 × 5) = 80%
```

The higher the balance score, the more evenly distributed the work is.

### 14.4 Bottleneck Detection

A bottleneck should be flagged when:

```text
Station Cycle Time > Takt Time
```

or when:

```text
Station Cycle Time = Highest Cycle Time in the line
```

or when:

```text
Station causes downstream waiting or upstream WIP buildup
```

---

## 15. Takt & Capacity Calculator

The app should include a calculator for production targets.

### 15.1 Required Inputs

```text
Demand quantity
Demand period
Shift length
Number of shifts
Breaks
Meetings
Planned downtime
Efficiency assumption
Number of operators
Target man-hours
```

### 15.2 Calculated Outputs

```text
Gross available time
Net available time
Required takt time
Required units per hour
Required units per shift
Required units per day
Available labor hours
Available man-hours
Planned man-hour usage
Labor gap
Capacity gap
Bottleneck station
```

### 15.3 Capacity Formula

```text
Available Man-Hours = Net Available Production Hours × Number of Operators
```

### 15.4 Demand Capacity Formula

```text
Required Man-Hours = Demand × Target Man-Hours per Unit
```

### 15.5 Capacity Gap

```text
Capacity Gap = Available Man-Hours - Required Man-Hours
```

If negative, the line does not have enough labor capacity.

---

## 16. Man-Hour Target Manager

The app should include a dedicated man-hour target manager.

### 16.1 Product-Level Man-Hour Target

Each product should have a target.

Example:

```text
Product: Hybrid Generator
Target Man-Hours: 140
```

### 16.2 Station-Level Allocation

The product target should be broken down by station.

Example:

| Station | Target MH | Planned MH | Actual MH | Variance |
|---|---:|---:|---:|---:|
| Fluid Drain & LOTO | 8 | 7.5 | 8.2 | +0.2 |
| Electrical Recovery | 18 | 20 | 22 | +4 |
| Cooling Removal | 20 | 19 | 21 | +1 |
| Engine Module Removal | 14 | 13 | 15 | +1 |
| Fuel Tank Reorientation | 10 | 11 | 12 | +2 |
| Panel Recovery | 30 | 32 | 35 | +5 |
| Hybrid Base Assembly | 40 | 42 | 45 | +5 |

### 16.3 Man-Hour Waterfall

The app should show a waterfall from target to actual:

```text
Target MH
+ Additional rework
+ Downtime
+ Missing material
+ Extra labor
- Improvements
= Actual MH
```

### 16.4 Man-Hour Variance Reasons

Variance categories:

- Rework
- Waiting on material
- Waiting on engineering
- Waiting on QC
- Missing tools
- Untrained operator
- Poor work instruction
- Design issue
- Supplier issue
- Equipment downtime
- Safety issue
- Layout issue
- Excess walking
- Excess handling
- Overprocessing

---

## 17. KPI Dashboard

The KPI dashboard should summarize production line health.

### 17.1 Product-Level KPIs

| KPI | Formula / Meaning |
|---|---|
| Takt Time | Available time / demand |
| Planned Cycle Time | Planned elapsed build time |
| Actual Cycle Time | Actual elapsed build time |
| Lead Time | Start-to-finish time |
| Target Man-Hours | Product labor target |
| Planned Man-Hours | Sum of planned task labor |
| Actual Man-Hours | Actual recorded labor |
| Man-Hour Variance | Actual minus target |
| Labor Efficiency | Target MH / Actual MH |
| Throughput | Units completed per period |
| Capacity Gap | Available MH minus required MH |
| Bottleneck Station | Station with highest constraint |
| First Pass Yield | Units passing without rework |
| Rework Hours | Total rework labor |
| Schedule Adherence | Completed on or before plan |
| On-Time Completion | Percent completed by required date |
| WIP | Units currently in process |
| Line Balance Score | Balance of station workloads |

### 17.2 Station-Level KPIs

| KPI | Meaning |
|---|---|
| Station Cycle Time | Time to complete station work |
| Station Man-Hours | Labor used by station |
| Operator Utilization | Productive time / available time |
| Waiting Time | Time station is blocked or idle |
| Rework Time | Time spent correcting defects |
| QC Failures | Number of quality failures |
| Takt Variance | Station CT minus takt |
| Bottleneck Frequency | How often station becomes bottleneck |

### 17.3 Task-Level KPIs

| KPI | Meaning |
|---|---|
| Planned Duration | Expected task time |
| Actual Duration | Actual task time |
| Duration Variance | Actual minus planned |
| Planned MH | Planned labor |
| Actual MH | Actual labor |
| Task Completion Rate | Completion performance |
| Rework Occurrence | Whether task caused rework |
| Dependency Delay | Delay caused by predecessor |
| Blocked Time | Time waiting |

---

## 18. Actuals Tracking

The app should support actual execution tracking.

### 18.1 Task Start / Stop

Each task should support:

- Start task
- Pause task
- Resume task
- Complete task
- Mark blocked
- Mark QC hold
- Mark rework
- Add note
- Add photo
- Assign operator
- Change station

### 18.2 Actual Time Capture

For each task, capture:

```text
Actual start time
Actual finish time
Actual duration
Pause time
Blocked time
Rework time
Operators used
Actual man-hours
```

### 18.3 Actual Man-Hour Calculation

```text
Actual Man-Hours = Actual Duration × Actual Operators
```

If the task is paused or blocked, the app should allow the user to decide whether the time counts as labor time, elapsed time, or both.

### 18.4 Time Categories

Time should be categorized as:

- Value-added work time
- Non-value-added required time
- Waiting time
- Rework time
- QC hold time
- Material delay
- Engineering delay
- Safety delay
- Equipment downtime
- Changeover time

---

## 19. Scenario Planning

The app should allow multiple scenarios for the same product.

### 19.1 Example Scenarios

```text
Scenario 1: Current State
Scenario 2: Future State
Scenario 3: Add 2 Operators
Scenario 4: Move Work to Subassembly
Scenario 5: Reduce Bottleneck Station by 20%
Scenario 6: One Shift
Scenario 7: Two Shifts
Scenario 8: Demand Increase to 5 Units/Week
```

### 19.2 Scenario Comparison

The app should compare:

- Takt time
- Cycle time
- Lead time
- Target man-hours
- Planned man-hours
- Actual man-hours
- Operator requirement
- Bottleneck station
- Number of stations
- Capacity gap
- Line balance score
- Throughput

### 19.3 Scenario Copy

The user should be able to duplicate a scenario and modify it without losing the original.

---

## 20. Manufacturing Line Builder Workflow

Recommended user workflow:

```text
1. Create Product
2. Enter demand and available time
3. Calculate takt time
4. Enter product man-hour target
5. Create production scenario
6. Create line plan
7. Add stations
8. Add work packages
9. Add tasks
10. Enter planned cycle times
11. Assign operators
12. Define dependencies
13. Review planned man-hours
14. Review station balance
15. Identify bottlenecks
16. Adjust work distribution
17. Run playback simulation
18. Compare against takt
19. Save baseline
20. Release line plan
21. Track actuals
22. Improve plan over time
```

---

## 21. Example Product Flow: Hybrid Generator Conversion

This example is based on a disassembly and conversion line.

### 21.1 Product

```text
Product: SDG125-to-Hybrid Generator Conversion
Product Type: Generator Conversion
Top-Level Goal: Convert donor SDG125 generator into hybrid generator configuration
```

### 21.2 Example Disassembly Stations

```text
1. Fluid Drain, LOTO & Safe Teardown Prep Station
2. Electrical Disconnect, Labeling & Control Cabinet Recovery Station
3. Cooling, Aftertreatment & Accessory Removal Station
4. Engine / Alternator Coupled Module Removal Station
5. Fuel Tank & Containment Tank Reorientation Station
6. Panel Recovery, Rework & Service Parts Station
```

### 21.3 Station Detail: Fluid Drain, LOTO & Safe Teardown Prep

Purpose:

```text
Make the SDG125 safe before deeper disassembly.
```

Tasks:

- Verify unit and serial number
- Verify traveler
- Perform LOTO
- Complete zero-energy check
- Drain or control fluids as required
- Cap and plug lines
- Clean spills
- Document fluid disposal or recovery
- Sign traveler
- Release unit to disassembly

Pass gates:

- LOTO complete
- Fluids controlled
- Lines capped
- Work area clean
- Traveler signed

### 21.4 Station Detail: Electrical Disconnect, Labeling & Control Cabinet Recovery

Purpose:

```text
Recover the control cabinet and required electrical components while preserving wiring knowledge and routing.
```

Tasks:

- Photo-document existing wiring
- Photo-document routing
- Label connectors
- Label harnesses
- Label terminals
- Disconnect alternator/generator leads
- Disconnect control harnesses
- Remove control cabinet
- Protect open connectors
- Sort recovered electrical components
- Sign traveler
- Release to mechanical teardown

Disposition paths:

- Hybrid reuse
- Hybrid rework/modification
- SDG125 service parts
- QC hold/review

### 21.5 Station Detail: Cooling, Aftertreatment & Accessory Removal

Purpose:

```text
Remove bulky cooling and support systems before engine/alternator module removal.
```

Tasks:

- Verify traveler and unit ID
- Photo-document hose routing
- Photo-document bracket routing
- Remove fan guards
- Remove shrouds
- Remove cooling package components
- Remove intercooler/radiator/cooler lines as required
- Remove DEF/aftertreatment components as required
- Cap and plug open lines
- Sort recovered parts
- Clean work area
- Sign traveler
- Release to engine/alternator separation

### 21.6 Station Detail: Engine / Alternator Coupled Module Removal

Purpose:

```text
Remove the engine and alternator as one intact coupled module from the donor SDG125 and transfer it directly to the horizontal electric motor integration jig.
```

Important rule:

```text
Do not split the engine and alternator in this station.
```

Tasks:

- Verify traveler and unit ID
- Confirm prior disconnects complete
- Confirm horizontal jig is ready
- Support and lift from approved points
- Remove mounting hardware
- Place coupled module directly on jig
- Protect exposed interfaces
- Bag and tag mounting hardware
- Sign traveler
- Release to Electric Motor Integration & Precision Alignment

### 21.7 Station Detail: Fuel Tank & Containment Tank Reorientation

Purpose:

```text
Rotate the fuel tank 180 degrees against the containment tank and prepare the tank/containment package for hybrid assembly.
```

Known details:

- The SDG125 base attaches to the containment tank with 6 bolts and 2 nuts.
- The fuel tank sits inside the containment tank.
- For the hybrid model, the fuel tank must rotate 180 degrees against the containment tank.
- Fuel may remain in the tank if approved by safety and process conditions.
- A longer fuel drain hose must be installed because of the rotation.
- The containment package should leave this station ready for hybrid assembly.

Tasks:

- Verify traveler and unit ID
- Verify fuel status
- Photograph original orientation
- Separate SDG125 base from containment tank
- Remove 6 bolts and 2 nuts as required
- Rotate fuel tank 180 degrees
- Install longer fuel drain hose
- Verify hose routing
- Verify bend radius
- Verify drain access
- Verify no pinch points
- Bolt containment package back up
- Torque hardware
- Inspect tank/containment package
- Stage as hybrid-ready
- Sign traveler
- Release to Hybrid Base / Battery Pack Assembly

Pass gates:

- Correct 180-degree orientation
- Longer fuel drain hose installed
- No hose pinch points
- Drain access verified
- Hardware torqued
- Traveler signed

### 21.8 Station Detail: Panel Recovery, Rework & Service Parts Station

Purpose:

```text
Recover panels and route them into reuse, rework, service parts, or QC hold paths.
```

Output paths:

```text
1. Hybrid reuse panels
2. Hybrid rework panels
3. SDG125 service parts inventory
4. QC hold/service parts review
```

Rules:

- No unused parts should be treated as scrap by default.
- Questionable parts go to QC hold/service parts review.
- Recovered panels should be cleaned, inspected, sealed, labeled, protected, and staged.

---

## 22. UI Requirements

### 22.1 Main Layout

Recommended app layout:

```text
Top Navigation
Left Sidebar
Main Workspace
Right Detail Drawer
Bottom Simulation / Event Panel
```

### 22.2 Top Navigation

Top nav should include:

- Product selector
- Scenario selector
- Revision selector
- Save status
- Release status
- Search
- Export
- Settings

### 22.3 Left Sidebar

Sidebar modules:

- Dashboard
- Product Setup
- Line Plan
- Gantt
- Station Balance
- Takt Calculator
- Man-Hours
- Playback
- KPIs
- Actuals
- Reports
- Settings

### 22.4 Right Detail Drawer

Clicking any row should open a detail drawer.

For a product row, show:

- Product details
- Demand
- Takt
- Target man-hours
- Scenarios
- Revisions
- KPI summary

For a station row, show:

- Station description
- Owner
- Cycle time
- Operators
- Tools
- Equipment
- Tasks
- Bottleneck status

For a task row, show:

- Task name
- Description
- Duration
- Operators
- Dependencies
- Work instructions
- Safety notes
- Quality notes
- Actuals
- Comments

### 22.5 Bottom Playback Panel

The bottom panel should show:

- Playback controls
- Speed selector
- Current simulation time
- Active tasks
- Event log
- KPI strip

---

## 23. Data Model

### 23.1 Product Table

```ts
Product {
  id: string
  name: string
  sku?: string
  family?: string
  revision: string
  description?: string
  ownerId?: string
  status: "draft" | "review" | "approved" | "released" | "obsolete"
  targetManHours: number
  demandQuantity: number
  demandPeriod: "shift" | "day" | "week" | "month" | "custom"
  grossAvailableMinutes: number
  breakMinutes: number
  meetingMinutes: number
  plannedDowntimeMinutes: number
  netAvailableMinutes: number
  calculatedTaktMinutes: number
  manualTaktMinutes?: number
  activeTaktMinutes: number
  createdAt: string
  updatedAt: string
}
```

### 23.2 Scenario Table

```ts
Scenario {
  id: string
  productId: string
  name: string
  description?: string
  type: "current_state" | "future_state" | "prototype" | "production" | "what_if"
  status: "draft" | "baseline" | "released" | "archived"
  targetOutput: number
  targetOutputPeriod: string
  notes?: string
  createdAt: string
  updatedAt: string
}
```

### 23.3 Station Table

```ts
Station {
  id: string
  scenarioId: string
  sequence: number
  name: string
  description?: string
  ownerId?: string
  plannedCycleMinutes: number
  actualCycleMinutes?: number
  plannedOperators: number
  actualOperators?: number
  plannedManHours: number
  actualManHours?: number
  taktStatus: "green" | "yellow" | "red" | "missing"
  bottleneckFlag: boolean
  wipLimit?: number
  area?: string
  toolsRequired?: string[]
  equipmentRequired?: string[]
  safetyNotes?: string
  qcNotes?: string
}
```

### 23.4 Task Table

```ts
Task {
  id: string
  scenarioId: string
  stationId: string
  parentTaskId?: string
  rowType: "task" | "milestone" | "inspection" | "material_gate" | "hold" | "rework" | "buffer"
  wbs: string
  name: string
  description?: string
  plannedStart: string
  plannedFinish: string
  plannedDurationMinutes: number
  actualStart?: string
  actualFinish?: string
  actualDurationMinutes?: number
  plannedOperators: number
  actualOperators?: number
  plannedManHours: number
  actualManHours?: number
  status: "not_started" | "ready" | "in_progress" | "complete" | "blocked" | "hold" | "qc_hold" | "rework"
  percentComplete: number
  ownerId?: string
  role?: string
  skillLevel?: "apprentice" | "trained" | "certified" | "expert"
  dependencyIds: string[]
  criticalPath: boolean
  bottleneckFlag: boolean
  qualityGate: boolean
  travelerSignoffRequired: boolean
  sopLink?: string
  workInstructionLink?: string
  drawingLink?: string
  materialKit?: string
  toolsRequired?: string[]
  equipmentRequired?: string[]
  safetyNotes?: string
  qcChecklist?: string
  reworkRisk?: "low" | "medium" | "high"
  notes?: string
  customFields: Record<string, any>
}
```

### 23.5 Dependency Table

```ts
Dependency {
  id: string
  predecessorTaskId: string
  successorTaskId: string
  type: "finish_to_start" | "start_to_start" | "finish_to_finish" | "start_to_finish"
  lagMinutes?: number
  constraintType?: "safety" | "quality" | "material" | "tooling" | "labor" | "engineering" | "traveler"
}
```

### 23.6 Actual Event Table

```ts
ActualEvent {
  id: string
  taskId: string
  eventType: "start" | "pause" | "resume" | "complete" | "blocked" | "unblocked" | "qc_hold" | "rework" | "note"
  timestamp: string
  userId?: string
  notes?: string
  reasonCode?: string
}
```

### 23.7 Custom Column Table

```ts
CustomColumn {
  id: string
  productId?: string
  scenarioId?: string
  name: string
  key: string
  description?: string
  type: "text" | "long_text" | "number" | "currency" | "percent" | "duration" | "date" | "datetime" | "checkbox" | "select" | "multi_select" | "person" | "formula" | "url" | "file" | "relation" | "rollup" | "status" | "rating" | "risk_score"
  appliesTo: "product" | "scenario" | "station" | "task" | "all"
  required: boolean
  defaultValue?: any
  options?: string[]
  formula?: string
  unit?: string
  precision?: number
  visible: boolean
  locked: boolean
}
```

---

## 24. Formula Engine

The app should include a formula engine for KPI and custom column calculations.

### 24.1 Standard Formulas

```text
Net Available Time = Gross Available Time - Breaks - Meetings - Planned Downtime

Takt Time = Net Available Time / Demand

Task Planned Man-Hours = Planned Duration Hours × Planned Operators

Task Actual Man-Hours = Actual Duration Hours × Actual Operators

Station Planned Man-Hours = SUM(Task Planned Man-Hours)

Station Actual Man-Hours = SUM(Task Actual Man-Hours)

Product Planned Man-Hours = SUM(Station Planned Man-Hours)

Product Actual Man-Hours = SUM(Station Actual Man-Hours)

Man-Hour Variance = Actual Man-Hours - Target Man-Hours

Man-Hour Efficiency = Target Man-Hours / Actual Man-Hours × 100

Station Takt Variance = Station Cycle Time - Takt Time

Capacity Gap = Available Man-Hours - Required Man-Hours

Required Man-Hours = Demand × Target Man-Hours per Unit

Available Man-Hours = Net Available Hours × Operators

Line Balance Score = Total Station Work Content / (Bottleneck Cycle Time × Number of Stations)
```

### 24.2 Status Logic

```text
If Planned Cycle Time <= Takt Time:
  Status = Green

If Planned Cycle Time > Takt Time and Planned Cycle Time <= Takt Time × 1.10:
  Status = Yellow

If Planned Cycle Time > Takt Time × 1.10:
  Status = Red
```

The 10% tolerance should be configurable.

---

## 25. Reports & Exports

The app should generate reports.

### 25.1 Reports

Reports:

- Product Line Plan Report
- Takt & Capacity Report
- Man-Hour Target Report
- Station Balance Report
- Bottleneck Report
- Cycle Time Report
- Actual vs Planned Report
- Scenario Comparison Report
- Custom Column Export
- Traveler / Work Package Report
- QC Gate Report

### 25.2 Export Formats

Support:

- PDF
- CSV
- Excel
- JSON
- Markdown
- Image export of Gantt
- Printable traveler
- Station work package sheet

### 25.3 Markdown Export

The app should export a full markdown file for any product line plan.

The markdown should include:

- Product overview
- Demand assumptions
- Takt calculation
- Man-hour target
- Station list
- Task list
- Gantt data table
- Dependencies
- Bottlenecks
- KPIs
- Scenario notes
- Revision history

---

## 26. Permissions

User roles:

| Role | Permissions |
|---|---|
| Admin | Full access |
| Engineer | Edit product, stations, tasks, formulas |
| Production Manager | Edit schedule, labor, actuals |
| Supervisor | Update actuals, status, notes |
| Operator | Start/complete assigned tasks |
| QC | Complete quality gates |
| Viewer | Read only |

---

## 27. Implementation Notes for Codex

### 27.1 Recommended Tech Stack

Suggested stack:

```text
Next.js
React
TypeScript
Tailwind CSS
shadcn/ui
PostgreSQL
Prisma or Drizzle
Supabase or Neon
Zustand or Redux Toolkit
React Query / TanStack Query
Gantt chart library or custom canvas/SVG timeline
Recharts for KPI charts
```

### 27.2 Gantt Implementation Options

The Gantt could be built using:

```text
Option 1: Existing Gantt library
Option 2: Custom React/SVG timeline
Option 3: Canvas-based high-performance timeline
```

Recommended approach:

Start with a custom React/SVG Gantt if the product needs strong manufacturing-specific controls, custom columns, playback simulation, and station-level timeline logic.

### 27.3 MVP Recommendation

Build MVP in this order:

```text
1. Product setup
2. Takt calculator
3. Station builder
4. Task table
5. Gantt timeline
6. Man-hour calculations
7. Station balance view
8. Playback mode
9. Actual tracking
10. Reports
```

---

## 28. MVP Scope

### 28.1 MVP Must Have

- Create product
- Enter demand
- Enter available production time
- Calculate takt time
- Enter product target man-hours
- Create scenario
- Add stations
- Add tasks
- Enter planned duration
- Enter operators
- Calculate task man-hours
- Calculate station man-hours
- Calculate product planned man-hours
- Create dependencies
- Display Gantt chart
- Show bottleneck station
- Show station balance
- Playback planned timeline
- Export markdown report

### 28.2 MVP Should Have

- Custom columns
- Actual start/finish tracking
- Actual man-hour tracking
- Scenario duplication
- Baseline comparison
- KPI dashboard
- CSV export
- PDF export

### 28.3 Later Features

- Multi-user live collaboration
- Operator mobile mode
- Barcode/QR traveler scanning
- AI process improvement suggestions
- Automatic bottleneck recommendations
- Integration with ERP/MES
- Drawing and work instruction attachments
- Digital traveler execution
- Advanced simulation engine
- Labor skill matrix
- Cost modeling
- OEE integration
- Material shortage integration

---

## 29. Example User Story Set

### 29.1 Product Setup

```text
As a manufacturing engineer,
I want to create a product and define its demand, available time, takt time, and target man-hours,
so that I can build a line plan around real production requirements.
```

### 29.2 Gantt Planning

```text
As a process engineer,
I want to add stations and tasks to a Gantt chart,
so that I can visually design the sequence of manufacturing work.
```

### 29.3 Takt Validation

```text
As an operations leader,
I want the app to compare station cycle time to takt time,
so that I can see whether the line can meet customer demand.
```

### 29.4 Man-Hour Control

```text
As a production manager,
I want to compare planned and actual man-hours to the product target,
so that I can control labor efficiency.
```

### 29.5 Playback Simulation

```text
As a line developer,
I want to play back the manufacturing schedule at different speeds,
so that I can see how work flows through the line and where bottlenecks appear.
```

### 29.6 Custom Columns

```text
As a manufacturing engineer,
I want to create custom columns such as torque spec, fixture ID, QC gate, and material status,
so that the Gantt chart matches the real information needed on my production floor.
```

---

## 30. Acceptance Criteria

### 30.1 Product-Level Acceptance Criteria

- User can create a product.
- User can enter target man-hours.
- User can enter demand.
- User can enter available production time.
- App calculates takt time.
- App displays product-level KPI summary.
- App supports product revisions.
- App supports multiple scenarios.

### 30.2 Gantt Acceptance Criteria

- User can create stations.
- User can create tasks under stations.
- User can assign task durations.
- User can assign operators.
- App calculates task man-hours.
- App calculates station man-hours.
- App calculates product planned man-hours.
- User can link dependencies.
- Gantt bars display correctly on a timeline.
- Milestones are supported.
- Critical path can be flagged.
- Bottlenecks can be flagged.

### 30.3 Playback Acceptance Criteria

- User can play, pause, stop, restart, step forward, and step backward.
- User can select playback speed.
- User can create a custom playback speed.
- Gantt displays moving time marker.
- Active tasks highlight during playback.
- Completed tasks update visually.
- Blocked tasks show warning status.
- Playback event log updates.
- Playback side panel shows current KPIs.

### 30.4 Custom Column Acceptance Criteria

- User can create custom columns.
- User can choose custom column type.
- User can decide which row types the column applies to.
- User can hide/show custom columns.
- User can use formulas in custom columns.
- Custom columns appear in the Gantt table.
- Custom columns export with reports.

### 30.5 KPI Acceptance Criteria

- App calculates takt time.
- App calculates planned cycle time.
- App calculates actual cycle time.
- App calculates planned man-hours.
- App calculates actual man-hours.
- App calculates man-hour variance.
- App calculates line balance score.
- App identifies bottleneck station.
- App shows station status against takt.

---

## 31. Suggested Initial Seed Data

```json
{
  "product": {
    "name": "SDG125-to-Hybrid Generator Conversion",
    "revision": "Rev A",
    "targetManHours": 140,
    "demandQuantity": 1,
    "demandPeriod": "day",
    "grossAvailableMinutes": 540,
    "breakMinutes": 60,
    "meetingMinutes": 15,
    "plannedDowntimeMinutes": 15,
    "netAvailableMinutes": 450,
    "calculatedTaktMinutes": 450
  },
  "stations": [
    {
      "sequence": 1,
      "name": "Fluid Drain, LOTO & Safe Teardown Prep",
      "plannedOperators": 1
    },
    {
      "sequence": 2,
      "name": "Electrical Disconnect, Labeling & Control Cabinet Recovery",
      "plannedOperators": 2
    },
    {
      "sequence": 3,
      "name": "Cooling, Aftertreatment & Accessory Removal",
      "plannedOperators": 2
    },
    {
      "sequence": 4,
      "name": "Engine / Alternator Coupled Module Removal",
      "plannedOperators": 2
    },
    {
      "sequence": 5,
      "name": "Fuel Tank & Containment Tank Reorientation",
      "plannedOperators": 2
    },
    {
      "sequence": 6,
      "name": "Panel Recovery, Rework & Service Parts",
      "plannedOperators": 2
    }
  ]
}
```

---

## 32. Important Design Principle

The app should always connect the schedule back to manufacturing reality.

A task is not just a bar on a timeline.

A task should answer:

```text
What work is being done?
Where is it being done?
Who is doing it?
How long should it take?
How many operators are needed?
How many man-hours does it consume?
What must happen before it starts?
What quality gate proves it is complete?
Does it help or hurt the takt target?
Does it keep the product within the man-hour target?
```

---

## 33. Final Build Direction

Build this app as a **manufacturing line development system** centered on a product-level Gantt chart.

The app should let the user:

- Define the product
- Define demand
- Calculate takt
- Set man-hour targets
- Build the line sequence
- Assign work by station
- Define task cycle times
- Assign labor
- Create dependencies
- Simulate the line
- Play back the flow
- Detect bottlenecks
- Balance stations
- Track actuals
- Compare target vs actual
- Improve the production system

The final experience should feel like a combination of:

```text
Gantt chart
Lean manufacturing calculator
Line balance board
Industrial engineering planner
Production KPI dashboard
Digital traveler system
Manufacturing simulation tool
```

The purpose is to help the user design a production line for a specific product, validate whether it can meet demand, control labor against man-hour targets, and improve the flow before and during real production.
