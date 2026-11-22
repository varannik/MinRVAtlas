import { Suspense } from "react";

import { LedgerWorkspace } from "@/components/ledger/ledger-workspace";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Ledger — 3DMinRV",
  description: "Read and move Isometric Registry credit inventory.",
};

export default function LedgerPage() {
  return (
    <Suspense
      fallback={
        <div className="atlas-backdrop fixed inset-0 grid place-items-center text-sm text-strata-700">
          Opening the ledger…
        </div>
      }
    >
      <LedgerWorkspace />
    </Suspense>
  );
}
