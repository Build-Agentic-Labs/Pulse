/** Keep prose compact and give the remaining printable height to photographs. */
export function fillWiPhotoRows(rows: { height: number; hasPhoto: boolean; maxHeight?: number }[], available: number) {
  let spare = Math.max(0, available - rows.reduce((sum, row) => sum + row.height, 0));
  const heights = rows.map(row => row.height);
  while (spare > 0.01) {
    const growing = rows.map((row, index) => ({ row, index })).filter(({ row, index }) =>
      row.hasPhoto && heights[index] < (row.maxHeight ?? Infinity));
    if (!growing.length) break;
    const share = spare / growing.length;
    for (const { row, index } of growing) {
      const growth = Math.min(share, (row.maxHeight ?? Infinity) - heights[index]);
      heights[index] += growth;
      spare -= growth;
    }
  }
  return heights;
}

/** Measured wrapping also splits long unbroken tokens; no instruction characters are dropped. */
export function wrapWiPdfText(
  text: string,
  width: number,
  measure: (text: string) => number,
) {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const token of paragraph.match(/\S+\s*|\s+/g) ?? []) {
      if (line && measure(line + token) > width) {
        lines.push(line.trimEnd());
        line = "";
      }
      for (const character of token) {
        if (line && measure(line + character) > width) {
          lines.push(line.trimEnd());
          line = "";
        }
        line += character;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}
