import type { PendingWiEdit, WiEdit } from "./schema";
/** Coalesce only edits never issued to the database; issued operation identities are immutable. */
export function appendWiEdit(
  entries: PendingWiEdit[],
  edit: WiEdit,
  operation: string,
): PendingWiEdit[] {
  const last = entries.at(-1);
  if (
    last &&
    last.issued !== true &&
    last.edit.kind === edit.kind &&
    (edit.kind === "details" ||
      (edit.kind === "step" &&
        last.edit.kind === "step" &&
        last.edit.payload.id === edit.payload.id))
  ) {
    const merged = {
      kind: edit.kind,
      payload: { ...last.edit.payload, ...edit.payload },
    } as WiEdit;
    return [...entries.slice(0, -1), { ...last, operation, edit: merged }];
  }
  return [...entries, { operation, edit }];
}
