"use client";

import { create } from "zustand";
import {
  formatPeriodLabel,
  periodsOverlap,
  sortPeriods,
  withSequences,
  type ReportingPeriod,
} from "@/lib/period-desk";

const STORAGE_KEY = "minrv-reporting-periods";

type PeriodState = {
  byProject: Record<string, ReportingPeriod[]>;
  hydrated: boolean;
  hydrate: () => void;
  mergeFetched: (projectId: string, fetched: ReportingPeriod[]) => void;
  addDraft: (
    projectId: string,
    periodStart: string,
    periodEnd: string,
    notBefore?: string | null,
  ) => { ok: true; period: ReportingPeriod } | { ok: false; error: string };
  removePeriod: (projectId: string, periodId: string) => void;
  markStatus: (
    projectId: string,
    periodId: string,
    status: ReportingPeriod["status"],
    ghgStatementId?: string,
  ) => void;
};

function readStored(): Record<string, ReportingPeriod[]> {
  if (typeof window === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, ReportingPeriod[]>;
    if (!parsed || typeof parsed !== "object") return {};
    const next: Record<string, ReportingPeriod[]> = {};
    for (const [projectId, periods] of Object.entries(parsed)) {
      next[projectId] = (periods ?? []).filter(
        (period) => !/^draft-.+-\d{4}$/.test(period.id),
      );
    }
    return next;
  } catch {
    return {};
  }
}

function writeStored(byProject: Record<string, ReportingPeriod[]>) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(byProject));
}

function ordered(periods: ReportingPeriod[]): ReportingPeriod[] {
  return withSequences(sortPeriods(periods));
}

export const usePeriodStore = create<PeriodState>((set, get) => ({
  byProject: {},
  hydrated: false,
  hydrate: () => {
    if (get().hydrated) return;
    set({ byProject: readStored(), hydrated: true });
  },
  mergeFetched: (projectId, fetched) =>
    set((state) => {
      const current = state.byProject[projectId] ?? [];
      const drafts = current.filter(
        (period) =>
          period.origin === "draft" && !/^draft-.+-\d{4}$/.test(period.id),
      );
      const keptDrafts = drafts.filter(
        (draft) =>
          !fetched.some((row) =>
            periodsOverlap(
              draft.periodStart,
              draft.periodEnd,
              row.periodStart,
              row.periodEnd,
            ),
          ),
      );
      const next = {
        ...state.byProject,
        [projectId]: ordered([...fetched, ...keptDrafts]),
      };
      writeStored(next);
      return { byProject: next, hydrated: true };
    }),
  addDraft: (projectId, periodStart, periodEnd, notBefore) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) {
      return { ok: false, error: "Use ISO dates (YYYY-MM-DD)" };
    }
    if (periodStart > periodEnd) {
      return { ok: false, error: "Period start must be on or before end" };
    }
    if (notBefore && periodStart < notBefore) {
      return {
        ok: false,
        error: `Cannot start before project design (${notBefore}).`,
      };
    }
    const current = get().byProject[projectId] ?? [];
    const clash = current.find((period) =>
      periodsOverlap(period.periodStart, period.periodEnd, periodStart, periodEnd),
    );
    if (clash) {
      return {
        ok: false,
        error: `Overlaps ${clash.periodLabel}. Periods must not overlap.`,
      };
    }
    const period: ReportingPeriod = {
      id: `draft-${projectId}-${periodStart}-${periodEnd}`,
      projectId,
      periodStart,
      periodEnd,
      periodLabel: formatPeriodLabel(periodStart, periodEnd),
      status: "assembling",
      origin: "draft",
      sequence: current.length + 1,
    };
    const next = {
      ...get().byProject,
      [projectId]: ordered([...current, period]),
    };
    writeStored(next);
    set({ byProject: next, hydrated: true });
    return { ok: true, period };
  },
  removePeriod: (projectId, periodId) =>
    set((state) => {
      const current = state.byProject[projectId] ?? [];
      const next = {
        ...state.byProject,
        [projectId]: ordered(current.filter((period) => period.id !== periodId)),
      };
      writeStored(next);
      return { byProject: next };
    }),
  markStatus: (projectId, periodId, status, ghgStatementId) =>
    set((state) => {
      const current = state.byProject[projectId] ?? [];
      const next = {
        ...state.byProject,
        [projectId]: current.map((period) =>
          period.id === periodId
            ? {
                ...period,
                status,
                ghgStatementId: ghgStatementId ?? period.ghgStatementId,
              }
            : period,
        ),
      };
      writeStored(next);
      return { byProject: next };
    }),
}));

export function periodsFor(projectId: string): ReportingPeriod[] {
  return usePeriodStore.getState().byProject[projectId] ?? [];
}

if (typeof window !== "undefined") {
  usePeriodStore.getState().hydrate();
}
