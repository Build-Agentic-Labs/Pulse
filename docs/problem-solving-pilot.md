# Problem Solving private pilot

Quality → Problem Solving lives at `/sops/problem-solving`. Dashboard, Open and Closed share a guided case form. Drafts, action plans, section attachments and change history persist in Supabase. Closed cases are read-only.

Access is restricted to the verified rlopez account ID in `is_problem_solving_pilot()`, plus membership in the case workspace. The navigation link and server page check that predicate; RLS independently protects cases, actions, evidence metadata, history and the private `problem-evidence` bucket. Workspace owners and platform administrators do not gain pilot access through their ordinary user sessions. No notifications are sent by this feature.

The database enforces stage order, required definition and cause evidence, completed containment/corrective/preventive actions, an effectiveness plan/result/date and completion of every remaining action before sign-off. The pilot user records the sign-off. This is a pilot workflow, not an extension of the SOP approval functions.

Case writes use optimistic version checks. Actions and attachments save independently. History and linked files are append-only. Files are limited to 20 MB. Case evidence is opened with a 60-second signed URL after an RLS-authorized request.

Before widening access, replace the pilot predicate with an approved role/assignment model and define who may sign off cases. Do not merely expose the navigation link or grant all Quality users database access.

Validation: `src/domain/problem-solving.test.ts`, the private-route tests, the native date entry regression test, and `supabase/tests/problem_solving_test.sql`. The SQL suite runs in a rolled-back transaction and tests the workflow plus denial of another workspace owner's access. Use a clearly labeled QA case for browser checks and remove only that test case and its artifacts afterward.
