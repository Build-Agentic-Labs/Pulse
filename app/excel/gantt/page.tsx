import Script from "next/script";
import { ExcelGanttRouteShell } from "@/components/project-route-shells";

export const metadata = {
  title: "M-Tools Gantt for Excel",
  description: "Excel-hosted BuildLogic Gantt workspace",
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
