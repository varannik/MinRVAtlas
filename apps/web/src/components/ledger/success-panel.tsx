"use client";

import type { MutationResult } from "@/lib/ledger/types";
import { quietButtonClass } from "./ui";

export function SuccessPanel({
  title,
  result,
  onDismiss,
}: {
  title: string;
  result: MutationResult;
  onDismiss: () => void;
}) {
  return (
    <div className="rounded-2xl bg-olivine-100 px-5 py-4 text-sm text-earth">
      <div className="font-semibold text-olivine-800">{title}</div>
      <div className="mt-1 font-mono text-xs text-strata-700">{result.id}</div>
      {result.url ? (
        <a
          href={result.url}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block text-olivine-700 underline"
        >
          Open certificate
        </a>
      ) : (
        <div className="mt-2 text-strata-700">The registry did not return a certificate link.</div>
      )}
      <div className="mt-2 text-strata-700">Balance and batches were reloaded.</div>
      <button type="button" className={`${quietButtonClass} mt-3`} onClick={onDismiss}>
        Close
      </button>
    </div>
  );
}
