export async function preparePhotoOverlay(file: File) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error("Choose a JPG, PNG or WebP image.");
  if (file.size > 20 * 1024 * 1024) throw new Error("Choose an image smaller than 20 MB.");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Unable to read this image."));
      image.src = url;
    });
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 1000 / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Unable to prepare this image.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/webp", 0.8);
    if (dataUrl.length > 500_000) throw new Error("This image is too detailed for an overlay. Crop or resize it before adding it.");
    return { dataUrl, sourceWidth: canvas.width, sourceHeight: canvas.height };
  } finally { URL.revokeObjectURL(url); }
}
