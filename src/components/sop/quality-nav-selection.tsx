"use client";

import type { ReactNode } from "react";
import { NavSelectionTrack } from "@/components/nav-selection-track";

export function QualityNavSelection({ children }: { children: ReactNode }) {
  return <NavSelectionTrack persistenceKey="quality" className="flex min-h-full flex-col">{children}</NavSelectionTrack>;
}
