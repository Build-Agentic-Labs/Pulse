import type { Metadata } from "next";
import { NothingDesignShowcase } from "@/components/nothing-design-showcase";

export const metadata: Metadata = {
  title: "Nothing Design · Pulse",
  description: "Nothing-inspired design system showcase with light and dark mode",
};

export default function NothingDesignPage() {
  return <NothingDesignShowcase />;
}
