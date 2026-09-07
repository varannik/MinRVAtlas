"use client";

import { useEffect } from "react";
import { latestPeriodId, type ReportingPeriod } from "@/lib/period-desk";
import { periodsFor, usePeriodStore } from "@/store/period-store";
import type { Project } from "@/lib/types";

export function useReportingPeriods(project: Project | undefined) {
  const byProject = usePeriodStore((state) => state.byProject);
  const hydrate = usePeriodStore((state) => state.hydrate);
  const mergeFetched = usePeriodStore((state) => state.mergeFetched);
  const addDraft = usePeriodStore((state) => state.addDraft);
  const markStatus = usePeriodStore((state) => state.markStatus);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (!project) return;
    const controller = new AbortController();
    fetch(`/api/registry/periods?projectId=${encodeURIComponent(project.id)}`, {
      headers: { "x-tenant-id": project.tenantId },
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { periods?: ReportingPeriod[] } | null) => {
        if (!payload) return;
        mergeFetched(project.id, payload.periods ?? []);
      })
      .catch(() => {
        if (!usePeriodStore.getState().byProject[project.id]?.length) {
          mergeFetched(project.id, []);
        }
      });
    return () => controller.abort();
  }, [mergeFetched, project]);

  const periods = project
    ? (byProject[project.id] ?? periodsFor(project.id))
    : [];

  return {
    periods,
    latestId: latestPeriodId(periods),
    addDraft,
    markStatus,
  };
}
