import { CortexEntry } from "@/components/cortex/cortex-entry";

export const metadata = {
  title: "Cortex — 3DMinRV",
  description:
    "The AI data expert behind MinRV: anomaly detection, rules, runs, knowledge and verification, each one a capability you can teach.",
};

/**
 * `pin` opens a capability; `back` (a journey path) offers the way back. Read
 * here rather than from window.location, which still holds the previous URL
 * on the first render after an in-app navigation.
 */
export default async function CortexPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { pin, back } = await searchParams;
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? null;
  return <CortexEntry pin={first(pin)} back={first(back)} />;
}
