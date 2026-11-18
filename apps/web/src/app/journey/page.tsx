import { JourneyEntry } from "@/components/journey/journey-entry";
import { isScenarioId } from "@/lib/journey/scenarios";

export const metadata = {
  title: "Journey — 3DMinRV",
  description:
    "Where a project stands on its Puro path: facility validation once, then verification every monitoring period, with Cortex asking for what each step needs.",
};

export default async function JourneyPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { project } = await searchParams;
  const id = Array.isArray(project) ? project[0] : project;
  return <JourneyEntry initialScenario={isScenarioId(id) ? id : "fujairah-mineral"} />;
}
