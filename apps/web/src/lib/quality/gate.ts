import { formatDay } from "@/lib/mrv/days";
import type { DateRange } from "@/lib/mrv/types";
import { isBlocking, touches, verdictFor, type QualityFinding, type QualityRun } from "./types";

/**
 * The registry submit rule for data: a period goes to a registry only when the data
 * quality engine's latest run has seen all of it and its verdict for those days is
 * not "blocked". A finding that needs a look does not stop it: a detector never
 * blocks on its own, only once a person confirms it. It replaces the rule that a
 * write needed a green Sentinel DQA run.
 *
 * Returns why a write is refused, or null. With no period, the whole run is judged.
 */
export function submitBlockReason(run: QualityRun | null, findings: QualityFinding[], period: DateRange | null): string | null {
  if (!run) return "The data quality checks have not run on this project yet. Run them, then submit.";
  const checked = run.range ?? null;
  if (!checked) return "The data quality checks found no monitoring data for this project.";
  if (period && checked.end < period.end) {
    return `The data quality checks have only seen data up to ${formatDay(checked.end)}, before this period ends. Run them again, then submit.`;
  }
  const window = period ?? checked;
  if (verdictFor(findings, window) !== "blocked") return null;
  const first = findings.find((finding) => isBlocking(finding) && touches(finding, window));
  return `Data quality blocks this period${first ? `: ${first.text.headline}` : ""}. Fix it, or have it dismissed with a reason, then submit.`;
}

/** A period from two day keys, or null when either is missing or malformed. */
export function periodOf(start: string | undefined, end: string | undefined): DateRange | null {
  const day = /^\d{4}-\d{2}-\d{2}$/;
  return start && end && day.test(start) && day.test(end) && start <= end ? { start, end } : null;
}
