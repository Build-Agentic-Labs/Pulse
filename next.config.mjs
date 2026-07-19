import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";

const supabaseOrigin = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin
  : "https://neaadefipcpxxcqszpud.supabase.co";
const supabaseRealtimeOrigin = supabaseOrigin.replace(/^https:/, "wss:");
const isDevelopment = process.env.NODE_ENV !== "production";
const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""} https://appsforoffice.microsoft.com`,
      // fflate (read-excel-file's unzip step, used by the Planning workbook/item-master
      // uploads) decompresses inside a Web Worker created from a blob: URL. Without an
      // explicit worker-src, workers fall back to script-src (which has no blob:), Chrome
      // blocks the worker, fflate's callback never fires, and the upload spins forever.
      "worker-src 'self' blob:",
      "style-src 'self' 'unsafe-inline'",
      `img-src 'self' data: blob: ${supabaseOrigin}`,
      `connect-src 'self' ${supabaseOrigin} ${supabaseRealtimeOrigin}${isDevelopment ? " ws://localhost:* ws://127.0.0.1:*" : ""}`,
      "font-src 'self' data:",
      "frame-ancestors 'self' https://*.office.com https://*.officeapps.live.com https://*.microsoft.com",
      "form-action 'self'",
    ].join("; "),
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    // Browsers ignore HSTS over plain http, so local dev is unaffected.
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "geolocation=(), microphone=(), payment=(), usb=(), camera=(self)",
  },
];

/** @type {(phase: string) => import('next').NextConfig} */
const nextConfig = (phase) => ({
  distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next",
  // Lint runs as a dedicated CI gate via `npm run lint`; Next 16 removed the
  // `eslint` config key (builds never lint anymore).
  async headers() {
    return [
      {
        source: "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
        headers: securityHeaders,
      },
      {
        source: "/api/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "private, no-store, max-age=0",
          },
        ],
      },
    ];
  },
});

export default nextConfig;
