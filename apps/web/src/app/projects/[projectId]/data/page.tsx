import { MonitoringDataPage } from "@/components/monitoring/data-page";

export const metadata = {
  title: "Monitoring data — 3DMinRV",
  description: "Load a project's monitoring data from the site's spreadsheet, through its approved tag map, and check it.",
};

export default async function ProjectDataPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <MonitoringDataPage projectId={projectId} />;
}
