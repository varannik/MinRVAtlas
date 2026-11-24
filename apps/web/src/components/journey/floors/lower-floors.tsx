"use client";

import { useMemo, useState } from "react";

import { useLedger, type Ledger } from "@/hooks/use-ledger";
import { evaluate } from "@/lib/mrv/calc/evaluate";
import type { Project, SubmissionBatch } from "@/lib/types";
import { stepProgress, usePlan, useJourney } from "@/store/journey-store";
import { CalcFloor } from "./calc-floor";
import { LedgerFloor } from "./ledger-floor";
import { defaultBox, parsePeriod, periodBoxes } from "./periods";
import { useLedgerProject, useProjectBatches } from "./use-journey-ledger";

/** The ledger and calculation floors, sharing which period is selected. */
function Floors({ scope, ledger }: { scope: string; ledger: Ledger | null }) {
  const current = useJourney((state) => state.current);
  const laps = useJourney((state) => state.laps);
  const tasks = useJourney((state) => state.tasks);
  const plan = usePlan();
  const periodValue = tasks["monitor.period"]?.value;
  const flagged = stepProgress(plan.stepById[current], tasks).flagged > 0;

  const boxes = useMemo(
    () => periodBoxes(ledger?.blocks ?? [], { current, laps, period: parsePeriod(periodValue), flagged }),
    [current, flagged, laps, ledger?.blocks, periodValue],
  );

  // Net removal per box: each block's own result, and the journey's period from its dates.
  const netById = useMemo(() => {
    const map = new Map<string, number | null>();
    if (!ledger) return map;
    for (const [id, result] of ledger.blockResults) map.set(id, result.root.value);
    for (const box of boxes) {
      if (!box.block && box.range && ledger.index) map.set(box.id, evaluate(ledger.spec, ledger.index, box.range).root.value);
    }
    return map;
  }, [boxes, ledger]);

  const [chosen, setChosen] = useState<string | null>(null);
  const selected = boxes.find((box) => box.id === chosen) ?? defaultBox(boxes);

  return (
    <>
      <LedgerFloor scope={scope} ledger={ledger} boxes={boxes} netById={netById} selectedId={selected?.id ?? null} onSelect={setChosen} />
      <CalcFloor ledger={ledger} box={selected} projectId={ledger ? scope : null} />
    </>
  );
}

function WithLedger({ project, batches }: { project: Project; batches: SubmissionBatch[] | null }) {
  const ledger = useLedger(project, batches);
  return <Floors scope={project.id} ledger={ledger} />;
}

/**
 * Floors 2 and 3, filled from the project's removal ledger: the same
 * monitoring data, blocks and calculation as the ledger on the Atlas. With no
 * Atlas project behind the journey, they show only the journey's own period.
 */
export function LowerFloors({ requested }: { requested: string | null }) {
  const project = useLedgerProject(requested);
  const batches = useProjectBatches(project);
  return project ? <WithLedger project={project} batches={batches} /> : <Floors scope="none" ledger={null} />;
}
