import type { AwiMaster } from "@/lib/awi/store";

export function groupAwiMasters(masters: readonly AwiMaster[]) {
  const groups = new Map<string, { category: string; masters: AwiMaster[] }>();
  for (const master of masters) {
    const category = master.category?.trim() || "Uncategorized";
    const key = category.toLocaleLowerCase();
    const group = groups.get(key) ?? { category, masters: [] };
    group.masters.push(master);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) =>
    Number(a.category === "Uncategorized") - Number(b.category === "Uncategorized")
    || a.category.localeCompare(b.category, undefined, { sensitivity: "base" }),
  ).map(group => ({ ...group, masters: group.masters.sort((a, b) =>
    a.document_number.localeCompare(b.document_number, undefined, { numeric: true, sensitivity: "base" }) || a.id.localeCompare(b.id),
  ) }));
}
