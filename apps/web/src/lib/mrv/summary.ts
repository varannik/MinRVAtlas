import { blockAt } from "./blocks";
import type { DailyPoint } from "./calc/evaluate";
import type { BlockStage, LedgerBlock } from "./types";

/**
 * Where every calculated tonne sits, for the ledger summary. Each day's net is
 * filed under the block that claims it, so the four buckets always add up to
 * the total.
 */
export interface LedgerTotals {
  net: number;
  issued: number;
  /** Submitted, with the verifier, or sent back with issues. */
  inReview: number;
  /** In local draft blocks, not yet sent. */
  draft: number;
  unclaimed: number;
  /** Days with data whose net cannot be calculated yet. */
  pendingDays: number;
}

const BUCKET: Record<BlockStage, keyof Pick<LedgerTotals, "issued" | "inReview" | "draft">> = {
  issued: "issued",
  submitted: "inReview",
  verification: "inReview",
  issues: "inReview",
  draft: "draft",
};

export function ledgerTotals(daily: DailyPoint[], blocks: LedgerBlock[]): LedgerTotals {
  const totals: LedgerTotals = { net: 0, issued: 0, inReview: 0, draft: 0, unclaimed: 0, pendingDays: 0 };
  for (const point of daily) {
    if (point.value == null) {
      if (point.proxy != null) totals.pendingDays += 1;
      continue;
    }
    totals.net += point.value;
    const owner = blockAt(blocks, point.day);
    if (owner) totals[BUCKET[owner.stage]] += point.value;
    else totals.unclaimed += point.value;
  }
  return totals;
}
