# Map Converted Approvers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An unresolved row in the "Approvals carried over from the original document" table gets a department picker; choosing one writes that department's code onto the approval row and creates the unstaffed seat, so the row flips to "Seat added" and the roster is no longer empty.

**Architecture:** `ConvertedApprovalsNotice` stays presentational and gains one optional callback. `SopRosterEditor` performs the seat write (it already owns `upsertSeat`); `SopEditor` performs the document write (it already owns `update()`). The persisted `departmentCode` is what makes the fix durable — `mapApprovalsToDepartments` resolves by code before position, so the row re-derives as "Seat added" with no new state.

**Tech Stack:** TypeScript, React 19, Vitest (jsdom for `.tsx`, node for `.ts`), `@testing-library/react`, existing `ThemedSelect` component.

**Spec:** `docs/superpowers/specs/2026-08-04-map-converted-approvers-design.md`

## Global Constraints

- **Write order is load-bearing:** document write (`departmentCode`) FIRST, seat upsert SECOND. Reversed, a failure leaves a seat under a row still claiming "No match".
- The seat is created **unstaffed**: `{ sopId, departmentId, rasic: "responsible", signerId: null }` — identical to what conversion creates. Never pre-select a reviewer.
- **Never render the transcribed approver name** (`approval.name`) anywhere in the notice. Stated rule at `converted-approvals-notice.tsx:60`.
- Picker appears on `no-match` and `seat-removed` rows ONLY. Never on `seated` or `quality-gate`.
- Picker options exclude the Quality-gate department (`isQualityGate`) and any already-seated department.
- Picker renders only when the callback prop is supplied. Absent → the table renders byte-identically to today.
- Rows are identified by **array index** (`approvalIndex`) — approval rows have no id and can duplicate (Control Plan has `Robbie Miller` ×3).
- Domain logic in `src/domain/` stays pure with a test file beside it (CLAUDE.md). No new CSS in `app/globals.css`.
- **`ThemedSelect` is NOT a native `<select>`** — it is a trigger `<button aria-label=…>` plus a `role="listbox"` menu of `role="option"` buttons. Drive it in tests the way `src/components/themed-select.test.tsx:29-34` already does, and never with `fireEvent.change`:

```tsx
fireEvent.click(screen.getByRole("button", { name: "Department for the Approved By approval" }));
fireEvent.click(screen.getByRole("option", { name: /ENG/ }));
```

  Likewise assert a picker's presence with `screen.getByRole("button", { name: … })`, not `getByLabelText`.
- Branch `feat/map-converted-approvers`. Run `git branch --show-current` before every commit. No `Co-Authored-By` footer.

## File Structure

| File | Responsibility |
|---|---|
| `src/domain/sop/approval-mapping.test.ts` | **Modify.** Prove a position-unmatched row resolves once `departmentCode` is set — the property the design rests on. |
| `src/components/sop/converted-approvals-notice.tsx` | **Modify.** Optional `onSeatDepartment` prop; renders a picker in the "Mapped to" cell of unresolved rows. |
| `src/components/sop/converted-approvals-notice.test.tsx` | **Modify.** Picker visibility, option filtering, callback payload. |
| `src/components/sop/sop-roster-editor.tsx` | **Modify.** Optional `onMapApproval` prop; wires the notice's callback to the document write then `upsertSeat`. |
| `src/components/sop/sop-editor.tsx` | **Modify.** Implements `onMapApproval` (writes `departmentCode` into `sop.approvals[i]`); fixes the empty-routing message. |

---

### Task 1: Prove the resolution property

**Files:**
- Test: `src/domain/sop/approval-mapping.test.ts`

**Interfaces:**
- Consumes: `mapApprovalsToDepartments(approvals, departments)` from `@/domain/sop/approval-mapping` — already exists, unchanged by this task.
- Produces: nothing. This task adds a regression test for behaviour the whole feature depends on.

