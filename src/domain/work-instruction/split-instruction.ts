/**
 * Splits a step's instruction text across continuation cards.
 *
 * A work instruction card is a fixed slot on a printed sheet, so long text has
 * to go somewhere. Flagging it and asking the author to split the step by hand
 * pushes document structure onto the person least able to see the page
 * geometry; splitting it here keeps the authored step intact and lets the
 * document paginate itself, the same way prose flows in the SOP print preview.
 *
 * Breaks at sentence boundaries where it can, word boundaries where it must,
 * and never mid-word. A single token longer than the budget is emitted alone —
 * the renderer marks that card as overflowing, which is the one case a human
 * has to resolve.
 */

/** Sentence-ending punctuation followed by whitespace. */
const SENTENCE_BREAK = /(?<=[.!?:;])\s+/;

function packPieces(pieces: string[], joiner: string, budgetFor: (index: number) => number): string[] {
  return pieces.reduce<string[]>((chunks, piece) => {
    const index = chunks.length === 0 ? 0 : chunks.length - 1;
    const current = chunks[chunks.length - 1];

    if (current === undefined) {
      return [piece];
    }

    const merged = `${current}${joiner}${piece}`;
    if (merged.length <= budgetFor(index)) {
      return [...chunks.slice(0, -1), merged];
    }
    return [...chunks, piece];
  }, []);
}

export function splitInstruction(text: string, firstBudget: number, restBudget: number): string[] {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }

  const budgetFor = (index: number) => (index === 0 ? firstBudget : restBudget);
  if (trimmed.length <= firstBudget) {
    return [trimmed];
  }

  const sentences = trimmed.split(SENTENCE_BREAK).filter((sentence) => sentence.trim() !== "");

  // Any sentence that still will not fit is broken down into words, which are
  // then packed the same way. A word wider than the budget survives on its own.
  const pieces = sentences.flatMap((sentence, index) => {
    if (sentence.length <= budgetFor(index)) {
      return [sentence];
    }
    return packPieces(sentence.split(/\s+/).filter(Boolean), " ", budgetFor);
  });

  return packPieces(pieces, " ", budgetFor).filter((chunk) => chunk.trim() !== "");
}
