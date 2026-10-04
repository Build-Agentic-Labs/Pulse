# Edit baseline measurement 2026-10-04T19:14:35.904Z

Build SHA `438a6dfe677ad9d84e7dc58a61e951af1265f1d7`; Node v22.16.0; Next 16.3.0; Playwright 1.63.0; Chromium 153.0.8010.12.
Darwin 27.0.0 27.0.1; Apple M4 Pro; 24 GiB; Docker version 29.7.2, build a7dcaa6.
Network: loopback (127.0.0.1), no throttling; Next.js production server (next start) on :3100; Supabase local stack (Kong) on :56321. Database: retained isolated project pulse-e2e (scratch/browser-db), started from its existing data, never reset.
Samples per fixture: 5. Sample 1 of each fixture is the cold run (first visit to that project since the server started; every sample uses a new browser context, so the browser cache is empty in all of them). Warm = samples 2..n. Only browser-issued requests are counted; server-component fetches during the first paint are not visible to the recorder.

## Fixtures

| Fixture | zones | stations | tasks | steps | step_tools | seed time |
|---|---:|---:|---:|---:|---:|---:|
| medium | 3 | 6 | 40 | 200 | 400 | 129 ms |
| small | 0 | 0 | 1 | 1 | 0 | 126 ms |
| stress | 2 | 4 | 1100 | 1100 | 1100 | 180 ms |

## medium

### Timing (ms)

| Phase | cold (sample 1) | warm median (min, max, n) |
|---|---:|---|
| open | 378 | 377 (min 373, max 381, n=4) |
| switch:Procedure | 75 | 72 (min 60, max 78, n=4) |
| edit:step-instruction | 795 | 817 (min 806, max 822, n=4) |
| mobile:open | 221 | 216 (min 196, max 221, n=4) |
| blur → row observable in DB (poll 20 ms) | 776 | 796 (min 790, max 801, n=4) |

### Supabase requests by endpoint

#### open

Total Supabase requests per sample: 61, 61, 61, 61, 61 (identical endpoint counts in every sample). Response bytes median 265.1 KiB, request bytes median 99.3 KiB; app-origin (documents, chunks, RSC) response bytes median 655.5 KiB.

| Endpoint | count (per sample) | response bytes (median) | failed |
|---|---|---:|---:|
| `GET /rest/v1/actual_events` | 1 | 1.7 KiB | 0 |
| `GET /rest/v1/custom_columns` | 1 | 0.7 KiB | 0 |
| `GET /rest/v1/department_members` | 3 | 2.0 KiB | 0 |
| `GET /rest/v1/departments` | 6 | 3.9 KiB | 0 |
| `GET /rest/v1/document_type_codes` | 1 | 1.9 KiB | 0 |
| `GET /rest/v1/manufacturing_components` | 1 | 0.6 KiB | 0 |
| `GET /rest/v1/manufacturing_steps` | 1 | 64.2 KiB | 0 |
| `GET /rest/v1/notifications` | 3 | 1.9 KiB | 0 |
| `GET /rest/v1/part_references` | 1 | 1.7 KiB | 0 |
| `GET /rest/v1/products` | 1 | 1.5 KiB | 0 |
| `GET /rest/v1/profiles` | 4 | 2.5 KiB | 0 |
| `GET /rest/v1/project_access` | 4 | 2.8 KiB | 0 |
| `GET /rest/v1/projects` | 4 | 4.4 KiB | 0 |
| `GET /rest/v1/scenarios` | 2 | 1.8 KiB | 0 |
| `GET /rest/v1/sop_review_annotations` | 3 | 1.9 KiB | 0 |
| `GET /rest/v1/sop_review_seats` | 3 | 2.7 KiB | 0 |
| `GET /rest/v1/sops` | 3 | 2.8 KiB | 0 |
| `GET /rest/v1/stations` | 1 | 4.3 KiB | 0 |
| `GET /rest/v1/step_tools` | 1 | 101.4 KiB | 0 |
| `GET /rest/v1/task_dependencies` | 1 | 1.7 KiB | 0 |
| `GET /rest/v1/tasks` | 1 | 48.4 KiB | 0 |
| `GET /rest/v1/tool_library` | 1 | 0.6 KiB | 0 |
| `GET /rest/v1/workspace_members` | 4 | 2.8 KiB | 0 |
| `GET /rest/v1/workspaces` | 4 | 3.2 KiB | 0 |
| `GET /rest/v1/zones` | 1 | 1.4 KiB | 0 |
| `POST /rest/v1/profiles` | 1 | 0.5 KiB | 0 |
| `POST /rest/v1/rpc/is_super_admin` | 3 | 1.5 KiB | 0 |
| `POST /rest/v1/rpc/redeem_workspace_access_grants` | 1 | 0.5 KiB | 0 |