The design rests on one property: a row whose position title matches nothing still resolves once `departmentCode` is set, because `findByCodeOrName(approval.departmentCode)` is tried before `findByPositionTitle(approval.position)` (`approval-mapping.ts:68-69`). If that ever regresses, the picker would silently stop working — rows would keep reading "No match" after being mapped. Lock it now.

- [ ] **Step 1: Write the failing test**

Open `src/domain/sop/approval-mapping.test.ts`, read its existing helpers (there is already a `Department` factory and a `SopApproval` factory — reuse them, do not invent new ones), and add inside the existing `describe("mapApprovalsToDepartments")` block:

```ts
  // The property the converted-approver picker rests on: the author's chosen
  // department is stored as departmentCode, and code resolution runs BEFORE the
  // position-title fallback. Without this, a mapped row would keep rendering
  // "No match" forever.
  it("resolves by departmentCode even when the position title matches nothing", () => {
    // "IC Manager" is deliberately NOT in any department's STANDARD_POSITION_TITLES,
    // so the position fallback cannot resolve it and only the code can.
    const unmatchable = { role: "Approved By", name: "R. Miller", position: "IC Manager", date: "" };

    const before = mapApprovalsToDepartments([unmatchable], DEPARTMENTS);
    expect(before[0].outcome).toBe("unmapped");

    const after = mapApprovalsToDepartments([{ ...unmatchable, departmentCode: "MFG" }], DEPARTMENTS);
    expect(after[0].outcome).toBe("mapped");
    expect(after[0].department?.code).toBe("MFG");
  });

  // THE discriminating test. The position must be an EXACT entry in another
  // department's STANDARD_POSITION_TITLES (findByPositionTitle matches exactly,
  // not by substring) — otherwise the fallback resolves to nothing, the code wins
  // by default, and the test passes under BOTH orderings while proving nothing.
  // "Production Manager" is an exact MFG title; the code says QAS. Reversing the
  // two resolvers in approval-mapping.ts MUST turn this red.
  it("prefers departmentCode over a position title that matches a different department", () => {
    const conflicting = {
      role: "Approved By",
      name: "R. Miller",
      position: "Production Manager",
      date: "",
      departmentCode: "QAS",
    };
    const [mapping] = mapApprovalsToDepartments([conflicting], DEPARTMENTS);
    // QAS is the quality gate, MFG is not — the outcome names which input won.
    expect(mapping.outcome).toBe("quality-gate");
  });
```

Adapt `DEPARTMENTS` / the approval literal to the fixture names actually present in that file. The two department codes used must be a non-quality department (for the first test) and the quality-gate department (for the second).

- [ ] **Step 2: Run the test**

```bash
npx vitest run src/domain/sop/approval-mapping.test.ts
```

Expected: PASS (this documents existing behaviour — it is a characterization test, so green on first run is correct). If either assertion FAILS, stop: the design's core assumption is wrong and the spec needs revisiting before any UI work.

- [ ] **Step 2b: Prove the test actually discriminates**

Green-on-first-run means nothing until you show the test can go red. In `src/domain/sop/approval-mapping.ts`, temporarily swap the two resolvers so position is tried first:

```ts
    const department =
      findByPositionTitle(approval.position, departments) ??
      findByCodeOrName(approval.departmentCode ?? "", departments);
```

Re-run the file. The "prefers departmentCode" test MUST fail (it will resolve to MFG instead of quality-gate). Then restore the file and confirm `git diff src/domain/sop/approval-mapping.ts` is empty and the suite is green again.

If it does NOT go red, the fixture is wrong — the position string is not an exact `STANDARD_POSITION_TITLES` entry (`src/domain/departments.ts:27-37`) so the fallback resolves to nothing and the code wins under either ordering. Fix the fixture, do not proceed.

- [ ] **Step 3: Commit**

```bash
git add src/domain/sop/approval-mapping.test.ts
git commit -m "test: lock departmentCode precedence in approval mapping"
```

---

### Task 2: The picker in the notice

**Files:**
- Modify: `src/components/sop/converted-approvals-notice.tsx`
- Test: `src/components/sop/converted-approvals-notice.test.tsx`

