import { addDays, contains, overlaps } from "./days";
import type { BlockIssue, BlockStage, DateRange, DayKey, LedgerBlock } from "./types";
import type { SubmissionBatch, SubmissionStatus } from "../types";

/**
 * Blocks are the registry batches a project's data is cut into. Like blocks
 * on a chain they never overlap, so no tonne is claimed twice.
 */

const STAGE_FROM_STATUS: Record<SubmissionStatus, BlockStage> = {
  assembling: "draft",
  submitted: "submitted",
  "in-verification": "verification",
  issued: "issued",
  rejected: "issues",
};

function requirementIssues(batch: SubmissionBatch): BlockIssue[] {
  const issues: BlockIssue[] = [];
  if (batch.status === "rejected") {
    issues.push({
      id: `${batch.id}:rejected`,
      severity: "blocker",
      title: "Returned by the registry",
      detail: "The registry sent this period back. Open the filing desk for the reviewer's notes.",
      source: "registry",
    });
  }
  for (const item of batch.items) {
    if (!item.dueThisPeriod || !item.mandatory) continue;
    if (item.state !== "missing" && item.state !== "rejected") continue;
    issues.push({
      id: `${batch.id}:${item.slotId}`,
      severity: item.state === "rejected" ? "blocker" : "warning",
      title: item.state === "rejected" ? `${item.label} rejected` : `${item.label} not filed`,
      detail: item.reference,
      source: "requirements",
    });
  }
  return issues;
}

/** Reporting periods (registry or local draft) as ledger blocks. */
export function blocksFromBatches(batches: SubmissionBatch[]): LedgerBlock[] {
  return batches.map((batch) => ({
    id: batch.id,
    sequence: batch.sequence,
    range: { start: batch.periodStart, end: batch.periodEnd },
    label: batch.periodLabel,
    stage: STAGE_FROM_STATUS[batch.status],
    origin: batch.origin === "certify" ? "registry" : "draft",
    hash: batch.hash,
    issues: requirementIssues(batch),
    registryRef: batch.ghgStatementId,
  }));
}

/**
 * Real periods first; sample history only where it does not collide with
 * them, then renumbered in date order.
 */
export function mergeBlocks(real: LedgerBlock[], sample: LedgerBlock[]): LedgerBlock[] {
  const kept = sample.filter((row) => !real.some((block) => overlaps(block.range, row.range)));
  return [...real, ...kept]
    .sort((a, b) => a.range.start.localeCompare(b.range.start))
    .map((block, index) => ({ ...block, sequence: index + 1 }));
}

export function blockAt(blocks: LedgerBlock[], day: DayKey): LedgerBlock | null {
  return blocks.find((block) => contains(block.range, day)) ?? null;
}

export function overlapsAny(range: DateRange, blocks: LedgerBlock[]): LedgerBlock | null {
  return blocks.find((block) => overlaps(block.range, range)) ?? null;
}

/** Unclaimed stretch of `bounds` around `day`, or null if the day is claimed. */
export function freeGapAt(day: DayKey, blocks: LedgerBlock[], bounds: DateRange): DateRange | null {
  if (!contains(bounds, day) || blockAt(blocks, day)) return null;
  let start = bounds.start;
  let end = bounds.end;
  for (const block of blocks) {
    if (block.range.end < day && block.range.end >= start) start = addDays(block.range.end, 1);
    if (block.range.start > day && block.range.start <= end) end = addDays(block.range.start, -1);
  }
  return { start, end };
}

/** Clip a dragged range to the free gap that holds its anchor day. */
export function clampToGap(anchor: DayKey, other: DayKey, blocks: LedgerBlock[], bounds: DateRange): DateRange | null {
  const gap = freeGapAt(anchor, blocks, bounds);
  if (!gap) return null;
  const clipped = other < gap.start ? gap.start : other > gap.end ? gap.end : other;
  return anchor <= clipped ? { start: anchor, end: clipped } : { start: clipped, end: anchor };
}

/** Every unclaimed stretch inside `bounds`, oldest first. */
export function freeGaps(blocks: LedgerBlock[], bounds: DateRange): DateRange[] {
  const sorted = [...blocks].sort((a, b) => a.range.start.localeCompare(b.range.start));
  const gaps: DateRange[] = [];
  let cursor = bounds.start;
  for (const block of sorted) {
    if (block.range.end < cursor) continue;
    if (block.range.start > bounds.end) break;
    if (block.range.start > cursor) gaps.push({ start: cursor, end: addDays(block.range.start, -1) });
    cursor = addDays(block.range.end, 1);
  }
  if (cursor <= bounds.end) gaps.push({ start: cursor, end: bounds.end });
  return gaps;
}

/** First unclaimed day after the newest block, or the start of `bounds`. */
export function nextOpenDay(blocks: LedgerBlock[], bounds: DateRange): DayKey | null {
  const latest = blocks.reduce<DayKey | null>((max, block) => (!max || block.range.end > max ? block.range.end : max), null);
  const day = latest ? addDays(latest, 1) : bounds.start;
  return day <= bounds.end ? day : null;
}

/** Calendar-aligned window from `start`: the rest of its month, or a quarter. */
export function presetRange(start: DayKey, months: number, blocks: LedgerBlock[], bounds: DateRange): DateRange | null {
  const [y, m] = start.split("-").map(Number);
  const endMonth = m - 1 + months;
  const end = new Date(Date.UTC(y, endMonth, 0)).toISOString().slice(0, 10);
  return clampToGap(start, end, blocks, bounds);
}
