import { Suspense } from "react";

import { VerificationPage } from "@/components/verification/verification-page";

export const metadata = {
  title: "Verification — 3DMinRV",
  description: "Review a project's submission against Puro's Audit Document Index: every evidence piece, the clauses it answers and the documents filed under it.",
};

export default function Page() {
  return (
    <Suspense fallback={<main className="journey-strata fixed inset-0 grid place-items-center text-[13px] text-calcite/60">Opening verification…</main>}>
      <VerificationPage />
    </Suspense>
  );
}