**Interfaces:**
- Consumes: `mapApprovalsToDepartments`, `ApprovalMapping` (unchanged); `ThemedSelect` from `@/components/themed-select` (used with `variant="sop"`, `ariaLabel`, `value`, `disabled`, `options: {value,label}[]`, `onChange: (value: string) => void`).
- Produces: `ConvertedApprovalsNotice` gains
  `onSeatDepartment?: (approvalIndex: number, departmentId: string) => Promise<void>`.
  Task 3 supplies it.

- [ ] **Step 1: Write the failing tests**

Add to `src/components/sop/converted-approvals-notice.test.tsx`. The file already has `dept()`, `DEPARTMENTS`, `row()` and `bodyRows()` helpers — reuse them. `DEPARTMENTS` is `[dept("d-mfg","MFG","Manufacturing/Production"), dept("d-qas","QAS","Quality", true)]`.

```tsx
  it("offers a department picker on a row that matched nothing", () => {
    render(
      <ConvertedApprovalsNotice
        approvals={[row({ role: "Approved By", position: "IC Manager" })]}
        departments={DEPARTMENTS}
        seatedDepartmentIds={new Set()}
        onSeatDepartment={async () => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Department for the Approved By approval" })).toBeTruthy();
  });

  it("renders no picker when the caller supplies no handler", () => {
    render(
      <ConvertedApprovalsNotice
        approvals={[row({ role: "Approved By", position: "IC Manager" })]}
        departments={DEPARTMENTS}
        seatedDepartmentIds={new Set()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Department for the Approved By approval" })).toBeNull();
  });

  it("offers no picker on a row that is already seated", () => {
    render(
      <ConvertedApprovalsNotice
        approvals={[row({ role: "Approved By", position: "Manufacturing/Production Manager" })]}
        departments={DEPARTMENTS}
        seatedDepartmentIds={new Set(["d-mfg"])}
        onSeatDepartment={async () => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: "Department for the Approved By approval" })).toBeNull();
  });

  // Quality signs the final release; the transition guard refuses to release an
  // SOP whose Quality approver holds a seat. A picker here would invite the
  // author to create the one seat that blocks their own release.
  it("offers no picker on the quality-gate row", () => {
    render(
      <ConvertedApprovalsNotice
        approvals={[row({ role: "Quality Approval", position: "Quality" })]}
        departments={DEPARTMENTS}
        seatedDepartmentIds={new Set()}
        onSeatDepartment={async () => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: "Department for the Quality Approval approval" })).toBeNull();
  });

  it("excludes the quality-gate department and already-seated departments from the options", () => {
    const departments = [
      dept("d-mfg", "MFG", "Manufacturing/Production"),
      dept("d-eng", "ENG", "Engineering"),
      dept("d-qas", "QAS", "Quality", true),
    ];
    const { container } = render(
      <ConvertedApprovalsNotice
        approvals={[row({ role: "Approved By", position: "IC Manager" })]}
        departments={departments}
        seatedDepartmentIds={new Set(["d-mfg"])}
        onSeatDepartment={async () => {}}
      />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("ENG");
    expect(text).not.toContain("QAS");
  });

  it("reports the row index and chosen department to the handler", async () => {
    const calls: Array<[number, string]> = [];
    render(
      <ConvertedApprovalsNotice
        approvals={[
          row({ role: "Reviewed By", position: "Manufacturing/Production Manager" }),
          row({ role: "Approved By", position: "IC Manager" }),
        ]}
        departments={[dept("d-mfg", "MFG", "Manufacturing/Production"), dept("d-eng", "ENG", "Engineering")]}
        seatedDepartmentIds={new Set(["d-mfg"])}
        onSeatDepartment={async (index, departmentId) => {
          calls.push([index, departmentId]);
        }}
      />,
    );
    // Index 1 is the unresolved row; index 0 already resolved by position.
    fireEvent.click(screen.getByRole("button", { name: "Department for the Approved By approval" }));
    fireEvent.click(screen.getByRole("option", { name: /ENG/ }));
    await waitFor(() => expect(calls).toEqual([[1, "d-eng"]]));
  });
```

