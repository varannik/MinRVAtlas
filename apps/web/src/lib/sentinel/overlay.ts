import type { BatchGroup, RequirementItem, SubmissionBatch } from "@/lib/types";
import type { RegistrySubmitRecord } from "@/store/registry-submit-store";
import {
  itemStateFromPipeline,
  pipelineKey,
  type PipelineResult,
} from "./pipeline-types";

function overlayState(
  item: RequirementItem,
  pipeline?: PipelineResult,
  submit?: RegistrySubmitRecord,
): RequirementItem {
  if (submit?.ok || submit?.status === "submitted") {
    return { ...item, state: "submitted" };
  }
  if (pipeline) {
    return { ...item, state: itemStateFromPipeline(pipeline) };
  }
  return item;
}

function coverage(items: RequirementItem[]): "valid" | "partial" | "missing" {
  const due = items.filter((item) => item.dueThisPeriod && item.mandatory);
  if (due.length === 0) return "missing";
  const submitted = due.filter((item) => item.state === "submitted").length;
  if (submitted === due.length) return "valid";
  if (
    submitted > 0 ||
    due.some((item) => item.state === "pending" || item.state === "complete")
  ) {
    return "partial";
  }
  return "missing";
}

function stats(items: RequirementItem[]) {
  const due = items.filter((item) => item.dueThisPeriod);
  const complete = due.filter(
    (item) => item.state === "submitted" || item.state === "complete",
  ).length;
  return {
    completion: due.length ? Math.round((complete / due.length) * 100) : 0,
    blockers: due.filter(
      (item) =>
        item.mandatory &&
        (item.state === "missing" || item.state === "rejected"),
    ).length,
    outstanding: due.length - complete,
    monitoringCoverage: coverage(items),
  };
}

export function overlayBatch(
  batch: SubmissionBatch,
  byKey: Record<string, PipelineResult>,
  submitByKey: Record<string, RegistrySubmitRecord> = {},
): SubmissionBatch {
  let changed = false;

  const overlayItem = (item: RequirementItem): RequirementItem => {
    const key = pipelineKey(batch.projectId, batch.id, item.slotId);
    const next = overlayState(item, byKey[key], submitByKey[key]);
    if (next.state === item.state) return item;
    changed = true;
    return next;
  };

  const items = batch.items.map(overlayItem);
  const groups: BatchGroup[] = batch.groups.map((group) => ({
    ...group,
    items: group.items.map(overlayItem),
  }));

  if (!changed) return batch;

  return {
    ...batch,
    items,
    groups,
    ...stats(items),
  };
}

export function overlayBatches(
  batches: SubmissionBatch[],
  byKey: Record<string, PipelineResult>,
  submitByKey: Record<string, RegistrySubmitRecord> = {},
): SubmissionBatch[] {
  let changed = false;
  const next = batches.map((batch) => {
    const overlaid = overlayBatch(batch, byKey, submitByKey);
    if (overlaid !== batch) changed = true;
    return overlaid;
  });
  return changed ? next : batches;
}
