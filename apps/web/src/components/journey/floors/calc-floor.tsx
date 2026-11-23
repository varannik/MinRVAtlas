"use client";

import { Calculator } from "lucide-react";

import type { Ledger } from "@/hooks/use-ledger";
import { isGenericSpec } from "@/lib/mrv/calc/specs";
import { formatRange, rangeDays } from "@/lib/mrv/days";
import { STAGE_META } from "@/lib/mrv/registry-pipeline";
import { CalcLegend, CalcTreeView } from "@/components/stage/calc/calc-explorer";
import { ORIGIN_BADGE } from "@/components/stage/theme";
import { FloorHeading } from "./floor-parts";
import type { PeriodBox } from "./periods";

/** Why there is no tree to show. */
function emptyReason(ledger: Ledger | null, box: PeriodBox | null): string {
  if (!ledger) return "No monitoring data for this project yet, so there is nothing to calculate.";
  if (ledger.status === "loading") return "Reading monitoring data…";
  if (ledger.status === "error") return ledger.error ?? "The monitoring data could not be read.";
  if (!box) return "Select a block on the ledger above to see how its CO₂ removal is calculated.";
  if (box.locked) return "The first monitoring period opens once the facility is validated.";
  return "This period has no dates yet. Give them in the Monitor step, and its calculation appears here.";
}

/**
 * Floor 3: how the selected period's CO₂ removal is calculated. The same tree
 * as the ledger's calculation view: the credited figure at the root, each
 * equation fanning out into its terms down to the monitored values. A plain
 * scroll moves the page; pinch or ⌘-scroll zooms the tree.
 */
export function CalcFloor({ ledger, box }: { ledger: Ledger | null; box: PeriodBox | null }) {
  const range = box?.range ?? null;
  const spec = ledger?.spec ?? null;
  const badge = ORIGIN_BADGE[ledger?.dataset?.origin ?? "none"];
  const ready = Boolean(ledger && spec && range && ledger.status === "ready");

  return (
    <section
      id="floor-calc"
      aria-label="Floor 3, calculation tree"
      className="journey-floor journey-floor--calc flex h-[100svh] min-h-[720px] flex-col px-4 pt-24 pb-6 sm:px-6 lg:px-10 lg:pr-28"
    >
      <header className="relative z-[2] flex flex-wrap items-end gap-x-6 gap-y-3">
        <FloorHeading
          floor={3}
          dark
          eyebrow="how the period's CO₂ removal is calculated"
          title="Calculation tree"
          sub={spec ? `${spec.registry} · ${spec.methodology}${isGenericSpec(spec) ? " · generic tree until this methodology is transcribed" : ` · ${spec.edition}`}` : undefined}
        />
        <div
          data-floor-anchor="calc"
          className="flex items-center gap-2.5 rounded-2xl border border-calcite/15 bg-earth/40 px-3.5 py-2 text-calcite backdrop-blur-md"
        >
          <Calculator className="size-4 shrink-0 text-[#B2BE8B]" />
          <span className="min-w-0">
            <span className="block text-[10px] font-semibold tracking-[0.16em] text-sand uppercase">
              {box ? `Block #${box.sequence}${box.live ? " · this period" : ""}` : "No block selected"}
            </span>
            <span className="block truncate text-[13px] font-semibold">
              {box ? box.label : "—"}
              {range ? <span className="font-normal text-calcite/65"> · {formatRange(range)} · {rangeDays(range)} days</span> : null}
              {box?.block && !box.live ? <span className="font-normal text-calcite/65"> · {STAGE_META[box.block.stage].label}</span> : null}
            </span>
          </span>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <CalcLegend className="hidden md:flex" />
          {ledger ? (
            <span title={ledger.dataset?.note ?? badge.title} className={`rounded-md px-2 py-1 text-[10px] font-semibold ${badge.className}`}>
              {badge.label}
            </span>
          ) : null}
        </div>
      </header>

      <div className="relative z-[2] mt-4 flex min-h-0 flex-1 overflow-hidden rounded-[24px] border border-calcite/10 bg-earth/35 text-white shadow-[0_24px_60px_-24px_rgba(0,0,0,0.6)] backdrop-blur-sm">
        {ready && ledger && spec ? (
          <CalcTreeView
            key={`${box?.id}:${range!.start}:${range!.end}`}
            spec={spec}
            index={ledger.index}
            daily={ledger.daily}
            range={range}
            loading={false}
            wheel="modifier"
            inspectorClassName="max-lg:hidden"
          />
        ) : (
          <div className="grid flex-1 place-items-center px-6 text-center text-[13px] text-calcite/60">{emptyReason(ledger, box)}</div>
        )}
      </div>
    </section>
  );
}
