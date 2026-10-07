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