#### switch:Procedure

Total Supabase requests per sample: 5, 5, 5, 5, 5 (identical endpoint counts in every sample). Response bytes median 3.1 KiB, request bytes median 8.2 KiB; app-origin (documents, chunks, RSC) response bytes median 2.1 KiB.

| Endpoint | count (per sample) | response bytes (median) | failed |
|---|---|---:|---:|
| `GET /rest/v1/step_exploded_views` | 1 | 0.6 KiB | 0 |
| `GET /rest/v1/step_photos` | 1 | 0.6 KiB | 0 |
| `GET /rest/v1/task_videos` | 1 | 0.6 KiB | 0 |
| `GET /rest/v1/tasks` | 1 | 0.7 KiB | 0 |
| `POST /rest/v1/rpc/task_project_id` | 1 | 0.5 KiB | 0 |

#### edit:step-instruction

Total Supabase requests per sample: 18, 18, 18, 18, 18 (identical endpoint counts in every sample). Response bytes median 16.1 KiB, request bytes median 31.0 KiB; app-origin (documents, chunks, RSC) response bytes median 0.0 KiB.

| Endpoint | count (per sample) | response bytes (median) | failed |
|---|---|---:|---:|
| `GET /rest/v1/manufacturing_steps` | 2 | 3.1 KiB | 0 |
| `GET /rest/v1/part_references` | 2 | 1.2 KiB | 0 |
| `GET /rest/v1/step_exploded_views` | 1 | 0.6 KiB | 0 |
| `GET /rest/v1/step_photos` | 1 | 0.6 KiB | 0 |
| `GET /rest/v1/step_tools` | 1 | 3.1 KiB | 0 |
| `GET /rest/v1/task_dependencies` | 1 | 0.6 KiB | 0 |
| `GET /rest/v1/task_videos` | 1 | 0.6 KiB | 0 |
| `GET /rest/v1/tasks` | 1 | 1.7 KiB | 0 |
| `PATCH /rest/v1/manufacturing_steps` | 5 | 2.9 KiB | 0 |
| `PATCH /rest/v1/tasks` | 1 | 0.6 KiB | 0 |
| `POST /rest/v1/rpc/task_project_id` | 2 | 1.1 KiB | 0 |

#### mobile:open

Total Supabase requests per sample: 30, 30, 30, 30, 30 (identical endpoint counts in every sample). Response bytes median 245.1 KiB, request bytes median 49.0 KiB; app-origin (documents, chunks, RSC) response bytes median 53.8 KiB.

| Endpoint | count (per sample) | response bytes (median) | failed |
|---|---|---:|---:|
| `GET /rest/v1/actual_events` | 1 | 1.7 KiB | 0 |
| `GET /rest/v1/custom_columns` | 1 | 0.7 KiB | 0 |
| `GET /rest/v1/document_type_codes` | 1 | 1.9 KiB | 0 |
| `GET /rest/v1/manufacturing_components` | 1 | 0.6 KiB | 0 |
| `GET /rest/v1/manufacturing_steps` | 1 | 64.2 KiB | 0 |
| `GET /rest/v1/part_references` | 1 | 1.7 KiB | 0 |
| `GET /rest/v1/products` | 1 | 1.5 KiB | 0 |
| `GET /rest/v1/profiles` | 2 | 1.2 KiB | 0 |
| `GET /rest/v1/project_access` | 2 | 1.4 KiB | 0 |
| `GET /rest/v1/projects` | 2 | 2.1 KiB | 0 |
| `GET /rest/v1/scenarios` | 1 | 1.0 KiB | 0 |
| `GET /rest/v1/stations` | 1 | 4.3 KiB | 0 |
| `GET /rest/v1/step_exploded_views` | 1 | 1.7 KiB | 0 |
| `GET /rest/v1/step_photos` | 1 | 1.7 KiB | 0 |
| `GET /rest/v1/step_tools` | 1 | 101.4 KiB | 0 |
| `GET /rest/v1/task_dependencies` | 1 | 1.7 KiB | 0 |
| `GET /rest/v1/task_videos` | 1 | 1.7 KiB | 0 |
| `GET /rest/v1/tasks` | 1 | 48.4 KiB | 0 |
| `GET /rest/v1/workspace_members` | 2 | 1.4 KiB | 0 |
| `GET /rest/v1/workspaces` | 2 | 1.6 KiB | 0 |
| `GET /rest/v1/zones` | 1 | 1.4 KiB | 0 |
| `POST /rest/v1/profiles` | 1 | 0.5 KiB | 0 |
| `POST /rest/v1/rpc/is_super_admin` | 2 | 1.0 KiB | 0 |
| `POST /rest/v1/rpc/redeem_workspace_access_grants` | 1 | 0.5 KiB | 0 |

