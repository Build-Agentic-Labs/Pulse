"use client";

import { useState } from "react";
import { createEmptySop } from "@/domain/sop/schema";
import { newSopId } from "@/lib/sop/store";
import { SopEditor } from "./sop-editor";

export function SopNewClient() {
  // Build the blank SOP once, client-side (needs crypto + Date).
  const [initial] = useState(() => createEmptySop(newSopId(), new Date().toISOString()));
  return <SopEditor initial={initial} />;
}
