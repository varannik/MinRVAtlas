"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

import { useQuality, type QualityState } from "@/hooks/use-quality";
import type { DateRange } from "@/lib/mrv/types";
import { isBlocking, touches, type QualityFinding } from "@/lib/quality/types";
import { useLedgerProject } from "./use-journey-ledger";

/**
 * The data quality engine's findings for the journey's project, loaded once for
 * the whole page: the ledger's period details, the calculation tree's trend and
 * the step panel's task cards all read the same run.
 */

const QualityContext = createContext<QualityState | null>(null);

export function JourneyQuality({ requested, children }: { requested: string | null; children: ReactNode }) {
  const project = useLedgerProject(requested);
  const quality = useQuality(project?.id ?? null);
  return <QualityContext value={quality}>{children}</QualityContext>;
}

export function useJourneyQuality(): QualityState | null {
  return useContext(QualityContext);
}

/** Open findings worth acting on (not dismissed, not for information) on these days, blocking ones first. */
export function openFindings(findings: QualityFinding[] | undefined, range: DateRange | null): QualityFinding[] {
  if (!findings || !range) return [];
  return findings
    .filter((finding) => finding.status !== "dismissed" && finding.severity !== "info" && touches(finding, range))
    .sort((a, b) => Number(isBlocking(b)) - Number(isBlocking(a)) || a.start.localeCompare(b.start));
}

/** Findings whose records are filed on this journey task, for the period in progress. */
export function useTaskFindings(taskId: string, period: DateRange | null): QualityFinding[] {
  const findings = useJourneyQuality()?.view?.findings;
  return useMemo(() => openFindings(findings, period).filter((finding) => finding.task === taskId), [findings, period, taskId]);
}
