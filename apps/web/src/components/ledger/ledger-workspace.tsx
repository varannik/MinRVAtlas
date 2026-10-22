"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import type { LedgerConnection } from "@/lib/ledger/types";
import { ActivityPanel } from "./activity-panel";
import { BatchTable } from "./batch-table";
import { BuyPanel } from "./buy-panel";
import { ledgerRequest } from "./client";
import { DeliverPanel } from "./deliver-panel";
import { OverviewPanel } from "./overview-panel";
import { RetirePanel } from "./retire-panel";
import { TransferPanel } from "./transfer-panel";
import { Banner } from "./ui";

const TABS = [
  ["overview", "Overview"],
  ["batches", "Batches"],
  ["deliver", "Deliver"],
  ["transfer", "Transfer"],
  ["retire", "Retire"],
  ["activity", "Activity"],
  ["buy", "Buy"],
] as const;

type Tab = (typeof TABS)[number][0] | "buy-success" | "buy-cancel";

export function LedgerWorkspace() {
  const router = useRouter();
  const search = useSearchParams();
  const tab = (search.get("tab") || "overview") as Tab;
  const registry = search.get("registry") || "isometric";
  const [connection, setConnection] = useState<LedgerConnection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const reload = useCallback(() => setReloadToken((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    void ledgerRequest<LedgerConnection>("/api/ledger/connected")
      .then((data) => {
        if (!cancelled) setConnection(data);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not open the ledger.");
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  function navigate(nextTab: string, nextRegistry = registry) {
    const params = new URLSearchParams();
    params.set("tab", nextTab);
    params.set("registry", nextRegistry);
    router.replace(`/ledger?${params.toString()}`);
  }

  const canWrite = Boolean(connection?.canWrite && registry === "isometric");
  const canBuy = Boolean(connection?.capabilities.includes("buy") && registry === "isometric");
  const visibleTabs = TABS.filter(([id]) => {
    if (registry === "all") return id === "overview";
    if (id === "buy") return canBuy && canWrite;
    if (id === "deliver" || id === "transfer" || id === "retire") return canWrite;
    return true;
  });
  const buyHighlight =
    tab === "buy-success" || tab === "buy-cancel" || tab === "buy" ? tab : null;

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-ink-950 text-frost">
      <header className="flex items-center gap-4 border-b border-line px-5 py-3">
        <div>
          <div className="text-sm font-semibold">Ledger</div>
          <div className="text-[10px] tracking-wide text-mist uppercase">Registry inventory</div>
        </div>
        <label className="flex items-center gap-2 text-xs text-mist">
          Registry
          <select
            className="rounded-xl border border-line bg-ink-800 px-2 py-1 text-sm text-frost"
            value={registry}
            onChange={(event) => {
              const next = event.target.value;
              navigate(next === "all" ? "overview" : tab, next);
            }}
          >
            <option value="isometric">Isometric</option>
            <option value="all">All registries</option>
            <option value="puro" disabled>
              Puro
            </option>
            <option value="verra" disabled>
              Verra
            </option>
          </select>
        </label>
        <nav className="ml-auto flex items-center gap-3 text-xs text-mist">
          <Link href="/" className="hover:text-frost">
            Back to map
          </Link>
          <Link href="/manual" className="hover:text-frost">
            Guide
          </Link>
          <Link href="/quality" className="hover:text-frost">
            Quality
          </Link>
          <a href="/auth/logout" className="hover:text-frost">
            Sign out
          </a>
        </nav>
      </header>
      <div className="flex min-h-0 flex-1">
        <nav className="w-44 shrink-0 border-r border-line p-3">
          {visibleTabs.map(([id, label]) => {
            const active = tab === id || (id === "buy" && (tab === "buy-success" || tab === "buy-cancel"));
            return (
              <button
                key={id}
                type="button"
                onClick={() => navigate(id)}
                className={`mb-1 block w-full rounded-xl px-3 py-2 text-left text-sm ${
                  active ? "bg-ink-800 text-carbon-400" : "text-mist hover:text-frost"
                }`}
              >
                {label}
              </button>
            );
          })}
        </nav>
        <main className="scroll-slim min-w-0 flex-1 overflow-auto p-6">
          {error ? <Banner kind="error">{error}</Banner> : null}
          {!connection ? (
            <p className="text-sm text-mist">Opening the ledger…</p>
          ) : !connection.connected ? (
            <Banner kind="info">{connection.message}</Banner>
          ) : !connection.organisationReady ? (
            <Banner kind="info">
              {connection.message ?? "The Isometric connection could not be read."}
            </Banner>
          ) : (
            <>
              {tab === "overview" || registry === "all" ? (
                <OverviewPanel registry={registry} connection={connection} reloadToken={reloadToken} />
              ) : null}
              {tab === "batches" && registry === "isometric" ? <BatchTable reloadToken={reloadToken} /> : null}
              {tab === "deliver" && canWrite ? (
                <DeliverPanel reloadToken={reloadToken} onDone={reload} />
              ) : null}
              {tab === "transfer" && canWrite ? (
                <TransferPanel reloadToken={reloadToken} onDone={reload} />
              ) : null}
              {tab === "retire" && canWrite ? (
                <RetirePanel reloadToken={reloadToken} onDone={reload} />
              ) : null}
              {tab === "activity" && registry === "isometric" ? (
                <ActivityPanel reloadToken={reloadToken} />
              ) : null}
              {buyHighlight && canBuy && canWrite ? <BuyPanel highlight={buyHighlight} /> : null}
              {registry === "isometric" && !canWrite && (tab === "deliver" || tab === "transfer" || tab === "retire" || tab === "buy" || tab === "buy-success" || tab === "buy-cancel") ? (
                <Banner kind="info">This role can view the ledger but cannot change it.</Banner>
              ) : null}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
