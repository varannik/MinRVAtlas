import type { RequirementItem, SpecItem } from "./types";

const READ_ONLY_GROUPS = new Set(["PRE", "REG", "VV", "FDS"]);
const READ_ONLY_IDS = new Set([
  "pdd",
  "validation-report",
  "safeguards",
  "lca",
]);

function daysBetween(start: string, end: string): number {
  const from = Date.parse(`${start}T00:00:00Z`);
  const to = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return 0;
  return Math.round((to - from) / 86_400_000);
}

function cadenceKey(cadence?: string): string {
  return (cadence ?? "").toLowerCase();
}

/**
 * Whether this requirement is expected in the open reporting window.
 * Validation-once / published docs stay on the board as read-only.
 */
export function isDueThisPeriod(
  item: Pick<SpecItem, "id" | "cadence" | "mandatory"> & {
    groupCode?: string;
  },
  periodStart: string,
  periodEnd: string,
): boolean {
  if (item.groupCode && READ_ONLY_GROUPS.has(item.groupCode)) return false;
  const suffix = item.id.split(".").pop() ?? item.id;
  if (READ_ONLY_IDS.has(suffix)) return false;

  const cadence = cadenceKey(item.cadence);
  const span = daysBetween(periodStart, periodEnd);

  if (
    !cadence ||
    cadence.includes("continuous") ||
    cadence.includes("daily") ||
    cadence.includes("week") ||
    cadence.includes("month") ||
    cadence.includes("periodic") ||
    cadence.includes("quarter") ||
    cadence.includes("injection") ||
    cadence.includes("production")
  ) {
    return true;
  }
  if (cadence.includes("6 month") || cadence.includes("semiannual")) {
    return span >= 80;
  }
  if (cadence.includes("annual") || cadence.includes("year")) {
    if (cadence.includes("2 year")) return span >= 600 || !item.mandatory;
    if (cadence.includes("5 year")) return span >= 300;
    return span >= 180 || periodEnd.slice(5) >= "12-01";
  }
  if (cadence.includes("once") || cadence.includes("not applicable")) {
    return false;
  }
  return Boolean(item.mandatory);
}

export function coverageFromEvidence(
  item: Pick<RequirementItem, "evidence">,
  periodStart: string,
  periodEnd: string,
): "valid" | "partial" | "missing" {
  const evidence = item.evidence ?? [];
  let overlaps = false;
  for (const entry of evidence) {
    const from = entry.validFrom ?? "0000-01-01";
    const to = entry.validTo;
    if (from <= periodStart && to >= periodEnd) return "valid";
    if (from <= periodEnd && to >= periodStart) overlaps = true;
  }
  return overlaps ? "partial" : "missing";
}
