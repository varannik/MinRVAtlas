"use client";

import { useEffect, useRef } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useLedger } from "@/hooks/use-ledger";
import type { Project, SubmissionBatch } from "@/lib/types";
import { useStage } from "@/store/stage-store";
import { CalcExplorer } from "./calc/calc-explorer";
import { LedgerCard } from "./cards/ledger-card";
import { PulseCard } from "./cards/pulse-card";
import { StageProvider } from "./ledger-context";
import { LedgerPage } from "./ledger/ledger-page";
import { PinFlows } from "./pin-flows";
import { stageAnchors } from "./stage-anchors";

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * An open project: the globe in the middle with the project's pin, and two
 * flows from the pin into two matching summary cards. Each card opens its own
 * page — the ledger page, or the 3D chain. Card width lives here only; the
 * globe reads the gap the cards leave.
 */
export function ProjectStage({ project, batches }: { project: Project; batches: SubmissionBatch[] | null }) {
  const ledger = useLedger(project, batches);
  const calc = useStage((state) => state.calc);
  const calcNodeId = useStage((state) => state.calcNodeId);
  const ledgerOpen = useStage((state) => state.ledgerOpen);
  const reduceMotion = useReducedMotion();
  const rowRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);

  // Report the free band between the cards every frame for the globe.
  useEffect(() => {
    let frame = 0;
    const band = stageAnchors.band;
    const tick = () => {
      const row = rowRef.current?.getBoundingClientRect();
      const left = leftRef.current?.getBoundingClientRect();
      const right = rightRef.current?.getBoundingClientRect();
      if (row && left && right) {
        band.left = left.right;
        band.right = right.left;
        band.top = row.top;
        band.bottom = row.bottom;
        band.valid = band.right - band.left > 80;
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(frame);
      band.valid = false;
    };
  }, []);

  const slide = (x: number, delay: number) => ({
    initial: { opacity: 0, x, scale: 0.97 },
    animate: { opacity: 1, x: 0, scale: 1 },
    exit: { opacity: 0, x, scale: 0.97 },
    transition: { duration: reduceMotion ? 0.2 : 0.6, ease: EASE, delay: reduceMotion ? 0 : delay },
  });

  const overlay = {
    initial: { opacity: 0, scale: 0.985 },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.985 },
    transition: { duration: reduceMotion ? 0.15 : 0.35, ease: EASE },
  };

  return (
    <StageProvider value={{ project, batches, ledger }}>
      <div ref={rowRef} className="relative z-30 flex min-h-0 flex-1 items-center gap-6 px-6 pt-1 pb-6">
        <motion.div ref={leftRef} {...slide(-40, 0.15)} className="pointer-events-auto w-[clamp(320px,24vw,380px)] shrink-0">
          <LedgerCard />
        </motion.div>
        <div className="min-w-0 flex-1" aria-hidden />
        <motion.div ref={rightRef} {...slide(40, 0.22)} className="pointer-events-auto w-[clamp(320px,24vw,380px)] shrink-0">
          <PulseCard />
        </motion.div>
      </div>
      <PinFlows />
      <AnimatePresence>
        {ledgerOpen ? (
          <motion.div key="ledger" className="pointer-events-auto fixed inset-0 z-[60]" {...overlay}>
            <LedgerPage />
          </motion.div>
        ) : null}
        {calc ? (
          <motion.div key="calc" className="pointer-events-auto fixed inset-0 z-[80]" {...overlay}>
            <CalcExplorer
              key={`${calc.kind}:${calc.kind === "block" ? calc.blockId : `${calc.range.start}:${calc.range.end}`}:${calcNodeId ?? ""}`}
              target={calc}
              initialNodeId={calcNodeId}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </StageProvider>
  );
}
