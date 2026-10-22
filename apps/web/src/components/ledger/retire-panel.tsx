"use client";

import { useCallback, useEffect, useState } from "react";

import { formatTonnes } from "@/lib/ledger/units";
import type { MutationResult, NormalizedOrganisation, Page, RetirementPurpose } from "@/lib/ledger/types";
import {
  RETIREMENT_PURPOSE_LABELS,
  RETIREMENT_PURPOSES,
  notesMessage,
  overQuantityMessage,
  purposesMessage,
  quantityLinesMessage,
  sumKg,
} from "@/lib/ledger/validate";
import { BatchPicker, type SelectedLine } from "./batch-picker";
import { ledgerRequest } from "./client";
import { SuccessPanel } from "./success-panel";
import { Banner, buttonClass, fieldClass, quietButtonClass } from "./ui";

export function RetirePanel({
  reloadToken,
  onDone,
}: {
  reloadToken: number;
  onDone: () => void;
}) {
  const [beneficiaries, setBeneficiaries] = useState<NormalizedOrganisation[]>([]);
  const [beneficiaryId, setBeneficiaryId] = useState("");
  const [purposes, setPurposes] = useState<RetirementPurpose[]>([]);
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<SelectedLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<MutationResult | null>(null);
  const onLines = useCallback((next: SelectedLine[]) => setLines(next), []);

  useEffect(() => {
    let cancelled = false;
    void ledgerRequest<Page<NormalizedOrganisation>>("/api/ledger/isometric/beneficiaries?first=50")
      .then((page) => {
        if (!cancelled) setBeneficiaries(page.nodes);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not load beneficiaries.");
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const beneficiaryName =
    beneficiaries.find((org) => org.id === beneficiaryId)?.name ?? "the connected organisation";
  const block =
    purposesMessage(purposes) ||
    quantityLinesMessage(lines) ||
    notesMessage(notes) ||
    overQuantityMessage({ lines });

  async function submit() {
    if (block) {
      setError(block);
      setConfirming(false);
      return;
    }
    setPending(true);
    setError(null);
    try {
      const created = await ledgerRequest<MutationResult>("/api/ledger/isometric/retirements", {
        method: "POST",
        body: JSON.stringify({
          beneficiary_organisation_id: beneficiaryId || null,
          retirement_purposes: purposes,
          notes,
          credit_batch_quantities: lines.map((line) => ({
            credit_batch_id: line.credit_batch_id,
            credit_quantity_kg: line.credit_quantity_kg,
          })),
        }),
      });
      setResult(created);
      setConfirming(false);
      onDone();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Retirement failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      {result ? (
        <SuccessPanel title="Retirement accepted" result={result} onDismiss={() => setResult(null)} />
      ) : null}
      {error ? <Banner kind="error">{error}</Banner> : null}
      <fieldset className="space-y-2">
        <legend className="text-xs text-mist">Purpose</legend>
        {RETIREMENT_PURPOSES.map((purpose) => (
          <label key={purpose} className="flex items-center gap-2 text-sm text-frost">
            <input
              type="checkbox"
              checked={purposes.includes(purpose)}
              onChange={(event) => {
                setPurposes((current) =>
                  event.target.checked
                    ? [...current, purpose]
                    : current.filter((item) => item !== purpose),
                );
              }}
            />
            {RETIREMENT_PURPOSE_LABELS[purpose]}
          </label>
        ))}
      </fieldset>
      <label className="block text-xs text-mist">
        Beneficiary
        <select
          className={`${fieldClass} mt-1`}
          value={beneficiaryId}
          onChange={(event) => setBeneficiaryId(event.target.value)}
        >
          <option value="">Connected organisation</option>
          {beneficiaries.map((org) => (
            <option key={org.id} value={org.id}>
              {org.name}
            </option>
          ))}
        </select>
      </label>
      <BatchPicker reloadToken={reloadToken} onChange={onLines} />
      <label className="block text-xs text-mist">
        Notes
        <textarea className={`${fieldClass} mt-1`} maxLength={256} value={notes} onChange={(event) => setNotes(event.target.value)} />
      </label>
      {block && lines.length > 0 ? <p className="text-sm text-signal-rose">{block}</p> : null}
      <button
        type="button"
        className={buttonClass}
        disabled={Boolean(block)}
        onClick={() => setConfirming(true)}
      >
        Review retirement
      </button>
      {confirming ? (
        <div className="rounded-2xl border border-signal-rose/50 bg-ink-900 p-4 text-sm">
          <p className="font-medium text-signal-rose">Retirement is permanent and cannot be undone.</p>
          <p className="mt-2 text-frost">
            {formatTonnes(sumKg(lines))} t across {lines.length}{" "}
            {lines.length === 1 ? "batch" : "batches"} for {beneficiaryName}.
          </p>
          <p className="mt-1 text-mist">
            {purposes.map((purpose) => RETIREMENT_PURPOSE_LABELS[purpose]).join(", ")}
          </p>
          <div className="mt-3 flex gap-2">
            <button type="button" className={buttonClass} disabled={pending} onClick={() => void submit()}>
              {pending ? "Retiring…" : "Retire permanently"}
            </button>
            <button type="button" className={quietButtonClass} onClick={() => setConfirming(false)}>
              Back
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
