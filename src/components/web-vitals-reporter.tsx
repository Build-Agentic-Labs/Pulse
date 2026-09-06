"use client";

import { useReportWebVitals } from "next/web-vitals";
import { performanceRoute } from "@/lib/web-vitals";

const webVitalsEndpoint = process.env.NEXT_PUBLIC_WEB_VITALS_ENDPOINT || "/api/performance";

export function WebVitalsReporter() {
  useReportWebVitals((metric) => {
    if (process.env.NODE_ENV !== "production") {
      return;
    }

    const body = JSON.stringify({
      name: metric.name,
      value: metric.value,
      rating: metric.rating,
      path: performanceRoute(window.location.pathname),
      recordedAt: new Date().toISOString(),
    });

    if (navigator.sendBeacon?.(webVitalsEndpoint, new Blob([body], { type: "application/json" }))) {
      return;
    }

    void fetch(webVitalsEndpoint, {
      method: "POST",
      body,
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      cache: "no-store",
    }).catch(() => undefined);
  });

  return null;
}
