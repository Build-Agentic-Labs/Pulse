import type { SignatureStrokes } from "@/domain/sop/signature";

/** Convert the typed mark to the same fixed vector coordinates as a drawn signature.
 * This keeps the saved approval independent of fonts on a later PDF viewer's device.
 */
export function typedSignatureStrokes(name: string): SignatureStrokes {
  const text = name.trim();
  if (!text) return [];
  const canvas = document.createElement("canvas");
  canvas.width = 600;
  canvas.height = 180;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Your browser could not prepare the typed signature.");
  context.font = '48px "Pulse Signature"';
  const size = Math.min(48, 540 / Math.max(context.measureText(text).width, 1) * 48);
  context.font = `${size}px "Pulse Signature"`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, 300, 90);
  const pixels = context.getImageData(0, 0, 600, 180).data;
  const strokes: SignatureStrokes = [];
  for (let y = 0; y < 180; y += 2) {
    let start = -1;
    for (let x = 0; x <= 600; x++) {
      const ink = x < 600 && pixels[(y * 600 + x) * 4 + 3] >= 128;
      if (ink && start < 0) start = x;
      if (!ink && start >= 0) {
        strokes.push([{ x: start, y }, { x: x - 1, y }]);
        start = -1;
      }
    }
  }
  if (!strokes.length || JSON.stringify(strokes).length > 90000) {
    throw new Error("Please use a shorter name for your signature.");
  }
  return strokes;
}

let fontReady: Promise<void> | undefined;
export function loadSignatureFont(): Promise<void> {
  if (!fontReady) {
    fontReady = new FontFace("Pulse Signature", "url(/fonts/dancing-script.ttf)").load().then(font => {
      document.fonts.add(font);
    }).catch(error => { fontReady = undefined; throw error; });
  }
  return fontReady;
}
