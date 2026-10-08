import type { GeneralWorkInstruction } from "@/domain/quality/work-instruction-template";
/** Browser font measurement keeps the existing header design while allowing long metadata. */
export function wiHeaderHeightTwips(model: GeneralWorkInstruction) {
  const context = document.createElement("canvas").getContext("2d");
  if (!context) throw new Error("Document layout measurement is unavailable.");
  function lines(text: string, width: number, font: string) {
    context!.font = font;
    let count = 0;
    for (const paragraph of text.split("\n")) {
      let line = "";
      for (const word of paragraph.split(/\s+/)) {
        if (
          context!.measureText(line ? line + " " + word : word).width <= width
        ) {
          line = line ? line + " " + word : word;
          continue;
        }
        if (line) {
          count++;
          line = "";
        }
        for (const char of word) {
          if (line && context!.measureText(line + char).width > width) {
            count++;
            line = "";
          }
          line += char;
        }
      }
      count++;
    }
    return count;
  }
  // Match the shared Word header's logo/revision columns. Twips = CSS px × 15.
  const title =
    lines(model.title, 7.7 * 96 - 108 - 230 - 20, "bold 12pt Arial") * 20 +
    58;
  const height = Math.max(84, title);
  if (height > 7 * 96)
    throw new Error(
      "Shorten the title before exporting on letter paper.",
    );
  return Math.ceil(height * 15);
}
