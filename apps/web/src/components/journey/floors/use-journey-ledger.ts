"use client";

import { useEffect, useMemo } from "react";

import { useReportingPeriods } from "@/hooks/use-reporting-periods";
import { useRequirementSpec } from "@/hooks/use-requirement-spec";
import { useResolvedProject } from "@/hooks/use-visible-projects";
import { overlayBatches } from "@/lib/sentinel/overlay";
import { getSubmissions } from "@/lib/submissions";
import type { Project, SubmissionBatch } from "@/lib/types";
import { useDashboard } from "@/store/dashboard-store";
import { useJourney } from "@/store/journey-store";
import { useLiveProjects } from "@/store/live-projects-store";
import { hydratePipelineStore, usePipeline } from "@/store/pipeline-store";
import { useRegistrySubmit } from "@/store/registry-submit-store";

/**
 * The Atlas project behind the journey, whose removal ledger fills the floors
 * below validation: the stored project open, else the one the link names,
 * else the practice scenario's own project (Fujairah is in the catalogue).
 */
export function useLedgerProject(requested: string | null): Project | undefined {
  const stored = useJourney((state) => state.project?.id ?? null);
  const scenarioId = useJourney((state) => state.scenarioId);
  const seeded = useJourney((state) => state.practiceSeed !== null);
  const id = stored ?? requested ?? (!seeded && scenarioId !== "new" ? scenarioId : null);

  const project = useResolvedProject(id);
  const tenantId = useDashboard((state) => state.tenantId);
  const liveOrigin = useLiveProjects((state) => state.origin);
  const loadLive = useLiveProjects((state) => state.load);

  // Not in the catalogue: it may be a live registry project, listed once per session.
  useEffect(() => {
    if (id && !project && liveOrigin === "idle") void loadLive(tenantId);
  }, [id, liveOrigin, loadLive, project, tenantId]);

  return project;
}

/** The project's reporting periods as the ledger reads them, built the same way as on the Atlas. */
export function useProjectBatches(project: Project | undefined): SubmissionBatch[] | null {
  const { spec } = useRequirementSpec(project);
  const { periods } = useReportingPeriods(project);
  const pipelineByKey = usePipeline((state) => state.byKey);
  const submitByKey = useRegistrySubmit((state) => state.byKey);

  useEffect(() => {
    hydratePipelineStore();
  }, []);

  const raw = useMemo(() => (project && spec ? getSubmissions(project, spec, periods) : null), [periods, project, spec]);
  return useMemo(() => (raw ? overlayBatches(raw, pipelineByKey, submitByKey) : null), [pipelineByKey, raw, submitByKey]);
}
