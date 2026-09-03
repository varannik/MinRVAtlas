import type { BatchGroup, RequirementItem, SubmissionBatch } from "@/lib/types";
import {
  itemStateFromPipeline,
  pipelineKey,
  type PipelineResult,
} from "./pipeline-types";

export function overlayBatch(
  batch: SubmissionBatch,
  byKey: Record<string, PipelineResult>,
): SubmissionBatch {
  let changed = false;

  const overlayItem = (item: RequirementItem): RequirementItem => {
    const result = byKey[pipelineKey(batch.projectId, batch.id, item.slotId)];
    if (!result) return item;
    const state = itemStateFromPipeline(result);
    if (state === item.state) return item;
    changed = true;
    return { ...item, state };
  };

  const items = batch.items.map(overlayItem);
  const groups: BatchGroup[] = batch.groups.map((group) => ({
    ...group,
    items: group.items.map(overlayItem),
  }));

  if (!changed) return batch;

  const complete = items.filter((item) => item.state === "complete").length;
  return {
    ...batch,
    items,
    groups,
    completion: items.length
      ? Math.round((complete / items.length) * 100)
      : batch.completion,
    blockers: items.filter(
      (item) =>
        item.mandatory &&
        (item.state === "missing" || item.state === "rejected"),
    ).length,
    outstanding: items.length - complete,
  };
}

export function overlayBatches(
  batches: SubmissionBatch[],
  byKey: Record<string, PipelineResult>,
): SubmissionBatch[] {
  let changed = false;
  const next = batches.map((batch) => {
    const overlaid = overlayBatch(batch, byKey);
    if (overlaid !== batch) changed = true;
    return overlaid;
  });
  return changed ? next : batches;
}
