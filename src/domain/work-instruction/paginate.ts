/**
 * Splits a work instruction into printed ledger sheets.
 *
 * Pure and synchronous, which is the whole point of the fixed 3x2 grid: because
 * every card occupies a slot of known size, pagination is arithmetic. Contrast
 * `src/domain/sop/pagination.ts`, which must measure real DOM because SOP prose
 * is variable-height and has to flow.
 */

import {
  CARDS_ON_FIRST_SHEET,
  CARDS_PER_SHEET,
  type WorkInstruction,
  type WorkInstructionCard,
  type WorkInstructionSheet,
} from "./schema";

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
  // Sheet 1 carries the setup band plus the first row of cards; the band is
  // sized to exactly one card row, so the rest of the sheet is a normal row
  // rather than white space. Purely a page-count saving.
  const onFirst = instruction.cards.slice(0, CARDS_ON_FIRST_SHEET);
  const remaining = instruction.cards.slice(CARDS_ON_FIRST_SHEET);

  // A blank instruction gets an extra sheet of ruled slots so the fill-in form
  // has somewhere to write past the first three steps.
  const stepGroups = instruction.blank ? [[]] : chunk(remaining, CARDS_PER_SHEET);
  const total = stepGroups.length + 1;

  return [
    { kind: "setup", page: 1, total, cards: onFirst },
    ...stepGroups.map((cards, index) => ({ kind: "steps" as const, page: index + 2, total, cards })),
  ];
}
