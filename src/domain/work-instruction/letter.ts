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
    const limit = first ? 1 : 2;
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

/** Preserve every character while preferring action/word boundaries between pages. */
export function splitLetterInstruction(text: string, fits: (text: string) => boolean): string[] {
  const parts: string[] = [];
  let remaining = text;
  while (remaining && !fits(remaining)) {
    let low = 0;
    let high = remaining.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (fits(remaining.slice(0, middle))) low = middle;
      else high = middle - 1;
    }
    if (low === 0) break; // Metadata alone needs the overflow fallback.
    const prefix = remaining.slice(0, low);
    const action = Math.max(prefix.lastIndexOf("\n"), prefix.lastIndexOf("•"));
    const word = prefix.lastIndexOf(" ");
    const boundary = action > 0 ? action + (prefix[action] === "\n" ? 1 : 0) : word > low / 2 ? word + 1 : low;
    parts.push(remaining.slice(0, boundary));
    remaining = remaining.slice(boundary);
  }
  if (remaining) parts.push(remaining);
  return parts.length ? parts : [text];
}