Page errors: none.

## small

### Timing (ms)

| Phase | cold (sample 1) | warm median (min, max, n) |
|---|---:|---|
| open | 455 | 379 (min 378, max 384, n=4) |
| switch:Procedure | 72 | 68 (min 63, max 71, n=4) |
| edit:step-instruction | 824 | 818 (min 801, max 824, n=4) |
| mobile:open | 111 | 126 (min 93, max 127, n=4) |
| blur → row observable in DB (poll 20 ms) | 802 | 801 (min 786, max 805, n=4) |

### Supabase requests by endpoint

#### open

Total Supabase requests per sample: 60, 61, 61, 61, 61 (counts differ between samples). Response bytes median 46.8 KiB, request bytes median 99.2 KiB; app-origin (documents, chunks, RSC) response bytes median 651.3 KiB.

| Endpoint | count (per sample) | response bytes (median) | failed |
|---|---|---:|---:|
| `GET /rest/v1/actual_events` | 1 | 0.6 KiB | 0 |
| `GET /rest/v1/custom_columns` | 1 | 0.7 KiB | 0 |
| `GET /rest/v1/department_members` | 3 | 2.0 KiB | 0 |
| `GET /rest/v1/departments` | 6 | 3.9 KiB | 0 |
| `GET /rest/v1/document_type_codes` | 1 | 1.9 KiB | 0 |
| `GET /rest/v1/manufacturing_components` | 1 | 0.6 KiB | 0 |
| `GET /rest/v1/manufacturing_steps` | 1 | 1.0 KiB | 0 |
| `GET /rest/v1/notifications` | 3 | 1.9 KiB | 0 |
| `GET /rest/v1/part_references` | 1 | 0.6 KiB | 0 |
| `GET /rest/v1/products` | 1 | 1.5 KiB | 0 |
| `GET /rest/v1/profiles` | 4 | 2.5 KiB | 0 |
| `GET /rest/v1/project_access` | 4 | 2.8 KiB | 0 |
| `GET /rest/v1/projects` | 4 | 4.4 KiB | 0 |
| `GET /rest/v1/scenarios` | 2 | 1.8 KiB | 0 |
| `GET /rest/v1/sop_review_annotations` | 3 | 1.9 KiB | 0 |
| `GET /rest/v1/sop_review_seats` | 3 | 2.7 KiB | 0 |
| `GET /rest/v1/sops` | 3 | 2.8 KiB | 0 |
| `GET /rest/v1/stations` | 1 | 0.6 KiB | 0 |
| `GET /rest/v1/step_tools` | 1 | 0.6 KiB | 0 |
| `GET /rest/v1/task_dependencies` | 1 | 0.6 KiB | 0 |
| `GET /rest/v1/tasks` | 1 | 1.8 KiB | 0 |
| `GET /rest/v1/tool_library` | 1 | 0.6 KiB | 0 |
| `GET /rest/v1/workspace_members` | 4 | 2.8 KiB | 0 |
| `GET /rest/v1/workspaces` | 4 | 3.2 KiB | 0 |
| `GET /rest/v1/zones` | 1 | 0.6 KiB | 0 |
| `POST /rest/v1/profiles` | 1 | 0.5 KiB | 0 |
| `POST /rest/v1/rpc/is_super_admin` | 2/3/3/3/3 | 1.5 KiB | 0 |
| `POST /rest/v1/rpc/redeem_workspace_access_grants` | 1 | 0.5 KiB | 0 |

#### switch:Procedure

