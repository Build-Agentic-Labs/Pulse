import { splitInstruction } from "./split-instruction";
import { WORK_INSTRUCTION_LAYOUTS, type WorkInstructionCard } from "./schema";

/** Reflow canonical release cards without changing their stored content or fingerprint. */
export function letterCards(cards: WorkInstructionCard[]): WorkInstructionCard[] {
  return cards.flatMap((card) => {
    const slices = splitInstruction(card.instruction, WORK_INSTRUCTION_LAYOUTS.letter.instruction, WORK_INSTRUCTION_LAYOUTS.letter.continuation);
    return (slices.length ? slices : [""]).map((instruction, index) => ({
      ...card, instruction,
      photo: card.photo ?? cards.find(entry => entry.stepId === card.stepId && entry.photo)?.photo,
      tools: index === 0 ? card.tools : [],
      checks: index === slices.length - 1 || slices.length === 0 ? card.checks : [],
      // Keep the referenced image visible on continuations as well.
    }));
  }).map((card, index, all) => {
    const siblings = all.filter((entry) => entry.stepId === card.stepId);
    return { ...card, part: all.slice(0, index + 1).filter((entry) => entry.stepId === card.stepId).length, partCount: siblings.length };
  });
}
