"use client";

import { useCallback, useEffect, useState } from "react";

import type { MutationResult, NormalizedOrganisation, Page } from "@/lib/ledger/types";
import { notesMessage, overQuantityMessage, quantityLinesMessage } from "@/lib/ledger/validate";
import { BatchPicker, type SelectedLine } from "./batch-picker";
import { ledgerRequest } from "./client";
import { SuccessPanel } from "./success-panel";
import { Banner, buttonClass, fieldClass } from "./ui";

export function TransferPanel({
  reloadToken,
  onDone,
}: {
  reloadToken: number;
  onDone: () => void;
}) {
  const [recipients, setRecipients] = useState<NormalizedOrganisation[]>([]);
  const [query, setQuery] = useState("");
  const [recipientId, setRecipientId] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<SelectedLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<MutationResult | null>(null);
  const onLines = useCallback((next: SelectedLine[]) => setLines(next), []);

  useEffect(() => {
    let cancelled = false;
    void ledgerRequest<Page<NormalizedOrganisation>>("/api/ledger/isometric/transferees?first=50")
      .then((page) => {
        if (cancelled) return;
        setRecipients(page.nodes);
        setRecipientId((current) => current || page.nodes[0]?.id || "");
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not load recipients.");
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const visible = recipients.filter((org) => {
    const haystack = `${org.name} ${org.domain ?? ""}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  });
  const block =
    (!recipientId ? "Choose a recipient from the directory." : null) ||
    quantityLinesMessage(lines) ||
    notesMessage(notes) ||
    overQuantityMessage({ lines });

  async function submit() {
    if (block) {
      setError(block);
      return;
    }
    setPending(true);
    setError(null);
    try {
      const created = await ledgerRequest<MutationResult>("/api/ledger/isometric/transfers", {
        method: "POST",
        body: JSON.stringify({
          to_organisation_id: recipientId,
          notes,
          credit_batch_quantities: lines.map((line) => ({
            credit_batch_id: line.credit_batch_id,
            credit_quantity_kg: line.credit_quantity_kg,
          })),
        }),
      });
      setResult(created);
      onDone();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Transfer failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      {result ? (
        <SuccessPanel title="Transfer accepted" result={result} onDismiss={() => setResult(null)} />
      ) : null}
      {error ? <Banner kind="error">{error}</Banner> : null}
      <label className="block text-xs text-mist">
        Search recipients
        <input
          className={`${fieldClass} mt-1`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Name or domain"
        />
      </label>
      <label className="block text-xs text-mist">
        Recipient
        <select
          className={`${fieldClass} mt-1`}
          value={recipientId}
          onChange={(event) => setRecipientId(event.target.value)}
        >
          {visible.length === 0 ? <option value="">No matching organisations</option> : null}
          {visible.map((org) => (
            <option key={org.id} value={org.id}>
              {org.name}
              {org.domain ? ` · ${org.domain}` : ""}
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
      <button type="button" className={buttonClass} disabled={Boolean(block) || pending} onClick={() => void submit()}>
        {pending ? "Transferring…" : "Transfer credits"}
      </button>
    </div>
  );
}