Total Supabase requests per sample: 5, 5, 5, 5, 5 (identical endpoint counts in every sample). Response bytes median 3.1 KiB, request bytes median 8.2 KiB; app-origin (documents, chunks, RSC) response bytes median 2.1 KiB.

| Endpoint | count (per sample) | response bytes (median) | failed |
|---|---|---:|---:|
| `GET /rest/v1/step_exploded_views` | 1 | 0.6 KiB | 0 |
| `GET /rest/v1/step_photos` | 1 | 0.6 KiB | 0 |
| `GET /rest/v1/task_videos` | 1 | 0.6 KiB | 0 |
| `GET /rest/v1/tasks` | 1 | 0.7 KiB | 0 |
| `POST /rest/v1/rpc/task_project_id` | 1 | 0.5 KiB | 0 |

#### edit:step-instruction

Total Supabase requests per sample: 14, 14, 14, 14, 14 (identical endpoint counts in every sample). Response bytes median 9.8 KiB, request bytes median 23.4 KiB; app-origin (documents, chunks, RSC) response bytes median 0.0 KiB.

| Endpoint | count (per sample) | response bytes (median) | failed |
|---|---|---:|---:|
| `GET /rest/v1/manufacturing_steps` | 2 | 1.6 KiB | 0 |
| `GET /rest/v1/part_references` | 2 | 1.2 KiB | 0 |
| `GET /rest/v1/step_exploded_views` | 1 | 0.6 KiB | 0 |
| `GET /rest/v1/step_photos` | 1 | 0.6 KiB | 0 |
| `GET /rest/v1/step_tools` | 1 | 0.6 KiB | 0 |
| `GET /rest/v1/task_dependencies` | 1 | 0.6 KiB | 0 |
| `GET /rest/v1/task_videos` | 1 | 0.6 KiB | 0 |
| `GET /rest/v1/tasks` | 1 | 1.7 KiB | 0 |
| `PATCH /rest/v1/manufacturing_steps` | 1 | 0.6 KiB | 0 |
| `PATCH /rest/v1/tasks` | 1 | 0.6 KiB | 0 |
| `POST /rest/v1/rpc/task_project_id` | 2 | 1.1 KiB | 0 |

#### mobile:open

Total Supabase requests per sample: 30, 30, 30, 30, 30 (identical endpoint counts in every sample). Response bytes median 23.6 KiB, request bytes median 48.9 KiB; app-origin (documents, chunks, RSC) response bytes median 50.0 KiB.

| Endpoint | count (per sample) | response bytes (median) | failed |
|---|---|---:|---:|
| `GET /rest/v1/actual_events` | 1 | 0.6 KiB | 0 |
| `GET /rest/v1/custom_columns` | 1 | 0.7 KiB | 0 |
| `GET /rest/v1/document_type_codes` | 1 | 1.9 KiB | 0 |
| `GET /rest/v1/manufacturing_components` | 1 | 0.6 KiB | 0 |
| `GET /rest/v1/manufacturing_steps` | 1 | 1.0 KiB | 0 |
| `GET /rest/v1/part_references` | 1 | 0.6 KiB | 0 |
| `GET /rest/v1/products` | 1 | 1.5 KiB | 0 |
| `GET /rest/v1/profiles` | 2 | 1.2 KiB | 0 |
| `GET /rest/v1/project_access` | 2 | 1.4 KiB | 0 |
| `GET /rest/v1/projects` | 2 | 2.1 KiB | 0 |
| `GET /rest/v1/scenarios` | 1 | 1.0 KiB | 0 |
| `GET /rest/v1/stations` | 1 | 0.6 KiB | 0 |
| `GET /rest/v1/step_exploded_views` | 1 | 0.6 KiB | 0 |
| `GET /rest/v1/step_photos` | 1 | 0.6 KiB | 0 |
| `GET /rest/v1/step_tools` | 1 | 0.6 KiB | 0 |
| `GET /rest/v1/task_dependencies` | 1 | 0.6 KiB | 0 |
| `GET /rest/v1/task_videos` | 1 | 0.6 KiB | 0 |
| `GET /rest/v1/tasks` | 1 | 1.8 KiB | 0 |
| `GET /rest/v1/workspace_members` | 2 | 1.4 KiB | 0 |
| `GET /rest/v1/workspaces` | 2 | 1.6 KiB | 0 |
| `GET /rest/v1/zones` | 1 | 0.6 KiB | 0 |
| `POST /rest/v1/profiles` | 1 | 0.5 KiB | 0 |
| `POST /rest/v1/rpc/is_super_admin` | 2 | 1.0 KiB | 0 |
| `POST /rest/v1/rpc/redeem_workspace_access_grants` | 1 | 0.5 KiB | 0 |

