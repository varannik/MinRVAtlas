"use client";

import { useEffect, useState } from "react";

import { tonnesInputToKg } from "@/lib/ledger/units";
import type { StripeCheckout, StripeConfig } from "@/lib/ledger/types";
import { ledgerRequest } from "./client";
import { Banner, buttonClass, fieldClass } from "./ui";

export function BuyPanel({
  highlight,
}: {
  highlight: "buy" | "buy-success" | "buy-cancel";
}) {
  const [config, setConfig] = useState<StripeConfig | null>(null);
  const [tonnes, setTonnes] = useState("1");
  const [frequency, setFrequency] = useState<"one_time" | "monthly" | "yearly">("one_time");
  const [isometricTerms, setIsometricTerms] = useState(false);
  const [supplierTerms, setSupplierTerms] = useState(false);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void ledgerRequest<StripeConfig>("/api/ledger/isometric/stripe/config")
      .then((data) => {
        if (!cancelled) setConfig(data);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Checkout is unavailable.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const kilograms = tonnesInputToKg(tonnes);
  const block = !kilograms
    ? "Enter a quantity in tonnes, up to three decimal places."
    : !isometricTerms || !supplierTerms
      ? "Accept both sets of terms before checkout."
      : null;

  async function submit() {
    if (block || !kilograms) {
      setError(block);
      return;
    }
    setPending(true);
    setError(null);
    try {
      const checkout = await ledgerRequest<StripeCheckout>("/api/ledger/isometric/stripe/checkout", {
        method: "POST",
        body: JSON.stringify({
          quantity_kg: kilograms,
          frequency,
          isometric_terms_and_conditions_accepted: true,
          supplier_terms_and_conditions_accepted: true,
          customer_email: email.trim() || null,
        }),
      });
      window.location.assign(checkout.redirectUrl);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Checkout failed.");
      setPending(false);
    }
  }

  return (
    <div className="max-w-lg space-y-4">
      {highlight === "buy-success" ? (
        <Banner kind="ok">Stripe returned to the ledger. Refresh the overview to see new credits once the registry records them.</Banner>
      ) : null}
      {highlight === "buy-cancel" ? (
        <Banner kind="info">Checkout was cancelled. No credits were bought.</Banner>
      ) : null}
      {error ? <Banner kind="error">{error}</Banner> : null}
      {config ? (
        <p className="text-sm text-mist">
          {config.creditPricePerTonne
            ? `${config.creditPricePerTonne} ${config.currency ?? ""} per tonne`
            : "Price is set by the registry checkout."}
        </p>
      ) : null}
      <label className="block text-xs text-mist">
        Tonnes
        <input className={`${fieldClass} mt-1`} value={tonnes} onChange={(event) => setTonnes(event.target.value)} />
      </label>
      <label className="block text-xs text-mist">
        Frequency
        <select
          className={`${fieldClass} mt-1`}
          value={frequency}
          onChange={(event) => setFrequency(event.target.value as typeof frequency)}
        >
          <option value="one_time">One time</option>
          <option value="monthly">Monthly</option>
          <option value="yearly">Yearly</option>
        </select>
      </label>
      <label className="block text-xs text-mist">
        Receipt email
        <input className={`${fieldClass} mt-1`} value={email} onChange={(event) => setEmail(event.target.value)} />
      </label>
      <label className="flex items-start gap-2 text-sm text-frost">
        <input type="checkbox" checked={isometricTerms} onChange={(event) => setIsometricTerms(event.target.checked)} />
        <span>
          I accept the{" "}
          {config?.termsUrl ? (
            <a href={config.termsUrl} target="_blank" rel="noreferrer" className="text-carbon-400 underline">
              Isometric terms
            </a>
          ) : (
            "Isometric terms"
          )}
          .
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm text-frost">
        <input type="checkbox" checked={supplierTerms} onChange={(event) => setSupplierTerms(event.target.checked)} />
        <span>I accept the supplier terms.</span>
      </label>
      {block ? <p className="text-sm text-signal-rose">{block}</p> : null}
      <button type="button" className={buttonClass} disabled={Boolean(block) || pending} onClick={() => void submit()}>
        {pending ? "Opening checkout…" : "Continue to Stripe"}
      </button>
    </div>
  );
}
