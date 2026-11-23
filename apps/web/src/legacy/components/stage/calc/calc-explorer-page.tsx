"use client";

import { X } from "lucide-react";
import { isGenericSpec } from "@/lib/mrv/calc/specs";
import { formatRange, rangeDays } from "@/lib/mrv/days";
import type { DateRange } from "@/lib/mrv/types";
import { STAGE_META } from "@/lib/mrv/registry-pipeline";
import { useStage, type CalcTarget } from "@/legacy/store/stage-store";
import { useStageContext } from "@/legacy/components/stage/ledger-context";
import { ORIGIN_BADGE } from "@/components/stage/theme";
import { CalcLegend, CalcTreeView } from "@/components/stage/calc/calc-explorer";

function targetRange(target: CalcTarget, blocks: { id: string; range: DateRange }[]): DateRange | null {
  if (target.kind === "range") return target.range;
  return blocks.find((block) => block.id === target.blockId)?.range ?? null;
}

/**
 * Full-screen view of how one window's credited number is built, opened from
 * the ledger or the stage.
 */
export function CalcExplorer({ target, initialNodeId }: { target: CalcTarget; initialNodeId: string | null }) {
  const { project, ledger } = useStageContext();
  const { spec, index, blocks, daily, dataset } = ledger;
  const closeCalc = useStage((state) => state.closeCalc);

  const range = targetRange(target, blocks);
  const block = target.kind === "block" ? blocks.find((row) => row.id === target.blockId) : null;
  const badge = ORIGIN_BADGE[dataset?.origin ?? "none"];

  return (
    <div className="calc-stage absolute inset-0 flex flex-col" role="dialog" aria-modal="true" aria-label="Calculation tree">
      <header className="flex items-center gap-5 border-b border-white/10 px-6 py-3.5">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold tracking-[0.18em] text-white/45 uppercase">
            Calculation tree · {spec.registry} · {spec.methodology}
          </p>
          <h2 className="mt-0.5 truncate text-[18px] font-semibold tracking-tight text-white">
            {block ? `Block #${block.sequence} · ${block.label}` : "Proposed block"}
            {range ? <span className="font-normal text-white/50"> · {formatRange(range)} · {rangeDays(range)} days</span> : null}
          </h2>
          <p className="mt-0.5 truncate text-[11px] text-white/40">
            {isGenericSpec(spec) ? "Generic tree — this methodology's equations are not transcribed yet" : spec.edition}
            {block ? ` · ${STAGE_META[block.stage].label}` : ""} · {project.name}
          </p>
        </div>
        <CalcLegend className="hidden md:flex" />
        <span title={dataset?.note ?? badge.title} className={`rounded-md px-2 py-1 text-[10px] font-semibold ${badge.className}`}>
          {badge.label}
        </span>
        <button
          type="button"
          onClick={closeCalc}
          aria-label="Close calculation tree"
          className="grid size-9 place-items-center rounded-full bg-white/10 text-white/80 transition-colors hover:bg-white/20"
        >
          <X className="size-4" />
        </button>
      </header>

      <CalcTreeView spec={spec} index={index} daily={daily} range={range} loading={ledger.status === "loading"} initialNodeId={initialNodeId} />
    </div>
  );
}
