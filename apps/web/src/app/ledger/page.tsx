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
        <div className="fixed inset-0 grid place-items-center bg-ink-950 text-sm text-mist">
          Opening the ledger…
        </div>
      }
    >
      <LedgerWorkspace />
    </Suspense>
  );
}
