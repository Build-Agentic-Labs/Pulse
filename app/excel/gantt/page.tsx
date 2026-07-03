import Script from "next/script";
import { ExcelGanttRouteShell } from "@/components/project-route-shells";

export const metadata = {
  title: "Gantt for Excel | Pulse",
  description: "Excel-hosted Pulse Gantt workspace",
};

export default function ExcelGanttPage() {
  return (
    <>
      <Script src="https://appsforoffice.microsoft.com/lib/1/hosted/office.js" strategy="afterInteractive" />
      <div className="excel-addin-shell">
        <ExcelGanttRouteShell />
      </div>
    </>
  );
}
