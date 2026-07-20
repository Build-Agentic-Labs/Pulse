"use client";

import { useSearchParams } from "next/navigation";
import { ProductLoadingState, SettingsLoadingState } from "@/components/space-loading-states";

export default function ProjectLoading() {
  const searchParams = useSearchParams();
  return searchParams.get("view") === "settings" ? <SettingsLoadingState /> : <ProductLoadingState />;
}
