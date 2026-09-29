import type { WorkInstructionCard } from "./schema";

/** Keep authored steps together; the renderer measures their real wrapped height.
 * Legacy cards remain unchanged in storage and retain their release fingerprint.
 */
export function letterCards(cards: WorkInstructionCard[]): WorkInstructionCard[] {
  const groups = new Map<string, WorkInstructionCard[]>();
  for (const card of cards) groups.set(card.stepId, [...(groups.get(card.stepId) ?? []), card]);
  return Array.from(groups.values(), (parts) => {
    const ordered = [...parts].sort((a, b) => a.part - b.part);
    const first = ordered[0];
    return {
      ...first,
      instruction: ordered.map(part => part.instruction).filter(Boolean).join("\n"),
      part: 1,
      partCount: 1,
      overflowing: false,
      photo: ordered.find(part => part.photo)?.photo,
      tools: [...new Set(ordered.flatMap(part => part.tools))],
      checks: [...new Map(ordered.flatMap(part => part.checks).map(check => [check.key, check])).values()],
      partReferences: [...new Map(ordered.flatMap(part => part.partReferences ?? []).map(part => [part.marker, part])).values()],
    };
  });
}

/** Pack whole steps using each step's measured height, preserving authored order. */
export function letterPageCounts(heights: number[], firstAvailable: number, laterAvailable: number): number[] {
  const counts: number[] = [];
  let index = 0;
  do {
    const first = counts.length === 0;
    const available = first ? firstAvailable : laterAvailable;
    const limit = first ? 2 : 3;
    let used = 0;
    let count = 0;
    while (index + count < heights.length && count < limit && used + heights[index + count] <= available) {
      used += heights[index + count];
      count++;
    }
    // An oversized step still renders so the overflow warning can explain it.
    if (!first && count === 0 && index < heights.length) count = 1;
    counts.push(count);
    index += count;
  } while (index < heights.length);
  return counts;
}
