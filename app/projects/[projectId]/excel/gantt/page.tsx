import Script from "next/script";
import { ExcelGanttRouteShell } from "@/components/project-route-shells";

export const metadata = {
  title: "Gantt for Excel | Pulse",
  description: "Excel-hosted Pulse Gantt workspace",
};

export default async function ProjectExcelGanttPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  return (
    <>
      <Script src="https://appsforoffice.microsoft.com/lib/1/hosted/office.js" strategy="afterInteractive" />
      <div className="excel-addin-shell">
        <ExcelGanttRouteShell projectId={projectId} />
      </div>
    </>
  );
}
