"use client";

import { useCallback, useEffect, useState } from "react";

import { formatTonnes } from "@/lib/ledger/units";
import type { MutationResult, NormalizedOrder, Page } from "@/lib/ledger/types";
import { notesMessage, overQuantityMessage, quantityLinesMessage } from "@/lib/ledger/validate";
import { BatchPicker, type SelectedLine } from "./batch-picker";
import { ledgerRequest } from "./client";
import { SuccessPanel } from "./success-panel";
import { Banner, buttonClass, fieldClass } from "./ui";

export function DeliverPanel({
  reloadToken,
  onDone,
}: {
  reloadToken: number;
  onDone: () => void;
}) {
  const [orders, setOrders] = useState<NormalizedOrder[]>([]);
  const [orderId, setOrderId] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<SelectedLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<MutationResult | null>(null);
  const onLines = useCallback((next: SelectedLine[]) => setLines(next), []);

  useEffect(() => {
    let cancelled = false;
    void ledgerRequest<Page<NormalizedOrder>>("/api/ledger/isometric/orders?first=50")
      .then((page) => {
        if (cancelled) return;
        const open = page.nodes.filter(
          (order) => order.status === "PLACED" || order.status === "IN_PROGRESS",
        );
        setOrders(open);
        setOrderId((current) => current || open[0]?.id || "");
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not load orders.");
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const order = orders.find((item) => item.id === orderId) ?? null;
  const block =
    quantityLinesMessage(lines) ||
    notesMessage(notes) ||
    (order
      ? overQuantityMessage({
          lines,
          limitKg: order.remainingKg,
          limitLabel: "The total is larger than the order remainder.",
        })
      : "Choose an open order.");

  async function submit() {
    if (block) {
      setError(block);
      return;
    }
    setPending(true);
    setError(null);
    try {
      const created = await ledgerRequest<MutationResult>("/api/ledger/isometric/deliveries", {
        method: "POST",
        body: JSON.stringify({
          order_id: orderId,
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
      setError(reason instanceof Error ? reason.message : "Delivery failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      {result ? (
        <SuccessPanel title="Delivery accepted" result={result} onDismiss={() => setResult(null)} />
      ) : null}
      {error ? <Banner kind="error">{error}</Banner> : null}
      <label className="block text-xs text-mist">
        Order
        <select
          className={`${fieldClass} mt-1`}
          value={orderId}
          onChange={(event) => setOrderId(event.target.value)}
        >
          {orders.length === 0 ? <option value="">No open orders</option> : null}
          {orders.map((item) => (
            <option key={item.id} value={item.id}>
              {item.id} · {item.buyerName} · {formatTonnes(item.remainingKg)} t remaining
            </option>
          ))}
        </select>
      </label>
      <BatchPicker reloadToken={reloadToken} onChange={onLines} />
      <label className="block text-xs text-mist">
        Notes
        <textarea
          className={`${fieldClass} mt-1`}
          maxLength={256}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </label>
      {block && lines.length > 0 ? <p className="text-sm text-signal-rose">{block}</p> : null}
      <button type="button" className={buttonClass} disabled={Boolean(block) || pending} onClick={() => void submit()}>
        {pending ? "Delivering…" : "Deliver credits"}
      </button>
    </div>
  );
}