Page errors: none.

## stress

### Timing (ms)

| Phase | cold (sample 1) | warm median (min, max, n) |
|---|---:|---|
| open | 662 | 638 (min 627, max 704, n=4) |
| switch:Procedure | 219 | 214 (min 208, max 231, n=4) |
| edit:step-instruction | 898 | 886 (min 876, max 901, n=4) |
| mobile:open | 1306 | 1251 (min 1100, max 1455, n=4) |
| blur → row observable in DB (poll 20 ms) | 769 | 762 (min 755, max 776, n=4) |

### Supabase requests by endpoint

#### open

Total Supabase requests per sample: 124, 124, 124, 124, 119 (counts differ between samples). Response bytes median 2195.0 KiB, request bytes median 201.5 KiB; app-origin (documents, chunks, RSC) response bytes median 684.9 KiB.

| Endpoint | count (per sample) | response bytes (median) | failed |
|---|---|---:|---:|
| `GET /rest/v1/actual_events` | 11 | 37.7 KiB | 0 |
| `GET /rest/v1/custom_columns` | 1 | 0.7 KiB | 0 |
| `GET /rest/v1/department_members` | 4 | 2.6 KiB | 0 |
| `GET /rest/v1/departments` | 8 | 5.1 KiB | 0 |
| `GET /rest/v1/document_type_codes` | 1 | 1.9 KiB | 0 |
| `GET /rest/v1/manufacturing_components` | 1 | 0.6 KiB | 0 |
| `GET /rest/v1/manufacturing_steps` | 11 | 384.7 KiB | 0 |
| `GET /rest/v1/notifications` | 4 | 2.5 KiB | 0 |
| `GET /rest/v1/part_references` | 11 | 37.7 KiB | 0 |
| `GET /rest/v1/products` | 1 | 1.5 KiB | 0 |
| `GET /rest/v1/profiles` | 6 | 3.8 KiB | 0 |
| `GET /rest/v1/project_access` | 4/4/4/4/3 | 2.8 KiB | 0 |
| `GET /rest/v1/projects` | 4/4/4/4/3 | 4.4 KiB | 0 |
| `GET /rest/v1/scenarios` | 2 | 1.8 KiB | 0 |
| `GET /rest/v1/sop_review_annotations` | 4 | 2.6 KiB | 0 |
| `GET /rest/v1/sop_review_seats` | 4 | 3.5 KiB | 0 |
| `GET /rest/v1/sops` | 4 | 3.7 KiB | 0 |
| `GET /rest/v1/stations` | 1 | 3.0 KiB | 0 |
| `GET /rest/v1/step_tools` | 13 | 327.2 KiB | 0 |
| `GET /rest/v1/task_dependencies` | 11 | 37.6 KiB | 0 |
| `GET /rest/v1/tasks` | 3 | 1319.2 KiB | 0 |
| `GET /rest/v1/tool_library` | 1 | 0.6 KiB | 0 |
| `GET /rest/v1/workspace_members` | 4/4/4/4/3 | 2.8 KiB | 0 |
| `GET /rest/v1/workspaces` | 4/4/4/4/3 | 3.2 KiB | 0 |
| `GET /rest/v1/zones` | 1 | 1.2 KiB | 0 |
| `POST /rest/v1/profiles` | 1 | 0.5 KiB | 0 |
| `POST /rest/v1/rpc/is_super_admin` | 3/3/3/3/2 | 1.5 KiB | 0 |
| `POST /rest/v1/rpc/redeem_workspace_access_grants` | 1 | 0.5 KiB | 0 |

#### switch:Procedure

Total Supabase requests per sample: 5, 5, 5, 5, 5 (identical endpoint counts in every sample). Response bytes median 3.1 KiB, request bytes median 8.2 KiB; app-origin (documents, chunks, RSC) response bytes median 2.1 KiB.

