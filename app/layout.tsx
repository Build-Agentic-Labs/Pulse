import type { Metadata } from "next";
import { Doto, Space_Grotesk, Space_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { themeInitScript } from "@/lib/theme-init";
import "./globals.css";

const grotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  weight: ["300", "400", "500", "700"],
});

const mono = Space_Mono({
  subsets: ["latin"],
  variable: "--font-space-mono",
  weight: ["400", "700"],
  adjustFontFallback: true,
  preload: true,
});

const doto = Doto({
  subsets: ["latin"],
  variable: "--font-doto",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Pulse",
  description: "Manufacturing line development planner",
};

export const dynamic = "force-dynamic";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${grotesk.variable} ${mono.variable} ${doto.variable} h-full overflow-hidden`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <style
          dangerouslySetInnerHTML={{
            __html:
              ".ui-loading-status-shell{height:12px;overflow:hidden;display:flex;align-items:center}.ui-loading-status,.nd-status{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:12px;line-height:12px;letter-spacing:.04em;white-space:nowrap}",
          }}
        />
      </head>
      <body className="h-full overflow-hidden font-sans">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
