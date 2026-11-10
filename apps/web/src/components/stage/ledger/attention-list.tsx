"use client";

import { ArrowRight, CircleAlert, Info, Layers, TriangleAlert } from "lucide-react";
import { blockAt } from "@/lib/mrv/blocks";
import type { Finding } from "@/lib/mrv/checks";
import { formatDay } from "@/lib/mrv/days";
import { STAGE_META } from "@/lib/mrv/registry-pipeline";
import type { DayKey, IssueSeverity, LedgerBlock } from "@/lib/mrv/types";
import { useStage } from "@/store/stage-store";
import { formatTonnes } from "../format";
import { BLOCK_TONE, SEVERITY_TONE } from "../theme";

const ICON: Record<IssueSeverity, typeof TriangleAlert> = { blocker: TriangleAlert, warning: CircleAlert, info: Info };

/**
 * What the expert should look at first when nothing is selected: blocks the
 * registry or verifier pushed back, open data to batch, and what the data
 * checks found across the whole history.
 */
export function AttentionList({
  blocks,
  findings,
  unclaimed,
  openFrom,
  onBatchNext,
}: {
  blocks: LedgerBlock[];
  findings: Finding[];
  unclaimed: number;
  openFrom: DayKey | null;
  onBatchNext: () => void;
}) {
  const focusBlock = useStage((state) => state.focusBlock);
  const flagged = blocks.filter((block) => block.stage === "issues" || block.issues.some((issue) => issue.severity === "blocker"));
  const top = findings.filter((finding) => finding.severity !== "info").slice(0, 4);

  return (
    <section className="space-y-3">
      <p className="text-[10px] font-semibold tracking-[0.14em] text-mist uppercase">Needs attention</p>
      <ul className="space-y-1.5">
        {flagged.map((block) => (
          <li key={block.id}>
            <button
              type="button"
              onClick={() => focusBlock(block.id)}
              className="flex w-full items-center gap-3 rounded-xl bg-white/80 px-3 py-2 text-left ring-1 ring-line/60 hover:ring-rock/40"
            >
              <span className="h-8 w-1.5 shrink-0 rounded-full" style={{ background: BLOCK_TONE[block.stage].face }} />
              <span className="min-w-0 flex-1">
                <span className="block text-[12px] font-semibold text-frost">
                  Block #{block.sequence} · {block.label} — {STAGE_META[block.stage].label.toLowerCase()}
                </span>
                <span className="block truncate text-[10.5px] text-mist">{block.issues[0]?.title ?? "Open the block for details"}</span>
              </span>
              <ArrowRight className="size-3.5 shrink-0 text-mist" />
            </button>
          </li>
        ))}
        {openFrom && unclaimed > 0 ? (
          <li>
            <button
              type="button"
              onClick={onBatchNext}
              className="flex w-full items-center gap-3 rounded-xl bg-white/80 px-3 py-2 text-left ring-1 ring-line/60 hover:ring-rock/40"
            >
              <Layers className="size-4 shrink-0 text-canyon" />
              <span className="min-w-0 flex-1">
                <span className="block text-[12px] font-semibold text-frost">{formatTonnes(unclaimed)} t not in any block yet</span>
                <span className="block truncate text-[10.5px] text-mist">Open since {formatDay(openFrom)} — propose the next quarter</span>
              </span>
              <ArrowRight className="size-3.5 shrink-0 text-mist" />
            </button>
          </li>
        ) : null}
      </ul>
      {top.length ? (
        <div>
          <p className="mb-1 text-[10px] font-semibold tracking-[0.14em] text-mist uppercase">Data checks across all data</p>
          <ul className="space-y-0.5">
            {top.map((finding) => {
              const Icon = ICON[finding.severity];
              const owner = finding.range ? blockAt(blocks, finding.range.start) : null;
              const body = (
                <>
                  <Icon className="mt-0.5 size-3.5 shrink-0" style={{ color: SEVERITY_TONE[finding.severity].color }} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11.5px] leading-snug font-medium text-frost">{finding.title}</span>
                    {finding.detail ? <span className="block text-[10.5px] leading-snug text-mist">{finding.detail}</span> : null}
                  </span>
                  {owner ? <span className="shrink-0 rounded bg-ink-700 px-1.5 py-px text-[9px] font-semibold text-mist">#{owner.sequence}</span> : null}
                </>
              );
              return (
                <li key={finding.id}>
                  {owner ? (
                    <button type="button" onClick={() => focusBlock(owner.id)} className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-off-white">
                      {body}
                    </button>
                  ) : (
                    <div className="flex items-start gap-2 px-2 py-1.5">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
