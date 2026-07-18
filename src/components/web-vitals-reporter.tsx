"use client";

import { useReportWebVitals } from "next/web-vitals";

const webVitalsEndpoint = process.env.NEXT_PUBLIC_WEB_VITALS_ENDPOINT;

export function WebVitalsReporter() {
  useReportWebVitals((metric) => {
    if (!webVitalsEndpoint) {
      return;
    }

    const body = JSON.stringify({
      ...metric,
      path: window.location.pathname,
      recordedAt: new Date().toISOString(),
    });

    if (navigator.sendBeacon) {
      navigator.sendBeacon(webVitalsEndpoint, new Blob([body], { type: "application/json" }));
      return;
    }

    void fetch(webVitalsEndpoint, {
      method: "POST",
      body,
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      cache: "no-store",
    });
  });

  return null;
}
