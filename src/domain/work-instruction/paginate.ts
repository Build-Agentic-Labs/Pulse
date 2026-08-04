/**
 * Splits a work instruction into printed ledger sheets.
 *
 * Pure and synchronous, which is the whole point of the fixed 3x2 grid: because
 * every card occupies a slot of known size, pagination is arithmetic. Contrast
 * `src/domain/sop/pagination.ts`, which must measure real DOM because SOP prose
 * is variable-height and has to flow.
 */

import { CARDS_PER_SHEET, type WorkInstruction, type WorkInstructionCard, type WorkInstructionSheet } from "./schema";

function chunk(cards: WorkInstructionCard[], size: number): WorkInstructionCard[][] {
  return cards.reduce<WorkInstructionCard[][]>((accumulator, card, index) => {
    if (index % size === 0) {
      return [...accumulator, [card]];
    }
    const previous = accumulator.slice(0, -1);
    const current = accumulator[accumulator.length - 1];
    return [...previous, [...current, card]];
  }, []);
}

export function paginateWorkInstruction(instruction: WorkInstruction): WorkInstructionSheet[] {
  const grouped = chunk(instruction.cards, CARDS_PER_SHEET);
  // A blank instruction still prints one step sheet, of ruled empty slots, so
  // the document is usable as a fill-in form.
  const stepGroups = grouped.length > 0 ? grouped : [[]];
  const total = stepGroups.length + 1;

  return [
    { kind: "setup", page: 1, total, cards: [] },
    ...stepGroups.map((cards, index) => ({ kind: "steps" as const, page: index + 2, total, cards })),
  ];
}
