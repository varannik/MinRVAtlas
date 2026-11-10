/**
 * Shared shapes for the project stage: the data we hold for a project, the
 * blocks it is batched into for the registry, and the checks run over both.
 *
 * Everything here is plain data so the server, the client and tests can use it.
 */

/** UTC calendar day, `YYYY-MM-DD`. */
export type DayKey = string;

/** Inclusive day range. */
export interface DateRange {
  start: DayKey;
  end: DayKey;
}

/** One stream metric folded into a single day. */
export interface MetricDay {
  sum: number;
  mean: number;
  min: number;
  max: number;
  last: number;
  count: number;
}

export interface DailyMetrics {
  day: DayKey;
  metrics: Record<string, MetricDay>;
}

/**
 * How a fixed value applies to a shorter window:
 * - `intensity`: a factor (kg/kWh, fraction) used as-is in any window.
 * - `prorata`: a total for its validity window, shared out by days.
 */
export type FixedScaling = "intensity" | "prorata";

/** A value that is not a time series: lab result, LCA factor, period total. */
export interface FixedValue {
  key: string;
  value: number;
  unit?: string;
  validFrom?: DayKey;
  validTo?: DayKey;
  /** Where it came from, e.g. "attributes.json" or "C-14 lab report". */
  source: string;
}

/** Where a dataset came from. `sample` is generated and badged in the UI. */
export type DataOrigin = "stream" | "sample" | "none";

/** Where a block sits in the registry's process. */
export type BlockStage =
  | "draft"
  | "submitted"
  | "verification"
  | "issued"
  | "issues";

export type IssueSeverity = "blocker" | "warning" | "info";

/** Who raised an issue. */
export type IssueSource = "registry" | "vvb" | "checks" | "requirements";

export interface BlockIssue {
  id: string;
  severity: IssueSeverity;
  title: string;
  detail?: string;
  source: IssueSource;
}

/**
 * A batch of monitoring data claimed for one registry submission. Blocks
 * never overlap, so no day is counted twice.
 */
export interface LedgerBlock {
  id: string;
  sequence: number;
  range: DateRange;
  label: string;
  stage: BlockStage;
  origin: "registry" | "draft" | "sample";
  /** Short content hash, shown like a block hash. */
  hash: string;
  issues: BlockIssue[];
  /** Registry-side id (statement, output report), when there is one. */
  registryRef?: string;
  /** Credits issued for this block, when the registry has issued. */
  issuedT?: number;
  updatedOn?: DayKey;
  verifier?: string;
}

/** Everything the stage needs about one project's monitoring data. */
export interface MrvDataset {
  projectId: string;
  origin: DataOrigin;
  /** Why the origin was chosen, shown next to the badge. */
  note?: string;
  range: DateRange | null;
  days: DailyMetrics[];
  fixed: FixedValue[];
  /** Latest reading timestamp (ISO). */
  latestAt?: string;
  /** Server's UTC day when the dataset was read; the timeline ends here. */
  asOf: DayKey;
  /** Registry history that came with sample data. Empty for real data. */
  blocks: LedgerBlock[];
}

export function emptyDataset(projectId: string, asOf: DayKey, note?: string): MrvDataset {
  return {
    projectId,
    origin: "none",
    note,
    asOf,
    range: null,
    days: [],
    fixed: [],
    blocks: [],
  };
}