Add `fireEvent` and `waitFor` to the existing `@testing-library/react` import.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/components/sop/converted-approvals-notice.test.tsx
```

Expected: the new tests FAIL (no picker rendered); the ~10 existing tests still PASS.

- [ ] **Step 3: Implement the picker**

In `converted-approvals-notice.tsx`:

1. Extend the props:

```tsx
export function ConvertedApprovalsNotice({
  approvals,
  departments,
  seatedDepartmentIds,
  onSeatDepartment,
}: {
  approvals: readonly SopApproval[];
  departments: readonly Department[];
  seatedDepartmentIds: ReadonlySet<string>;
  /**
   * Turn an unresolved row into a real seat. Absent — a read-only viewer, or an
   * SOP past draft — renders the table exactly as it always was: a report.
   */
  onSeatDepartment?: (approvalIndex: number, departmentId: string) => Promise<void>;
}) {
```

2. `toRow` must carry the row's array index so the callback can name it. Add `index: number` to `NoticeRow` and set it from the existing `index` argument `toRow` already receives.

3. Compute the options once (they are the same for every row):

```tsx
  // Quality is the release gate, never a seat; an already-seated department has
  // nothing to add. Both exclusions mirror the roster's own add-row.
  const seatableDepartments = useMemo(
    () => departments.filter((d) => !d.isQualityGate && !seatedDepartmentIds.has(d.id)),
    [departments, seatedDepartmentIds],
  );
```

4. In the "Mapped to" cell, replace `{row.mappedTo || "—"}` with a picker when the row is unresolved and the callback exists:

```tsx
                <td className="px-4 py-2.5 align-middle text-[13px] text-ink">
                  {onSeatDepartment && (row.status === "no-match" || row.status === "seat-removed") ? (
                    <ThemedSelect
                      variant="sop"
                      ariaLabel={`Department for the ${row.documentRole} approval`}
                      value=""
                      disabled={pending === row.key}
                      menuMaxHeight={420}
                      options={[
                        { value: "", label: "Choose a department…" },
                        ...seatableDepartments.map((department) => ({
                          value: department.id,
                          label: `${department.code} · ${department.name}`,
                        })),
                      ]}
                      onChange={(departmentId) => {
                        if (!departmentId) return;
                        setPending(row.key);
                        void onSeatDepartment(row.index, departmentId).finally(() => setPending(null));
                      }}
                    />
                  ) : (
                    row.mappedTo || "—"
                  )}
                </td>
```

with `const [pending, setPending] = useState<string | null>(null);` at the top of the component. `value=""` always: the select is an action, not a bound field — once the write lands, the row re-derives as "Seat added" and the picker disappears.

Import `ThemedSelect` from `@/components/themed-select` and `useState` from `react`.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/components/sop/converted-approvals-notice.test.tsx
npm run typecheck && npm run lint
```

Expected: all tests pass (existing + 6 new); typecheck and lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/sop/converted-approvals-notice.tsx src/components/sop/converted-approvals-notice.test.tsx
git commit -m "feat: offer a department picker on unresolved converted approvals"
```

---

### Task 3: Wire the writes

**Files:**
- Modify: `src/components/sop/sop-roster-editor.tsx`
- Modify: `src/components/sop/sop-editor.tsx`

**Interfaces:**
- Consumes: `ConvertedApprovalsNotice`'s `onSeatDepartment?: (approvalIndex: number, departmentId: string) => Promise<void>` (Task 2); `upsertSeat(seat: SopReviewSeat): Promise<void>` from `@/lib/sop/review`; `SopEditor`'s existing `update(partial)` helper and `sop.approvals`.
- Produces: `SopRosterEditor` gains `onMapApproval?: (approvalIndex: number, departmentCode: string) => Promise<void>`. No other new exports.

- [ ] **Step 1: Add the roster editor's handler**

In `sop-roster-editor.tsx`, extend `RosterEditorProps`:

```ts
  /**
   * Persist the author's department choice onto the legacy approval row. Supplied
   * only when the document is editable; its absence is what hides the picker.
   */
  onMapApproval?: (approvalIndex: number, departmentCode: string) => Promise<void>;
```

Destructure it in the component signature, then add the handler:

```tsx
  async function seatConvertedApproval(approvalIndex: number, departmentId: string) {
    const department = departments.find((item) => item.id === departmentId);
    if (!department || !onMapApproval) return;
    await guarded(`map-${approvalIndex}`, async () => {
      // Document write FIRST. If the seat write then fails the row reads
      // "Seat removed" — accurate, still offers its picker, and a retry heals it.
      // Reversed, a failure would leave a seat under a row still claiming "No match".
      await onMapApproval(approvalIndex, department.code);
      await upsertSeat({ sopId, departmentId, rasic: "responsible", signerId: null });
    });
  }
```

Use the file's existing `guarded(key, fn)` helper (`sop-roster-editor.tsx:108`) — it already sets `busy`, clears and sets `error` via `getErrorMessage`, calls `onChanged()` on success, and no-ops while another write is in flight. Do NOT hand-roll busy/error/onChanged; that would diverge from every other seat write in the file.

Pass it down at the existing `<ConvertedApprovalsNotice>` call (`sop-roster-editor.tsx:415`):

```tsx
      <ConvertedApprovalsNotice
        approvals={convertedApprovals}
        departments={departments}
        seatedDepartmentIds={seatedDepartmentIds}
        onSeatDepartment={onMapApproval ? seatConvertedApproval : undefined}
      />
```

- [ ] **Step 2: Add the editor's document write**

In `sop-editor.tsx`, above the `step.id === "approvals"` block, add:

```tsx
  /**
   * Record the author's department choice on the legacy approval row. This is what
   * makes the mapping durable: mapApprovalsToDepartments resolves by departmentCode
   * before falling back to the position title, so the row re-derives as seated
   * instead of reading "No match" forever.
   */
  async function handleMapApproval(approvalIndex: number, departmentCode: string) {
    update({
      approvals: sop.approvals.map((approval, index) =>
        index === approvalIndex ? { ...approval, departmentCode } : approval,
      ),
    });
  }
```

Place it beside the component's other handlers, not inside JSX. If `update` is not the correct name for this component's state-writer, use whatever the neighbouring field handlers use — read them first.

Pass it to the roster editor (`sop-editor.tsx:2050`):

```tsx
                  <SopRosterEditor
                    sopId={sop.id}
                    departments={approvalDepartments}
                    seats={approvalSeats}
                    convertedApprovals={sop.source === "converted" ? sop.approvals : undefined}
                    onMapApproval={handleMapApproval}
                    onChanged={() => refreshApprovalRouting({ background: true })}
                  />
```

Because this branch only renders under `hasPersistedSop && canEdit`, supplying the prop here is exactly the intended gate: read-only viewers and non-draft SOPs never receive it, so they never see a picker.

- [ ] **Step 3: Fix the empty-routing message**

At `sop-editor.tsx:2072-2075`, the read-only fallback tells a saved draft to save itself. Replace the single message with the honest pair:

```tsx
                        <p className="px-4 py-8 text-center text-xs text-ink-tertiary">
                          {hasPersistedSop
                            ? "No department routing configured."
                            : "Save the draft to configure department routing."}
                        </p>
```

- [ ] **Step 4: Test the write order**

The order is the one thing a reviewer cannot see by reading the diff, and getting it backwards produces a seat under a row still reading "No match". Create `src/components/sop/sop-roster-editor.test.tsx`:

```tsx
// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SopRosterEditor } from "./sop-roster-editor";

vi.mock("@/lib/sop/review", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sop/review")>();
  return { ...actual, upsertSeat: vi.fn(async () => {}) };
});

