/**
 * Image files carried by a paste/drop DataTransfer.
 *
 * Prefers `items` and falls back to `files` on purpose: screenshot tools and browsers
 * disagree about which collection they populate, and the fallback is what makes Cmd+V
 * work across both.
 */
export function clipboardImageFiles(data: DataTransfer | null): File[] {
  if (!data) {
    return [];
  }

  const itemFiles = Array.from(data.items ?? [])
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));

  const candidates = itemFiles.length > 0 ? itemFiles : Array.from(data.files ?? []);
  return candidates.filter((file) => file.type.startsWith("image/"));
}
