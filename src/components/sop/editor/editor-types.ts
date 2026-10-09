import type { ReactNode } from "react";
import type { Sop } from "@/domain/sop/schema";

export type SopPatch = Partial<Sop> | ((current: Sop) => Partial<Sop>);
export type SectionEditors = Record<
  | "purpose"
  | "scope"
  | "definitions"
  | "references"
  | "responsible"
  | "measurements",
  ReactNode
>;
export interface ReviewSectionProps {
  builderHasFeedback: boolean;
  reviewCategoriesNeedingAttention: Set<string>;
  builderFeedback: (category: string) => ReactNode;
}
