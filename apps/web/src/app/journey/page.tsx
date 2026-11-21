import { JourneyEntry } from "@/components/journey/journey-entry";

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
  const params = await searchParams;
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? null;
  // ?project=<Cortex project> opens its saved journey; ?practice=<scenario> a practice one.
  return <JourneyEntry request={{ project: first(params.project), practice: first(params.practice) }} />;
}