describe("SopRosterEditor — seating a converted approval", () => {
  it("writes the approval row before creating the seat", async () => {
    const { upsertSeat } = await import("@/lib/sop/review");
    const order: string[] = [];
    (upsertSeat as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      order.push("seat");
    });

    render(
      <SopRosterEditor
        sopId="sop-1"
        departments={[
          { id: "d-eng", workspaceId: "ws", code: "ENG", name: "Engineering", isQualityGate: false },
        ]}
        seats={[]}
        convertedApprovals={[{ role: "Approved By", name: "R. Miller", position: "IC Manager", date: "" }]}
        onMapApproval={async () => {
          order.push("document");
        }}
        onChanged={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Department for the Approved By approval" }));
    fireEvent.click(screen.getByRole("option", { name: /ENG/ }));

    await waitFor(() => expect(order).toEqual(["document", "seat"]));
  });
});
```

If `SopRosterEditor` needs additional required props to render, supply minimal valid values — do not weaken the assertion.

- [ ] **Step 5: Run the full gate**

```bash
npx vitest run src/components/sop/sop-roster-editor.test.tsx
npm run typecheck && npm run lint && npx vitest run
```

Expected: the order test passes; clean; every test green.

- [ ] **Step 6: Commit**

```bash
git add src/components/sop/sop-roster-editor.tsx src/components/sop/sop-roster-editor.test.tsx src/components/sop/sop-editor.tsx
git commit -m "feat: seat a converted approval from its row, and fix the empty-routing message"
```

---

### Task 4: Live verification (controller-run)

**Files:** none — verification only.

**Interfaces:**
- Consumes: the running app, an edit-capable account.
- Produces: confirmation, or defects to fix before merge.

**Blocker to resolve first:** the browser session used for earlier verification is `rlopez@anacorp.com`, whose `org_tool_access.level` is `none`, so it only ever renders the read-only branch and **cannot see this feature at all**. Of the five production accounts only `jli@`, `tbach@` and `tnguyen@` carry `edit`. Verification needs one of those, or `rlopez` granted `edit`. Surface this to the user rather than reporting the read-only screen as a pass.

- [ ] **Step 1: Start the dev server** via `preview_start` with `{name: "dev"}` (never Bash).
- [ ] **Step 2: Open a converted SOP with unresolved rows as an edit-capable account.** `340e374c` (Control Plan — 3 rows, 0 seats, positions `Quality Manager`) or `5489db40` (test - to be deleted — 3 rows, 0 seats). Go to the Approvals step.
- [ ] **Step 3: Confirm the picker appears** on the "No match" rows and NOT on any quality-gate row.
- [ ] **Step 4: Choose a department.** Confirm: the row's status becomes "Seat added"; a new seat appears in the roster above with no reviewer assigned; the picker disappears from that row.
- [ ] **Step 5: Reload the page.** Confirm the row still reads "Seat added" — this proves the `departmentCode` write persisted, and is the single most important check in this task. If it reverts to "No match", the document write is not being saved and the feature is cosmetic.
- [ ] **Step 6: Confirm the seat is usable** — assign a reviewer to it in the roster, and confirm the option list is that department's members.
- [ ] **Step 7: Check the read-only path** — open the same SOP as `rlopez@anacorp.com` (or any `none` account) and confirm no picker renders and the panel now reads "No department routing configured." rather than telling a saved draft to save itself.
- [ ] **Step 8: Console clean**, then full gate and push:

```bash
npm run typecheck && npm run lint && npx vitest run && npm run build
git push -u origin feat/map-converted-approvers
```

---

## Follow-up, not in this plan

- The 11 converted SOPs already carrying transcribed approver names (`rmiller@anacorp.com`, `Name`, `______`) keep them in `sop.approvals`. This feature makes their *departments* actionable; the names remain historical record with no editor.
- `rlopez@anacorp.com` having `org_tool_access = none` is unrelated to this feature but blocks its verification — and means that account cannot edit any SOP.