| Endpoint | count (per sample) | response bytes (median) | failed |
|---|---|---:|---:|
| `GET /rest/v1/step_exploded_views` | 1 | 0.6 KiB | 0 |
| `GET /rest/v1/step_photos` | 1 | 0.6 KiB | 0 |
| `GET /rest/v1/task_videos` | 1 | 0.6 KiB | 0 |
| `GET /rest/v1/tasks` | 1 | 0.7 KiB | 0 |
| `POST /rest/v1/rpc/task_project_id` | 1 | 0.5 KiB | 0 |

#### edit:step-instruction

Total Supabase requests per sample: 16, 16, 16, 16, 16 (identical endpoint counts in every sample). Response bytes median 293.6 KiB, request bytes median 26.6 KiB; app-origin (documents, chunks, RSC) response bytes median 0.0 KiB.

| Endpoint | count (per sample) | response bytes (median) | failed |
|---|---|---:|---:|
| `GET /rest/v1/manufacturing_steps` | 2 | 1.6 KiB | 0 |
| `GET /rest/v1/part_references` | 2 | 1.2 KiB | 0 |
| `GET /rest/v1/step_exploded_views` | 1 | 0.6 KiB | 0 |
| `GET /rest/v1/step_photos` | 1 | 0.6 KiB | 0 |
| `GET /rest/v1/step_tools` | 3 | 284.4 KiB | 0 |
| `GET /rest/v1/task_dependencies` | 1 | 0.6 KiB | 0 |
| `GET /rest/v1/task_videos` | 1 | 0.6 KiB | 0 |
| `GET /rest/v1/tasks` | 1 | 1.7 KiB | 0 |
| `PATCH /rest/v1/manufacturing_steps` | 1 | 0.6 KiB | 0 |
| `PATCH /rest/v1/tasks` | 1 | 0.6 KiB | 0 |
| `POST /rest/v1/rpc/task_project_id` | 2 | 1.1 KiB | 0 |

#### mobile:open

Total Supabase requests per sample: 114, 114, 114, 114, 114 (identical endpoint counts in every sample). Response bytes median 2277.2 KiB, request bytes median 185.2 KiB; app-origin (documents, chunks, RSC) response bytes median 88.6 KiB.

| Endpoint | count (per sample) | response bytes (median) | failed |
|---|---|---:|---:|
| `GET /rest/v1/actual_events` | 11 | 37.7 KiB | 0 |
| `GET /rest/v1/custom_columns` | 1 | 0.7 KiB | 0 |
| `GET /rest/v1/document_type_codes` | 1 | 1.9 KiB | 0 |
| `GET /rest/v1/manufacturing_components` | 1 | 0.6 KiB | 0 |
| `GET /rest/v1/manufacturing_steps` | 11 | 384.7 KiB | 0 |
| `GET /rest/v1/part_references` | 11 | 37.7 KiB | 0 |
| `GET /rest/v1/products` | 1 | 1.5 KiB | 0 |
| `GET /rest/v1/profiles` | 2 | 1.2 KiB | 0 |
| `GET /rest/v1/project_access` | 2 | 1.4 KiB | 0 |
| `GET /rest/v1/projects` | 2 | 2.1 KiB | 0 |
| `GET /rest/v1/scenarios` | 1 | 1.0 KiB | 0 |
| `GET /rest/v1/stations` | 1 | 3.0 KiB | 0 |
| `GET /rest/v1/step_exploded_views` | 11 | 38.0 KiB | 0 |
| `GET /rest/v1/step_photos` | 11 | 37.9 KiB | 0 |
| `GET /rest/v1/step_tools` | 13 | 327.2 KiB | 0 |
| `GET /rest/v1/task_dependencies` | 11 | 37.6 KiB | 0 |
| `GET /rest/v1/task_videos` | 11 | 37.9 KiB | 0 |
| `GET /rest/v1/tasks` | 3 | 1319.2 KiB | 0 |
| `GET /rest/v1/workspace_members` | 2 | 1.4 KiB | 0 |
| `GET /rest/v1/workspaces` | 2 | 1.6 KiB | 0 |
| `GET /rest/v1/zones` | 1 | 1.2 KiB | 0 |
| `POST /rest/v1/profiles` | 1 | 0.5 KiB | 0 |
| `POST /rest/v1/rpc/is_super_admin` | 2 | 1.0 KiB | 0 |
| `POST /rest/v1/rpc/redeem_workspace_access_grants` | 1 | 0.5 KiB | 0 |

Page errors: none.
