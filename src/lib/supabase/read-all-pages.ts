// Stay below the hosted API's default row cap. Every caller must provide a
// deterministic order (including a unique tie-breaker) and rebuild its query.
export const READ_PAGE_SIZE = 500;

export async function readAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<T[] | null>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += READ_PAGE_SIZE) {
    const page = await fetchPage(offset, offset + READ_PAGE_SIZE - 1);
    if (!page) throw new Error("Database returned no result while loading records.");
    rows.push(...page);
    if (page.length < READ_PAGE_SIZE) return rows;
  }
}

/** Bound IN-filter URLs as well as response sizes for child collections. */
export async function readRowsByIds<T>(
  ids: string[],
  fetchPage: (ids: string[], from: number, to: number) => PromiseLike<T[] | null>,
  maxEncodedFilterLength = Number.POSITIVE_INFINITY,
): Promise<T[]> {
  const rows: T[] = [];
  for (let start = 0; start < ids.length;) {
    const batch: string[] = [];
    let length = 0;
    while (start < ids.length && batch.length < 100) {
      // JSON quoting conservatively covers PostgREST's quoting/escaping; the
      // byte budget matters for long email addresses as well as UUIDs.
      const nextLength = encodeURIComponent(JSON.stringify(ids[start])).length + 3;
      if (batch.length && length + nextLength > maxEncodedFilterLength) break;
      batch.push(ids[start++]);
      length += nextLength;
    }
    rows.push(...await readAllPages((from, to) => fetchPage(batch, from, to)));
  }
  return rows;
}
