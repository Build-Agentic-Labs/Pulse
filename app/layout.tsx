import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { ConfirmProvider } from "@/components/confirm-provider";
import { DisplayNamePrompt } from "@/components/display-name-prompt";
import { ThemeProvider } from "@/components/theme-provider";
import { WebVitalsReporter } from "@/components/web-vitals-reporter";
import { themeInitScript } from "@/lib/theme-init";
import "./globals.css";

const supabaseOrigin = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin
  : "https://neaadefipcpxxcqszpud.supabase.co";

const inter = localFont({
  variable: "--font-inter",
  display: "swap",
  src: [
    {
      path: "../node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../node_modules/@fontsource/inter/files/inter-latin-500-normal.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "../node_modules/@fontsource/inter/files/inter-latin-600-normal.woff2",
      weight: "600",
      style: "normal",
    },
    {
      path: "../node_modules/@fontsource/inter/files/inter-latin-700-normal.woff2",
      weight: "700",
      style: "normal",
    },
  ],
});

export const metadata: Metadata = {
  title: "Pulse",
  description: "Manufacturing line development planner",
  icons: {
    icon: "/pulse-favicon.png",
    apple: "/apple-touch-icon.png",
  },
};

// `viewportFit: "cover"` is load-bearing: every `env(safe-area-inset-*)` in the
// codebase resolves to 0 without it.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-font="inter"
      className={`${inter.variable} h-full overflow-hidden`}
      suppressHydrationWarning
    >
      <head>
        <link rel="preconnect" href={supabaseOrigin} crossOrigin="" />
        <link rel="dns-prefetch" href={supabaseOrigin} />
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <style
          dangerouslySetInnerHTML={{
            __html:
              ".ui-loading-status-shell{height:12px;overflow:hidden;display:flex;align-items:center}.ui-loading-status,.nd-status{font-family:var(--font-ui-family);font-size:12px;line-height:12px;letter-spacing:.04em;white-space:nowrap}",
          }}
        />
      </head>
      <body className="h-full overflow-hidden font-sans">
        <ThemeProvider>
          <ConfirmProvider>
            {children}
            <DisplayNamePrompt />
          </ConfirmProvider>
        </ThemeProvider>
        <WebVitalsReporter />
      </body>
    </html>
  );
}
