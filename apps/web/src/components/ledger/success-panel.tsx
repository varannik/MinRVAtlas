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
    <div className="rounded-2xl border border-carbon-400/40 bg-ink-900 px-4 py-3 text-sm text-frost">
      <div className="font-medium text-carbon-400">{title}</div>
      <div className="mt-1 font-mono text-xs text-mist">{result.id}</div>
      {result.url ? (
        <a
          href={result.url}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block text-carbon-400 underline"
        >
          Open certificate
        </a>
      ) : (
        <div className="mt-2 text-mist">The registry did not return a certificate link.</div>
      )}
      <div className="mt-2 text-mist">Balance and batches were reloaded.</div>
      <button type="button" className={`${quietButtonClass} mt-3`} onClick={onDismiss}>
        Close
      </button>
    </div>
  );
}
