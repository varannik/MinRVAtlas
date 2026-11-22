import { JourneyEntry } from "@/components/journey/journey-entry";
import { readAtlasHint } from "@/lib/journey/atlas";

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
  // ?project=<id> opens its saved journey; ?practice=<scenario> a practice one. An Atlas
  // link also carries name, registry and at, so a project Cortex has no journey for
  // still opens as itself, on any registry.
  const atlas = readAtlasHint(first(params.name), first(params.registry), first(params.at));
  return <JourneyEntry request={{ project: first(params.project), practice: first(params.practice), atlas }} />;
}
