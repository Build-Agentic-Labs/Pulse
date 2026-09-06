export const VITAL_NAMES = ["CLS", "FCP", "INP", "LCP", "TTFB"] as const;

export function performanceRoute(path: string) {
  // Report route shapes, never project/task IDs or URL search parameters.
  return path.split("?")[0]
    .replace(/\/projects\/[^/]+/g, "/projects/[projectId]")
    .replace(/\/work-orders\/(?!new(?:\/|$))[^/]+/g, "/work-orders/[id]")
    .replace(/\/sops\/(?!new(?:\/|$)|review(?:\/|$)|dashboard(?:\/|$)|library(?:\/|$)|departments(?:\/|$))[^/]+/g, "/sops/[sopId]");
}

export function parseWebVital(input: unknown) {
  if (!input || typeof input !== "object") return null;
  const metric = input as Record<string, unknown>;
  if (!VITAL_NAMES.includes(metric.name as typeof VITAL_NAMES[number]) ||
    typeof metric.value !== "number" || !Number.isFinite(metric.value) || metric.value < 0 ||
    typeof metric.path !== "string" || !metric.path.startsWith("/") || metric.path.length > 300) return null;
  return {
    name: metric.name as typeof VITAL_NAMES[number],
    value: metric.value,
    path: performanceRoute(metric.path),
    rating: ["good", "needs-improvement", "poor"].includes(String(metric.rating)) ? metric.rating : undefined,
  };
}
