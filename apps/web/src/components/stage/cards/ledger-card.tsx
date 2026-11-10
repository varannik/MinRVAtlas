"use client";

import { useMemo } from "react";
import { nextOpenDay } from "@/lib/mrv/blocks";
import { formatDay } from "@/lib/mrv/days";
import { ledgerTotals } from "@/lib/mrv/summary";
import { useStage } from "@/store/stage-store";
import { formatTonnes } from "../format";
import { useStageContext } from "../ledger-context";
import { BLOCK_TONE, ORIGIN_BADGE, PROPOSAL } from "../theme";
import { StageCard } from "./stage-card";

const SEGMENTS = [
  { key: "issued", label: "issued", color: BLOCK_TONE.issued.face },
  { key: "inReview", label: "in review", color: BLOCK_TONE.verification.face },
  { key: "draft", label: "draft", color: BLOCK_TONE.draft.side },
  { key: "unclaimed", label: "open", color: PROPOSAL.stroke },
] as const;

/** Every tonne as one bar, split by where it sits with the registry. */
function AllocationBar({ parts, total }: { parts: { key: string; label: string; color: string; value: number }[]; total: number }) {
  const shown = parts.filter((part) => part.value > 0);
  return (
    <div>
      <div className="flex h-3 gap-[3px] overflow-hidden rounded-full">
        {total > 0 ? (
          shown.map((part) => (
            <span key={part.key} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${(part.value / total) * 100}%`, background: part.color }} />
          ))
        ) : (
          <span className="h-full w-full rounded-full bg-ink-600/60" />
        )}
      </div>
      <p className="mt-2 truncate text-[10.5px] text-mist tabular-nums">
        {total > 0 ? shown.map((part) => `${Math.round((part.value / total) * 100)}% ${part.label}`).join(" · ") : "Nothing calculated yet"}
      </p>
    </div>
  );
}

/** The chain's newest blocks as small cubes, a glimpse of the ledger page. */
function MiniChain({ stages }: { stages: (keyof typeof BLOCK_TONE)[] }) {
  return (
    <div className="absolute top-3 right-3 flex items-end gap-1.5">
      {stages.map((stage, index) => {
        const tone = BLOCK_TONE[stage];
        return (
          <span key={index} className="relative" style={{ width: 26, height: 30 }}>
            <span className="absolute top-0 left-0" style={{ width: 22, height: 4, background: tone.top, transform: "skewX(-45deg)", transformOrigin: "bottom left" }} />
            <span className="absolute bottom-0" style={{ left: 22, width: 4, height: 22, background: tone.side, transform: "skewY(-45deg)", transformOrigin: "bottom left" }} />
            <span className="absolute bottom-0 left-0" style={{ width: 22, height: 22, background: tone.face }} />
          </span>
        );
      })}
      <span className="ml-1 rounded-[3px] border border-dashed border-white/50" style={{ width: 22, height: 22 }} />
    </div>
  );
}

export function LedgerCard() {
  const { ledger } = useStageContext();
  const { spec, blocks, bounds, daily, dataset, status } = ledger;
  const openLedger = useStage((state) => state.openLedger);
  const totals = useMemo(() => ledgerTotals(daily, blocks), [blocks, daily]);
  const badge = ORIGIN_BADGE[dataset?.origin ?? "none"];
  const openFrom = bounds ? nextOpenDay(blocks, bounds) : null;
  const ready = status === "ready" && bounds;

  return (
    <StageCard
      side="left"
      eyebrow="Removal ledger"
      badge={{ label: badge.label, className: badge.className, title: dataset?.note ?? badge.title }}
      title={spec.methodology}
      subtitle={`${spec.registry} · ${blocks.length} block${blocks.length === 1 ? "" : "s"} · ${spec.creditUnit === "CORC" ? "CORCs" : "credits"}`}
      hero={{
        label: "Net removed",
        value: ready ? formatTonnes(totals.net) : "—",
        unit: "tCO₂e",
        caption: status === "loading" ? "Reading monitoring data…" : totals.pendingDays ? `${totals.pendingDays} days awaiting inputs` : "All data to date",
      }}
      visual={<AllocationBar total={totals.net} parts={SEGMENTS.map((segment) => ({ ...segment, value: totals[segment.key] }))} />}
      metrics={[
        { label: "Issued", value: formatTonnes(totals.issued), unit: "t", color: BLOCK_TONE.issued.face },
        { label: "In review", value: formatTonnes(totals.inReview), unit: "t", color: BLOCK_TONE.verification.face, hint: totals.draft > 0 ? `+${formatTonnes(totals.draft)} t in drafts` : "Registry & verifier" },
        { label: "Unclaimed", value: formatTonnes(totals.unclaimed), unit: "t", color: PROPOSAL.stroke, hint: "Ready to batch" },
      ]}
      preview={
        <>
          <div className="calc-stage__grid absolute inset-0 opacity-60" />
          <MiniChain stages={blocks.slice(-5).map((block) => block.stage)} />
        </>
      }
      cta={{ label: "Open ledger", detail: openFrom ? `Next block from ${formatDay(openFrom)}` : "Blocks, timeline & calculation trees" }}
      onOpen={openLedger}
    />
  );
}
