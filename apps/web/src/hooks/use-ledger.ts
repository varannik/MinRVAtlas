"use client";

import { useEffect, useMemo } from "react";
import { blocksFromBatches, mergeBlocks } from "@/lib/mrv/blocks";
import { calcSpecFor } from "@/lib/mrv/calc/specs";
import { dailySeries, evaluate, indexDataset, type DailyPoint, type DatasetIndex } from "@/lib/mrv/calc/evaluate";
import type { CalcSpec, Evaluation } from "@/lib/mrv/calc/types";
import type { DateRange, LedgerBlock, MrvDataset } from "@/lib/mrv/types";
import { useMrvData } from "@/store/mrv-data-store";
import type { Project, SubmissionBatch } from "@/lib/types";

export interface Ledger {
  status: "loading" | "ready" | "error";
  error?: string;
  dataset: MrvDataset | null;
  spec: CalcSpec;
  index: DatasetIndex | null;
  /** Every block, real and sample, oldest first. */
  blocks: LedgerBlock[];
  /** Days the timeline spans. */
  bounds: DateRange | null;
  daily: DailyPoint[];
  /** Root evaluation per block id. */
  blockResults: Map<string, Evaluation>;
}

function boundsOf(dataset: MrvDataset | null, blocks: LedgerBlock[]): DateRange | null {
  const starts = [dataset?.range?.start, ...blocks.map((block) => block.range.start)].filter(Boolean) as string[];
  if (!starts.length || !dataset) return null;
  const ends = [dataset.asOf, dataset.range?.end, ...blocks.map((block) => block.range.end)].filter(Boolean) as string[];
  return { start: starts.sort()[0], end: ends.sort()[ends.length - 1] };
}

/** Everything the ledger, pulse and calculation view derive from one project's data. */
export function useLedger(project: Project, batches: SubmissionBatch[] | null): Ledger {
  const entry = useMrvData((state) => state.byProject[project.id]);
  const load = useMrvData((state) => state.load);

  useEffect(() => {
    void load(project);
  }, [load, project]);

  const dataset = entry?.status === "ready" ? entry.dataset : null;
  const spec = useMemo(() => calcSpecFor(project), [project]);
  const index = useMemo(() => (dataset ? indexDataset(dataset) : null), [dataset]);
  const blocks = useMemo(
    () => mergeBlocks(blocksFromBatches(batches ?? []), dataset?.blocks ?? []),
    [batches, dataset],
  );
  const bounds = useMemo(() => boundsOf(dataset, blocks), [blocks, dataset]);
  const daily = useMemo(
    () => (index && bounds ? dailySeries(spec, index, bounds) : []),
    [bounds, index, spec],
  );
  const blockResults = useMemo(() => {
    const map = new Map<string, Evaluation>();
    if (!index) return map;
    for (const block of blocks) map.set(block.id, evaluate(spec, index, block.range));
    return map;
  }, [blocks, index, spec]);

  return {
    status: entry?.status ?? "loading",
    error: entry?.status === "error" ? entry.error : undefined,
    dataset,
    spec,
    index,
    blocks,
    bounds,
    daily,
    blockResults,
  };
}
