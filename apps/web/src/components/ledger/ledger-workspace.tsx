"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeftRight,
  BadgeCheck,
  History,
  Landmark,
  Layers,
  LayoutGrid,
  PackageCheck,
  ShoppingCart,
  type LucideIcon,
} from "lucide-react";

import type { LedgerConnection } from "@/lib/ledger/types";
import { ActivityPanel } from "./activity-panel";
import { BatchTable } from "./batch-table";
import { BuyPanel } from "./buy-panel";
import { ledgerRequest } from "./client";
import { DeliverPanel } from "./deliver-panel";
import { OverviewPanel } from "./overview-panel";
import { AccountToolbar } from "../nav/account-toolbar";
import { AppSwitcher } from "../nav/app-switcher";
import { Segmented } from "../nav/segmented";
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

const TAB_ICONS: Record<(typeof TABS)[number][0], LucideIcon> = {
  overview: LayoutGrid,
  batches: Layers,
  deliver: PackageCheck,
  transfer: ArrowLeftRight,
  retire: BadgeCheck,
  activity: History,
  buy: ShoppingCart,
};

/** Registries the ledger reads. Puro and Verra are listed but not connected yet. */
const REGISTRIES = [
  { value: "isometric", label: "Isometric" },
  { value: "all", label: "All registries" },
] as const;

const LABEL = "text-[10.5px] font-semibold tracking-[0.14em] text-strata-700 uppercase";

/** Forms read best at a measure; tables and the overview use the full panel. */
const FORM_TABS = new Set<string>(["deliver", "transfer", "retire", "buy", "buy-success", "buy-cancel"]);

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

  const activeTab = tab === "buy-success" || tab === "buy-cancel" ? "buy" : tab;
  const tabLabel = TABS.find(([id]) => id === activeTab)?.[1] ?? "Overview";

  return (
    <div className="atlas-backdrop fixed inset-0 z-40 text-earth">
      {/* Top bar: the same glass pills as the Atlas. */}
      <header className="relative flex h-16 items-center px-5">
        <div className="glass flex h-11 items-center gap-2.5 rounded-full pr-4 pl-1">
          <span
            className="grid size-9 shrink-0 place-items-center rounded-full text-calcite shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]"
            style={{ background: "linear-gradient(in oklab 140deg, #0d1802 0%, #414f1b 58%, #8b9c44 125%)" }}
            aria-hidden
          >
            <Landmark className="size-4" />
          </span>
          <div className="leading-tight">
            <div className="text-[13px] font-semibold tracking-tight">Ledger</div>
            <div className="text-[10px] tracking-[0.12em] text-strata-700 uppercase">Registry inventory</div>
          </div>
        </div>
        <AccountToolbar className="ml-auto" />
      </header>

      {/* Left menu: the registry filter, then the ledger's sections. */}
      <aside className="glass absolute top-16 bottom-5 left-5 flex w-52 flex-col overflow-hidden rounded-[26px] lg:w-60">
        <div className="px-4 pt-4 pb-4">
          <p className={`mb-2 px-1 ${LABEL}`}>Registry</p>
          <Segmented
            label="Registry"
            thumbId="ledger-registry-thumb"
            options={REGISTRIES}
            value={registry === "all" ? "all" : "isometric"}
            onChange={(next) => navigate(next === "all" ? "overview" : tab, next)}
          />
          <p className="mt-2 px-1 text-[11px] text-strata-700">Puro and Verra are not connected yet.</p>
        </div>
        <div className="mx-4 h-px bg-strata-400/30" aria-hidden />
        <nav aria-label="Ledger sections" className="scroll-slim min-h-0 flex-1 overflow-y-auto px-2 pt-3 pb-2">
          <p className={`mb-1.5 px-3 ${LABEL}`}>Ledger</p>
          {visibleTabs.map(([id, label]) => {
            const active = activeTab === id;
            const Icon = TAB_ICONS[id];
            return (
              <button
                key={id}
                type="button"
                onClick={() => navigate(id)}
                aria-current={active ? "page" : undefined}
                className={`mb-0.5 flex h-10 w-full items-center gap-2.5 rounded-full px-3 text-left text-[13px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-olivine-500 ${
                  active ? "glass-thumb text-earth" : "text-strata-700 hover:bg-white/50 hover:text-earth"
                }`}
              >
                <Icon className={`size-4 shrink-0 ${active ? "text-olivine-700" : ""}`} />
                {label}
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Content: one glass panel. */}
      <section
        aria-label={tabLabel}
        className="glass-strong absolute top-16 right-5 bottom-21 left-[calc(13rem+2.5rem)] flex flex-col overflow-hidden rounded-[26px] lg:left-[calc(15rem+2.5rem)]"
      >
        <header className="border-b border-strata-400/25 px-8 pt-6 pb-5">
          <p className={LABEL}>{registry === "all" ? "All registries" : "Isometric"} · Ledger</p>
          <h1 className="mt-1 text-[28px] leading-tight font-semibold tracking-tight">{tabLabel}</h1>
        </header>
        <main className={`scroll-slim min-h-0 min-w-0 flex-1 overflow-auto px-8 py-6 ${FORM_TABS.has(tab) && registry !== "all" ? "[&>*]:max-w-3xl" : ""}`}>
          {error ? <Banner kind="error">{error}</Banner> : null}
          {!connection ? (
            <p className="text-sm text-strata-700">Opening the ledger…</p>
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
      </section>
      <AppSwitcher active="ledger" />
    </div>
  );
}
