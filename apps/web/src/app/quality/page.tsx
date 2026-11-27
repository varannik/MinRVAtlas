import { Suspense } from "react";

import { DataQualityPage } from "@/components/data-quality/data-quality-page";

export const metadata = {
  title: "Data quality — 3DMinRV",
  description: "A project's data quality checks: every finding and decision, coverage, runs, and the rules and tag map in force.",
};

export default function QualityPage() {
  return (
    <Suspense fallback={<main className="journey-strata fixed inset-0 grid place-items-center text-[13px] text-calcite/60">Opening data quality…</main>}>
      <DataQualityPage />
    </Suspense>
  );
}
