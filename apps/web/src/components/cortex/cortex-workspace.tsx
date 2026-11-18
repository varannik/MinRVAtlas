"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import {
  CAPABILITY_BY_ID,
  LOBES,
  capabilitiesIn,
  isCapabilityId,
} from "@/lib/cortex/capabilities";
import { stagedFor, useCortex } from "@/store/cortex-store";
import { AppSwitcher } from "../nav/app-switcher";
import { CapabilityPanel, CorePanel } from "./capability-panel";

const EASE = [0.22, 1, 0.36, 1] as const;

function Waking() {
  return (
    <div className="grid h-full place-items-center">
      <div className="flex items-center gap-3 text-xs tracking-[0.2em] text-white/80 uppercase">
        <span className="size-2 animate-pulse rounded-full bg-white" />
        Waking Cortex
      </div>
    </div>
  );
}

const BrainScene = dynamic(
  () => import("./brain-scene").then((mod) => mod.BrainScene),
  { ssr: false, loading: Waking },
);

function CapabilityRail({ hidden }: { hidden: boolean }) {
  const selected = useCortex((state) => state.selected);
  const hovered = useCortex((state) => state.hovered);
  const staged = useCortex((state) => state.staged);
  const select = useCortex((state) => state.select);
  const hover = useCortex((state) => state.hover);

  return (
    <nav
      aria-label="Cortex capabilities"
      aria-hidden={hidden || undefined}
      className={`scroll-slim fixed top-44 left-6 z-30 hidden max-h-[calc(100vh-260px)] w-48 overflow-y-auto pr-1 transition-opacity duration-300 lg:block ${
        hidden ? "pointer-events-none opacity-0" : "opacity-100"
      }`}
    >
      <div className="grid gap-3.5">
        {LOBES.map((lobe) => (
          <div key={lobe.id} className="grid gap-0.5">
            <div className="mb-0.5 flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.16em] text-white/65 uppercase">
              <span className="size-1.5 rounded-full" style={{ background: lobe.glow }} />
              {lobe.name}
            </div>
            {capabilitiesIn(lobe.id).map((item) => {
              const active = selected === item.id || hovered === item.id;
              const count = stagedFor(staged, item.id).length;
              return (
                <button
                  key={item.id}
                  type="button"
                  tabIndex={hidden ? -1 : 0}
                  onClick={() => select(item.id)}
                  onMouseEnter={() => hover(item.id)}
                  onMouseLeave={() => hover(null)}
                  onFocus={() => hover(item.id)}
                  onBlur={() => hover(null)}
                  className={`flex items-center justify-between rounded-md px-2 py-1 text-left text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-white ${
                    active ? "bg-white/18 text-white" : "text-white/78 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  {item.name}
                  {count > 0 && (
                    <span className="tabular rounded-full bg-white/20 px-1.5 text-[10.5px] text-white">
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </nav>
  );
}

export function CortexWorkspace({ pin = null, back = null }: { pin?: string | null; back?: string | null }) {
  const selected = useCortex((state) => state.selected);
  const staged = useCortex((state) => state.staged);
  const select = useCortex((state) => state.select);
  const hover = useCortex((state) => state.hover);
  const reduce = useReducedMotion();
  // ?pin= (passed in by the page) lands on a capability once. The URL is not kept
  // in sync: rewriting it makes the App Router remount the page and drop the selection.
  const [initialPin] = useState(pin);
  // Opened from a project journey: offer the way back. Only journey paths are allowed.
  const backTo = back && /^\/journey(\?|$)/.test(back) ? back : null;

  useEffect(() => {
    if (initialPin === "core") select("core");
    else if (isCapabilityId(initialPin)) select(initialPin);
  }, [initialPin, select]);

  useEffect(
    () => () => {
      select(null);
      hover(null);
    },
    [select, hover],
  );

  useEffect(() => {
    if (!selected) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") select(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, select]);

  const capability = selected && selected !== "core" ? CAPABILITY_BY_ID[selected] : null;
  const panelOpen = selected !== null;

  return (
    <main className="fixed inset-0 overflow-hidden bg-[#7E6AD2] text-white">
      <BrainScene />

      <header className="pointer-events-none fixed top-5 left-5 z-30 max-w-[min(22rem,calc(100vw-2.5rem))] lg:top-6 lg:left-6">
        {backTo ? (
          <Link
            href={backTo}
            className="pointer-events-auto mb-3 inline-flex items-center gap-1.5 rounded-full bg-white/18 px-3 py-1.5 text-[12px] font-semibold text-white backdrop-blur-md transition-colors hover:bg-white/28 focus-visible:outline-2 focus-visible:outline-white"
          >
            <ArrowLeft className="size-3.5" />
            Back to journey
          </Link>
        ) : null}
        <p className="text-[10.5px] font-semibold tracking-[0.2em] text-white/70 uppercase">
          MinRV · AI data expert
        </p>
        <h1 className="mt-1 text-[30px] leading-none font-semibold tracking-tight lg:text-[36px]">
          Cortex
        </h1>
        <p className="mt-2 hidden text-[13.5px] leading-snug text-white/82 sm:block">
          The expert that checks your MRV data. Open a pin to see what it does and teach it.
        </p>
        {staged.length > 0 && (
          <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-[11.5px] font-semibold text-white backdrop-blur-md">
            <span className="size-1.5 rounded-full bg-white" />
            <span className="tabular">{staged.length}</span> staged in this browser
          </p>
        )}
      </header>

      <CapabilityRail hidden={panelOpen} />

      <p
        className={`pointer-events-none fixed bottom-7 left-6 z-30 hidden text-[11.5px] text-white/70 transition-opacity lg:block ${
          panelOpen ? "opacity-0" : "opacity-100"
        }`}
      >
        Drag to turn · Click a pin or the core · Esc closes
      </p>

      <AnimatePresence mode="wait">
        {panelOpen && (
          <motion.aside
            key={selected}
            aria-label={capability ? `${capability.name} capability` : "Cortex core"}
            initial={reduce ? { opacity: 0 } : { opacity: 0, x: 28 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, x: 20 }}
            transition={{ duration: 0.32, ease: EASE }}
            className="glass fixed inset-x-3 bottom-21 z-40 flex max-h-[60vh] flex-col overflow-hidden rounded-2xl text-rock lg:inset-x-auto lg:top-5 lg:right-5 lg:bottom-21 lg:max-h-none lg:w-110"
          >
            {capability ? <CapabilityPanel capability={capability} /> : <CorePanel />}
          </motion.aside>
        )}
      </AnimatePresence>

      <AppSwitcher active="cortex" />
    </main>
  );
}
